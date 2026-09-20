import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import * as path from "node:path";
import { loadSettings, saveSettings, setGameOverride, Settings } from "./settingsStore";
import { scanAllGames } from "./gameScanner";
import { launchGame } from "./gameLauncher";
import { GameEntry } from "./types";
import { isLosslessScalingConfigPresent } from "./losslessScaling";
import { scanMedia, MediaEntry, MediaKind } from "./mediaScanner";
import { resolveArt, isGameArtConfigured } from "./gameArt";
import { browseMusic, MusicListing } from "./musicLibrary";

// Let the compositor track the display's native refresh rate (120Hz on the Ally) via
// vsync-synced requestAnimationFrame - just remove Chromium's internal 60fps throttle
// rather than disabling vsync, which would tear and waste battery on a handheld.
app.commandLine.appendSwitch("disable-frame-rate-limit");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("high-dpi-support", "1");

let mainWindow: BrowserWindow | null = null;
let cachedGames: GameEntry[] = [];

function createWindow(): void {
  const settings = loadSettings();
  const display = screen.getPrimaryDisplay();

  mainWindow = new BrowserWindow({
    width: settings.windowed ? 1280 : display.size.width,
    height: settings.windowed ? 800 : display.size.height,
    fullscreen: !settings.windowed,
    autoHideMenuBar: true,
    backgroundColor: "#050814",
    frame: settings.windowed,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
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
  mainWindow.setFullScreen(!windowed);
  mainWindow.setMenuBarVisibility(false);
  if (windowed) {
    mainWindow.setSize(1280, 800);
    mainWindow.center();
  } else {
    mainWindow.setSize(display.size.width, display.size.height);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---- IPC ----

ipcMain.handle("axm:getSettings", (): Settings => loadSettings());

ipcMain.handle("axm:setSettings", (_e, partial: Partial<Settings>): Settings => {
  const updated = saveSettings(partial);
  if (partial.windowed !== undefined) applyWindowMode(partial.windowed);
  return updated;
});

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

ipcMain.handle("axm:openMedia", (_e, filePath: string): void => {
  shell.openPath(filePath);
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
