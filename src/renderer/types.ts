export type GameSource = "steam" | "epic" | "xbox" | "generic";

/** Which loop plays behind the menu. Keys of AMBIENT_TRACKS in audio.ts. */
export type AmbientTrackId = "xmb" | "luminous";

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
  streamUrl?: string;
}

export interface ArtChoice {
  id: number;
  url: string;
  thumb: string;
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
  profile: UserProfile | null;
  jellyfinLogins: Record<string, JellyfinLogin>;
  ankerDeviceName: string;
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
