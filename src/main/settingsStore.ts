import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export interface GameOverride {
  hidden?: boolean;
  losslessProfile?: 1 | 2 | 3 | null;
}

export interface Settings {
  windowed: boolean;
  targetHz: number;
  waveColorCycleSeconds: number;
  musicVolume: number;
  sfxVolume: number;
  extraGameFolders: string[];
  gameOverrides: Record<string, GameOverride>;
}

const DEFAULTS: Settings = {
  windowed: false,
  targetHz: 120,
  waveColorCycleSeconds: 18,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  extraGameFolders: [],
  gameOverrides: {},
};

let cache: Settings | null = null;

function filePath(): string {
  return path.join(app.getPath("userData"), "axm-settings.json");
}

export function loadSettings(): Settings {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(filePath(), "utf-8");
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache ?? { ...DEFAULTS };
}

export function saveSettings(partial: Partial<Settings>): Settings {
  const current = loadSettings();
  cache = { ...current, ...partial };
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(cache, null, 2), "utf-8");
  return cache;
}

export function setGameOverride(gameId: string, override: Partial<GameOverride>): Settings {
  const current = loadSettings();
  const existing = current.gameOverrides[gameId] ?? {};
  const gameOverrides = { ...current.gameOverrides, [gameId]: { ...existing, ...override } };
  return saveSettings({ gameOverrides });
}
