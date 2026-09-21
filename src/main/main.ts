import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings, saveSettings, setGameOverride, Settings } from "./settingsStore";
import { scanAllGames } from "./gameScanner";
import { launchGame } from "./gameLauncher";
import { GameEntry } from "./types";
import { isLosslessScalingConfigPresent } from "./losslessScaling";
import { scanMedia, MediaEntry, MediaKind } from "./mediaScanner";
import { resolveArt, isGameArtConfigured } from "./gameArt";
import { browseMusic, MusicListing } from "./musicLibrary";
import { scanSaves, SaveEntry } from "./saveScanner";
import * as memcard from "./memoryCard";
import * as memcardSync from "./memoryCardSync";
import * as memcardImport from "./memoryCardImport";
import * as apolloDb from "./apollo/database";
import * as apollo from "./apollo/service";
import * as companionSaves from "./apollo/companionSaves";
import { rootDrive, ensureRootLayout } from "./rootDrive";
import * as texturePacks from "./texturePacks";
import * as ps2cardModule from "./ps2card";
import { browseMedia, BrowseKind, BrowseListing, listMediaDrives, createMediaFolder, MediaDrive } from "./mediaBrowser";
import { getSteamLibrary, installSteamGame, SteamLibrary } from "./steamLibrary";
import { listGridChoices, resolveIcon, cacheImage, ArtChoice } from "./gameArt";
import { mediaRoot } from "./mediaBrowser";
import * as jellyfin from "./jellyfin";
import { findSubtitles, findLyrics, SubtitleQuery } from "./subtitles";
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
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import { toybox, kindOf } from "./toybox/toyboxService";
import { findEmulators as findRetroEmulators } from "./scanners/retroScanner";
import { preparePs3, installFromGithub } from "./retro";
import { storeCatalogue, storeInstall, StoreItem } from "./store";
import { execFile } from "node:child_process";
import type { RetroPlatform } from "./types";
import { artUrl as toyArtUrl } from "./toybox/artwork";
import { nfcHub, dumpsDir as toyboxDumpsDir, relayUrlFor, mediaKeyFor, migrateBackupsToRoot } from "./toybox/nfc";
import { downloadUrl } from "./storage";
import { CompanionServer } from "./companion/server";
import { CompanionSetting } from "./companion/protocol";
import * as xtream from "./xtream";
import { apiConfigSource, apiFolder, ensureApiExample } from "./apiKeys";
import { logoStatus, refreshLogos } from "./networkLogos";
import { DeviceRegistry } from "./companion/registry";
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
app.commandLine.appendSwitch("enable-blink-features", "AudioVideoTracks");

let mainWindow: BrowserWindow | null = null;
let cachedGames: GameEntry[] = [];

/**
 * The Android companion.
 *
 * The phone finds this machine by UDP broadcast and then holds one WebSocket for
 * everything it does. Input it sends is forwarded to the renderer as if it were a
 * local button press, so the menu needs no idea a phone exists - and if the phone
 * goes away mid-session, nothing here has to unwind.
 *
 * A tag the phone scans goes into nfcHub.scan(), the same entry the PC/SC reader
 * uses, so there is one path for a scan rather than a second one that would drift.
 */
const companionRegistry = new DeviceRegistry();
/** Opaque keys the phone browses the music library by, so no path crosses the wire. */
const musicKeys = new Map<string, string>();
const companion = new CompanionServer(
  companionRegistry,
  loadSettings().systemName || "A-X-M",
  app.getVersion(),
  {
    onXmbInput: (action) => mainWindow?.webContents.send("axm:companionInput", { kind: "xmb", action }),
    onMediaCommand: (command, value) =>
      mainWindow?.webContents.send("axm:companionInput", { kind: "media", command, value }),
    onPointer: (input) => mainWindow?.webContents.send("axm:companionInput", { kind: "pointer", input }),
    // Settings, the keyboard and the music library: the menu owns all three, so the
    // frames go to the renderer, which applies them and republishes what changed.
    onSettingsSet: (id, value) => mainWindow?.webContents.send("axm:companionInput", { kind: "setting", id, value }),
    onKeyboardInput: (text, done) => mainWindow?.webContents.send("axm:companionInput", { kind: "keyboard", text, done }),
    onMusicBrowse: async (key) => {
      const dir = key ? musicKeys.get(key) ?? null : null;
      if (key && !dir) return null;
      const listing = browseMusic(dir);
      const keyOf = (p: string) => {
        const k = crypto.createHash("sha1").update(p).digest("hex").slice(0, 16);
        musicKeys.set(k, p);
        return k;
      };
      return {
        key: listing.path ? keyOf(listing.path) : "",
        name: listing.title,
        parent: listing.parent ? keyOf(listing.parent) : listing.path ? "" : undefined,
        entries: listing.entries.map((e) => ({ key: keyOf(e.filePath), name: e.name, kind: e.kind === "folder" ? ("folder" as const) : ("file" as const) })),
      };
    },
    onMusicPlay: (key) => {
      const file = musicKeys.get(key);
      if (file) mainWindow?.webContents.send("axm:companionInput", { kind: "musicPlay", filePath: file });
    },
    // Memory card saves on the phone: listed, copied, put back, and Apollo at its request.
    onSavesList: async () => companionSaves.listing(loadSettings().memcardSyncToPhone ?? true),
    onSavesRequest: async (cardId, save) => companionSaves.copyOf(cardId, save),
    onSavesPush: async (cardId, save, base64) => companionSaves.pushBack(cardId, save, base64),
    onSavesCheats: async (cardId, save) => companionSaves.cheats(cardId, save),
    onSavesApply: async (cardId, save, selections, preview) => {
      const r = companionSaves.applyFromPhone(cardId, save, selections, preview);
      if (!preview) mainWindow?.webContents.send("axm:memcardsChanged", { cardId, save });
      return r;
    },
    onSavesRestore: async (cardId, save) => {
      const r = companionSaves.restoreLast(cardId, save);
      mainWindow?.webContents.send("axm:memcardsChanged", { cardId, save });
      return r;
    },
    onToyScan: (scan, device) => {
      nfcHub.scan({
        reader: { id: device.deviceId, type: "companion" },
        uid: scan.uid,
        tech: scan.technology,
        head: scan.head,
        tail: scan.tail,
        characterId: scan.characterId,
        variantId: scan.variantId,
      });
    },
    // The code is shown on this screen, so whoever pairs has to be able to see it.
    onPairingCode: (code, deviceName) =>
      mainWindow?.webContents.send("axm:companionPairing", { code, deviceName }),
    onSessionsChanged: (sessions) => mainWindow?.webContents.send("axm:companionDevices", { sessions }),
    onStatus: (message) => mainWindow?.webContents.send("axm:companionStatus", { message }),
  }
);

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
  // Toy readers and the companion endpoint come up with the menu.
  ensureRootLayout();
  setTimeout(() => migrateBackupsToRoot(), 6000);
  setTimeout(() => nfcHub.start(loadSettings().toybox?.companion ?? true), 4000);
  setTimeout(() => void apolloDb.autoUpdate().then(() => mainWindow?.webContents.send("axm:apolloProgress", { note: "" })), 8000);
  // Listening from the start: the phone should find A-X-M without anything being
  // switched on first. It costs one idle UDP socket until something connects.
  companion.start();
  // Writes apis/apis.example.json the first time, so the folder explains itself.
  ensureApiExample();
  // MakeMKV reads its key from its own settings file; keep it in step with ours.
  if (loadSettings().makemkvKey) applyMakemkvKey(loadSettings().makemkvKey);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => overlayHotkey?.stop());
app.on("before-quit", () => console.log("[A-X-M] quitting"));

app.on("before-quit", () => {
  stopTts();
  nfcHub.stop();
  companion.stop();
});
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

      // Sent even with nothing found: the menu's disc spins while a game is being looked up.
      if (!mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send("axm:artUpdated", { ...update, searched: true });
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
    // A retro game without its emulator (or a PS3 image still to be prepared) has nothing to run.
    if (game.source === "retro" && (!game.launchTarget || game.needsPrep)) return;
    noteLaunched(game);
    launchGame(game);
  }
});

ipcMain.handle("axm:retroEmulators", () => findRetroEmulators(loadSettings().emulators));
ipcMain.handle("axm:storeCatalogue", () => storeCatalogue(cachedGames));
// A desktop shortcut for an emulator, only when the user said yes to it.
ipcMain.handle("axm:desktopShortcut", (_e, platform: RetroPlatform): boolean => {
  const emu = findRetroEmulators(loadSettings().emulators).find((x) => x.platform === platform);
  if (!emu?.exe) return false;
  const link = path.join(app.getPath("desktop"), `${emu.name}.lnk`);
  return shell.writeShortcutLink(link, "create", { target: emu.exe, cwd: path.dirname(emu.exe), description: `${emu.name} (installed by A-X-M)` });
});
ipcMain.handle("axm:storeInstall", async (_e, item: StoreItem): Promise<string> => {
  const dst = await storeInstall(item);
  cachedGames = await scanAllGames();
  void fetchMissingArt();
  return dst;
});
ipcMain.handle("axm:installEmulator", async (_e, platform: RetroPlatform): Promise<boolean> => {
  const emu = findRetroEmulators(loadSettings().emulators).find((x) => x.platform === platform);
  if (!emu || (!emu.winget && !emu.github)) return false;
  toolToast("emu-" + platform, `${emu.name} · installing`, 0, 1);
  let ok = false;
  if (emu.winget) ok = await new Promise<boolean>((resolve) => execFile("winget", ["install", "--id", emu.winget!, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], { windowsHide: true, timeout: 30 * 60_000 }, (err) => resolve(!err)));
  else if (emu.github) ok = await installFromGithub(emu.name, emu.github, (done, total) => toolToast("emu-" + platform, `${emu.name} · downloading`, done, total));
  toolToast("emu-" + platform, emu.name, 1, 1, true);
  cachedGames = await scanAllGames();
  return ok;
});
ipcMain.handle("axm:preparePs3", async (_e, gameId: string, trim: { update: boolean; dummy: boolean; languages: boolean } | null) => {
  const game = cachedGames.find((g) => g.id === gameId);
  if (!game) throw new Error("Unknown game");
  const rpcs3 = findRetroEmulators(loadSettings().emulators).find((e) => e.platform === "ps3")?.exe;
  if (!rpcs3) throw new Error("RPCS3 isn't installed (C:\\rpcs3\\rpcs3.exe)");
  // The menu is English-only so far; System Language will feed this when it grows.
  const lang = "en";
  const result = await preparePs3(game, path.dirname(rpcs3), trim ? { ...trim, keepLanguage: lang } : null);
  cachedGames = await scanAllGames();
  void fetchMissingArt();
  return result;
});
// Only ever the disc image a Retro row points at, and only after the menu asked.
ipcMain.handle("axm:deleteDiscImage", (_e, gameId: string): boolean => {
  const game = cachedGames.find((g) => g.id === gameId);
  if (!game?.romPath || !/\.iso$/i.test(game.romPath)) return false;
  try {
    fs.rmSync(game.romPath, { force: true });
    for (const side of [game.romPath.replace(/\.iso$/i, ".dec.iso")]) fs.rmSync(side, { force: true });
    return true;
  } catch {
    return false;
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
ipcMain.handle("axm:getVolumes", async (): Promise<VolumeInfo[]> => {
  // Copy targets, exports and the like: only ROOT (and this PC) when ROOT is set.
  const all = await listVolumes();
  const only = rootDrive();
  return only ? all.filter((v) => v.system || v.drive.toUpperCase() === only) : all;
});
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

// The NFC hub: readers in, one detection event out. Started once the menu is up.
ipcMain.handle("axm:toyboxSimulate", (_e, figureId: string | null) => (figureId ? nfcHub.simulate(figureId) : nfcHub.simulateUnknown()));
ipcMain.handle("axm:toyboxSimulateRemoval", () => nfcHub.simulateRemoval());
ipcMain.handle("axm:toyboxNfcStatus", () => nfcHub.status());
ipcMain.handle("axm:toyboxDumpsDir", () => toyboxDumpsDir());
ipcMain.handle("axm:toyboxLastGame", (_e, figureId: string) => toybox.lastGame(figureId));
ipcMain.handle("axm:toyboxSetLastGame", (_e, figureId: string, gameId: string) => toybox.setLastGame(figureId, gameId));
ipcMain.handle("axm:toyboxSaveCustomTag", (_e, uid: string, label: string, figureId?: string) => toybox.saveCustomTag({ uid, label, figureId, created: new Date().toISOString() }));

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
ipcMain.handle("axm:toyboxKinds", (_e, platform: ToyFigure["platform"]): { kind: string; label: string; count: number; owned: number }[] => {
  const out = new Map<string, { kind: string; label: string; count: number; owned: number }>();
  for (const f of toybox.getFiguresByPlatform(platform)) {
    const k = kindOf(f);
    const row = out.get(k.kind) ?? { ...k, count: 0, owned: 0 };
    row.count++;
    if (toybox.getEntry(f.id)?.owned) row.owned++;
    out.set(k.kind, row);
  }
  const order = ["figures", "characters", "cards", "yarn", "bands", "legendaries", "minis", "vehicles", "traps-items", "expansions", "power-discs", "power-discs-hex", "play-sets", "trophies", "debug"];
  return [...out.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
});
ipcMain.handle("axm:toyboxShelf", (_e, filter: { view: "all" | "owned" | "favorites" | "recent"; platform?: ToyFigure["platform"] | ""; query?: string; kind?: string }): ToyShelfFigure[] => {
  let list: ToyFigure[] =
    filter.view === "recent" ? toybox.getRecentlyScanned() : filter.view === "owned" ? toybox.getCollection("owned") : filter.view === "favorites" ? toybox.getCollection("favorites") : toybox.getCollection("all");
  if (filter.platform) list = list.filter((f) => f.platform === filter.platform);
  if (filter.kind) list = list.filter((f) => kindOf(f).kind === filter.kind);
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

/**
 * TV Streaming. The renderer never sees the password: it asks for a playable URL
 * and gets one back, so the credential stays in the main process where a page
 * cannot read it.
 */
ipcMain.handle("axm:tvStatus", () => xtream.status());
ipcMain.handle("axm:tvLogos", () => ({ ...logoStatus(), apiFolder: apiFolder(), apiSource: apiConfigSource() }));
ipcMain.handle("axm:tvRefreshLogos", () => refreshLogos());

ipcMain.handle("axm:tvLogin", async (_e, account: xtream.XtreamAccount | null) => {
  xtream.saveAccount(account);
  return xtream.status();
});

const tvFilter = (adultUnlocked?: boolean): xtream.TvFilter => {
  const s = loadSettings();
  return { englishOnly: s.tvEnglishOnly, overrides: s.tvLanguageOverrides ?? {}, hideAdult: s.tvAdultBlocked && !adultUnlocked };
};
ipcMain.handle("axm:tvCategories", (_e, kind: xtream.XtreamKind, adultUnlocked?: boolean) => xtream.categories(kind, tvFilter(adultUnlocked)));
ipcMain.handle("axm:tvLanguages", () => xtream.languageTags());
ipcMain.handle("axm:tvItems", (_e, kind: xtream.XtreamKind, categoryId?: string, adultUnlocked?: boolean) =>
  xtream.items(kind, categoryId, tvFilter(adultUnlocked))
);
ipcMain.handle("axm:tvEpg", (_e, streamId: string) => xtream.shortEpg(streamId));
ipcMain.handle("axm:tvStreamUrl", (_e, item: xtream.XtreamItem) => xtream.streamUrl(item));
ipcMain.handle("axm:tvEpisodes", (_e, seriesId: string) => xtream.episodes(seriesId));
// ---- Memory Card Utility: virtual PS1 / PS2 cards, the emulators' folders, Apollo ----
ipcMain.handle("axm:memcardOverview", () => memcardSync.overview());
ipcMain.handle("axm:memcardCreate", (_e, kind: memcard.CardKind, name: string) => memcard.createCard(kind, name));
ipcMain.handle("axm:memcardRename", (_e, id: string, name: string) => memcard.renameCard(id, name));
ipcMain.handle("axm:memcardSlot", (_e, id: string, slot: 1 | 2) => memcard.setCardSlot(id, slot));
ipcMain.handle("axm:memcardDelete", (_e, id: string) => memcard.deleteCard(id));
ipcMain.handle("axm:memcardSaves", (_e, id: string) => ({ saves: memcard.readSaves(id), usage: memcard.cardUsage(id) }));
ipcMain.handle("axm:memcardPublish", (_e, id: string, emulator: memcardSync.EmulatorId) => {
  const card = memcard.listCards().find((c) => c.id === id);
  return card ? memcardSync.publishToEmulator(card, emulator) : { ok: false, message: "no such card" };
});
ipcMain.handle("axm:memcardAdopt", (_e, emulator: memcardSync.EmulatorId, file: string, name: string) => memcardSync.adoptFromEmulator(emulator, file, name));
ipcMain.handle("axm:memcardExport", (_e, id: string, save: string | null, folder: string) => {
  const card = memcard.listCards().find((c) => c.id === id);
  if (!card) return { ok: false, message: "no such card" };
  if (!save) return memcardSync.exportCard(card, folder);
  if (card.kind === "ps1") return memcardSync.exportSave(card.filePath, save, folder);
  // PS2: the save as a .psu, which every PS2 save tool and uLaunchELF read.
  try {
    const b = apollo.exportSaveBundle({ cardId: id, save });
    const file = path.join(folder, b.name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(file, b.data);
    return { ok: true, message: `${b.name} written`, file };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
});
ipcMain.handle("axm:memcardInspect", (_e, file: string) => memcardImport.inspect(file));
ipcMain.handle("axm:memcardScanDrive", (_e, root: string) => memcardImport.scanDrive(root));
ipcMain.handle("axm:memcardImportPs1", (_e, id: string, source: string, only?: string[]) => {
  const card = memcard.listCards().find((c) => c.id === id);
  return card ? memcardImport.importPs1(card.filePath, source, only) : { ok: false, message: "no such card" };
});
ipcMain.handle("axm:memcardImportPs2", (_e, id: string, source: string) => {
  const card = memcard.listCards().find((c) => c.id === id);
  if (!card || card.kind !== "ps2") return { ok: false, message: "pick a PS2 card" };
  try {
    const buf = fs.readFileSync(source);
    const { readPsu, readPsvPs2, Ps2Card } = ps2cardModule;
    const bundle = readPsvPs2(buf) ?? readPsu(buf);
    if (!bundle) return { ok: false, message: "not a .psu or PS2 .psv save" };
    const ps2 = Ps2Card.open(card.filePath);
    if (ps2.listSaves().some((s) => s.name === bundle.name)) return { ok: false, message: `${bundle.name} is already on the card` };
    ps2.addSave(bundle.name, bundle.files, bundle.attr);
    ps2.save(card.filePath);
    return { ok: true, message: `${bundle.name} added` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
});
// ---- HD texture packs: the curated list, and a game's packs on / off ----
ipcMain.handle("axm:textureDb", () => texturePacks.textureDb());
ipcMain.handle("axm:texturePacksFor", async (_e, gameId: string) => {
  const game = cachedGames.find((g) => g.id === gameId);
  if (!game || (game.platform !== "ps1" && game.platform !== "ps2") || !game.romPath) return null;
  const serial = await texturePacks.serialOf(game.romPath);
  const status = await texturePacks.packStatus(game.platform, serial, game.name);
  return { serial, status };
});
ipcMain.handle("axm:textureInstall", (_e, platform: "ps1" | "ps2", serial: string, slug: string) =>
  texturePacks.installPack(platform, serial, slug, (note) => mainWindow?.webContents.send("axm:textureProgress", { slug, note }))
);
ipcMain.handle("axm:textureEnable", (_e, platform: "ps1" | "ps2", serial: string, slug: string) => texturePacks.enablePack(platform, serial, slug));
ipcMain.handle("axm:textureDisable", (_e, platform: "ps1" | "ps2", serial: string, slug: string) => texturePacks.disablePack(platform, serial, slug));
ipcMain.handle("axm:textureDelete", (_e, platform: "ps1" | "ps2", serial: string, slug: string) => texturePacks.deletePack(platform, serial, slug));
ipcMain.handle("axm:apolloStatus", () => apolloDb.apolloStatus());
ipcMain.handle("axm:apolloUpdatePatches", () => apolloDb.updatePatches((note) => mainWindow?.webContents.send("axm:apolloProgress", { note })));
ipcMain.handle("axm:apolloUpdateSaves", () => apolloDb.updateSaves((note) => mainWindow?.webContents.send("axm:apolloProgress", { note })));
ipcMain.handle("axm:apolloClearCache", () => apolloDb.clearCache());
ipcMain.handle("axm:apolloSetLocation", (_e, location: string) => apolloDb.setLocation(location));
ipcMain.handle("axm:apolloFind", (_e, ref: apollo.SaveRef) => {
  try {
    return apollo.findPatches(ref);
  } catch (err) {
    return { error: (err as Error).message };
  }
});
ipcMain.handle("axm:apolloPreview", (_e, ref: apollo.SaveRef, selections: apollo.Selection[]) => apollo.preview(ref, selections));
ipcMain.handle("axm:apolloApply", (_e, ref: apollo.SaveRef, selections: apollo.Selection[], note?: string) => apollo.apply(ref, selections, note));
ipcMain.handle("axm:apolloBackups", (_e, ref: apollo.SaveRef) => apollo.listBackups(ref));
ipcMain.handle("axm:apolloRestore", (_e, ref: apollo.SaveRef, backupId?: string) => apollo.restoreBackup(ref, backupId));
ipcMain.handle("axm:apolloCommunity", (_e, ref: apollo.SaveRef | { platform: apolloDb.ApolloPlatform; titleId: string }) => apollo.communitySavesFor(ref));
ipcMain.handle("axm:apolloImportCommunity", (_e, cardId: string, platform: apolloDb.ApolloPlatform, titleId: string, zip: string) => apollo.importCommunitySave(cardId, platform, titleId, zip));
ipcMain.handle("axm:apolloExportBundle", (_e, ref: apollo.SaveRef) => {
  const b = apollo.exportSaveBundle(ref);
  return { name: b.name, kind: b.kind, base64: b.data.toString("base64") };
});
ipcMain.handle("axm:findSubtitles", (_e, q: SubtitleQuery) => (loadSettings().subtitles?.enabled ? findSubtitles(q) : Promise.resolve(null)));
ipcMain.handle("axm:findLyrics", (_e, artist: string, title: string, album: string, duration: number) =>
  loadSettings().lyricsEnabled ? findLyrics(artist ?? "", title ?? "", album ?? "", duration ?? 0) : Promise.resolve(null)
);
ipcMain.handle("axm:tvEpisodeUrl", (_e, ep: xtream.XtreamEpisode) => xtream.episodeUrl(ep));
// The same stream through the local relay - a player's User-Agent, ranges passed on.
ipcMain.handle("axm:tvRelayUrl", (_e, url: string) => (/^https?:\/\//i.test(url) ? relayUrlFor(url) : null));
ipcMain.handle("axm:tvDownload", (_e, url: string, name: string, target: string, container: string) => downloadUrl(url, name, target, container));

ipcMain.handle("axm:companionStatus", () => ({
  media: lastMediaState,
  running: companion.isRunning(),
  enabled: companionRegistry.isEnabled(),
  addresses: companion.addresses(),
  permissions: companionRegistry.permissions(),
  sessions: companion.sessionList(),
  trusted: companionRegistry.list().map((d) => ({
    deviceId: d.deviceId,
    name: d.name,
    platform: d.platform,
    pairedAt: d.pairedAt,
    lastSeenAt: d.lastSeenAt,
  })),
}));

ipcMain.handle("axm:companionForget", (_e, deviceId: string) => companionRegistry.revoke(deviceId));

// What is playing, for the phone's media screen. The renderer is the authority.
let lastMediaState: { playing: boolean; title?: string; kind?: string; artworkUrl?: string } | null = null;
ipcMain.on("axm:companionSettings", (_e, items: CompanionSetting[]) => companion.setSettingsState(items));
// A copy of a save to every phone (Send to phone), and the fresh list after the menu changed a card.
ipcMain.handle("axm:companionSendSave", (_e, cardId: string, save: string) => {
  const f = companionSaves.copyOf(cardId, save);
  if (f && companion.isRunning()) companion.broadcast("saves.file", f);
});
ipcMain.on("axm:memcardsChanged", () => void companion.publishSaves());
ipcMain.on("axm:companionKeyboard", (_e, prompt: { title: string; label: string; value: string; secret: boolean } | null) => {
  companion.setKeyboardPrompt(prompt);
});
ipcMain.on("axm:companionMedia", (_e, state: { playing: boolean; title?: string; artist?: string; album?: string; artworkUrl?: string; positionSeconds?: number; durationSeconds?: number; kind?: string }) => {
  // A cover the menu holds as a local file is handed to the phone through the
  // asset route on the companion HTTP port, on this machine's LAN address.
  if (state.artworkUrl?.startsWith("file:")) {
    // The address the phone can actually reach: the one on its own subnet, else a
    // home-network one, before any VPN or virtual adapter.
    const phones = companion.sessionList().map((s) => s.address.replace(/^::ffff:/, ""));
    const all = companion.addresses().filter((a) => !a.startsWith("127."));
    const sameNet = all.find((a) => phones.some((p) => p.split(".").slice(0, 3).join(".") === a.split(".").slice(0, 3).join(".")));
    const lan = sameNet ?? all.find((a) => a.startsWith("192.168.")) ?? all.find((a) => a.startsWith("10.")) ?? all[0];
    try {
      const file = fileURLToPath(state.artworkUrl);
      state = { ...state, artworkUrl: lan ? `http://${lan}:47311/asset?f=${encodeURIComponent(file)}` : undefined };
    } catch {
      state = { ...state, artworkUrl: undefined };
    }
  }
  // The file itself, so a phone can take the audio over (Bluetooth follows the phone).
  const st = state as typeof state & { filePath?: string; streamUrl?: string; output?: string };
  if (st.filePath && /^[A-Za-z]:\\/.test(st.filePath)) {
    const phones = companion.sessionList().map((s) => s.address.replace(/^::ffff:/, ""));
    const all = companion.addresses().filter((a) => !a.startsWith("127."));
    const lan = all.find((a) => phones.some((p) => p.split(".").slice(0, 3).join(".") === a.split(".").slice(0, 3).join("."))) ?? all.find((a) => a.startsWith("192.168.")) ?? all[0];
    if (lan) st.streamUrl = `http://${lan}:47311/media?k=${mediaKeyFor(st.filePath)}`;
    delete st.filePath;
  }
  lastMediaState = st;
  if (companion.isRunning()) companion.broadcast("media.state", st);
});
ipcMain.handle("axm:companionSetEnabled", (_e, enabled: boolean) => {
  companionRegistry.setEnabled(enabled);
  if (enabled) companion.start();
  else companion.stop();
  return companionRegistry.isEnabled();
});

ipcMain.handle("axm:companionPermissions", (_e, patch: Record<string, boolean>) =>
  companionRegistry.setPermissions(patch)
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
