import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";
import { app } from "electron";
import { loadSettings } from "./settingsStore";

/**
 * Words on the screen, from two free services:
 *
 *   - Subtitles from SubDL (api.subdl.com, with the user's own key) for a film or
 *     an episode playing from Jellyfin or TV Streaming: searched by title, year,
 *     season and episode, the zip fetched, the .srt inside turned into WebVTT and
 *     cached, and handed to the video element as a text track.
 *   - Lyrics from LRCLIB (lrclib.net, no key) for the track playing: the synced
 *     LRC when there is one, plain lines otherwise, for the Karaoke visualizer.
 *
 * Both are looked up once per title and kept in userData; nothing is written to
 * the media files.
 */

function cacheDir(): string {
  return path.join(app.getPath("userData"), "subs-cache");
}

function keyFor(...parts: (string | number | undefined)[]): string {
  return crypto.createHash("sha1").update(parts.map((p) => String(p ?? "")).join("|").toLowerCase()).digest("hex");
}

// ------------------------------------------------------------ subtitles ----

export interface SubtitleQuery {
  title: string;
  year?: string;
  kind: "movie" | "tv";
  season?: number;
  episode?: number;
}

/**
 * A minimal zip reader: the .srt / .vtt files inside, inflated. Enough for SubDL's
 * packs. With `prefer` (an episode pattern) that entry is chosen over the first.
 */
function subtitleInZip(buf: Buffer, prefer?: RegExp): { name: string; text: string } | null {
  const entries: { name: string; data: Buffer; method: number }[] = [];
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.toString("utf8", off + 30, off + 30 + nameLen);
    const dataStart = off + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (/\.(srt|vtt)$/i.test(name) && compSize > 0) entries.push({ name, data, method });
    off = dataStart + compSize;
  }
  const ordered = prefer ? [...entries.filter((e) => prefer.test(e.name)), ...entries.filter((e) => !prefer.test(e.name))] : entries;
  for (const e of ordered) {
    try {
      const raw = e.method === 8 ? zlib.inflateRawSync(e.data) : e.data;
      return { name: e.name, text: raw.toString("utf8") };
    } catch {
      /* try the next entry */
    }
  }
  return null;
}

function srtToVtt(text: string): string {
  const body = text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return body.startsWith("WEBVTT") ? body : `WEBVTT\n\n${body}`;
}

/** The subtitles for a title as WebVTT text, or null when there are none (or no key). */
export async function findSubtitles(q: SubtitleQuery): Promise<string | null> {
  const settings = loadSettings();
  const apiKey = settings.subdlApiKey?.trim();
  if (!apiKey) return null;
  const lang = (settings.subtitles?.language || "EN").toUpperCase();
  fs.mkdirSync(cacheDir(), { recursive: true });
  const out = path.join(cacheDir(), `${keyFor(q.title, q.year, q.kind, q.season, q.episode, lang)}.vtt`);
  if (fs.existsSync(out)) return fs.readFileSync(out, "utf-8");
  const miss = out + ".none";
  if (fs.existsSync(miss) && Date.now() - fs.statSync(miss).mtimeMs < 7 * 86400_000) return null;

  const params = new URLSearchParams({ api_key: apiKey, film_name: q.title, languages: lang, type: q.kind, subs_per_page: "10" });
  if (q.year) params.set("year", q.year);
  if (q.kind === "tv" && q.season) params.set("season_number", String(q.season));
  if (q.kind === "tv" && q.episode) params.set("episode_number", String(q.episode));
  try {
    const res = await fetch(`https://api.subdl.com/api/v1/subtitles?${params.toString()}`, { headers: { "User-Agent": "A-X-M" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`SubDL ${res.status}`);
    const data = (await res.json()) as { status?: boolean; subtitles?: { url?: string; name?: string; lang?: string; episode_from?: number; episode_end?: number; season?: number }[] };
    const list = (data.subtitles ?? []).filter((s) => s.url);
    // For an episode: a file for just that episode first, then a season pack that
    // covers it (the right file is picked out of the zip), then whatever came first.
    const ep = q.kind === "tv" && q.episode ? q.episode : 0;
    const pick =
      (ep ? list.find((s) => s.episode_from === ep && (s.episode_end ?? ep) === ep) ?? list.find((s) => (s.episode_from ?? 0) <= ep && (s.episode_end ?? 0) >= ep) : undefined) ?? list[0];
    const epPattern = ep && q.season ? new RegExp(`s0*${q.season}e0*${ep}(?!\\d)|(^|\\D)0*${q.season}x0*${ep}(?!\\d)`, "i") : undefined;
    if (!pick?.url) {
      fs.writeFileSync(miss, "");
      return null;
    }
    const zipRes = await fetch(`https://dl.subdl.com${pick.url}`, { headers: { "User-Agent": "A-X-M" }, signal: AbortSignal.timeout(30_000) });
    if (!zipRes.ok) throw new Error(`SubDL download ${zipRes.status}`);
    const sub = subtitleInZip(Buffer.from(await zipRes.arrayBuffer()), epPattern);
    if (!sub) {
      fs.writeFileSync(miss, "");
      return null;
    }
    const vtt = srtToVtt(sub.text);
    fs.writeFileSync(out, vtt, "utf-8");
    return vtt;
  } catch (err) {
    console.warn("[subtitles]", (err as Error).message);
    return null;
  }
}

// --------------------------------------------------------------- lyrics ----

export interface LyricLine {
  /** Seconds; -1 when the lyrics aren't timed. */
  t: number;
  text: string;
}

export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
  source: string;
}

function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const times = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!times.length) continue;
    for (const m of times) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Lyrics for a track from LRCLIB: exact match on artist / title (/ duration), else its search. */
export async function findLyrics(artist: string, title: string, album: string, durationSec: number): Promise<Lyrics | null> {
  fs.mkdirSync(cacheDir(), { recursive: true });
  const file = path.join(cacheDir(), `${keyFor("lyrics", artist, title, Math.round(durationSec))}.json`);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as Lyrics | null;
    } catch {
      /* refetch */
    }
  }
  const headers = { "User-Agent": "A-X-M (https://github.com/nahalewski/A-X-M)" };
  const clean = (s: string) => s.replace(/\(.*?\)|\[.*?\]/g, "").replace(/\s+feat\..*$/i, "").replace(/^\d+\s*[-.]\s*/, "").trim();
  const tryGet = async (url: string) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return (await res.json()) as { syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean } | { syncedLyrics?: string | null; plainLyrics?: string | null }[] | null;
  };
  try {
    let hit: { syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean } | null = null;
    const p = new URLSearchParams({ artist_name: clean(artist), track_name: clean(title) });
    if (album) p.set("album_name", clean(album));
    if (durationSec > 0) p.set("duration", String(Math.round(durationSec)));
    const exact = await tryGet(`https://lrclib.net/api/get?${p.toString()}`);
    if (exact && !Array.isArray(exact)) hit = exact;
    // No exact record: search by artist + title, then by the two as free text. The
    // artist stays in the query - a cover or a remix mustn't get the original's words.
    type Hit = { syncedLyrics?: string | null; plainLyrics?: string | null; duration?: number };
    const pick = (s: Hit[]): Hit | undefined => {
      const near = durationSec > 0 ? s.filter((x) => Math.abs((x.duration ?? 0) - durationSec) <= 6) : [];
      return near.find((x) => x.syncedLyrics) ?? s.find((x) => x.syncedLyrics) ?? near[0] ?? s[0];
    };
    for (const q of [{ track_name: clean(title), artist_name: clean(artist) }, { q: `${clean(artist)} ${clean(title)}` }] as Record<string, string>[]) {
      if (hit) break;
      const s = await tryGet(`https://lrclib.net/api/search?${new URLSearchParams(q).toString()}`);
      if (Array.isArray(s) && s.length) hit = pick(s as Hit[]) ?? null;
    }
    let result: Lyrics | null = null;
    if (hit?.syncedLyrics) result = { synced: true, lines: parseLrc(hit.syncedLyrics), source: "LRCLIB" };
    else if (hit?.plainLyrics) result = { synced: false, lines: hit.plainLyrics.split(/\r?\n/).map((text) => ({ t: -1, text })), source: "LRCLIB" };
    fs.writeFileSync(file, JSON.stringify(result));
    return result;
  } catch (err) {
    console.warn("[lyrics]", (err as Error).message);
    return null;
  }
}
