import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

/**
 * What a game actually is: who made it, who published it, when it came out.
 *
 * The Y-button Information panel already answers this for music, film and TV in
 * metadata.ts. This is the same idea for games, drawing on niemasd's GameDB for
 * the PlayStation platforms and GameTDB for the Nintendo ones.
 *
 * Neither is bundled. Both are downloaded on demand into the user's own cache
 * folder and reused from there, which keeps a GPL-3.0 dataset out of this tree
 * and means the data can be refreshed without shipping a new build. Nothing is
 * fetched until somebody opens Information on a game.
 *
 * Coverage is uneven and the panel says so rather than showing blank rows. The
 * PlayStation and PS2 sets carry publisher, developer, genre and release date
 * for most titles; the PS3 set is essentially a serial-to-title list and has
 * almost none of that. Saying "not recorded" is honest; an empty row is not.
 */

export type DbPlatform = "ps1" | "ps2" | "ps3" | "3ds" | "wii" | "wiiu" | "ds";

export interface GameInfo {
  title: string;
  serial: string;
  region: string;
  languages: string;
  genre: string;
  publisher: string;
  developer: string;
  releaseDate: string;
  year: string;
  players: string;
  synopsis: string;
  /** Which database answered, for the attribution line in the panel. */
  source: string;
  sourceUrl: string;
  /** How the row was matched, so a shaky match can be presented as such. */
  matchedBy: "serial" | "release name" | "title" | "none";
}

interface Source {
  kind: "gamedb" | "gametdb";
  /** Where the data comes from. */
  url: string;
  /** Local cache file name. */
  cache: string;
  name: string;
  home: string;
}

const SOURCES: Record<DbPlatform, Source> = {
  ps1: {
    kind: "gamedb",
    url: "https://github.com/niemasd/GameDB-PSX/releases/latest/download/PSX.data.json",
    cache: "PSX.data.json",
    name: "GameDB-PSX",
    home: "https://github.com/niemasd/GameDB-PSX",
  },
  ps2: {
    kind: "gamedb",
    url: "https://github.com/niemasd/GameDB-PS2/releases/latest/download/PS2.data.json",
    cache: "PS2.data.json",
    name: "GameDB-PS2",
    home: "https://github.com/niemasd/GameDB-PS2",
  },
  ps3: {
    kind: "gamedb",
    url: "https://github.com/niemasd/GameDB-PS3/releases/latest/download/PS3.data.json",
    cache: "PS3.data.json",
    name: "GameDB-PS3",
    home: "https://github.com/niemasd/GameDB-PS3",
  },
  "3ds": { kind: "gametdb", url: "https://www.gametdb.com/3dstdb.zip?LANG=EN", cache: "3dstdb.xml", name: "GameTDB (3DS)", home: "https://www.gametdb.com/3DS" },
  wii: { kind: "gametdb", url: "https://www.gametdb.com/wiitdb.zip?LANG=EN", cache: "wiitdb.xml", name: "GameTDB (Wii)", home: "https://www.gametdb.com/Wii" },
  wiiu: { kind: "gametdb", url: "https://www.gametdb.com/wiiutdb.zip?LANG=EN", cache: "wiiutdb.xml", name: "GameTDB (Wii U)", home: "https://www.gametdb.com/WiiU" },
  ds: { kind: "gametdb", url: "https://www.gametdb.com/dstdb.zip?LANG=EN", cache: "dstdb.xml", name: "GameTDB (DS)", home: "https://www.gametdb.com/DS" },
};

function cacheDir(): string {
  const dir = path.join(app.getPath("userData"), "gamedb");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ----------------------------------------------------------------- download --

/**
 * Fetches a URL, following redirects, and returns the body.
 *
 * GitHub's "latest release" links redirect twice before reaching the file, and
 * GameTDB refuses requests without a plausible User-Agent.
 */
async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "A-X-M/0.6 (+https://github.com/nahalewski)", Accept: "*/*" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Pulls the single XML file out of a GameTDB zip.
 *
 * The archives hold exactly one deflated member, so the central directory is
 * walked rather than pulling in a zip library for one file. The local header's
 * name and extra-field lengths give the offset of the compressed data.
 */
function unzipSingle(buf: Buffer): Buffer {
  // End-of-central-directory, searched from the back since a comment may follow.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");

  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error("zip directory is damaged");

  const method = buf.readUInt16LE(centralOffset + 10);
  const localOffset = buf.readUInt32LE(centralOffset + 42);
  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("zip entry is damaged");

  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const compressed = buf.subarray(start, centralOffset);

  if (method === 0) return compressed;
  if (method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`unsupported zip compression (${method})`);
}

/** Downloads a platform's database into the cache, replacing what is there. */
export async function updateDatabase(platform: DbPlatform): Promise<{ ok: boolean; message: string }> {
  const source = SOURCES[platform];
  try {
    const raw = await download(source.url);
    const body = source.kind === "gametdb" ? unzipSingle(raw) : raw;

    // Temp then rename, so a half-written file never replaces a good one.
    const target = path.join(cacheDir(), source.cache);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, body);
    fs.renameSync(temp, target);
    indexes.delete(platform);
    return { ok: true, message: `${source.name} updated (${(body.length / 1048576).toFixed(1)} MB)` };
  } catch (err) {
    return { ok: false, message: `Could not update ${source.name}: ${(err as Error).message}` };
  }
}

export interface DbStatus {
  platform: DbPlatform;
  name: string;
  home: string;
  cached: boolean;
  updated: string | null;
  entries: number;
  sizeBytes: number;
}

export function databaseStatus(): DbStatus[] {
  return (Object.keys(SOURCES) as DbPlatform[]).map((platform) => {
    const source = SOURCES[platform];
    const file = path.join(cacheDir(), source.cache);
    let cached = false;
    let updated: string | null = null;
    let sizeBytes = 0;
    try {
      const stat = fs.statSync(file);
      cached = true;
      updated = stat.mtime.toISOString();
      sizeBytes = stat.size;
    } catch {
      // Not downloaded yet.
    }
    return { platform, name: source.name, home: source.home, cached, updated, entries: indexes.get(platform)?.size ?? 0, sizeBytes };
  });
}

export function clearCache(): { ok: boolean; message: string } {
  try {
    const dir = cacheDir();
    let removed = 0;
    for (const file of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, file), { force: true });
      removed++;
    }
    indexes.clear();
    return { ok: true, message: removed ? `Cleared ${removed} cached database file(s)` : "Nothing was cached" };
  } catch (err) {
    return { ok: false, message: `Could not clear the cache: ${(err as Error).message}` };
  }
}

export function cacheLocation(): string {
  return cacheDir();
}

// -------------------------------------------------------------------- index --

interface Row {
  title: string;
  serial: string;
  region: string;
  languages: string;
  genre: string;
  publisher: string;
  developer: string;
  releaseDate: string;
  players: string;
  synopsis: string;
  releaseName: string;
}

/**
 * Loaded databases, keyed by platform.
 *
 * Each key holds every entry that matches it, not just the first. Most games
 * were released several times - a USA disc, a PAL disc, a Japanese one, demos
 * and kiosk builds - and they all reduce to the same title. Keeping them all
 * lets the lookup choose the one the caller actually meant instead of whichever
 * happened to be read first.
 */
const indexes = new Map<DbPlatform, Map<string, Row[]>>();

/** Region tags as dumps write them, mapped to the regions the databases use. */
const REGION_TAGS: [RegExp, string][] = [
  [/\b(usa|us|ntsc-u|america|canada)\b/i, "NTSC-U"],
  [/\b(japan|jp|jpn|ntsc-j|asia|korea|china|taiwan)\b/i, "NTSC-J"],
  [/\b(europe|eur|pal|uk|england|france|germany|spain|italy|netherlands|sweden|australia|scandinavia)\b/i, "PAL"],
];

/** The region a dump's name is claiming, from its bracketed tags. */
function regionHint(name: string): string {
  const tags = name.match(/[([{][^)\]}]*[)\]}]/g)?.join(" ") ?? "";
  for (const [pattern, region] of REGION_TAGS) if (pattern.test(tags)) return region;
  return "";
}

/** Builds that are not the retail release, and should lose to one that is. */
const NOT_RETAIL = /\b(demo|beta|proto|prototype|sample|kiosk|trial|preview|promo|review code|not for resale)\b/i;

/**
 * Reduces a name to something two spellings of the same game agree on.
 *
 * Dumps are named all sorts of ways - "Resident Evil (USA)", "Resident Evil
 * [SLUS-00170]", "resident_evil" - so region tags, disc markers, bracketed notes
 * and punctuation all come off, leaving the letters and digits.
 */
function normalise(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Serials are written with and without the dash; compare without it. */
function normaliseSerial(serial: string): string {
  return serial.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function str(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function addKey(map: Map<string, Row[]>, key: string, row: Row): void {
  if (!key || key.endsWith(":")) return;
  const bucket = map.get(key);
  if (bucket) bucket.push(row);
  else map.set(key, [row]);
}

/**
 * Scores how well an entry answers the query, highest wins.
 *
 * Region is the big one. Dumps are named "Resident Evil (USA)" and the databases
 * hold a dozen Resident Evils across three regions, so ignoring the tag means
 * answering a USA disc with a German demo - which is what this did before the
 * tag was taken into account. A retail release beats a demo, and where nothing
 * else separates two entries the more complete one wins, since a row with a
 * publisher and a date is more use than a bare title.
 */
function score(row: Row, wantRegion: string, queryIsRetail: boolean): number {
  let points = 0;

  if (wantRegion && row.region) {
    if (row.region === wantRegion) points += 40;
    // NTSC-U and NTSC-J are both "NTSC" in some sets; a mismatch is still wrong.
    else points -= 25;
  }

  const rowIsRetail = !NOT_RETAIL.test(row.releaseName) && !NOT_RETAIL.test(row.title);
  if (queryIsRetail && !rowIsRetail) points -= 30;
  if (!queryIsRetail && rowIsRetail) points -= 10;

  // Completeness, as a tie-breaker only.
  if (row.publisher) points += 3;
  if (row.releaseDate) points += 3;
  if (row.developer) points += 2;
  if (row.genre) points += 1;

  return points;
}

/** The best entry in a bucket for this query, or null if the bucket is empty. */
function best(rows: Row[] | undefined, wantRegion: string, queryIsRetail: boolean): Row | null {
  if (!rows || rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  let winner = rows[0];
  let winningScore = score(winner, wantRegion, queryIsRetail);
  for (const row of rows.slice(1)) {
    const points = score(row, wantRegion, queryIsRetail);
    if (points > winningScore) {
      winner = row;
      winningScore = points;
    }
  }
  return winner;
}

/** Reads GameDB's JSON, which is an object of entries keyed by serial or release name. */
function indexGameDb(file: string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, Record<string, unknown>>;

  for (const [key, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object") continue;
    const row: Row = {
      title: str(entry.title),
      serial: str(entry.serial),
      region: str(entry.region),
      languages: str(entry.language),
      genre: str(entry.genre),
      publisher: str(entry.publisher),
      developer: str(entry.developer),
      releaseDate: str(entry.release_date),
      players: "",
      synopsis: "",
      releaseName: str(entry.release_name) || key,
    };
    addKey(map, `serial:${normaliseSerial(row.serial)}`, row);
    addKey(map, `name:${normalise(row.releaseName)}`, row);
    addKey(map, `title:${normalise(row.title)}`, row);
  }
  return map;
}

/**
 * Reads GameTDB's XML.
 *
 * A real parser is overkill here: the schema is flat, one <game> per record, and
 * the fields wanted are single elements or attributes. Entities are unescaped on
 * the way out so titles read properly.
 */
function indexGameTdb(file: string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  const xml = fs.readFileSync(file, "utf-8");

  const unescape = (s: string): string =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&amp;/g, "&");

  const one = (block: string, tag: string): string => {
    const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return m ? unescape(m[1]).trim() : "";
  };

  for (const m of xml.matchAll(/<game\b[^>]*>([\s\S]*?)<\/game>/g)) {
    const block = m[1];

    // The English locale title, falling back to whichever comes first.
    const en = block.match(/<locale lang="EN">\s*<title>([^<]*)<\/title>/);
    const any = block.match(/<title>([^<]*)<\/title>/);
    const title = unescape((en?.[1] ?? any?.[1] ?? "").trim());
    if (!title) continue;

    const date = block.match(/<date year="(\d*)"\s*month="(\d*)"\s*day="(\d*)"/);
    const year = date?.[1] ?? "";
    const month = date?.[2] ?? "";
    const day = date?.[3] ?? "";
    const releaseDate = year ? [year, month.padStart(2, "0"), day.padStart(2, "0")].filter((p) => p && p !== "00").join("-") : "";

    const players = block.match(/<input players="(\d+)"/)?.[1] ?? "";
    const synopsisEn = block.match(/<locale lang="EN">[\s\S]*?<synopsis>([\s\S]*?)<\/synopsis>/);

    const row: Row = {
      title,
      serial: one(block, "id"),
      region: one(block, "region"),
      languages: one(block, "languages"),
      genre: one(block, "genre"),
      publisher: one(block, "publisher"),
      developer: one(block, "developer"),
      releaseDate,
      players: players && players !== "0" ? players : "",
      synopsis: unescape((synopsisEn?.[1] ?? "").trim()).slice(0, 600),
      releaseName: title,
    };
    addKey(map, `serial:${normaliseSerial(row.serial)}`, row);
    addKey(map, `title:${normalise(row.title)}`, row);
  }
  return map;
}

/** Loads a platform's index, building it from the cache file on first use. */
function loadIndex(platform: DbPlatform): Map<string, Row[]> | null {
  const cached = indexes.get(platform);
  if (cached) return cached;

  const source = SOURCES[platform];
  const file = path.join(cacheDir(), source.cache);
  if (!fs.existsSync(file)) return null;

  try {
    const map = source.kind === "gametdb" ? indexGameTdb(file) : indexGameDb(file);
    indexes.set(platform, map);
    return map;
  } catch {
    // A damaged cache file should not be fatal; the next update replaces it.
    return null;
  }
}

// ------------------------------------------------------------------- lookup --

/** Pulls a serial out of a file or folder name, where a dump has one in it. */
function serialIn(name: string): string {
  const m = name.match(/\b([A-Z]{4})[ _-]?(\d{5})\b/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : "";
}

function blank(): GameInfo {
  return {
    title: "",
    serial: "",
    region: "",
    languages: "",
    genre: "",
    publisher: "",
    developer: "",
    releaseDate: "",
    year: "",
    players: "",
    synopsis: "",
    source: "",
    sourceUrl: "",
    matchedBy: "none",
  };
}

/**
 * Looks a game up, downloading that platform's database the first time.
 *
 * Three ways in, tried strongest first: the serial if the name carries one, then
 * the release name as the dump groups spell it, then the plain title. Which one
 * hit is reported, so a title-only match can be shown as the weaker evidence it
 * is rather than stated as fact.
 */
export async function getGameInfo(platform: DbPlatform, name: string, filePath?: string): Promise<GameInfo | null> {
  if (!SOURCES[platform]) return null;

  let index = loadIndex(platform);
  if (!index) {
    const updated = await updateDatabase(platform);
    if (!updated.ok) return null;
    index = loadIndex(platform);
    if (!index) return null;
  }

  const source = SOURCES[platform];
  const base = path.basename(filePath ?? name);
  const serial = serialIn(base) || serialIn(name);

  // What the dump's own name says it is, used to pick between releases.
  const wantRegion = regionHint(base) || regionHint(name);
  const queryIsRetail = !NOT_RETAIL.test(base) && !NOT_RETAIL.test(name);

  const tries: [string, GameInfo["matchedBy"]][] = [];
  if (serial) tries.push([`serial:${normaliseSerial(serial)}`, "serial"]);
  tries.push([`name:${normalise(base)}`, "release name"]);
  tries.push([`name:${normalise(name)}`, "release name"]);
  tries.push([`title:${normalise(base)}`, "title"]);
  tries.push([`title:${normalise(name)}`, "title"]);

  for (const [key, matchedBy] of tries) {
    const row = best(index.get(key), wantRegion, queryIsRetail);
    if (!row) continue;
    return {
      title: row.title,
      serial: row.serial,
      region: row.region,
      languages: row.languages,
      genre: row.genre,
      publisher: row.publisher,
      developer: row.developer,
      releaseDate: row.releaseDate,
      year: (row.releaseDate.match(/\d{4}/) ?? [""])[0],
      players: row.players,
      synopsis: row.synopsis,
      source: source.name,
      sourceUrl: source.home,
      matchedBy,
    };
  }

  return { ...blank(), source: source.name, sourceUrl: source.home };
}

/** The platforms the Information panel can answer for. */
export function supportedPlatforms(): DbPlatform[] {
  return Object.keys(SOURCES) as DbPlatform[];
}
