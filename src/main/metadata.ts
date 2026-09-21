import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { app } from "electron";
import { pathToFileURL } from "node:url";
import * as mm from "music-metadata";
import { loadSettings } from "./settingsStore";
import { apiKey } from "./apiKeys";

/**
 * "Information" for the Y-button pop-ups: what a song, film or show actually is.
 *
 * Music: the file's own tags first (title, artist, album, year, embedded cover),
 * then MusicBrainz for the artist (where they're from, when they were active, what
 * people tag them as) and the Cover Art Archive for a front cover when the file has
 * none. Both are free and keyless; MusicBrainz asks for one request a second and a
 * real User-Agent, which is honoured here.
 *
 * Film and TV: TMDB, with the user's own API key from settings. Local files are
 * matched on the cleaned-up filename; Jellyfin items come with a title and a year.
 *
 * Everything is cached in userData/info-cache so a row is looked up once.
 */

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

const USER_AGENT = "A-X-M/0.3.0-beta.1 (https://github.com/nahalewski/A-X-M)";
const CACHE_DIR = path.join(app.getPath("userData"), "info-cache");
const TMDB = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";

function cachePath(key: string): string {
  return path.join(CACHE_DIR, crypto.createHash("sha1").update(key).digest("hex") + ".json");
}

function readCache<T>(key: string): T | null {
  try {
    const raw = fs.readFileSync(cachePath(key), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(key), JSON.stringify(value));
  } catch {
    // a cache miss next time is the only consequence
  }
}

// MusicBrainz: one request a second, queued so bursts from a fast scroll don't get
// the client banned.
let mbLast = 0;
let mbQueue: Promise<unknown> = Promise.resolve();
function musicBrainz<T>(endpoint: string): Promise<T | null> {
  const task = async (): Promise<T | null> => {
    const wait = Math.max(0, mbLast + 1100 - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    mbLast = Date.now();
    try {
      const res = await fetch(`https://musicbrainz.org/ws/2/${endpoint}${endpoint.includes("?") ? "&" : "?"}fmt=json`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };
  const next = mbQueue.then(task, task);
  mbQueue = next.catch(() => undefined);
  return next;
}

async function coverArtExists(releaseId: string): Promise<string | null> {
  try {
    const url = `https://coverartarchive.org/release/${releaseId}/front-500`;
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

/** Artist and title guessed from "Artist - Title" filenames and the folder tree. */
function guessFromPath(filePath: string): { artist: string; title: string; album: string } {
  const base = path.basename(filePath, path.extname(filePath)).replace(/^\d+\s*[-.]\s*/, "");
  const parts = base.split(/\s+-\s+/);
  const parent = path.basename(path.dirname(filePath));
  const grand = path.basename(path.dirname(path.dirname(filePath)));
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim(), album: parent };
  return { artist: grand, title: base.trim(), album: parent };
}

export async function getSongInfo(filePath: string): Promise<SongInfo | null> {
  const cached = readCache<SongInfo>("song:" + filePath.toLowerCase());
  if (cached) return cached;

  const guess = guessFromPath(filePath);
  let info: SongInfo = {
    title: guess.title,
    artist: guess.artist,
    album: guess.album,
    year: "",
    genre: "",
    durationSec: 0,
    bitrateKbps: 0,
    coverUrl: null,
    artistInfo: null,
    source: "filename",
  };

  try {
    const meta = await mm.parseFile(filePath, { duration: true });
    const c = meta.common;
    info = {
      ...info,
      title: c.title || info.title,
      artist: c.artist || c.albumartist || info.artist,
      album: c.album || info.album,
      year: c.year ? String(c.year) : "",
      genre: (c.genre ?? []).join(", "),
      durationSec: Math.round(meta.format.duration ?? 0),
      bitrateKbps: Math.round((meta.format.bitrate ?? 0) / 1000),
      source: "tags",
    };
    const pic = c.picture?.[0];
    if (pic) {
      // Embedded art goes to the cache folder so the renderer can load it as a file.
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const ext = pic.format.includes("png") ? ".png" : ".jpg";
      const file = path.join(CACHE_DIR, crypto.createHash("sha1").update(filePath.toLowerCase()).digest("hex") + ext);
      fs.writeFileSync(file, pic.data);
      info.coverUrl = pathToFileURL(file).href;
    }
  } catch {
    // untagged or unreadable: the filename guess stands
  }

  // MusicBrainz: the artist, and a cover if the file had none.
  const q = `recording:"${info.title.replace(/"/g, "")}" AND artist:"${info.artist.replace(/"/g, "")}"`;
  const rec = await musicBrainz<{ recordings?: { "artist-credit"?: { artist: { id: string; name: string } }[]; releases?: { id: string; title: string; date?: string }[] }[] }>(
    `recording?query=${encodeURIComponent(q)}&limit=3`
  );
  const hit = rec?.recordings?.[0];
  const artistId = hit?.["artist-credit"]?.[0]?.artist.id;
  if (hit && !info.year) info.year = (hit.releases?.find((r) => r.date)?.date ?? "").slice(0, 4);
  if (artistId) {
    const artist = await musicBrainz<{ type?: string; area?: { name: string }; "life-span"?: { begin?: string; end?: string }; tags?: { name: string; count: number }[]; disambiguation?: string }>(
      `artist/${artistId}?inc=tags`
    );
    if (artist) {
      info.artistInfo = {
        type: artist.type,
        area: artist.area?.name,
        began: artist["life-span"]?.begin,
        ended: artist["life-span"]?.end,
        tags: (artist.tags ?? []).sort((a, b) => b.count - a.count).slice(0, 6).map((t) => t.name),
        disambiguation: artist.disambiguation,
      };
      info.source = info.source === "tags" ? "tags + MusicBrainz" : "MusicBrainz";
    }
  }
  if (!info.coverUrl && hit?.releases?.length) {
    for (const release of hit.releases.slice(0, 3)) {
      const url = await coverArtExists(release.id);
      if (url) {
        info.coverUrl = url;
        break;
      }
    }
  }

  writeCache("song:" + filePath.toLowerCase(), info);
  return info;
}

/** "Some.Movie.2019.1080p.BluRay.x264-GROUP" -> { title: "Some Movie", year: "2019" } */
export function cleanVideoName(name: string): { title: string; year: string } {
  let s = path.basename(name, path.extname(name)).replace(/[._]/g, " ");
  const year = (s.match(/\b(19|20)\d{2}\b/) ?? [""])[0];
  if (year) s = s.slice(0, s.indexOf(year));
  s = s.replace(/\b(1080p|720p|2160p|4k|bluray|brrip|webrip|web-dl|hdrip|x264|x265|hevc|h264|aac|dts|remux|proper|repack|extended|unrated|multi|dual)\b.*$/i, "");
  s = s.replace(/[\[\(].*?[\]\)]/g, "").replace(/\s+-\s*$/, "").replace(/\s{2,}/g, " ").trim();
  return { title: s || name, year };
}

interface TmdbSearchHit {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
}

async function tmdb<T>(endpoint: string, params: Record<string, string> = {}): Promise<T | null> {
  const key = apiKey("tmdb", loadSettings().tmdbApiKey);
  if (!key) return null;
  const q = new URLSearchParams({ api_key: key, ...params });
  try {
    const res = await fetch(`${TMDB}${endpoint}?${q.toString()}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Film or series details. `kind` is a hint (Jellyfin knows; a local file doesn't);
 * with "auto" the movie search is tried first, then TV.
 */
export async function getScreenInfo(title: string, year: string, kind: "movie" | "tv" | "auto", tmdbId?: string): Promise<ScreenInfo | null> {
  const cacheKey = `screen:${kind}:${tmdbId ?? ""}:${title.toLowerCase()}:${year}`;
  const cached = readCache<ScreenInfo>(cacheKey);
  if (cached) return cached;
  if (!apiKey("tmdb", loadSettings().tmdbApiKey)) return null;

  const tryKind = async (k: "movie" | "tv"): Promise<ScreenInfo | null> => {
    let id = tmdbId ? Number(tmdbId) : 0;
    if (!id) {
      const params: Record<string, string> = { query: title };
      if (year) params[k === "movie" ? "year" : "first_air_date_year"] = year;
      const search = await tmdb<{ results: TmdbSearchHit[] }>(`/search/${k}`, params);
      id = search?.results?.[0]?.id ?? 0;
      if (!id && year) {
        const loose = await tmdb<{ results: TmdbSearchHit[] }>(`/search/${k}`, { query: title });
        id = loose?.results?.[0]?.id ?? 0;
      }
    }
    if (!id) return null;
    const d = await tmdb<Record<string, unknown>>(`/${k}/${id}`);
    if (!d) return null;
    const genres = ((d.genres as { name: string }[]) ?? []).map((g) => g.name);
    return {
      title: (d.title as string) ?? (d.name as string) ?? title,
      year: String((d.release_date as string) ?? (d.first_air_date as string) ?? year).slice(0, 4),
      kind: k,
      overview: (d.overview as string) ?? "",
      rating: typeof d.vote_average === "number" ? Math.round((d.vote_average as number) * 10) / 10 : null,
      votes: (d.vote_count as number) ?? 0,
      genres,
      runtimeMin: (d.runtime as number) ?? ((d.episode_run_time as number[]) ?? [])[0] ?? null,
      posterUrl: d.poster_path ? `${TMDB_IMG}/w342${d.poster_path as string}` : null,
      backdropUrl: d.backdrop_path ? `${TMDB_IMG}/w1280${d.backdrop_path as string}` : null,
      tagline: (d.tagline as string) ?? "",
      seasons: d.number_of_seasons as number | undefined,
      episodes: d.number_of_episodes as number | undefined,
      status: d.status as string | undefined,
      source: "TMDB",
    };
  };

  let info: ScreenInfo | null = null;
  if (kind === "auto") info = (await tryKind("movie")) ?? (await tryKind("tv"));
  else info = await tryKind(kind);
  if (info) writeCache(cacheKey, info);
  return info;
}
