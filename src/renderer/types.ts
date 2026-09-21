export type GameSource = "steam" | "epic" | "xbox" | "generic" | "retro";

/** Which loop plays behind the menu. Keys of AMBIENT_TRACKS in audio.ts. */
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
/**
 * The XMB's month colours (the PS3's own "color filter" values: Jan CBCBCB, Feb
 * D8BF1A, Mar 6DB217, Apr E17E9A, May 178816, Jun 9A61C8, Jul 02CDC7, Aug 0C76C0,
 * Sep B444C0, Oct E5A708, Nov 875B1E, Dec E3412A). The backdrop is that colour at
 * full saturation but deepened so white text still reads; the ribbon is a pale tint
 * of it, which is what makes each month read as vividly its own.
 */
export const DEFAULT_MONTH_THEMES: MonthTheme[] = [
  { ribbonColor: "#ffffff", backgroundColor: "#a9a9a9", ribbonSpeed: 0.18, ribbonWidth: 1.05 }, // January  CBCBCB
  { ribbonColor: "#fff6b8", backgroundColor: "#c9b11a", ribbonSpeed: 0.20, ribbonWidth: 1.00 }, // February D8BF1A
  { ribbonColor: "#e6ffc4", backgroundColor: "#66a615", ribbonSpeed: 0.24, ribbonWidth: 0.95 }, // March    6DB217
  { ribbonColor: "#ffe4ee", backgroundColor: "#d67590", ribbonSpeed: 0.26, ribbonWidth: 0.95 }, // April    E17E9A
  { ribbonColor: "#d2ffd8", backgroundColor: "#178816", ribbonSpeed: 0.28, ribbonWidth: 0.90 }, // May      178816
  { ribbonColor: "#f0e2ff", backgroundColor: "#9057bd", ribbonSpeed: 0.30, ribbonWidth: 0.90 }, // June     9A61C8
  { ribbonColor: "#d6fffd", backgroundColor: "#02bdb8", ribbonSpeed: 0.32, ribbonWidth: 0.85 }, // July     02CDC7
  { ribbonColor: "#d9edff", backgroundColor: "#0c6fb4", ribbonSpeed: 0.30, ribbonWidth: 0.90 }, // August   0C76C0
  { ribbonColor: "#f6dcff", backgroundColor: "#a83fb3", ribbonSpeed: 0.24, ribbonWidth: 1.00 }, // September B444C0
  { ribbonColor: "#ffeec4", backgroundColor: "#d59c08", ribbonSpeed: 0.22, ribbonWidth: 1.05 }, // October  E5A708
  { ribbonColor: "#f8e3cc", backgroundColor: "#7f561c", ribbonSpeed: 0.20, ribbonWidth: 1.10 }, // November 875B1E
  { ribbonColor: "#ffdcd6", backgroundColor: "#d63c27", ribbonSpeed: 0.16, ribbonWidth: 1.15 }, // December E3412A
];

/** The PS3's Theme › Colour choices: "Original" (the month) and the twelve tints. */
export const THEME_COLOURS: { name: string; hex: string }[] = [
  { name: "Silver", hex: "#CBCBCB" },
  { name: "Yellow", hex: "#D8BF1A" },
  { name: "Light Green", hex: "#6DB217" },
  { name: "Pink", hex: "#E17E9A" },
  { name: "Green", hex: "#178816" },
  { name: "Violet", hex: "#9A61C8" },
  { name: "Cyan", hex: "#02CDC7" },
  { name: "Blue", hex: "#0C76C0" },
  { name: "Purple", hex: "#B444C0" },
  { name: "Orange", hex: "#E5A708" },
  { name: "Brown", hex: "#875B1E" },
  { name: "Red", hex: "#E3412A" },
];

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface GameEntry {
  id: string;
  name: string;
  source: GameSource;
  launchType: "exe" | "uri" | "shell";
  launchTarget: string;
  launchArgs?: string[];
  installDir: string;
  drive: string;
  iconPath?: string;
  /** Wide banner shown as the menu background while this game is selected. */
  heroPath?: string;
  losslessProfile: 1 | 2 | 3 | null;
  hidden: boolean;
  /** Retro (emulated) games only. */
  platform?: RetroPlatform;
  romPath?: string;
  /** The emulator's exe, or null when it isn't installed. */
  emulator?: string | null;
  emulatorName?: string;
  /** Why it can't be launched yet (a PS3 disc image that needs decrypting). */
  needsPrep?: string;
  isoEncrypted?: boolean;
  /** PS3 disc image that has already been extracted: where the folder game is. */
  extractedDir?: string;
}

export type RetroPlatform = "ps5" | "ps4" | "ps3" | "ps2" | "ps1" | "psp" | "switch";

export interface MediaEntry {
  id: string;
  name: string;
  filePath: string;
}

export interface MusicEntry {
  kind: "folder" | "track";
  name: string;
  filePath: string;
  url?: string;
}

export interface BrowseEntry {
  kind: "folder" | "file";
  name: string;
  filePath: string;
  url?: string;
  /** Play `url` through hls.js (an HLS playlist) instead of setting it as src. */
  hls?: boolean;
}

export interface BrowseListing {
  kind: "photo" | "video";
  path: string;
  parent: string | null;
  title: string;
  entries: BrowseEntry[];
}

export type SteamInstallState = "installed" | "installing" | "not-installed";

export interface SteamLibraryEntry {
  appid: number;
  name: string;
  state: SteamInstallState;
  progress?: number;
  lastPlayed: number;
  coverUrl: string;
}

export interface SteamLibrary {
  account: string | null;
  games: SteamLibraryEntry[];
}

export interface UserProfile {
  name: string;
  avatarUrl: string;
}

export interface JellyfinLogin {
  serverUrl: string;
  serverName: string;
  userId: string;
  userName: string;
  accessToken: string;
}

export interface JellyfinServer {
  name: string;
  url: string;
  id: string;
}

export interface JellyfinItem {
  id: string;
  name: string;
  type: string;
  isFolder: boolean;
  imageUrl?: string;
  backdropUrl?: string;
  year?: string;
  overview?: string;
  tmdbId?: string;
  container?: string;
  seriesName?: string;
  season?: number;
  episode?: number;
  streamUrl?: string;
  hls?: boolean;
}

export interface ArtChoice {
  id: number;
  url: string;
  thumb: string;
}

export interface WifiStatus {
  present: boolean;
  connected: boolean;
  ssid: string | null;
  signal: number | null;
}

export interface BluetoothStatus {
  present: boolean;
  enabled: boolean;
  connectedCount: number;
}

export interface ResolutionState {
  /** Target height actually in use (after auto and clamping). */
  target: number;
  /** The display's physical height in pixels. */
  nativeHeight: number;
  nativeWidth: number;
  /** Chosen by auto rather than by hand. */
  auto: boolean;
}

export interface VolumeInfo {
  drive: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  kind: "fixed" | "removable" | "network" | "other";
  system: boolean;
  cartridge?: boolean;
}

export interface TransferProgress {
  id: string;
  name: string;
  destination: string;
  done: number;
  total: number;
  finished: boolean;
  error?: string;
}

export interface SongInfo {
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
  durationSec: number;
  bitrateKbps: number;
  coverUrl: string | null;
  artistInfo: { type?: string; area?: string; began?: string; ended?: string; tags: string[]; disambiguation?: string } | null;
  source: string;
}

export type DbPlatform = "ps1" | "ps2" | "ps3" | "3ds" | "wii" | "wiiu" | "ds";

export interface GameInfo {
  title: string;
  serial: string;
  region: string;
  languages: string;
  genre: string;
  publisher: string;
  developer: string;
  releaseDate: string;
  year: string;
  players: string;
  synopsis: string;
  source: string;
  sourceUrl: string;
  matchedBy: "serial" | "release name" | "title" | "none";
}

export interface PcPackage {
  id: string;
  name: string;
  filePath: string;
  sizeBytes: number;
  installed: boolean;
  installPath: string | null;
  artUrl: string | null;
}

export interface GameDbStatus {
  platform: DbPlatform;
  name: string;
  home: string;
  cached: boolean;
  updated: string | null;
  entries: number;
  sizeBytes: number;
}

export interface ScreenInfo {
  title: string;
  year: string;
  kind: "movie" | "tv";
  overview: string;
  rating: number | null;
  votes: number;
  genres: string[];
  runtimeMin: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  tagline: string;
  seasons?: number;
  episodes?: number;
  status?: string;
  source: string;
}

/** Where the in-menu browser is, for the footer toolbar. */
export interface BrowserNavState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

/** A drive with PHOTO / VIDEO / GAME folders at its root. */
export interface MediaDrive {
  drive: string;
  photo: string | null;
  video: string | null;
  game: string | null;
  music: string | null;
}

export type DiscKind = "audio-cd" | "dvd" | "bluray" | "ps1" | "ps2" | "data" | "unknown";
export interface Disc { drive: string; label: string; kind: DiscKind; tracks?: number; photo?: string | null; video?: string | null; music?: string | null }
export interface DiscTools { ffmpeg: string | null; ffmpegCdio: boolean; handbrake: string | null; makemkv: string | null }
export interface RemotePlayStatus { installed: boolean; exe: string | null; version: string | null; running: boolean }
export interface Achievement { id: string; name: string; description: string; unlocked: boolean; unlockedAt: string | null; icon: string | null; points?: number }
export interface TrophyGame { id: string; name: string; unlocked: number; total: number; icon: string | null; source: "steam" | "ra" }
export interface RunningGame { id: string; name: string; pids: number[] }
export interface ConnectionStatus { adapter: string; connected: boolean; ssid: string | null; signal: number | null; ip: string | null; gateway: string | null; dns: string[]; mac: string | null; wifiEnabled: boolean }
export interface ConnectionTest { adapter: string; ip: string | null; gateway: "ok" | "failed" | "none"; internet: "ok" | "failed"; dns: "ok" | "failed"; mbps: number | null }

export interface AssistantStatus { modelReady: boolean; modelUrl: string | null; modelName: string; listening: boolean }
export interface UpdateInfo { current: string; latest: string | null; newer: boolean; notes: string; url: string | null; assetUrl: string | null; assetName: string | null; checkedAt: string; error: string | null }

export interface PowerPlan { guid: string; name: string; active: boolean }
export interface PowerSettings { plans: PowerPlan[]; screenOffBattery: number; screenOffPlugged: number; sleepBattery: number; sleepPlugged: number }
export interface ClockInfo { now: string; timeZone: string; timeZoneOffsetMin: number; autoTime: boolean | null }
export interface FileInfo { sizeBytes: number; modified: string; created: string; exists: boolean }

export interface WifiNetwork {
  ssid: string;
  signal: number;
  auth: string;
  connected: boolean;
  known: boolean;
}

export interface BluetoothDevice {
  id: string;
  name: string;
  paired: boolean;
  connected: boolean;
  canPair: boolean;
  kind: "audio" | "controller" | "input" | "other";
}

export interface ControllerDevice {
  name: string;
  kind: "ps" | "xbox" | "other";
  wireless: boolean;
  battery: number | null;
}

export interface HardwareInfo {
  deviceName: string;
  model: string;
  cpu: string;
  cpuGhz: number;
  ramGb: number;
  gpu: string;
  gpuGb: number | null;
}

export interface AnkerStatus {
  connected: boolean;
  level: number | null;
  depleting: boolean;
  deviceName: string | null;
}

export interface SaveEntry {
  id: string;
  name: string;
  filePath: string;
  source: "Saved Games" | "My Games" | "Steam Cloud";
  modified: string;
}

export interface LauncherEntry {
  id: string;
  name: string;
  installed: boolean;
}

export interface MusicListing {
  path: string | null;
  parent: string | null;
  title: string;
  entries: MusicEntry[];
}

export interface Settings {
  windowed: boolean;
  targetHz: number;
  waveColorCycleSeconds: number;
  musicVolume: number;
  sfxVolume: number;
  extraGameFolders: string[];
  gameOverrides: Record<string, { hidden?: boolean; losslessProfile?: 1 | 2 | 3 | null }>;
  gameArtApiKey: string;
  musicFolders: string[];
  ambientTrack: AmbientTrackId;
  backgroundQuality: BackgroundQuality;
  themeMode: ThemeMode;
  monthlyThemes: MonthTheme[];
  fixedTheme: MonthTheme;
  customImageUrl: string;
  ribbonEnabled: boolean;
  visualizerEnabled: boolean;
  visualizerStyle: string;
  introSparkleEnabled: boolean;
  tmdbApiKey: string;
  steamHandsOffInstall: boolean;
  musicShuffle: boolean;
  gamepadDeadZone: number;
  gamepadProfile: "standard" | "swapped";
  gamepadVibration: boolean;
  renderResolution: number;
  /** Menu upscaling look when rendering below native: off, FSR-style sharpen, strong. */
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
  playlists: { name: string; tracks: MusicEntry[] }[];
  /** Trophy Collection sources. */
  steamWebApiKey: string;
  raUsername: string;
  raApiKey: string;
  /** Audio CD import format. */
  importFormat: "mp3" | "aac" | "opus" | "flac";
  discTarget: string;
  makemkvKey: string;
  toolsSetupDone: boolean;
  toybox: ToyboxSettings;
  retroFolders: Partial<Record<RetroPlatform, string[]>>;
  emulators: Partial<Record<RetroPlatform, string>>;
  ps3Trim: Ps3TrimSettings;
  storeRoot: string;
  tvEnglishOnly: boolean;
  tvLanguageOverrides: Record<string, "show" | "hide">;
  tvAdultBlocked: boolean;
  tvPin: string;
  audioLanguage: string;
  subdlApiKey: string;
  subtitles: { enabled: boolean; language: string };
  lyricsEnabled: boolean;
  apollo: { autoUpdate: boolean; offline: boolean; location: string };
  memcardSyncToPhone: boolean;
  rootDrive: string;
  /** Jellyfin discovery on the LAN ("Media Server Connection"). */
  mediaServerEnabled: boolean;
  /** Ghost, the voice assistant. */
  assistant: { enabled: boolean; wakeWord: boolean; voiceReplies: boolean; bubbleSize: "small" | "medium" | "large" };
  playlist: MusicEntry[];
  wallpaper: { url: string; filePath: string; mode: "single" | "shuffle"; folder: string } | null;
  knownDrives: { drive: string; photo: boolean; video: boolean; game: boolean; music: boolean }[];
  profile: UserProfile | null;
  jellyfinLogins: Record<string, JellyfinLogin>;
  ankerDeviceName: string;
  navSoundsEnabled: boolean;
  menuMusicEnabled: boolean;
  batteryPercentEnabled: boolean;
  steamInstallDrive: string;
  overlayHotkey: string;
  fpsCounterEnabled: boolean;
  hardwareInfoEnabled: boolean;
}

/** Artwork that landed after the initial scan. Either field may be absent. */
export interface ArtUpdate {
  /** The lookup for this game ran (art or none) - the placeholder can stop spinning. */
  searched?: boolean;
  gameId: string;
  iconPath?: string;
  heroPath?: string;
}

/** Mirrors src/main/toybox/types.ts - the normalized shape every ecosystem becomes. */
export type ToyPlatform = "amiibo" | "skylanders" | "disney-infinity" | "lego-dimensions" | "generic";

export interface ToyFigure {
  schemaVersion: number;
  id: string;
  platform: ToyPlatform;
  name: string;
  franchise?: string;
  series?: string;
  manufacturer?: string;
  variant?: string;
  attributes?: Record<string, string>;
  media?: {
    thumbnail?: string;
    png?: string;
    hero?: string;
    model3d?: string;
    remoteArtwork?: string;
    copyrightOwner?: string;
    redistributable?: boolean;
  };
  compatibleGames?: string[];
  nfc?: { technology?: string; identifierType?: string; head?: string; tail?: string; characterId?: string; variantId?: string };
}

export interface ToyShelfFigure extends ToyFigure {
  artUrl: string | null;
  owned: boolean;
  favorite: boolean;
  wanted: boolean;
}

export interface ToyShelfFilter {
  view: "all" | "owned" | "favorites" | "recent";
  platform?: ToyPlatform | "";
  query?: string;
  /** A brand's sub-folder: figures, power-discs, vehicles, cards... */
  kind?: string;
}

export interface StoreItem {
  id: string;
  kind: "game" | "emulator";
  platform: RetroPlatform;
  name: string;
  path: string | null;
  sizeBytes: number;
  installed: boolean;
  libraryDir: string;
  emulatorName: string;
  emulatorInstalled: boolean;
  note?: string;
  iconPath?: string;
  heroPath?: string;
  needsPrep?: string;
}

export interface Ps3TrimSettings {
  update: boolean;
  dummy: boolean;
  languages: boolean;
}

export interface ToyKindRow {
  kind: string;
  label: string;
  count: number;
  owned: number;
}

export interface ToyboxSettings {
  onSelect: "launch" | "navigate" | "ask";
  suggestLast: boolean;
  speak: boolean;
  showCards: boolean;
  artwork: boolean;
  autoFocus: boolean;
  suggestGames: boolean;
  inGame: "full" | "small" | "voice" | "off";
  companion: boolean;
}

export interface ToyboxDetectionEvent {
  figureId: string | null;
  ecosystem: ToyPlatform | "custom";
  name: string;
  character?: string;
  variant?: string;
  series?: string;
  franchise?: string;
  artwork?: { thumbnail?: string; png?: string; hero?: string };
  compatibleGameIds: string[];
  reader: { id: string; type: string };
  uid: string;
  detectedAt: number;
  dumpPath?: string;
  handedTo?: string[];
}

export interface ToyboxRemovalEvent {
  uid: string;
  figureId: string | null;
  reader: { id: string; type: string };
  removedAt: number;
}

export interface ToyboxNfcStatus {
  pcscRunning: boolean;
  readers: string[];
  companionPort: number | null;
  pythonReady: boolean;
  lastError: string | null;
}

export interface ToyboxStats {
  byPlatform: Record<string, number>;
  total: number;
  withArtwork: number;
  missingArtwork: number;
  databaseVersion: number | null;
  updatedAt: string | null;
}

export interface ToyboxSummary {
  hasDatabase: boolean;
  stats: ToyboxStats;
  recent: ToyFigure[];
  favorites: ToyFigure[];
}

/** Input forwarded from a paired phone, shaped so the menu treats it as local. */
// ---- Memory cards and Apollo ----

export type CardKind = "ps1" | "ps2";
export interface MemoryCard { id: string; name: string; kind: CardKind; filePath: string; sizeBytes: number; slot: 1 | 2; createdAt: string }
export interface CardSave { name: string; title: string; sizeBytes: number; blocks?: number; files?: string[] }
export interface EmulatorCards { id: "duckstation" | "pcsx2"; name: string; kind: CardKind; installPath: string | null; dataPath: string | null; cardFolder: string | null; cardFolderFromConfig: boolean; defaultCardFolder: string; cards: string[] }
export interface ImportCandidate { filePath: string; fileName: string; kind: CardKind | null; format: string; saves: { name: string; title: string; blocks: number }[]; supported: boolean; reason?: string }
export interface TexturePack { name: string; author: string; source: "github"; repo: string; branch?: string; asset?: string; path?: string; sizeMb: number; license?: string; notes?: string }
export interface TextureGame { platform: "ps1" | "ps2"; title: string; serials: string[]; packs: TexturePack[] }
export interface TextureDb { note: string; moreSources: { name: string; url: string }[]; games: TextureGame[] }
export interface InstalledPack { platform: "ps1" | "ps2"; serial: string; slug: string; name: string; repo: string; folder: string; installedAt: string; enabled: boolean; linkedAt: string | null }
export interface PackStatus { game: TextureGame; serial: string; packs: { pack: TexturePack; slug: string; installed: InstalledPack | null }[]; emulator: { found: boolean; dataPath: string | null; texturesDir: string | null } }
export interface SaveRef { cardId: string; save: string }
export interface ApolloOption { tag: string; choices: { value: string; label: string }[] }
export interface ApolloCode { id: number; name: string; type: "sw" | "bsd" | "python"; lines: string[]; options: ApolloOption[]; target: { folder: string | null; file: string }; group: string | null; isDefault: boolean; isInfo: boolean; isRequired: boolean; order: "le" | "be" | null }
export interface MatchedCode { patchFile: string; patchTitle: string | null; author: string | null; source: "apollo" | "custom"; code: ApolloCode; targets: string[] }
export interface SaveIdentity { platform: string; titleId: string; productCode: string; region: string; gameName: string | null; files: { name: string; size: number }[] }
export interface PatchMatch { identity: SaveIdentity; codes: MatchedCode[]; hidden: number; attribution: string[] }
export interface ApolloSelection { patchFile: string; codeId: number; options: Record<string, string> }
export interface ApolloPreview { ok: boolean; error?: string; files: { name: string; before: number; after: number; changed: number; first: { offset: number; from: string; to: string }[] }[]; log: string[]; added: string[] }
export interface BackupInfo { id: string; at: string; cardId: string; save: string; applied: string[]; note: string }
export interface CommunitySave { platform: string; titleId: string; zip: string; description: string; local: string | null; iconUrl: string | null }
export interface ApolloStatus { location: string; patchesUpdatedAt: string | null; savesUpdatedAt: string | null; patchCounts: Record<string, number>; saveTitleCounts: Record<string, number>; customCount: number; autoUpdate: boolean; offline: boolean; cacheBytes: number }

export type CompanionInput =
  | { kind: "xmb"; action: "up" | "down" | "left" | "right" | "confirm" | "back" | "context" | "guide" }
  | { kind: "media"; command: string; value?: number }
  | { kind: "pointer"; input: { kind: string; dx?: number; dy?: number; button?: string } }
  | { kind: "setting"; id: string; value: string }
  | { kind: "keyboard"; text: string; done: boolean }
  | { kind: "musicPlay"; filePath: string };

export interface CompanionSession {
  deviceId: string;
  name: string;
  address: string;
  mode: string;
  paired: boolean;
  since: number;
}

export interface CompanionStatus {
  /** What the menu last told the phones is playing. */
  media?: { playing: boolean; title?: string; kind?: string } | null;
  running: boolean;
  enabled: boolean;
  addresses: string[];
  permissions: Record<string, boolean>;
  sessions: CompanionSession[];
  trusted: { deviceId: string; name: string; platform: string; pairedAt: string; lastSeenAt: string }[];
}

export type TvKind = "live" | "movie" | "series";

export interface TvAccount {
  url: string;
  username: string;
  password: string;
}

export interface TvStatus {
  configured: boolean;
  connected: boolean;
  message: string;
  expiresAt?: string;
  activeConnections?: string;
  maxConnections?: string;
}

export interface TvCategory {
  id: string;
  name: string;
}

export interface TvEpisode {
  id: string;
  title: string;
  season: number;
  episode: number;
  extension?: string;
  duration?: string;
}

export interface TvItem {
  id: string;
  name: string;
  kind: TvKind;
  categoryId: string;
  /** The provider's own artwork URL, fetched at runtime rather than bundled. */
  icon?: string;
  epgChannelId?: string;
  extension?: string;
}

export interface TvProgramme {
  title: string;
  description?: string;
  start: string;
  end: string;
}

export interface AxmApi {
  getSettings(): Promise<Settings>;
  setSettings(partial: Partial<Settings>): Promise<Settings>;
  toggleFullscreen(): Promise<Settings>;
  getGames(): Promise<GameEntry[]>;
  scanGames(): Promise<GameEntry[]>;
  launchGame(gameId: string): Promise<void>;
  setLosslessProfile(gameId: string, profile: 1 | 2 | 3 | null): Promise<Settings>;
  losslessScalingStatus(): Promise<{ configPresent: boolean }>;
  pickGameFolder(): Promise<Settings>;
  getMedia(kind: "photo" | "video" | "music"): Promise<MediaEntry[]>;
  openMedia(filePath: string): Promise<void>;
  getSaves(): Promise<SaveEntry[]>;
  browseMedia(kind: "photo" | "video", dirPath: string | null): Promise<BrowseListing>;
  listBundledAvatars(): Promise<{ id: string; url: string }[]>;
  listPictures(): Promise<{ id: string; url: string; label: string }[]>;
  fetchGameIcons(): Promise<void>;
  onGameIcon(callback: (update: { gameId?: string; name?: string; url?: string; done?: boolean }) => void): void;
  saveProfile(profile: UserProfile): Promise<Settings>;
  cacheImage(url: string, key: string): Promise<string | null>;
  listArtChoices(gameId: string): Promise<ArtChoice[]>;
  setGameArt(gameId: string, url: string): Promise<string | null>;
  jellyfinDiscover(): Promise<JellyfinServer[]>;
  jellyfinLogin(server: JellyfinServer, username: string, password: string): Promise<JellyfinLogin | null>;
  jellyfinForget(serverUrl: string): Promise<Settings>;
  jellyfinLibraries(login: JellyfinLogin): Promise<JellyfinItem[] | null>;
  jellyfinItems(login: JellyfinLogin, parentId: string): Promise<JellyfinItem[] | null>;
  getAnkerStatus(): Promise<AnkerStatus>;
  getWifiStatus(): Promise<WifiStatus>;
  getBluetoothStatus(): Promise<BluetoothStatus>;
  getHardwareInfo(): Promise<HardwareInfo>;
  getMediaDrives(): Promise<MediaDrive[]>;
  getVolumes(): Promise<VolumeInfo[]>;
  getControllerDevices(): Promise<ControllerDevice[]>;
  wifiList(): Promise<WifiNetwork[]>;
  wifiConnect(ssid: string, password: string | null): Promise<{ ok: boolean; message: string }>;
  wifiDisconnect(): Promise<void>;
  wifiForget(ssid: string): Promise<void>;
  btList(): Promise<BluetoothDevice[]>;
  btPair(id: string): Promise<{ ok: boolean; message: string }>;
  btUnpair(id: string): Promise<{ ok: boolean; message: string }>;
  getPowerSettings(): Promise<PowerSettings>;
  setPowerPlan(guid: string): Promise<boolean>;
  setPowerTimeout(what: "screen" | "sleep", onBattery: boolean, minutes: number): Promise<boolean>;
  powerAction(action: "shutdown" | "restart" | "sleep"): Promise<boolean>;
  getClock(): Promise<ClockInfo>;
  syncClock(): Promise<{ ok: boolean; message: string }>;
  listTimeZones(): Promise<string[]>;
  setTimeZone(id: string): Promise<boolean>;
  fileInfo(filePath: string): Promise<FileInfo>;
  hostName(): Promise<string>;
  listDiscs(): Promise<Disc[]>;
  discTools(): Promise<DiscTools>;
  importAudioCd(disc: Disc, target: string, format: "mp3" | "aac" | "opus" | "flac"): Promise<string>;
  backupDisc(disc: Disc, target: string, title?: string): Promise<string>;
  findDiscBackup(disc: Disc, target: string, title?: string): Promise<string | null>;
  guessDiscTitle(label: string): Promise<string>;
  remotePlayStatus(): Promise<RemotePlayStatus>;
  installRemotePlay(): Promise<RemotePlayStatus>;
  launchRemotePlay(): Promise<boolean>;
  onRemotePlayExit(callback: () => void): void;
  steamTrophyGames(): Promise<{ games: TrophyGame[]; error: string | null }>;
  steamAchievements(appid: string): Promise<{ list: Achievement[]; error: string | null }>;
  raTrophyGames(): Promise<{ games: TrophyGame[]; error: string | null }>;
  raAchievements(gameId: string): Promise<{ list: Achievement[]; error: string | null }>;
  raVerify(username: string, apiKey: string): Promise<{ ok: boolean; message: string }>;
  runningGame(): Promise<RunningGame | null>;
  quitRunningGame(): Promise<boolean>;
  connectionStatus(): Promise<ConnectionStatus>;
  setWifiEnabled(enabled: boolean): Promise<{ ok: boolean; message: string }>;
  connectionTest(): Promise<ConnectionTest>;
  manualUrl(): Promise<string>;
  assistantStatus(): Promise<AssistantStatus>;
  ttsStatus(): Promise<TtsStatus>;
  installTts(): Promise<TtsStatus>;
  removeTts(): Promise<void>;
  startTts(): Promise<boolean>;
  speak(text: string): Promise<string | null>;
  pickVoiceClip(): Promise<string | null>;
  resetVoiceClip(): Promise<void>;
  toolsState(): Promise<ToolState[]>;
  installTools(): Promise<ToolState[]>;
  startVoice(micId: string): Promise<boolean>;
  stopVoice(): Promise<void>;
  onVoice(callback: (message: { event: string; payload: unknown }) => void): void;
  checkForUpdate(): Promise<UpdateInfo>;
  downloadUpdate(assetUrl: string, assetName: string): Promise<string>;
  openUpdate(file: string): Promise<void>;
  installAssistantModel(): Promise<AssistantStatus>;
  removeAssistantModel(): Promise<void>;
  createMediaFolder(parentDir: string, name: string): Promise<string>;
  getSongInfo(filePath: string): Promise<SongInfo | null>;
  getScreenInfo(title: string, year: string, kind: "movie" | "tv" | "auto", tmdbId?: string): Promise<ScreenInfo | null>;
  getGameInfo(platform: DbPlatform, name: string, filePath?: string): Promise<GameInfo | null>;
  updateGameDb(platform: DbPlatform): Promise<{ ok: boolean; message: string }>;
  gameDbStatus(): Promise<GameDbStatus[]>;
  clearGameDbCache(): Promise<{ ok: boolean; message: string }>;
  gameDbLocation(): Promise<string>;
  listPcPackages(): Promise<PcPackage[]>;
  pcPackageFolders(): Promise<{ images: string | null; installs: string | null }>;
  mountPcPackage(filePath: string): Promise<{ ok: boolean; drive?: string; message: string }>;
  dismountPcPackage(filePath: string): Promise<boolean>;
  installPcPackage(filePath: string): Promise<{ ok: boolean; message: string; installPath?: string; interactive?: boolean }>;
  onPcInstallProgress(cb: (p: { filePath: string; note: string }) => void): void;
  copyMedia(kind: "music" | "photo" | "video", source: string, target: string): Promise<string>;
  jellyfinDownload(login: JellyfinLogin, itemId: string, name: string, kind: "music" | "video", target: string, container: string): Promise<string>;
  onTransfer(callback: (progress: TransferProgress) => void): void;
  /** The resolution the menu is being drawn at, sent on boot and on change. */
  onResolution(callback: (state: ResolutionState) => void): void;
  getResolution(): Promise<ResolutionState>;
  browserOpen(url: string): Promise<void>;
  browserClose(): Promise<void>;
  browserInput(action: string): Promise<boolean>;
  onBrowserClosed(callback: () => void): void;
  onBrowserNav(callback: (state: BrowserNavState) => void): void;
  overlayClose(): Promise<void>;
  overlayToggle(): Promise<void>;
  overlayState(): Promise<{ active: boolean }>;
  onOverlay(callback: (state: { active: boolean }) => void): void;
  getSteamLibrary(): Promise<SteamLibrary>;
  installSteamGame(appid: number): Promise<void>;
  launchSteamApp(appid: number): Promise<void>;
  openFolder(dirPath: string): Promise<void>;
  getLaunchers(): Promise<LauncherEntry[]>;
  openLauncher(id: string): Promise<void>;
  browseMusic(dirPath: string | null): Promise<MusicListing>;
  pickMusicFolder(): Promise<Settings>;
  pickBackgroundImage(): Promise<Settings>;
  openBrowser(url: string): Promise<void>;
  tvStatus(): Promise<TvStatus>;
  tvLogos(): Promise<{ folder: string; count: number; apiFolder: string; apiSource: string | null }>;
  tvRefreshLogos(): Promise<number>;
  tvLogin(account: TvAccount | null): Promise<TvStatus>;
  tvCategories(kind: TvKind, adultUnlocked?: boolean): Promise<TvCategory[]>;
  /** Language tags the provider uses ("EN", "FR", "MULTI"...), with how many rows carry each. */
  tvLanguages(): Promise<{ tag: string; count: number; english: boolean }[]>;
  tvItems(kind: TvKind, categoryId?: string, adultUnlocked?: boolean): Promise<TvItem[]>;
  tvEpg(streamId: string): Promise<TvProgramme[]>;
  tvStreamUrl(item: TvItem): Promise<string | null>;
  tvEpisodes(seriesId: string): Promise<TvEpisode[]>;
  tvEpisodeUrl(ep: TvEpisode): Promise<string | null>;
  tvRelayUrl(url: string): Promise<string | null>;
  /** The settings a paired phone may change - the list, labels and current values. */
  companionSettings(items: { id: string; title: string; group: string; kind: "toggle" | "choice"; value: string; options?: { id: string; label: string }[]; detail?: string }[]): void;
  /** A text prompt is open (or closed, null) - phones can type for it. */
  companionKeyboard(prompt: { title: string; label: string; value: string; secret: boolean } | null): void;
  // ---- Memory Card Utility ----
  memcardOverview(): Promise<{ managed: MemoryCard[]; emulators: EmulatorCards[] }>;
  memcardCreate(kind: CardKind, name: string): Promise<MemoryCard>;
  memcardRename(id: string, name: string): Promise<MemoryCard | null>;
  memcardSlot(id: string, slot: 1 | 2): Promise<MemoryCard | null>;
  memcardDelete(id: string): Promise<boolean>;
  memcardSaves(id: string): Promise<{ saves: CardSave[]; usage: { usedBlocks: number; totalBlocks: number } | null }>;
  memcardPublish(id: string, emulator: string): Promise<{ ok: boolean; message: string }>;
  memcardAdopt(emulator: string, file: string, name: string): Promise<{ ok: boolean; message: string }>;
  memcardExport(id: string, save: string | null, folder: string): Promise<{ ok: boolean; message: string; file?: string }>;
  memcardInspect(file: string): Promise<ImportCandidate>;
  memcardScanDrive(root: string): Promise<{ ps1: ImportCandidate[]; ps2: ImportCandidate[] }>;
  memcardImportPs1(id: string, source: string, only?: string[]): Promise<{ ok: boolean; imported: number; message: string }>;
  memcardImportPs2(id: string, source: string): Promise<{ ok: boolean; message: string }>;
  // ---- HD texture packs ----
  textureDb(): Promise<TextureDb>;
  texturePacksFor(gameId: string): Promise<{ serial: string | null; status: PackStatus | null } | null>;
  textureInstall(platform: string, serial: string, slug: string): Promise<{ ok: boolean; message: string }>;
  textureEnable(platform: string, serial: string, slug: string): Promise<{ ok: boolean; message: string }>;
  textureDisable(platform: string, serial: string, slug: string): Promise<{ ok: boolean; message: string }>;
  textureDelete(platform: string, serial: string, slug: string): Promise<{ ok: boolean; message: string }>;
  onTextureProgress(callback: (p: { slug: string; note: string }) => void): void;
  // ---- Apollo Save Tool ----
  apolloStatus(): Promise<ApolloStatus>;
  apolloUpdatePatches(): Promise<{ ok: boolean; message: string; count: number }>;
  apolloUpdateSaves(): Promise<{ ok: boolean; message: string; count: number }>;
  apolloClearCache(): Promise<void>;
  apolloSetLocation(location: string): Promise<void>;
  apolloFind(ref: SaveRef): Promise<PatchMatch | { error: string } | null>;
  apolloPreview(ref: SaveRef, selections: ApolloSelection[]): Promise<ApolloPreview>;
  apolloApply(ref: SaveRef, selections: ApolloSelection[], note?: string): Promise<{ ok: boolean; message: string; backupId?: string; log: string[] }>;
  apolloBackups(ref: SaveRef): Promise<BackupInfo[]>;
  apolloRestore(ref: SaveRef, backupId?: string): Promise<{ ok: boolean; message: string }>;
  apolloCommunity(ref: SaveRef | { platform: string; titleId: string }): Promise<{ gameName: string | null; titleId: string; saves: CommunitySave[] }>;
  apolloImportCommunity(cardId: string, platform: string, titleId: string, zip: string): Promise<{ ok: boolean; message: string }>;
  onApolloProgress(callback: (p: { note: string }) => void): void;
  /** A copy of the save to every paired phone. */
  companionSendSave(cardId: string, save: string): Promise<void>;
  /** The menu changed a card (edit, import, restore): phones get the new list. */
  memcardsChanged(): void;
  onMemcardsChanged(callback: (c: { cardId: string; save: string }) => void): void;
  /** SubDL subtitles for a film or episode, as WebVTT text. */
  findSubtitles(q: { title: string; year?: string; kind: "movie" | "tv"; season?: number; episode?: number }): Promise<string | null>;
  /** LRCLIB lyrics for the track: timed lines when synced, t = -1 otherwise. */
  findLyrics(artist: string, title: string, album: string, duration: number): Promise<{ synced: boolean; lines: { t: number; text: string }[]; source: string } | null>;
  tvDownload(url: string, name: string, target: string, container: string): Promise<string>;
  companionStatus(): Promise<CompanionStatus>;
  companionForget(deviceId: string): Promise<boolean>;
  companionMedia(state: { playing: boolean; title?: string; artist?: string; album?: string; artworkUrl?: string; positionSeconds?: number; durationSeconds?: number; kind?: string; filePath?: string; output?: string }): void;
  companionSetEnabled(enabled: boolean): Promise<boolean>;
  companionPermissions(patch: Record<string, boolean>): Promise<Record<string, boolean>>;
  onCompanionInput(callback: (input: CompanionInput) => void): void;
  onCompanionPairing(callback: (p: { code: string | null; deviceName: string }) => void): void;
  onCompanionDevices(callback: (p: { sessions: CompanionSession[] }) => void): void;
  onCompanionStatus(callback: (p: { message: string }) => void): void;
  toyboxSummary(): Promise<ToyboxSummary>;
  toyboxByPlatform(platform: ToyPlatform): Promise<ToyFigure[]>;
  toyboxSearch(query: string): Promise<ToyFigure[]>;
  toyboxShelf(filter: ToyShelfFilter): Promise<ToyShelfFigure[]>;
  toyboxKinds(platform: ToyPlatform): Promise<ToyKindRow[]>;
  retroEmulators(): Promise<{ platform: RetroPlatform; name: string; exe: string | null; winget: string | null }[]>;
  preparePs3(gameId: string, trim: Ps3TrimSettings | null): Promise<{ dir: string; keySource: string | null; decrypted: boolean; freed: number; iso: string; isoBytes: number }>;
  deleteDiscImage(gameId: string): Promise<boolean>;
  installEmulator(platform: RetroPlatform): Promise<boolean>;
  desktopShortcut(platform: RetroPlatform): Promise<boolean>;
  storeCatalogue(): Promise<StoreItem[]>;
  storeInstall(item: StoreItem): Promise<string>;
  onStoreArt(callback: (u: { id: string; iconPath?: string; heroPath?: string }) => void): void;
  toyboxSimulate(figureId: string | null): Promise<ToyboxDetectionEvent | null>;
  toyboxSimulateRemoval(): Promise<void>;
  toyboxNfcStatus(): Promise<ToyboxNfcStatus>;
  toyboxDumpsDir(): Promise<string>;
  toyboxLastGame(figureId: string): Promise<string | null>;
  toyboxSetLastGame(figureId: string, gameId: string): Promise<void>;
  toyboxSaveCustomTag(uid: string, label: string, figureId?: string): Promise<void>;
  onToyboxDetected(callback: (event: ToyboxDetectionEvent) => void): void;
  onToyboxRemoved(callback: (event: ToyboxRemovalEvent) => void): void;
  toyboxSetState(figureId: string, patch: Record<string, unknown>): Promise<unknown>;
  onArtUpdated(callback: (update: ArtUpdate) => void): void;
  /** Whether a SteamGridDB key is set anywhere (apis.json, the environment, Settings). */
  artConfigured(): Promise<boolean>;
  artSnapshot(): Promise<{ id: string; iconPath?: string; heroPath?: string }[]>;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    axm: AxmApi;
  }
}

export interface TtsStatus {
  python: string | null;
  engineReady: boolean;
  engineRunning: boolean;
  device: string | null;
  voiceClip: string;
  installing: boolean;
  cacheCount: number;
}

export interface ToolState {
  id: "ffmpeg" | "handbrake" | "makemkv" | "python" | "voice";
  name: string;
  installed: boolean;
  detail: string;
}
