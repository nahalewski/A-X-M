export type GameSource = "steam" | "epic" | "xbox" | "generic";

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
  losslessProfile: 1 | 2 | 3 | null;
  hidden: boolean;
}

export interface MediaEntry {
  id: string;
  name: string;
  filePath: string;
}

export interface Settings {
  windowed: boolean;
  targetHz: number;
  waveColorCycleSeconds: number;
  musicVolume: number;
  sfxVolume: number;
  extraGameFolders: string[];
  gameOverrides: Record<string, { hidden?: boolean; losslessProfile?: 1 | 2 | 3 | null }>;
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
  quit(): Promise<void>;
}

declare global {
  interface Window {
    axm: AxmApi;
  }
}
