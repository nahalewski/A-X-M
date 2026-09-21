import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { loadSettings } from "./settingsStore";
import { apiKey } from "./apiKeys";

/**
 * Artwork lookup via SteamGridDB, for the launchers that don't hand us any of their
 * own (Epic, loose exes, Xbox titles whose package logo didn't resolve). Two kinds
 * are fetched: `grid` box art for the tiles, and `hero` banners used as the menu
 * background behind the selected game, the way a PS3 theme swaps the wave out.
 *
 * Results - including misses - are cached on disk so a given name is only ever
 * looked up once, and the images themselves are stored locally so the menu still
 * renders with no network and without re-fetching on every launch.
 */

const API_BASE = "https://www.steamgriddb.com/api/v2";

export type ArtKind = "grid" | "hero";

interface CacheIndex {
  /** `${kind}:${normalizedName}` -> cached file name, or null for a known miss.
   *  `id:${normalizedName}`      -> SteamGridDB game id as a string, or null. */
  [key: string]: string | null;
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
  // apis/apis.json wins, then the environment, then whatever was typed in Settings.
  return apiKey("steamGridDb", process.env.AXM_STEAMGRIDDB_KEY || loadSettings().gameArtApiKey || "");
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

/**
 * Resolves a name to a SteamGridDB game id. Cached separately from the images so
 * looking up a game's grid and its hero only costs one search.
 */
/**
 * The names to try for a file called "Legend of Dragoon, The (USA, Canada) (Disc 1)":
 * as given, with the article put back in front, without disc / region tags, and
 * without a subtitle after " - ". SteamGridDB's autocomplete is literal, so the
 * library-catalogue form finds nothing where "The Legend of Dragoon" does.
 */
function searchNames(name: string): string[] {
  const out: string[] = [];
  const push = (s: string) => { const t = s.replace(/\s+/g, " ").trim(); if (t && !out.includes(t)) out.push(t); };
  push(name);
  const untagged = name.replace(/\s*[[(][^\])]*[\])]/g, "").replace(/\s*-?\s*(disc|disk|cd)\s*\d+\b/i, "").trim();
  push(untagged);
  const article = untagged.match(/^(.*?),\s*(the|a|an)$/i) ?? untagged.match(/^(.*?),\s*(the|a|an)\s*[-:]\s*(.*)$/i);
  if (article) push(article[3] ? `${article[2]} ${article[1]}: ${article[3]}` : `${article[2]} ${article[1]}`);
  const dash = untagged.split(/\s+-\s+/);
  if (dash.length > 1) push(dash[0]);
  if (article && dash.length > 1) push(`${article[2]} ${dash[0].replace(/,\s*(the|a|an)$/i, "")}`);
  return out;
}


/**
 * A miss is remembered for a week, not forever: SteamGridDB grows, names get
 * fixed, and a bad night on the network shouldn't leave a game without art.
 */
const MISS_TTL_MS = 7 * 86400_000;
const miss = (): string => `miss:${Date.now()}`;
/** True when the cached value is a miss that still stands; expired misses read as "not cached". */
function stillMissing(index: Record<string, string | null>, key: string): boolean | undefined {
  const v = index[key];
  if (v === undefined) return undefined;
  if (v === null) return true;
  if (v.startsWith("miss:")) {
    if (Date.now() - Number(v.slice(5)) < MISS_TTL_MS) return true;
    delete index[key];
    return undefined;
  }
  return false;
}

async function findGameId(name: string): Promise<number | null> {
  const index = loadIndex();
  const cacheKey = `id:${normalize(name)}`;
  const known = stillMissing(index, cacheKey);
  if (known === true) return null;
  if (known === false) return Number(index[cacheKey]);

  let gameId: number | null = null;
  let answered = false;
  for (const candidate of searchNames(name)) {
    const search = (await apiGet(`/search/autocomplete/${encodeURIComponent(candidate)}`)) as
      | { data?: { id: number }[] }
      | null;
    if (!search) continue; // a blip: try the next form, and don't cache the miss
    answered = true;
    gameId = search.data?.[0]?.id ?? null;
    if (gameId !== null) break;
  }

  // Only cache a definite answer - a network blip shouldn't poison the name forever.
  if (answered) {
    index[cacheKey] = gameId === null ? miss() : String(gameId);
    saveIndex();
  }
  return gameId;
}

/** Endpoint + preferred dimensions per art kind, tried in order. */
const QUERIES: Record<ArtKind, { endpoint: string; queries: string[] }> = {
  grid: {
    endpoint: "grids",
    // Portrait box art first (matches the tile shape), then anything else that fits.
    queries: ["?dimensions=600x900&types=static&limit=1", "?types=static&limit=1"],
  },
  hero: {
    endpoint: "heroes",
    // 1920x620 is the size the menu actually renders at; wider ones are fine too.
    queries: ["?dimensions=1920x620&types=static&limit=1", "?types=static&limit=1"],
  },
};

async function findArtUrl(gameId: number, kind: ArtKind): Promise<string | null> {
  const { endpoint, queries } = QUERIES[kind];
  for (const query of queries) {
    const res = (await apiGet(`/${endpoint}/game/${gameId}${query}`)) as
      | { data?: { url?: string; thumb?: string }[] }
      | null;
    const hit = res?.data?.[0];
    if (!hit) continue;
    // Tiles are small, so the thumb is plenty; a full-screen background is not.
    const preferred = kind === "grid" ? hit.thumb ?? hit.url : hit.url ?? hit.thumb;
    if (preferred) return preferred;
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

/**
 * Returns a file:// URL to cached artwork for `name`, or null if there isn't any.
 * `kind` picks box art for the tile or a wide hero banner for the background.
 */
export async function resolveArt(name: string, kind: ArtKind = "grid"): Promise<string | null> {
  if (!isGameArtConfigured()) return null;

  const index = loadIndex();
  const key = normalize(name);
  const cacheKey = `${kind}:${key}`;
  const known = stillMissing(index, cacheKey);
  if (known === true) return null;
  if (known === false) {
    const full = path.join(artDir(), index[cacheKey]!);
    if (fs.existsSync(full)) return pathToFileURL(full).href;
  }

  const gameId = await findGameId(name);
  const url = gameId === null ? null : await findArtUrl(gameId, kind);
  if (!url) {
    index[cacheKey] = miss();
    saveIndex();
    return null;
  }

  const ext = path.extname(new URL(url).pathname) || ".jpg";
  const fileName = createHash("sha1").update(cacheKey).digest("hex") + ext;
  const destination = path.join(artDir(), fileName);

  if (!(await download(url, destination))) {
    // A failed download is a blip, not a verdict: nothing is cached, so it's tried again.
    return null;
  }

  index[cacheKey] = fileName;
  saveIndex();
  return pathToFileURL(destination).href;
}

/** One choice in an artwork picker: the full image and a small preview of it. */
export interface ArtChoice {
  id: number;
  url: string;
  thumb: string;
}

/**
 * Every static grid SteamGridDB has for `name`, for the "change artwork" picker.
 * Portrait first, since that's the tile shape, but the rest are offered too.
 */
export async function listGridChoices(name: string, limit = 45): Promise<ArtChoice[]> {
  if (!isGameArtConfigured()) return [];
  const gameId = await findGameId(name);
  if (!gameId) return [];
  const seen = new Set<number>();
  const out: ArtChoice[] = [];
  for (const query of [`?dimensions=600x900&types=static&limit=${limit}`, `?types=static&limit=${limit}`]) {
    const res = (await apiGet(`/grids/game/${gameId}${query}`)) as
      | { data?: { id: number; url: string; thumb: string }[] }
      | null;
    for (const g of res?.data ?? []) {
      if (seen.has(g.id) || !g.url) continue;
      seen.add(g.id);
      out.push({ id: g.id, url: g.url, thumb: g.thumb ?? g.url });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** The first square icon SteamGridDB has for `name`, cached like the other art. */
export async function resolveIcon(name: string): Promise<string | null> {
  if (!isGameArtConfigured()) return null;
  const index = loadIndex();
  const key = `icon:${normalize(name)}`;
  const known = stillMissing(index, key);
  if (known === true) return null;
  if (known === false) {
    const full = path.join(artDir(), index[key]!);
    if (fs.existsSync(full)) return pathToFileURL(full).href;
  }
  const gameId = await findGameId(name);
  if (!gameId) return null;
  const res = (await apiGet(`/icons/game/${gameId}?types=static&limit=1`)) as
    | { data?: { url?: string; thumb?: string }[] }
    | null;
  const url = res?.data?.[0]?.thumb ?? res?.data?.[0]?.url ?? null;
  if (!url) {
    if (res) {
      index[key] = miss();
      saveIndex();
    }
    return null;
  }
  const fileName = createHash("sha1").update(key).digest("hex") + (path.extname(new URL(url).pathname) || ".png");
  const destination = path.join(artDir(), fileName);
  if (!(await download(url, destination))) return null;
  index[key] = fileName;
  saveIndex();
  return pathToFileURL(destination).href;
}

/**
 * Stores an arbitrary image URL in the art cache and returns its file:// URL, so a
 * user's chosen artwork keeps working offline and doesn't re-download on launch.
 */
export async function cacheImage(url: string, cacheKey: string): Promise<string | null> {
  const index = loadIndex();
  const key = `pick:${cacheKey}`;
  const ext = path.extname(new URL(url).pathname) || ".png";
  const fileName = createHash("sha1").update(url).digest("hex") + ext;
  const destination = path.join(artDir(), fileName);
  if (!fs.existsSync(destination) && !(await download(url, destination))) return null;
  index[key] = fileName;
  saveIndex();
  return pathToFileURL(destination).href;
}
