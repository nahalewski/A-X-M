import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Every API key and service login in one file, so there is one place to look and
 * one file to move between machines.
 *
 * The file is `apis/apis.json` next to the app. It is gitignored, and only
 * `apis/apis.example.json` is committed - this project's git remote is public, and
 * a key pasted into a tracked file is a key published. The loader never writes the
 * real file; it is edited by hand.
 *
 * Settings remain the fallback for every value. Anyone who already typed a key into
 * the menu keeps working without touching a file, and the file simply wins when it
 * has something to say. That ordering is what makes this safe to drop in.
 */

export interface ApiConfig {
  /** SteamGridDB, for box art and hero banners. */
  steamGridDb?: string;
  /** TMDB, for film and TV metadata. Named for what it is, not for IMDb. */
  tmdb?: string;
  /** Steam Web API, for the library and achievements. */
  steamWeb?: string;
  /** RetroAchievements. */
  retroAchievements?: string;
  /** RetroAchievements username, which its API needs alongside the key. */
  retroAchievementsUser?: string;
  /** The Xtream/EPG provider used by TV Streaming. */
  epg?: {
    url?: string;
    username?: string;
    password?: string;
    /** Optional XMLTV guide URL, when the provider publishes one separately. */
    xmltvUrl?: string;
  };
}

let cache: ApiConfig | null = null;
let cachedFrom: string | null = null;

/**
 * Where to look, in order. Development runs from the project root; a packaged
 * build sits next to its executable, and its resources folder is the fallback so
 * an installed copy can ship a default without it being inside the asar.
 */
export function apiSearchPaths(): string[] {
  const paths = [path.join(process.cwd(), "apis")];
  try {
    paths.push(path.join(path.dirname(app.getPath("exe")), "apis"));
    paths.push(path.join(process.resourcesPath ?? "", "apis"));
    paths.push(path.join(app.getPath("userData"), "apis"));
  } catch {
    // Called before the app is ready; the working directory alone will do.
  }
  return paths.filter(Boolean);
}

/** The folder actually in use, or the first candidate when none exists yet. */
export function apiFolder(): string {
  for (const dir of apiSearchPaths()) {
    if (fs.existsSync(path.join(dir, "apis.json"))) return dir;
  }
  return apiSearchPaths()[0];
}

export function loadApiConfig(force = false): ApiConfig {
  if (cache && !force) return cache;

  for (const dir of apiSearchPaths()) {
    const file = path.join(dir, "apis.json");
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as ApiConfig;
      cache = parsed && typeof parsed === "object" ? parsed : {};
      cachedFrom = file;
      return cache;
    } catch (err) {
      // A malformed file should not take the menu down, but it must be visible -
      // silently falling back to settings would look like the file was ignored.
      console.error(`[A-X-M] could not read ${file}:`, err);
    }
  }

  cache = {};
  cachedFrom = null;
  return cache;
}

/** Which file the values came from, for the Settings screen to show. */
export function apiConfigSource(): string | null {
  loadApiConfig();
  return cachedFrom;
}

/** Picks the file's value when it has one, else whatever is in settings. */
export function apiKey(name: keyof ApiConfig, fallback: string): string {
  const value = loadApiConfig()[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

export function epgConfig(): NonNullable<ApiConfig["epg"]> {
  return loadApiConfig().epg ?? {};
}

/** Writes the example file if the folder has neither it nor a real config. */
export function ensureApiExample(): void {
  const dir = apiSearchPaths()[0];
  const example = path.join(dir, "apis.example.json");
  try {
    if (fs.existsSync(example) || fs.existsSync(path.join(dir, "apis.json"))) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      example,
      JSON.stringify(
        {
          steamGridDb: "",
          tmdb: "",
          steamWeb: "",
          retroAchievements: "",
          retroAchievementsUser: "",
          epg: { url: "", username: "", password: "", xmltvUrl: "" },
        },
        null,
        2
      ),
      "utf-8"
    );
  } catch {
    // A read-only install directory is fine; settings still work.
  }
}
