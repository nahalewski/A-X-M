import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { loadSettings, saveSettings, setGameOverride, Settings } from "./settingsStore";
import { scanAllGames } from "./gameScanner";
import { launchGame } from "./gameLauncher";
import { GameEntry } from "./types";
import { isLosslessScalingConfigPresent } from "./losslessScaling";
import { scanMedia, MediaEntry, MediaKind } from "./mediaScanner";
import { resolveArt, isGameArtConfigured } from "./gameArt";
import { browseMusic, MusicListing } from "./musicLibrary";
import { scanSaves, SaveEntry } from "./saveScanner";
import { browseMedia, BrowseKind, BrowseListing } from "./mediaBrowser";
import { getSteamLibrary, installSteamGame, SteamLibrary } from "./steamLibrary";
import { listGridChoices, resolveIcon, cacheImage, ArtChoice } from "./gameArt";
import { mediaRoot } from "./mediaBrowser";
import * as jellyfin from "./jellyfin";
import { readAnkerStatus, AnkerStatus } from "./ankerMonitor";
import { OverlayHotkey } from "./overlayHotkey";
import { UserProfile, JellyfinLogin } from "./settingsStore";
import * as fs from "node:fs";
import { spawn } from "node:child_process";

// requestAnimationFrame already follows the display's native refresh rate, 120Hz on
// the Ally included. An earlier build added --disable-frame-rate-limit believing it
// lifted a 60fps cap; what it actually does is unhook rAF from vsync entirely, which
// had the ribbon redrawing ~4000 times a second and starving everything else. Don't.
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("high-dpi-support", "1");

let mainWindow: BrowserWindow | null = null;
let cachedGames: GameEntry[] = [];

function createWindow(): void {
  const settings = loadSettings();
  const display = screen.getPrimaryDisplay();

  // Not true fullscreen: the in-game overlay needs a transparent window so the
  // game shows through, and Windows won't do transparency on a fullscreen surface.
  // A frameless window sized to the display looks identical and allows it.
  mainWindow = new BrowserWindow({
    x: settings.windowed ? undefined : display.bounds.x,
    y: settings.windowed ? undefined : display.bounds.y,
    width: settings.windowed ? 1280 : display.bounds.width,
    height: settings.windowed ? 800 : display.bounds.height,
    fullscreen: false,
    autoHideMenuBar: true,
    transparent: !settings.windowed,
    backgroundColor: settings.windowed ? "#050814" : "#00000000",
    frame: settings.windowed,
    resizable: settings.windowed,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Let Chromium pause rendering while a game is in front; otherwise the ribbon
      // keeps drawing at full rate behind it and eats into the game's frame budget.
      backgroundThrottling: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function applyWindowMode(windowed: boolean): void {
  if (!mainWindow) return;
  const display = screen.getPrimaryDisplay();
  mainWindow.setMenuBarVisibility(false);
  if (windowed) {
    mainWindow.setSize(1280, 800);
    mainWindow.center();
  } else {
    mainWindow.setBounds(display.bounds);
  }
}

// ---- In-game overlay ---------------------------------------------------------------
//
// The Guide button toggles the menu over whatever's running, like the PS button and
// the XMB. Shown: the window comes to the front, always-on-top, and the renderer
// drops the ribbons and goes translucent so the game stays visible behind it.
// Hidden: the window hides and focus returns to the game.

let overlayActive = false;
let overlayHotkey: OverlayHotkey | null = null;

function setOverlay(active: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  overlayActive = active;
  if (active) {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    mainWindow.focus();
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.hide();
  }
  mainWindow.webContents.send("axm:overlay", { active });
}

function toggleOverlay(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Visible and in front already? Then this press means "back to the game".
  const inFront = mainWindow.isVisible() && mainWindow.isFocused() && !mainWindow.isMinimized();
  setOverlay(!inFront);
}

app.whenReady().then(() => {
  createWindow();
  overlayHotkey = new OverlayHotkey(toggleOverlay);
  overlayHotkey.start(loadSettings().overlayHotkey);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => overlayHotkey?.stop());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- IPC ----

ipcMain.handle("axm:getSettings", (): Settings => loadSettings());

ipcMain.handle("axm:setSettings", (_e, partial: Partial<Settings>): Settings => {
  const updated = saveSettings(partial);
  if (partial.windowed !== undefined) applyWindowMode(partial.windowed);
  if (partial.overlayHotkey !== undefined) overlayHotkey?.setShortcut(partial.overlayHotkey);
  return updated;
});

ipcMain.handle("axm:overlayClose", (): void => setOverlay(false));
ipcMain.handle("axm:overlayToggle", (): void => toggleOverlay());
ipcMain.handle("axm:overlayState", (): { active: boolean } => ({ active: overlayActive }));

ipcMain.handle("axm:toggleFullscreen", (): Settings => {
  const settings = loadSettings();
  const windowed = !settings.windowed;
  const updated = saveSettings({ windowed });
  applyWindowMode(windowed);
  return updated;
});

ipcMain.handle("axm:scanGames", async (): Promise<GameEntry[]> => {
  cachedGames = await scanAllGames();
  void fetchMissingArt();
  return cachedGames;
});

/**
 * Fills in the artwork no launcher gave us: box art for the tiles, and the wide hero
 * banner the menu uses as its background. Runs in the background with small
 * concurrency so the menu stays responsive, pushing each result to the renderer as it
 * lands rather than making the first paint wait on the network.
 */
let artRunId = 0;
async function fetchMissingArt(): Promise<void> {
  if (!isGameArtConfigured()) return;
  const runId = ++artRunId;
  // Steam hands us both already, so only the rest need looking up - but a game can
  // easily have one and not the other, hence the per-kind check.
  const pending = cachedGames.filter((g) => !g.iconPath || !g.heroPath);
  const CONCURRENCY = 3;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < pending.length && runId === artRunId) {
      const game = pending[cursor++];
      const update: { gameId: string; iconPath?: string; heroPath?: string } = { gameId: game.id };

      if (!game.iconPath) {
        const grid = await resolveArt(game.name, "grid");
        if (runId !== artRunId) return;
        if (grid) {
          game.iconPath = grid;
          update.iconPath = grid;
        }
      }

      if (!game.heroPath) {
        const hero = await resolveArt(game.name, "hero");
        if (runId !== artRunId) return;
        if (hero) {
          game.heroPath = hero;
          update.heroPath = hero;
        }
      }

      if (!update.iconPath && !update.heroPath) continue;
      if (!mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send("axm:artUpdated", update);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

ipcMain.handle("axm:getGames", async (): Promise<GameEntry[]> => {
  if (cachedGames.length === 0) {
    cachedGames = await scanAllGames();
    void fetchMissingArt();
  }
  return cachedGames;
});

ipcMain.handle("axm:launchGame", (_e, gameId: string): void => {
  const game = cachedGames.find((g) => g.id === gameId);
  if (game) launchGame(game);
});

ipcMain.handle("axm:setLosslessProfile", (_e, gameId: string, profile: 1 | 2 | 3 | null): Settings => {
  const game = cachedGames.find((g) => g.id === gameId);
  if (game) game.losslessProfile = profile;
  return setGameOverride(gameId, { losslessProfile: profile });
});

ipcMain.handle("axm:losslessScalingStatus", (): { configPresent: boolean } => ({
  configPresent: isLosslessScalingConfigPresent(),
}));

ipcMain.handle("axm:quit", (): void => {
  app.quit();
});

ipcMain.handle("axm:getMedia", (_e, kind: MediaKind): MediaEntry[] => scanMedia(kind));

ipcMain.handle("axm:browseMusic", (_e, dirPath: string | null): MusicListing => browseMusic(dirPath));

ipcMain.handle("axm:pickMusicFolder", async (): Promise<Settings> => {
  if (!mainWindow) return loadSettings();
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return loadSettings();
  const settings = loadSettings();
  const musicFolders = Array.from(new Set([...settings.musicFolders, result.filePaths[0]]));
  return saveSettings({ musicFolders });
});

/** Picks a picture to use as the menu background, stored as a file:// URL. */
ipcMain.handle("axm:pickBackgroundImage", async (): Promise<Settings> => {
  if (!mainWindow) return loadSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return loadSettings();
  // The renderer puts this straight into a CSS url(), so hand it a real URL -
  // a raw Windows path with backslashes and spaces would not resolve.
  return saveSettings({ customImageUrl: pathToFileURL(result.filePaths[0]).href, themeMode: "image" });
});

ipcMain.handle("axm:openMedia", (_e, filePath: string): void => {
  shell.openPath(filePath);
});

ipcMain.handle("axm:browseMedia", (_e, kind: BrowseKind, dirPath: string | null): BrowseListing =>
  browseMedia(kind, dirPath)
);

// ---- Profile & avatars ------------------------------------------------------------

/** The avatars that ship with the app, as renderer-relative URLs. */
ipcMain.handle("axm:listBundledAvatars", (): { id: string; url: string }[] => {
  const dir = path.join(__dirname, "..", "renderer", "assets", "avatars");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort()
      .map((f) => ({ id: f, url: `assets/avatars/${f}` }));
  } catch {
    return [];
  }
});

/** Every image under the user's Pictures folder, a few levels deep, for the avatar picker. */
ipcMain.handle("axm:listPictures", (): { id: string; url: string; label: string }[] => {
  const out: { id: string; url: string; label: string }[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth > 0) walk(full, depth - 1);
      } else if (/\.(png|jpg|jpeg|webp|bmp)$/i.test(e.name)) {
        out.push({ id: full, url: pathToFileURL(full).href, label: path.basename(e.name, path.extname(e.name)) });
      }
      if (out.length >= 400) return;
    }
  };
  walk(mediaRoot("photo"), 3);
  return out;
});

/**
 * A SteamGridDB icon for each scanned game, for the avatar picker. Streams results
 * back as they land, since a hundred lookups shouldn't leave the picker empty.
 */
ipcMain.handle("axm:fetchGameIcons", async (): Promise<void> => {
  const targets = cachedGames.filter((g) => !g.hidden);
  const CONCURRENCY = 3;
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const game = targets[cursor++];
      const url = await resolveIcon(game.name);
      if (url && !mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send("axm:gameIcon", { gameId: game.id, name: game.name, url });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:gameIcon", { done: true });
});

ipcMain.handle("axm:saveProfile", (_e, profile: UserProfile): Settings => saveSettings({ profile }));

/** Copies a picked image into the art cache so the avatar survives the source moving. */
ipcMain.handle("axm:cacheImage", (_e, url: string, key: string): Promise<string | null> => cacheImage(url, key));

// ---- Game artwork -----------------------------------------------------------------

ipcMain.handle("axm:listArtChoices", (_e, gameId: string): Promise<ArtChoice[]> => {
  const game = cachedGames.find((g) => g.id === gameId);
  return game ? listGridChoices(game.name) : Promise.resolve([]);
});

ipcMain.handle("axm:setGameArt", async (_e, gameId: string, url: string): Promise<string | null> => {
  const game = cachedGames.find((g) => g.id === gameId);
  if (!game) return null;
  const cached = await cacheImage(url, `art-${gameId}`);
  if (!cached) return null;
  game.iconPath = cached;
  setGameOverride(gameId, { artUrl: cached });
  return cached;
});

// ---- Jellyfin ---------------------------------------------------------------------

ipcMain.handle("axm:jellyfinDiscover", (): Promise<jellyfin.JellyfinServer[]> => jellyfin.discoverServers());

ipcMain.handle(
  "axm:jellyfinLogin",
  (_e, server: jellyfin.JellyfinServer, username: string, password: string): Promise<JellyfinLogin | null> =>
    jellyfin.login(server, username, password)
);

ipcMain.handle("axm:jellyfinForget", (_e, serverUrl: string): Settings => {
  jellyfin.forgetLogin(serverUrl);
  return loadSettings();
});

ipcMain.handle("axm:jellyfinLibraries", (_e, login: JellyfinLogin): Promise<jellyfin.JellyfinItem[] | null> =>
  jellyfin.getLibraries(login)
);

ipcMain.handle(
  "axm:jellyfinItems",
  (_e, login: JellyfinLogin, parentId: string): Promise<jellyfin.JellyfinItem[] | null> =>
    jellyfin.getItems(login, parentId)
);

ipcMain.handle("axm:getAnkerStatus", (): Promise<AnkerStatus> => readAnkerStatus());

ipcMain.handle("axm:getSteamLibrary", (): SteamLibrary => getSteamLibrary());

ipcMain.handle("axm:installSteamGame", (_e, appid: number): void => installSteamGame(appid));

ipcMain.handle("axm:launchSteamApp", (_e, appid: number): void => {
  if (Number.isInteger(appid) && appid > 0) shell.openExternal(`steam://rungameid/${appid}`);
});

/** Saved Data Utility: where games keep their saves, named via the game scan where possible. */
ipcMain.handle("axm:getSaves", (): SaveEntry[] => {
  const nameByAppId = new Map<string, string>();
  for (const g of cachedGames) {
    if (g.source === "steam") nameByAppId.set(g.id.replace(/^steam-/, ""), g.name);
  }
  return scanSaves(nameByAppId);
});

/** Opens a folder in Explorer. Only ever a directory that exists - never an arbitrary path. */
ipcMain.handle("axm:openFolder", (_e, dirPath: string): void => {
  try {
    if (fs.statSync(dirPath).isDirectory()) shell.openPath(dirPath);
  } catch {
    // gone or inaccessible - nothing sensible to open
  }
});

/**
 * Launcher shortcuts for the Game column. Each is only offered when it's actually
 * installed (or, for the web ones, always), so the list matches this machine.
 */
const LAUNCHERS: { id: string; name: string; exe?: string; url?: string }[] = [
  { id: "battlenet", name: "Battle.net", exe: "C:\\Program Files (x86)\\Battle.net\\Battle.net Launcher.exe" },
  {
    id: "geforcenow",
    name: "GeForce NOW",
    exe: path.join(process.env.LOCALAPPDATA ?? "", "NVIDIA Corporation", "GeForceNOW", "CEF", "GeForceNOW.exe"),
  },
  { id: "xboxcloud", name: "Xbox Cloud Gaming", url: "https://www.xbox.com/play" },
];

ipcMain.handle("axm:getLaunchers", (): { id: string; name: string; installed: boolean }[] =>
  LAUNCHERS.map((l) => ({ id: l.id, name: l.name, installed: l.url ? true : !!l.exe && fs.existsSync(l.exe) }))
);

ipcMain.handle("axm:openLauncher", (_e, id: string): void => {
  const launcher = LAUNCHERS.find((l) => l.id === id);
  if (!launcher) return;
  if (launcher.url) {
    shell.openExternal(launcher.url);
  } else if (launcher.exe && fs.existsSync(launcher.exe)) {
    spawn(launcher.exe, [], { cwd: path.dirname(launcher.exe), detached: true, stdio: "ignore" }).unref();
  }
});

ipcMain.handle("axm:openBrowser", (_e, url: string): void => {
  // Only ever hand http(s) to the shell - never a local path or other protocol.
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle("axm:pickGameFolder", async (): Promise<Settings> => {
  if (!mainWindow) return loadSettings();
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return loadSettings();
  const settings = loadSettings();
  const extraGameFolders = Array.from(new Set([...settings.extraGameFolders, result.filePaths[0]]));
  return saveSettings({ extraGameFolders });
});
