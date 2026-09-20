export type GameSource = "steam" | "epic" | "xbox" | "generic";

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
  { ribbonColor: "#f2f2f2", backgroundColor: "#5c5c5c", ribbonSpeed: 0.18, ribbonWidth: 1.05 }, // January  CBCBCB
  { ribbonColor: "#fff3a6", backgroundColor: "#8a7a0c", ribbonSpeed: 0.20, ribbonWidth: 1.00 }, // February D8BF1A
  { ribbonColor: "#dcffb3", backgroundColor: "#3f7a09", ribbonSpeed: 0.24, ribbonWidth: 0.95 }, // March    6DB217
  { ribbonColor: "#ffd6e6", backgroundColor: "#9c3f5d", ribbonSpeed: 0.26, ribbonWidth: 0.95 }, // April    E17E9A
  { ribbonColor: "#c8ffcf", backgroundColor: "#0f6a12", ribbonSpeed: 0.28, ribbonWidth: 0.90 }, // May      178816
  { ribbonColor: "#ead6ff", backgroundColor: "#5f3a85", ribbonSpeed: 0.30, ribbonWidth: 0.90 }, // June     9A61C8
  { ribbonColor: "#c9fffd", backgroundColor: "#03847f", ribbonSpeed: 0.32, ribbonWidth: 0.85 }, // July     02CDC7
  { ribbonColor: "#cfe7ff", backgroundColor: "#0a5088", ribbonSpeed: 0.30, ribbonWidth: 0.90 }, // August   0C76C0
  { ribbonColor: "#f1d3ff", backgroundColor: "#7a2c85", ribbonSpeed: 0.24, ribbonWidth: 1.00 }, // September B444C0
  { ribbonColor: "#ffe6b3", backgroundColor: "#9a6f05", ribbonSpeed: 0.22, ribbonWidth: 1.05 }, // October  E5A708
  { ribbonColor: "#f5dcc2", backgroundColor: "#5e3f15", ribbonSpeed: 0.20, ribbonWidth: 1.10 }, // November 875B1E
  { ribbonColor: "#ffd5cf", backgroundColor: "#9a2b1c", ribbonSpeed: 0.16, ribbonWidth: 1.15 }, // December E3412A
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
}

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

export interface VolumeInfo {
  drive: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  kind: "fixed" | "removable" | "network" | "other";
  system: boolean;
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
  gameId: string;
  iconPath?: string;
  heroPath?: string;
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
  createMediaFolder(parentDir: string, name: string): Promise<string>;
  getSongInfo(filePath: string): Promise<SongInfo | null>;
  getScreenInfo(title: string, year: string, kind: "movie" | "tv" | "auto", tmdbId?: string): Promise<ScreenInfo | null>;
  copyMedia(kind: "music" | "photo" | "video", source: string, target: string): Promise<string>;
  jellyfinDownload(login: JellyfinLogin, itemId: string, name: string, kind: "music" | "video", target: string, container: string): Promise<string>;
  onTransfer(callback: (progress: TransferProgress) => void): void;
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
  onArtUpdated(callback: (update: ArtUpdate) => void): void;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    axm: AxmApi;
  }
}
