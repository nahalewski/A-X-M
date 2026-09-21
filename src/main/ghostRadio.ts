import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Ghost Radio: a station built out of the music already on this machine.
 *
 * Two jobs. It picks a set, weighting what gets played often and recently but
 * spreading across artists so a station does not become one album on repeat. And
 * it writes what Ghost says between tracks.
 *
 * One rule about the talking: Ghost only ever says things that are true of this
 * library. Play counts, when a track was last heard, how long since an artist came
 * up, what year the file is tagged with. He never invents trivia about a real
 * musician, because a DJ confidently stating something false about an artist is
 * worse than a DJ who says nothing.
 */

export interface RadioTrack {
  filePath: string;
  name: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  durationSeconds?: number;
}

export interface PlayRecord {
  /** Times this file has been played through Ghost Radio or the music column. */
  count: number;
  /** ISO timestamp of the last play. */
  last: string;
}

export interface RadioPlaylist {
  tracks: RadioTrack[];
  /** ISO timestamp the set was built. */
  builtAt: string;
}

/** How many tracks a station holds. */
const STATION_SIZE = 40;
/** No more than this many from one artist, so a station stays a station. */
const MAX_PER_ARTIST = 3;

function historyPath(): string {
  return path.join(app.getPath("userData"), "ghost-radio-history.json");
}

export function loadHistory(): Record<string, PlayRecord> {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath(), "utf-8")) as Record<string, PlayRecord>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveHistory(history: Record<string, PlayRecord>): void {
  try {
    const target = historyPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(history, null, 2), "utf-8");
    fs.renameSync(temp, target);
  } catch (err) {
    console.error("[A-X-M] could not save the Ghost Radio history:", err);
  }
}

/** Called whenever a track finishes, from anywhere in the menu. */
export function notePlayed(filePath: string): void {
  const history = loadHistory();
  const existing = history[filePath];
  history[filePath] = {
    count: (existing?.count ?? 0) + 1,
    last: new Date().toISOString(),
  };
  saveHistory(history);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How much this track wants to be picked.
 *
 * Plays raise it, but on a log curve - a track heard fifty times should beat one
 * heard twice without burying everything else. Recency raises it too, and then a
 * track heard in the last few hours is pushed down hard, because the one thing a
 * station must not do is play what just finished. Never-played tracks sit in the
 * middle rather than the bottom, so the library still gets explored.
 */
function weight(track: RadioTrack, history: Record<string, PlayRecord>): number {
  const record = history[track.filePath];
  if (!record) return 1.0;

  const plays = Math.log2(record.count + 1);
  const ageDays = (Date.now() - new Date(record.last).getTime()) / DAY_MS;

  // Heard today: almost certainly not what you want to hear again right now.
  if (ageDays < 0.25) return 0.05;

  // Familiar and not just heard is the sweet spot a station lives in.
  const freshness = Math.min(1.5, 0.5 + ageDays / 14);
  return (1 + plays) * freshness;
}

/** Weighted pick without replacement, so a set never repeats a track. */
function pick<T>(pool: { item: T; weight: number }[]): T | null {
  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const p of pool) {
    roll -= p.weight;
    if (roll <= 0) return p.item;
  }
  return pool[pool.length - 1]?.item ?? null;
}

/**
 * Builds a station. Takes whatever tracks the library found; returns up to forty,
 * capped per artist so one prolific folder cannot take the whole set.
 */
export function buildStation(library: RadioTrack[], size = STATION_SIZE): RadioPlaylist {
  const history = loadHistory();
  const remaining = library.map((item) => ({ item, weight: weight(item, history) }));
  const perArtist = new Map<string, number>();
  const chosen: RadioTrack[] = [];

  while (chosen.length < size && remaining.length > 0) {
    const track = pick(remaining);
    if (!track) break;

    const index = remaining.findIndex((r) => r.item.filePath === track.filePath);
    if (index >= 0) remaining.splice(index, 1);

    const artist = (track.artist ?? "Unknown").toLowerCase();
    const used = perArtist.get(artist) ?? 0;
    if (used >= MAX_PER_ARTIST) continue;

    perArtist.set(artist, used + 1);
    chosen.push(track);
  }

  return { tracks: chosen, builtAt: new Date().toISOString() };
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * What Ghost says before a track.
 *
 * `first` gets the full introduction; after that he mostly stays quiet, and when
 * he does speak it is something true from the library rather than invented
 * colour. Returns null when he should say nothing, which is most of the time.
 */
export function announce(track: RadioTrack, position: number, history = loadHistory()): string | null {
  const artist = track.artist?.trim() || "an artist I don't have a name for";
  const title = track.name;

  if (position === 0) {
    return `Ghost Radio. Starting with ${title}, by ${artist}.`;
  }

  // A word every few tracks. Any more and it stops being a radio station.
  if (position % 4 !== 0) return null;

  const record = history[track.filePath];
  const facts: string[] = [];

  if (record && record.count >= 5) {
    facts.push(`${title}, by ${artist}. You've played this one ${record.count} times.`);
  }
  if (record?.last) {
    facts.push(`Next up, ${title} by ${artist}. You last heard it ${ago(record.last)}.`);
  }
  if (!record) {
    facts.push(`Here's one you haven't played before. ${title}, by ${artist}.`);
  }
  if (track.year) {
    facts.push(`${title}, by ${artist}. Tagged ${track.year}.`);
  }
  if (track.album && track.album !== track.name) {
    facts.push(`From ${track.album}. This is ${title}, by ${artist}.`);
  }

  if (facts.length === 0) return `${title}, by ${artist}.`;
  return facts[Math.floor(Math.random() * facts.length)];
}
