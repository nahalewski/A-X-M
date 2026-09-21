import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export interface GameOverride {
  hidden?: boolean;
  losslessProfile?: 1 | 2 | 3 | null;
  /** file:// URL of artwork the user picked, taking precedence over the auto lookup. */
  artUrl?: string;
}

export interface UserProfile {
  name: string;
  /** file:// or asset URL of the avatar image. */
  avatarUrl: string;
}

/** A Jellyfin login. The access token is kept, the password never is. */
export interface JellyfinLogin {
  serverUrl: string;
  serverName: string;
  userId: string;
  userName: string;
  accessToken: string;
}

/** Which loop plays behind the menu. Values match AMBIENT_TRACKS in the renderer. */
export type AmbientTrackId = "xmb" | "luminous" | "moonlit" | "dreamy" | "midtown";

/** Ribbon background quality. "auto" starts high and steps down if frames suffer. */
export type BackgroundQuality = "auto" | "low" | "medium" | "high";

/**
 * How the menu background is themed.
 * - monthly: a different look per calendar month, the way the PS3 XMB shifts colour
 *   through the year. The current month's entry is what gets applied.
 * - fixed:   one look all year.
 * - cycle:   the original behaviour, drifting through the built-in palette.
 * - image:   a picture the user chose, with the ribbons over it.
 */
export type ThemeMode = "monthly" | "fixed" | "cycle" | "image";

export interface MonthTheme {
  /** Ribbon tint. */
  ribbonColor: string;
  /** Backdrop gradient top; the bottom is derived from it. */
  backgroundColor: string;
  /** Ribbon time scale. */
  ribbonSpeed: number;
  /** Multiplier on ribbon band thickness. */
  ribbonWidth: number;
}

/**
 * Seeded to follow the year the way the XMB does: cool and pale in midwinter,
 * greens through spring, deep blues in high summer, ambers and reds in autumn.
 * January is index 0.
 */
export const DEFAULT_MONTH_THEMES: MonthTheme[] = [
  { ribbonColor: "#dCEBFF", backgroundColor: "#12325f", ribbonSpeed: 0.18, ribbonWidth: 1.05 },
  { ribbonColor: "#ffd9ec", backgroundColor: "#3d1b52", ribbonSpeed: 0.20, ribbonWidth: 1.00 },
  { ribbonColor: "#e6ffe9", backgroundColor: "#13503c", ribbonSpeed: 0.24, ribbonWidth: 0.95 },
  { ribbonColor: "#ffe6f2", backgroundColor: "#5a2350", ribbonSpeed: 0.26, ribbonWidth: 0.95 },
  { ribbonColor: "#eaffd6", backgroundColor: "#255c1d", ribbonSpeed: 0.28, ribbonWidth: 0.90 },
  { ribbonColor: "#d8f2ff", backgroundColor: "#123f6d", ribbonSpeed: 0.30, ribbonWidth: 0.90 },
  { ribbonColor: "#d4fbff", backgroundColor: "#0b4f5e", ribbonSpeed: 0.32, ribbonWidth: 0.85 },
  { ribbonColor: "#cfe4ff", backgroundColor: "#0d2a6b", ribbonSpeed: 0.30, ribbonWidth: 0.90 },
  { ribbonColor: "#ffe9c9", backgroundColor: "#6b3a0c", ribbonSpeed: 0.24, ribbonWidth: 1.00 },
  { ribbonColor: "#ffdcae", backgroundColor: "#5e2a08", ribbonSpeed: 0.22, ribbonWidth: 1.05 },
  { ribbonColor: "#ffd2cc", backgroundColor: "#54121c", ribbonSpeed: 0.20, ribbonWidth: 1.10 },
  { ribbonColor: "#ffffff", backgroundColor: "#16386e", ribbonSpeed: 0.16, ribbonWidth: 1.15 },
];

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface Settings {
  windowed: boolean;
  targetHz: number;
  waveColorCycleSeconds: number;
  musicVolume: number;
  sfxVolume: number;
  extraGameFolders: string[];
  gameOverrides: Record<string, GameOverride>;
  /** SteamGridDB key for box-art lookup. Lives here (in userData), never in the repo. */
  gameArtApiKey: string;
  /** Music library roots. Empty falls back to the usual Windows music folders. */
  musicFolders: string[];
  /** Which background loop the menu plays. */
  ambientTrack: AmbientTrackId;
  /** Ribbon background detail level. */
  backgroundQuality: BackgroundQuality;
  themeMode: ThemeMode;
  /** Twelve entries, January first. Only the current month's is applied. */
  monthlyThemes: MonthTheme[];
  /** Used when themeMode is "fixed". */
  fixedTheme: MonthTheme;
  /** file:// URL of the user's chosen background picture, for themeMode "image". */
  customImageUrl: string;
  /** False hides the ribbons but keeps the themed backdrop. */
  ribbonEnabled: boolean;
  /** Whether the music visualizer may take over the background. */
  visualizerEnabled: boolean;
  /** Which visualizer draws: the PS3 spectrum bars by default. */
  visualizerStyle: string;
  /** The sparkle sweep when a profile hands over to the menu, and after the splash. */
  introSparkleEnabled: boolean;
  /** TMDB v3 key for film / show information. Lives only in the settings file. */
  tmdbApiKey: string;
  /** Confirm Steam's install dialog automatically and bring the menu back. */
  steamHandsOffInstall: boolean;
  /** Music: pick the next track at random rather than in folder order. */
  musicShuffle: boolean;
  /** Controller: how far a stick moves before it counts, whether B/A are swapped, rumble. */
  gamepadDeadZone: number;
  gamepadProfile: "standard" | "swapped";
  gamepadVibration: boolean;
  /** Menu resolution as a target height (720, 1080, 2160 ...) or 0 for auto. */
  renderResolution: number;
  menuUpscaling: "off" | "sharpen" | "sharpen-strong";
  /** PS3-style system settings kept by the menu. */
  systemName: string;
  clock24h: boolean;
  dictionaryTerms: string[];
  learnedWords: string[];
  notifications: { enabled: boolean; kinds: { general: boolean; transfer: boolean; controller: boolean; battery: boolean; install: boolean } };
  audioOutputId: string;
  audioInputId: string;
  menuDimMinutes: number;
  playlists: { name: string; tracks: { kind: "track"; name: string; filePath: string; url: string }[] }[];
  /** Trophy Collection sources. */
  steamWebApiKey: string;
  raUsername: string;
  raApiKey: string;
  /** Audio CD import format. */
  importFormat: "mp3" | "aac" | "opus" | "flac";
  /** Where disc backups and CD imports go: "home" (this PC) or a drive letter / mount. */
  discTarget: string;
  /** MakeMKV beta key (posted on makemkv.com's forum) - written to MakeMKV's own settings. */
  makemkvKey: string;
  /** The first-run tool setup has been offered / run. */
  toolsSetupDone: boolean;
  /** Retro: where the console games are, per platform, and the emulators to use. */
  retroFolders: Partial<Record<"ps5" | "ps4" | "ps3" | "ps2" | "ps1" | "psp" | "switch", string[]>>;
  emulators: Partial<Record<"ps5" | "ps4" | "ps3" | "ps2" | "ps1" | "psp" | "switch", string>>;
  /** The Store's shelf: N:\GAME\ROMS by default, one folder per platform. */
  storeRoot: string;
  /** TV Streaming: hide channels, films and shows tagged as another language. */
  tvEnglishOnly: boolean;
  /** TV Streaming: per language tag ("FR", "MULTI"...) show or hide, on top of English Only. */
  tvLanguageOverrides: Record<string, "show" | "hide">;
  /** TV Streaming: adult categories and channels hidden behind a PIN. */
  tvAdultBlocked: boolean;
  tvPin: string;
  /** Default audio language for videos with more than one track (ISO 639-1, "en"). */
  audioLanguage: string;
  /** SubDL API key (subdl.com) - subtitles for Jellyfin and TV Streaming videos. */
  subdlApiKey: string;
  /** Subtitles: fetched and shown by themselves when enabled; the language is a SubDL code (EN, ES, …). */
  subtitles: { enabled: boolean; language: string };
  /** Lyrics from LRCLIB for the Karaoke visualizer. */
  lyricsEnabled: boolean;
  /**
   * ROOT: the one drive the menu shows for media, saves, textures, patches and NFC
   * backups ("N:"), laid out as GAME, MUSIC, PHOTO, VIDEO, SAVE, TEXTURES, PATCHES,
   * NFC. Other drives stay out of the menu; game folders elsewhere (G:\GAMES) still scan.
   * "" shows every drive, as before.
   */
  rootDrive: string;
  /** Companion: phones keep a copy of every save on the cards, refreshed as they change. */
  memcardSyncToPhone: boolean;
  /** Apollo Save Tool databases: weekly refresh, offline (never fetch), where they live ("" = userData). */
  apollo: { autoUpdate: boolean; offline: boolean; location: string };
  /** What to empty out of an extracted PS3 game: the firmware update, dummy / pad files, other languages. */
  ps3Trim: { update: boolean; dummy: boolean; languages: boolean };
  /** Toybox: what Ghost does when a toy is scanned. */
  toybox: {
    onSelect: "launch" | "navigate" | "ask";
    suggestLast: boolean;
    speak: boolean;
    showCards: boolean;
    artwork: boolean;
    autoFocus: boolean;
    suggestGames: boolean;
    inGame: "full" | "small" | "voice" | "off";
    companion: boolean;
  };
  /** Jellyfin discovery on the LAN ("Media Server Connection"). */
  mediaServerEnabled: boolean;
  /** Ghost, the voice assistant. */
  assistant: { enabled: boolean; wakeWord: boolean; voiceReplies: boolean; bubbleSize: "small" | "medium" | "large" };
  /** The user's playlist: tracks in play order. */
  playlist: { name: string; filePath: string; url: string }[];
  /** Menu wallpaper: one picture, or a folder shuffled every few minutes. */
  wallpaper: { url: string; filePath: string; mode: "single" | "shuffle"; folder: string } | null;
  /** Drives seen with media folders, so an unplugged one still shows (greyed). */
  knownDrives: { drive: string; photo: boolean; video: boolean; game: boolean; music: boolean }[];
  /** Null until first-boot setup has run. */
  profile: UserProfile | null;
  /** Saved Jellyfin logins, keyed by server URL. */
  jellyfinLogins: Record<string, JellyfinLogin>;
  /** Regex matched against paired Bluetooth device names to find the power bank. */
  ankerDeviceName: string;
  /** Navigation / confirm / back blips. */
  navSoundsEnabled: boolean;
  /** The ambient menu loop. Off means silence between the boot sound and a game. */
  menuMusicEnabled: boolean;
  /** Show the percentage next to the battery icons. */
  batteryPercentEnabled: boolean;
  /** Preferred drive for Steam installs, e.g. "N:", or "" to leave it to Steam. */
  steamInstallDrive: string;
  /** Keyboard fallback for the controller Guide button, in Electron accelerator syntax. */
  overlayHotkey: string;
  /** Frame-rate readout, top-left. */
  fpsCounterEnabled: boolean;
  /** CPU / RAM / GPU / device summary, bottom-left. */
  hardwareInfoEnabled: boolean;
}

const DEFAULTS: Settings = {
  windowed: false,
  targetHz: 120,
  waveColorCycleSeconds: 18,
  musicVolume: 0.25,
  sfxVolume: 0.8,
  extraGameFolders: [],
  gameOverrides: {},
  gameArtApiKey: "",
  musicFolders: [],
  ambientTrack: "xmb",
  backgroundQuality: "auto",
  themeMode: "monthly",
  monthlyThemes: DEFAULT_MONTH_THEMES.map((t) => ({ ...t })),
  fixedTheme: { ...DEFAULT_MONTH_THEMES[11] },
  customImageUrl: "",
  ribbonEnabled: true,
  visualizerEnabled: true,
  visualizerStyle: "bars",
  introSparkleEnabled: true,
  tmdbApiKey: "",
  steamHandsOffInstall: true,
  musicShuffle: false,
  gamepadDeadZone: 0.5,
  gamepadProfile: "standard",
  gamepadVibration: true,
  renderResolution: 0,
  menuUpscaling: "sharpen",
  systemName: "",
  clock24h: false,
  dictionaryTerms: [],
  learnedWords: [],
  notifications: { enabled: true, kinds: { general: true, transfer: true, controller: true, battery: true, install: true } },
  audioOutputId: "",
  audioInputId: "",
  menuDimMinutes: 0,
  playlists: [],
  steamWebApiKey: "",
  raUsername: "",
  raApiKey: "",
  importFormat: "mp3",
  discTarget: "home",
  makemkvKey: "",
  toolsSetupDone: false,
  retroFolders: {},
  emulators: {},
  ps3Trim: { update: true, dummy: true, languages: false },
  storeRoot: "N:\\GAME\\ROMS",
  tvEnglishOnly: true,
  tvLanguageOverrides: {},
  tvAdultBlocked: true,
  tvPin: "",
  audioLanguage: "en",
  subdlApiKey: "",
  subtitles: { enabled: true, language: "EN" },
  lyricsEnabled: true,
  apollo: { autoUpdate: true, offline: false, location: "" },
  memcardSyncToPhone: true,
  rootDrive: "N:",
  toybox: { onSelect: "launch", suggestLast: true, speak: true, showCards: true, artwork: true, autoFocus: true, suggestGames: true, inGame: "small", companion: true },
  mediaServerEnabled: true,
  assistant: { enabled: false, wakeWord: true, voiceReplies: true, bubbleSize: "medium" },
  playlist: [],
  wallpaper: null,
  knownDrives: [],
  profile: null,
  jellyfinLogins: {},
  ankerDeviceName: "Anker",
  navSoundsEnabled: true,
  menuMusicEnabled: true,
  batteryPercentEnabled: true,
  steamInstallDrive: "",
  overlayHotkey: "Alt+Home",
  fpsCounterEnabled: false,
  hardwareInfoEnabled: false,
};

let cache: Settings | null = null;

function filePath(): string {
  return path.join(app.getPath("userData"), "axm-settings.json");
}

/** The last good copy: a torn or half-written file must never cost the profile. */
function backupPath(): string {
  return filePath() + ".bak";
}

function readSettingsFile(): Partial<Settings> {
  for (const p of [filePath(), backupPath()]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<Settings>;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try the backup */
    }
  }
  return {};
}

export function loadSettings(): Settings {
  if (cache) return cache;
  try {
    const merged: Settings = { ...DEFAULTS, ...readSettingsFile() };
    // A file from an older build can be missing these or hold a short array; the
    // shallow spread above wouldn't fix either, and the renderer indexes by month.
    if (!Array.isArray(merged.monthlyThemes) || merged.monthlyThemes.length !== 12) {
      merged.monthlyThemes = DEFAULT_MONTH_THEMES.map((t) => ({ ...t }));
    }
    if (!merged.fixedTheme) merged.fixedTheme = { ...DEFAULT_MONTH_THEMES[11] };
    cache = merged;
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache ?? { ...DEFAULTS };
}

export function saveSettings(partial: Partial<Settings>): Settings {
  const current = loadSettings();
  cache = { ...current, ...partial };
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  // Written whole-then-renamed, so another instance reading mid-write sees the old
  // file rather than half of the new one; the previous file becomes the backup.
  const tmp = filePath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf-8");
  try {
    if (fs.existsSync(filePath())) fs.copyFileSync(filePath(), backupPath());
  } catch {
    /* no backup this time */
  }
  fs.renameSync(tmp, filePath());
  return cache;
}

export function setGameOverride(gameId: string, override: Partial<GameOverride>): Settings {
  const current = loadSettings();
  const existing = current.gameOverrides[gameId] ?? {};
  const gameOverrides = { ...current.gameOverrides, [gameId]: { ...existing, ...override } };
  return saveSettings({ gameOverrides });
}
