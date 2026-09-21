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
import { browseMedia, BrowseKind, BrowseListing, listMediaDrives, createMediaFolder, MediaDrive } from "./mediaBrowser";
import { getSteamLibrary, installSteamGame, SteamLibrary } from "./steamLibrary";
import { listGridChoices, resolveIcon, cacheImage, ArtChoice } from "./gameArt";
import { mediaRoot } from "./mediaBrowser";
import * as jellyfin from "./jellyfin";
import { readAnkerStatus, AnkerStatus } from "./ankerMonitor";
import { OverlayHotkey } from "./overlayHotkey";
import { listDiscs, findDiscTools, importAudioCd, backupDisc, findDiscBackup, guessDiscTitle, Disc, ImportFormat } from "./discs";
import { remotePlayStatus, installRemotePlay, launchRemotePlay } from "./remotePlay";
import { steamTrophyGames, steamAchievements, raTrophyGames, raAchievements, raVerify } from "./trophies";
import { noteLaunched, runningGame, quitRunningGame } from "./runningGame";
import { connectionStatus, setWifiEnabled, connectionTest } from "./network";
import { assistantStatus, installAssistantModel, removeAssistantModel, startVoice, stopVoice } from "./assistant";
import { ttsStatus, installTts, removeTts, startTts, stopTts, speak, setVoiceClip, resetVoiceClip } from "./tts";
import { toolsState, installTools, applyMakemkvKey } from "./tools";
import { checkForUpdate, downloadUpdate, openUpdate } from "./updates";
import { getPowerSettings, setPowerPlan, setPowerTimeout, powerAction, getClock, syncClock, listTimeZones, setTimeZone, fileInfo, hostName } from "./system";
import { listWifi, connectWifi, disconnectWifi, forgetWifi, listBluetooth, pairBluetooth, unpairBluetooth, WifiNetwork, BluetoothDevice } from "./network";
import { getSongInfo, getScreenInfo, SongInfo, ScreenInfo } from "./metadata";
import { listVolumes, copyMedia, downloadJellyfin, VolumeInfo, MediaKind as TransferKind } from "./storage";
import { InMenuBrowser } from "./browserView";
import { getWifiStatus, getBluetoothStatus, getHardwareInfo, getControllerDevices, WifiStatus, BluetoothStatus, HardwareInfo, ControllerDevice } from "./systemStatus";
import { UserProfile, JellyfinLogin } from "./settingsStore";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { toybox } from "./toybox/toyboxService";
import { artUrl as toyArtUrl } from "./toybox/artwork";
import { ToyCollectionEntry, ToyFigure, ToyboxStats } from "./toybox/types";

// requestAnimationFrame already follows the display's native refresh rate, 120Hz on
// the Ally included. An earlier build added --disable-frame-rate-limit believing it
// lifted a 60fps cap; what it actually does is unhook rAF from vsync entirely, which
// had the ribbon redrawing ~4000 times a second and starving everything else. Don't.
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("high-dpi-support", "1");

// Let Chromium use the OS's HEVC / H.265 decoder (Windows' HEVC Video Extensions,
// the Deck's ffmpeg), so 10-bit MKV backups play in the menu.
app.commandLine.appendSwitch("enable-features", "PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport");

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
  // Chromium clamps a non-resizable window to the work area at creation, which
  // leaves the taskbar showing along the bottom. Setting the bounds again after
  // creation is honoured, so the window really does cover the whole display.
  if (!settings.windowed) mainWindow.setBounds(display.bounds);
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.webContents.on("did-finish-load", () => applyResolution());

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }


  mainWindow.on("closed", () => {
    console.log("[A-X-M] main window closed");
    mainWindow = null;
    // The hidden voice window must not keep the app alive once the menu is gone.
    stopVoice();
    app.quit();
  });
}

// ---- Menu resolution -----------------------------------------------------------
//
// The window always covers the display's physical pixels; the resolution setting
// picks the height the menu is laid out and rendered at. 720p on a 1080p screen
// means the layout is 720 CSS px tall (page zoom 1.5) and the ribbon and
// visualizer draw their frame buffers at 720 rows, then the compositor scales up.
// Auto picks the native height unless the GPU looks too small for it.

export const RESOLUTIONS = [720, 800, 900, 1080, 1200, 1440, 1600, 2160];

function chooseResolution(): { target: number; nativeHeight: number; nativeWidth: number; auto: boolean } {
  const display = screen.getPrimaryDisplay();
  const nativeHeight = Math.round(display.size.height * display.scaleFactor);
  const nativeWidth = Math.round(display.size.width * display.scaleFactor);
  const wanted = loadSettings().renderResolution;
  if (wanted > 0) return { target: Math.min(wanted, nativeHeight), nativeHeight, nativeWidth, auto: false };
  // Auto: native, stepped down on small GPUs at very high resolutions.
  let target = nativeHeight;
  const gpuGb = cachedGpuGb;
  if (nativeHeight > 1440 && gpuGb !== null && gpuGb < 6) target = 1440;
  if (nativeHeight > 1080 && gpuGb !== null && gpuGb < 3) target = 1080;
  return { target, nativeHeight, nativeWidth, auto: true };
}

let cachedGpuGb: number | null = null;
void getHardwareInfo().then((h) => {
  cachedGpuGb = h.gpuGb || null;
  applyResolution();
}).catch(() => {});

function applyResolution(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = chooseResolution();
  const display = screen.getPrimaryDisplay();
  // Windowed mode keeps the page at 1:1; the setting is for the full-screen menu.
  const zoom = loadSettings().windowed ? 1 : display.size.height / state.target;
  mainWindow.webContents.setZoomFactor(zoom);
  mainWindow.webContents.send("axm:resolution", state);
}

ipcMain.handle("axm:getResolution", () => chooseResolution());

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
  applyResolution();
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
  // MakeMKV reads its key from its own settings file; keep it in step with ours.
  if (loadSettings().makemkvKey) applyMakemkvKey(loadSettings().makemkvKey);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => overlayHotkey?.stop());
app.on("before-quit", () => console.log("[A-X-M] quitting"));

app.on("before-quit", () => stopTts());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- IPC ----

ipcMain.handle("axm:getSettings", (): Settings => loadSettings());

ipcMain.handle("axm:setSettings", (_e, partial: Partial<Settings>): Settings => {
  const updated = saveSettings(partial);
  if (partial.windowed !== undefined) applyWindowMode(partial.windowed);
  if (partial.renderResolution !== undefined) applyResolution();
  if (partial.overlayHotkey !== undefined) overlayHotkey?.setShortcut(partial.overlayHotkey);
  if (partial.makemkvKey !== undefined) applyMakemkvKey(partial.makemkvKey);
  return updated;
});

// The pop-up browser lives in the main process as a WebContentsView over the menu.
const browser = new InMenuBrowser(
  () => mainWindow,
  () => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:browserClosed");
  },
  (state) => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:browserNav", state);
  }
);

ipcMain.handle("axm:browserOpen", (_e, url: string): void => browser.open(url));
ipcMain.handle("axm:browserClose", (): void => browser.close());
ipcMain.handle("axm:browserInput", (_e, action: string): boolean => browser.input(action));

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
  if (game) {
    noteLaunched(game);
    launchGame(game);
  }
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
  console.log("[A-X-M] quit requested from the menu");
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
ipcMain.handle("axm:getMediaDrives", (): MediaDrive[] => listMediaDrives());
ipcMain.handle("axm:getVolumes", (): Promise<VolumeInfo[]> => listVolumes());
ipcMain.handle("axm:createMediaFolder", (_e, parentDir: string, name: string): string => createMediaFolder(parentDir, name));
ipcMain.handle("axm:getSongInfo", (_e, filePath: string): Promise<SongInfo | null> => getSongInfo(filePath));
ipcMain.handle("axm:getScreenInfo", (_e, title: string, year: string, kind: "movie" | "tv" | "auto", tmdbId?: string): Promise<ScreenInfo | null> =>
  getScreenInfo(title, year, kind, tmdbId)
);
ipcMain.handle("axm:copyMedia", (_e, kind: TransferKind, source: string, target: string): Promise<string> => copyMedia(kind, source, target));
ipcMain.handle(
  "axm:jellyfinDownload",
  (_e, login: JellyfinLogin, itemId: string, name: string, kind: TransferKind, target: string, container: string): Promise<string> =>
    downloadJellyfin(login, itemId, name, kind, target, container)
);
ipcMain.handle("axm:getWifiStatus", (): Promise<WifiStatus> => getWifiStatus());
ipcMain.handle("axm:getBluetoothStatus", (): Promise<BluetoothStatus> => getBluetoothStatus());
ipcMain.handle("axm:getHardwareInfo", (): Promise<HardwareInfo> => getHardwareInfo());
ipcMain.handle("axm:getControllerDevices", (): Promise<ControllerDevice[]> => getControllerDevices());
ipcMain.handle("axm:wifiList", (): Promise<WifiNetwork[]> => listWifi());
ipcMain.handle("axm:wifiConnect", (_e, ssid: string, password: string | null) => connectWifi(ssid, password));
ipcMain.handle("axm:wifiDisconnect", (): Promise<void> => disconnectWifi());
ipcMain.handle("axm:wifiForget", (_e, ssid: string): Promise<void> => forgetWifi(ssid));
ipcMain.handle("axm:btList", (): Promise<BluetoothDevice[]> => listBluetooth());
ipcMain.handle("axm:btPair", (_e, id: string) => pairBluetooth(id));
ipcMain.handle("axm:btUnpair", (_e, id: string) => unpairBluetooth(id));
ipcMain.handle("axm:getPowerSettings", () => getPowerSettings());
ipcMain.handle("axm:setPowerPlan", (_e, guid: string) => setPowerPlan(guid));
ipcMain.handle("axm:setPowerTimeout", (_e, what: "screen" | "sleep", onBattery: boolean, minutes: number) => setPowerTimeout(what, onBattery, minutes));
ipcMain.handle("axm:powerAction", async (_e, action: "shutdown" | "restart" | "sleep") => {
  if (action !== "sleep") setTimeout(() => app.quit(), 800);
  return powerAction(action);
});
ipcMain.handle("axm:getClock", () => getClock());
ipcMain.handle("axm:syncClock", () => syncClock());
ipcMain.handle("axm:listTimeZones", () => listTimeZones());
ipcMain.handle("axm:setTimeZone", (_e, id: string) => setTimeZone(id));
ipcMain.handle("axm:fileInfo", (_e, filePath: string) => fileInfo(filePath));
ipcMain.handle("axm:hostName", () => hostName());
ipcMain.handle("axm:listDiscs", () => listDiscs());
ipcMain.handle("axm:discTools", () => findDiscTools());
ipcMain.handle("axm:importAudioCd", (_e, disc: Disc, target: string, format: ImportFormat) => importAudioCd(disc, target, format));
ipcMain.handle("axm:backupDisc", (_e, disc: Disc, target: string, title?: string) => backupDisc(disc, target, title));
ipcMain.handle("axm:findDiscBackup", (_e, disc: Disc, target: string, title?: string) => findDiscBackup(disc, target, title));
ipcMain.handle("axm:guessDiscTitle", (_e, label: string) => guessDiscTitle(label));
ipcMain.handle("axm:remotePlayStatus", () => remotePlayStatus());
ipcMain.handle("axm:installRemotePlay", () =>
  installRemotePlay((done, total, note) => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:transfer", { id: "remoteplay", name: `Remote Play · ${note}`, destination: "A-X-M tools", done, total, finished: done >= total && note !== "downloading chiaki-ng" });
  })
);
ipcMain.handle("axm:launchRemotePlay", () => {
  const ok = launchRemotePlay(() => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:remotePlayExit");
  });
  if (ok) mainWindow?.hide();
  return ok;
});
ipcMain.handle("axm:steamTrophyGames", () => steamTrophyGames());
ipcMain.handle("axm:steamAchievements", (_e, appid: string) => steamAchievements(appid));
ipcMain.handle("axm:raTrophyGames", () => raTrophyGames());
ipcMain.handle("axm:raAchievements", (_e, gameId: string) => raAchievements(gameId));
ipcMain.handle("axm:raVerify", (_e, username: string, apiKey: string) => raVerify(username, apiKey));
ipcMain.handle("axm:runningGame", () => runningGame());
ipcMain.handle("axm:quitRunningGame", () => quitRunningGame());
ipcMain.handle("axm:connectionStatus", () => connectionStatus());
ipcMain.handle("axm:setWifiEnabled", (_e, enabled: boolean) => setWifiEnabled(enabled));
ipcMain.handle("axm:connectionTest", () => connectionTest());
ipcMain.handle("axm:assistantStatus", () => assistantStatus());
ipcMain.handle("axm:installAssistantModel", () =>
  installAssistantModel((done, total, note) => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:transfer", { id: "ghost-model", name: `Ghost · ${note}`, destination: "A-X-M models", done, total, finished: false });
  }).then((st) => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:transfer", { id: "ghost-model", name: "Ghost · voice model", destination: "A-X-M models", done: 1, total: 1, finished: true });
    return st;
  })
);
ipcMain.handle("axm:removeAssistantModel", () => removeAssistantModel());
// Ghost's cloned voice (Chatterbox in a local Python venv) and the tool installer.
const toolToast = (id: string, name: string, done: number, total: number, finished = false) => {
  if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:transfer", { id, name, destination: "this PC", done, total, finished });
};
ipcMain.handle("axm:ttsStatus", () => ttsStatus());
ipcMain.handle("axm:installTts", () =>
  installTts((note, step, steps) => toolToast("ghost-voice", `Ghost's voice · ${note}`, step, steps)).finally(() => toolToast("ghost-voice", "Ghost's voice", 1, 1, true))
);
ipcMain.handle("axm:removeTts", () => removeTts());
ipcMain.handle("axm:startTts", () => startTts());
ipcMain.handle("axm:speak", (_e, text: string) => speak(text));
ipcMain.handle("axm:pickVoiceClip", async () => {
  const r = await dialog.showOpenDialog({ title: "Ghost's voice clip", properties: ["openFile"], filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "flac", "ogg", "opus"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return setVoiceClip(r.filePaths[0], (await findDiscTools()).ffmpeg);
});
ipcMain.handle("axm:resetVoiceClip", () => resetVoiceClip());
ipcMain.handle("axm:toolsState", () => toolsState());
ipcMain.handle("axm:installTools", () =>
  installTools((p) => toolToast("tools", `Tools · ${p.note}`, p.step, p.steps)).finally(() => toolToast("tools", "Tools", 1, 1, true))
);
ipcMain.handle("axm:startVoice", (_e, micId: string) => startVoice(micId));
ipcMain.handle("axm:stopVoice", () => stopVoice());
// Transcripts from the hidden voice window, relayed to the menu.
ipcMain.on("axm:voice", (_e, message: { event: string; payload: unknown }) => {
  if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:voiceText", message);
});
ipcMain.handle("axm:checkForUpdate", () => checkForUpdate());
ipcMain.handle("axm:downloadUpdate", (_e, assetUrl: string, assetName: string) =>
  downloadUpdate(assetUrl, assetName, (done, total) => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("axm:transfer", { id: "update", name: `Update ${assetName}`, destination: "Downloads", done, total, finished: done >= total });
  })
);
ipcMain.handle("axm:openUpdate", (_e, file: string) => openUpdate(file));
ipcMain.handle("axm:manualUrl", () => pathToFileURL(path.join(__dirname, "..", "renderer", "assets", "manual.html")).href);

ipcMain.handle("axm:getSteamLibrary", (): SteamLibrary => getSteamLibrary());

ipcMain.handle("axm:installSteamGame", (_e, appid: number): void =>
  installSteamGame(appid, loadSettings().steamHandsOffInstall, () => {
    // Whatever the dialog did, the menu is where the user was.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  })
);

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
  { id: "epic", name: "Epic Games", exe: "C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe" },
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

/**
 * Toybox. The renderer never reads the database files itself - everything goes
 * through the service, so the menu, Ghost and the reader layer all see one
 * consistent view and lookups stay in-memory.
 */
export interface ToyboxSummary {
  hasDatabase: boolean;
  stats: ToyboxStats;
  recent: ToyFigure[];
  favorites: ToyFigure[];
}

ipcMain.handle("axm:toyboxSummary", (): ToyboxSummary => ({
  hasDatabase: toybox.hasDatabase(),
  stats: toybox.getStats(),
  recent: toybox.getRecentlyScanned().slice(0, 20),
  favorites: toybox.getFavorites().slice(0, 40),
}));

ipcMain.handle("axm:toyboxByPlatform", (_e, platform: ToyFigure["platform"]): ToyFigure[] =>
  toybox.getFiguresByPlatform(platform)
);

ipcMain.handle("axm:toyboxSearch", (_e, query: string): ToyFigure[] => toybox.searchFigures(query));

/**
 * The shelf's view of the collection: figures with their picture resolved and the
 * user's own state folded in, filtered the way the shelf tabs ask for.
 */
export interface ToyShelfFigure extends ToyFigure {
  artUrl: string | null;
  owned: boolean;
  favorite: boolean;
  wanted: boolean;
}
ipcMain.handle("axm:toyboxShelf", (_e, filter: { view: "all" | "owned" | "favorites" | "recent"; platform?: ToyFigure["platform"] | ""; query?: string }): ToyShelfFigure[] => {
  let list: ToyFigure[] =
    filter.view === "recent" ? toybox.getRecentlyScanned() : filter.view === "owned" ? toybox.getCollection("owned") : filter.view === "favorites" ? toybox.getCollection("favorites") : toybox.getCollection("all");
  if (filter.platform) list = list.filter((f) => f.platform === filter.platform);
  if (filter.query?.trim()) {
    const hits = new Set(toybox.searchFigures(filter.query, 5000).map((f) => f.id));
    list = list.filter((f) => hits.has(f.id));
  }
  return list.map((f) => {
    const e = toybox.getEntry(f.id);
    return { ...f, artUrl: toyArtUrl(f), owned: !!e?.owned, favorite: !!e?.favorite, wanted: !!e?.wanted };
  });
});

ipcMain.handle("axm:toyboxSetState", (_e, figureId: string, patch: Partial<ToyCollectionEntry>): ToyCollectionEntry =>
  toybox.setCollectionState(figureId, patch)
);

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
