import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { loadSettings } from "./settingsStore";

/**
 * Box art lookup via SteamGridDB, for the launchers that don't hand us any art of
 * their own (Epic, loose exes, Xbox titles whose package logo didn't resolve).
 * Results - including misses - are cached on disk so a given name is only ever
 * looked up once, and the images themselves are stored locally so the grid still
 * renders with no network and without re-fetching on every launch.
 */

const API_BASE = "https://www.steamgriddb.com/api/v2";

interface CacheIndex {
  [normalizedName: string]: string | null; // cached file name, or null for a known miss
}

let cacheIndex: CacheIndex | null = null;

function artDir(): string {
  return path.join(app.getPath("userData"), "art-cache");
}

function indexPath(): string {
  return path.join(artDir(), "index.json");
}

function loadIndex(): CacheIndex {
  if (cacheIndex) return cacheIndex;
  try {
    cacheIndex = JSON.parse(fs.readFileSync(indexPath(), "utf-8"));
  } catch {
    cacheIndex = {};
  }
  return cacheIndex!;
}

function saveIndex(): void {
  try {
    fs.mkdirSync(artDir(), { recursive: true });
    fs.writeFileSync(indexPath(), JSON.stringify(loadIndex()), "utf-8");
  } catch (err) {
    console.error("[A-X-M] could not write art cache index:", err);
  }
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getApiKey(): string {
  return process.env.AXM_STEAMGRIDDB_KEY || loadSettings().gameArtApiKey || "";
}

export function isGameArtConfigured(): boolean {
  return getApiKey().length > 0;
}

async function apiGet(endpoint: string): Promise<unknown | null> {
  const key = getApiKey();
  if (!key) return null;
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function findGridUrl(name: string): Promise<string | null> {
  const search = (await apiGet(`/search/autocomplete/${encodeURIComponent(name)}`)) as
    | { data?: { id: number }[] }
    | null;
  const gameId = search?.data?.[0]?.id;
  if (!gameId) return null;

  // Portrait box art first (matches the tile shape), then anything else that fits.
  for (const query of [`?dimensions=600x900&types=static&limit=1`, `?types=static&limit=1`]) {
    const grids = (await apiGet(`/grids/game/${gameId}${query}`)) as
      | { data?: { url?: string; thumb?: string }[] }
      | null;
    const hit = grids?.data?.[0];
    if (hit?.thumb || hit?.url) return hit.thumb ?? hit.url ?? null;
  }
  return null;
}

async function download(url: string, destination: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return false;
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, buffer);
    return true;
  } catch {
    return false;
  }
}

/** Returns a file:// URL to box art for `name`, or null if there isn't any. */
export async function resolveArt(name: string): Promise<string | null> {
  if (!isGameArtConfigured()) return null;

  const index = loadIndex();
  const key = normalize(name);
  if (key in index) {
    const cached = index[key];
    if (cached === null) return null;
    const full = path.join(artDir(), cached);
    if (fs.existsSync(full)) return pathToFileURL(full).href;
  }

  const url = await findGridUrl(name);
  if (!url) {
    index[key] = null;
    saveIndex();
    return null;
  }

  const ext = path.extname(new URL(url).pathname) || ".jpg";
  const fileName = createHash("sha1").update(key).digest("hex") + ext;
  const destination = path.join(artDir(), fileName);

  if (!(await download(url, destination))) {
    index[key] = null;
    saveIndex();
    return null;
  }

  index[key] = fileName;
  saveIndex();
  return pathToFileURL(destination).href;
}
