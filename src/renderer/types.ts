export type GameSource = "steam" | "epic" | "xbox" | "generic";

/** Which loop plays behind the menu. Keys of AMBIENT_TRACKS in audio.ts. */
export type AmbientTrackId = "xmb" | "luminous";

/** Ribbon background quality. "auto" starts high and steps down if frames suffer. */
export type BackgroundQuality = "auto" | "low" | "medium" | "high";

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
  browseMusic(dirPath: string | null): Promise<MusicListing>;
  pickMusicFolder(): Promise<Settings>;
  openBrowser(url: string): Promise<void>;
  onArtUpdated(callback: (update: ArtUpdate) => void): void;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    axm: AxmApi;
  }
}
