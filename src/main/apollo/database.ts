import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import { listZip } from "../zip";
import { loadSettings, saveSettings } from "../settingsStore";
import { parseSavepatch, ApolloPatch } from "./savepatch";

/**
 * The local copy of Apollo's two databases:
 *
 *   apollo-patches  - the save-edit / cheat definitions (.savepatch), by platform
 *                     and title id. Fetched whole as GitHub's source zip, unpacked
 *                     into <db>/patches/<PLATFORM>/, then indexed.
 *   apollo-saves    - community save files. Too big to mirror (every save carries
 *                     its icons), so the repository tree is fetched and kept as
 *                     the index; a title's list and its zips come down when asked.
 *
 * <db>/custom/<PLATFORM>/*.savepatch is the user's own folder, indexed alongside,
 * for consoles the upstream database doesn't cover yet (PS1) or edits of their own.
 *
 * Both databases are Damian "bucanero" Parrino's work, GPL-3.0 - credited in the
 * Memory Card Utility's About row and in assets/THIRD_PARTY_LICENSES.md.
 */

export type ApolloPlatform = "PS1" | "PS2" | "PS3" | "PS4" | "PSP" | "PSV";
export const APOLLO_PLATFORMS: ApolloPlatform[] = ["PS1", "PS2", "PS3", "PS4", "PSP", "PSV"];

const PATCHES_ZIP = "https://github.com/bucanero/apollo-patches/archive/refs/heads/main.zip";
const SAVES_TREE = "https://api.github.com/repos/bucanero/apollo-saves/git/trees/master?recursive=1";
const SAVES_RAW = "https://raw.githubusercontent.com/bucanero/apollo-saves/master/";
const AUTO_UPDATE_DAYS = 7;

export interface PatchIndexEntry {
  platform: ApolloPlatform;
  /** Normalised: letters and digits only, upper-case ("SLUS20216"). */
  titleId: string;
  file: string;
  title: string | null;
  author: string | null;
  /** Save-folder patterns the file names (":BASLUS-20216\..."), for the region check. */
  folders: string[];
  /** File patterns the codes target. */
  files: string[];
  codes: number;
  source: "apollo" | "custom";
}

export interface SavesIndexEntry {
  platform: ApolloPlatform;
  titleId: string;
  /** Files under the title folder in the repository (zips, saves.txt, icon0.png). */
  files: string[];
}

interface DbState {
  patchesUpdatedAt: string | null;
  savesUpdatedAt: string | null;
  patchesEtag?: string;
}

export interface ApolloStatus {
  location: string;
  patchesUpdatedAt: string | null;
  savesUpdatedAt: string | null;
  patchCounts: Record<string, number>;
  saveTitleCounts: Record<string, number>;
  customCount: number;
  autoUpdate: boolean;
  offline: boolean;
  cacheBytes: number;
}

// -------------------------------------------------------------- places ----

export function apolloDir(): string {
  const s = loadSettings();
  const custom = s.apollo?.location?.trim();
  return custom || path.join(app.getPath("userData"), "apollo");
}

const patchesDir = () => path.join(apolloDir(), "patches");
const customDir = () => path.join(apolloDir(), "custom");
const savesDir = () => path.join(apolloDir(), "saves");
const statePath = () => path.join(apolloDir(), "state.json");
const patchIndexPath = () => path.join(apolloDir(), "patch-index.json");
const savesIndexPath = () => path.join(apolloDir(), "saves-index.json");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function loadState(): DbState {
  return readJson<DbState>(statePath(), { patchesUpdatedAt: null, savesUpdatedAt: null });
}

/** "SLUS-20216", "slus_20216.savepatch" → "SLUS20216". */
export function normaliseTitleId(s: string): string {
  return s.replace(/\.savepatch$/i, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
  } catch {
    /* gone */
  }
  return total;
}

// ------------------------------------------------------------- patches ----

let patchIndexCache: PatchIndexEntry[] | null = null;

function indexFolder(root: string, source: "apollo" | "custom"): PatchIndexEntry[] {
  const out: PatchIndexEntry[] = [];
  for (const platform of APOLLO_PLATFORMS) {
    const dir = path.join(root, platform);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".savepatch"));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      let patch: ApolloPatch;
      try {
        patch = parseSavepatch(fs.readFileSync(file, "latin1"));
      } catch {
        continue;
      }
      out.push({
        platform,
        titleId: normaliseTitleId(name),
        file,
        title: patch.title,
        author: patch.author,
        folders: patch.targets.map((t) => t.folder).filter((f): f is string => !!f),
        files: patch.targets.map((t) => t.file),
        codes: patch.codes.filter((c) => !c.isInfo).length,
        source,
      });
    }
  }
  return out;
}

export function rebuildPatchIndex(): PatchIndexEntry[] {
  const index = [...indexFolder(patchesDir(), "apollo"), ...indexFolder(customDir(), "custom")];
  writeJson(patchIndexPath(), index);
  patchIndexCache = index;
  return index;
}

export function patchIndex(): PatchIndexEntry[] {
  if (patchIndexCache) return patchIndexCache;
  patchIndexCache = readJson<PatchIndexEntry[]>(patchIndexPath(), []);
  if (!patchIndexCache.length && fs.existsSync(patchesDir())) patchIndexCache = rebuildPatchIndex();
  return patchIndexCache;
}

/** Downloads the patch database and unpacks the .savepatch files and title lists. */
export async function updatePatches(onProgress?: (note: string) => void): Promise<{ ok: boolean; message: string; count: number }> {
  if (loadSettings().apollo?.offline) return { ok: false, message: "Offline mode is on - the database isn't fetched", count: patchIndex().length };
  try {
    onProgress?.("Downloading apollo-patches…");
    const res = await fetch(PATCHES_ZIP, { headers: { "User-Agent": "A-X-M" }, signal: AbortSignal.timeout(120_000), redirect: "follow" });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const zip = Buffer.from(await res.arrayBuffer());
    onProgress?.("Unpacking…");
    const entries = listZip(zip);
    const stage = path.join(apolloDir(), "patches.new");
    fs.rmSync(stage, { recursive: true, force: true });
    let n = 0;
    for (const e of entries) {
      // apollo-patches-main/PS2/SLUS20216.savepatch, and the title lists at the root.
      const parts = e.name.split("/").slice(1);
      if (!parts.length) continue;
      const isPatch = parts.length === 2 && APOLLO_PLATFORMS.includes(parts[0] as ApolloPlatform) && parts[1].toLowerCase().endsWith(".savepatch");
      const isList = parts.length === 1 && /titleid\.txt$/i.test(parts[0]);
      const isLicense = parts.length === 1 && /^(LICENSE|README\.md)$/i.test(parts[0]);
      if (!isPatch && !isList && !isLicense) continue;
      const target = path.join(stage, ...parts);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, e.read());
      if (isPatch) n++;
    }
    if (n === 0) throw new Error("the archive held no .savepatch files");
    const live = patchesDir();
    fs.rmSync(live, { recursive: true, force: true });
    fs.renameSync(stage, live);
    const state = loadState();
    state.patchesUpdatedAt = new Date().toISOString();
    writeJson(statePath(), state);
    titleNames = null;
    const index = rebuildPatchIndex();
    return { ok: true, message: `${n} patch files for ${new Set(index.map((i) => i.platform)).size} platforms`, count: index.length };
  } catch (err) {
    return { ok: false, message: (err as Error).message, count: patchIndex().length };
  }
}

/** Reads a patch file from the index, parsed. */
export function loadPatch(entry: PatchIndexEntry): ApolloPatch | null {
  try {
    return parseSavepatch(fs.readFileSync(entry.file, "latin1"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------- title names ----

let titleNames: Map<string, string> | null = null;

/** Game names from Apollo's ps1titleid.txt / ps2titleid.txt ("SLUS21258 .hack//G.U. Vol.1"). */
export function titleName(platform: ApolloPlatform, titleId: string): string | null {
  if (!titleNames) {
    titleNames = new Map();
    for (const list of ["ps1titleid.txt", "ps2titleid.txt", "psptitleid.txt", "psvtitleid.txt"]) {
      try {
        for (const line of fs.readFileSync(path.join(patchesDir(), list), "latin1").split(/\r?\n/)) {
          // "SLUS21258 .hack//G.U." in the PS2 list, "SLUS01411;Yu-Gi-Oh!" in the PS1 one.
          const m = line.match(/^([A-Za-z0-9-]+)[;\t ]+(.+)$/);
          if (m) titleNames.set(normaliseTitleId(m[1]), m[2].trim());
        }
      } catch {
        /* list not downloaded yet */
      }
    }
  }
  void platform;
  return titleNames.get(normaliseTitleId(titleId)) ?? null;
}

// --------------------------------------------------------------- saves ----

let savesIndexCache: SavesIndexEntry[] | null = null;

export function savesIndex(): SavesIndexEntry[] {
  if (!savesIndexCache) savesIndexCache = readJson<SavesIndexEntry[]>(savesIndexPath(), []);
  return savesIndexCache;
}

/** Fetches the repository tree once; that is the whole index of what's available. */
export async function updateSaves(onProgress?: (note: string) => void): Promise<{ ok: boolean; message: string; count: number }> {
  if (loadSettings().apollo?.offline) return { ok: false, message: "Offline mode is on - the database isn't fetched", count: savesIndex().length };
  try {
    onProgress?.("Reading the apollo-saves listing…");
    const res = await fetch(SAVES_TREE, { headers: { "User-Agent": "A-X-M", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const tree = (await res.json()) as { tree?: { path: string; type: string }[]; truncated?: boolean };
    const byTitle = new Map<string, SavesIndexEntry>();
    for (const t of tree.tree ?? []) {
      if (t.type !== "blob") continue;
      const parts = t.path.split("/");
      if (parts.length !== 3 || !APOLLO_PLATFORMS.includes(parts[0] as ApolloPlatform)) continue;
      const key = `${parts[0]}/${parts[1]}`;
      let e = byTitle.get(key);
      if (!e) {
        e = { platform: parts[0] as ApolloPlatform, titleId: normaliseTitleId(parts[1]), files: [] };
        byTitle.set(key, e);
      }
      e.files.push(parts[2]);
    }
    const index = [...byTitle.values()].filter((e) => e.files.some((f) => f.toLowerCase().endsWith(".zip")));
    writeJson(savesIndexPath(), index);
    savesIndexCache = index;
    const state = loadState();
    state.savesUpdatedAt = new Date().toISOString();
    writeJson(statePath(), state);
    return { ok: true, message: `${index.length} titles with saves${tree.truncated ? " (listing truncated by GitHub)" : ""}`, count: index.length };
  } catch (err) {
    return { ok: false, message: (err as Error).message, count: savesIndex().length };
  }
}

export interface CommunitySave {
  platform: ApolloPlatform;
  titleId: string;
  zip: string;
  description: string;
  /** Local path once downloaded. */
  local: string | null;
  iconUrl: string | null;
}

/** The saves listed for a title: saves.txt from the repository (cached), with what's already downloaded. */
export async function listCommunitySaves(platform: ApolloPlatform, titleId: string): Promise<CommunitySave[]> {
  const id = normaliseTitleId(titleId);
  const entry = savesIndex().find((e) => e.platform === platform && e.titleId === id);
  if (!entry) return [];
  const dir = path.join(savesDir(), platform, id);
  fs.mkdirSync(dir, { recursive: true });
  const listFile = path.join(dir, "saves.txt");
  let text = "";
  try {
    text = fs.readFileSync(listFile, "latin1");
  } catch {
    if (loadSettings().apollo?.offline) return [];
    try {
      const res = await fetch(`${SAVES_RAW}${platform}/${entry.titleId}/saves.txt`, { headers: { "User-Agent": "A-X-M" }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) {
        text = await res.text();
        fs.writeFileSync(listFile, text, "latin1");
      }
    } catch {
      /* offline or gone */
    }
  }
  const iconFile = path.join(dir, "icon0.png");
  if (!fs.existsSync(iconFile) && entry.files.includes("icon0.png") && !loadSettings().apollo?.offline) {
    try {
      const res = await fetch(`${SAVES_RAW}${platform}/${entry.titleId}/icon0.png`, { headers: { "User-Agent": "A-X-M" }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) fs.writeFileSync(iconFile, Buffer.from(await res.arrayBuffer()));
    } catch {
      /* no icon */
    }
  }
  const out: CommunitySave[] = [];
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const zip = line.slice(0, eq).trim();
    if (!entry.files.includes(zip)) continue;
    const local = path.join(dir, zip);
    out.push({ platform, titleId: id, zip, description: line.slice(eq + 1).trim(), local: fs.existsSync(local) ? local : null, iconUrl: fs.existsSync(iconFile) ? iconFile : null });
  }
  // Zips the listing doesn't describe still count.
  for (const f of entry.files) {
    if (f.toLowerCase().endsWith(".zip") && !out.some((o) => o.zip === f)) {
      const local = path.join(dir, f);
      out.push({ platform, titleId: id, zip: f, description: f, local: fs.existsSync(local) ? local : null, iconUrl: fs.existsSync(iconFile) ? iconFile : null });
    }
  }
  return out;
}

/** Downloads one community save zip and returns the files inside it. */
export async function fetchCommunitySave(platform: ApolloPlatform, titleId: string, zip: string): Promise<{ name: string; data: Buffer }[]> {
  const id = normaliseTitleId(titleId);
  const entry = savesIndex().find((e) => e.platform === platform && e.titleId === id);
  if (!entry || !entry.files.includes(zip)) throw new Error("that save isn't in the database listing");
  const local = path.join(savesDir(), platform, id, zip);
  if (!fs.existsSync(local)) {
    if (loadSettings().apollo?.offline) throw new Error("Offline mode is on and this save isn't downloaded");
    const res = await fetch(`${SAVES_RAW}${platform}/${entry.titleId}/${zip}`, { headers: { "User-Agent": "A-X-M" }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, Buffer.from(await res.arrayBuffer()));
  }
  return listZip(fs.readFileSync(local)).map((e) => ({ name: path.basename(e.name), data: e.read() }));
}

// -------------------------------------------------------------- status ----

export function apolloStatus(): ApolloStatus {
  const s = loadSettings();
  const state = loadState();
  const counts: Record<string, number> = {};
  let custom = 0;
  for (const e of patchIndex()) {
    counts[e.platform] = (counts[e.platform] ?? 0) + 1;
    if (e.source === "custom") custom++;
  }
  const saveCounts: Record<string, number> = {};
  for (const e of savesIndex()) saveCounts[e.platform] = (saveCounts[e.platform] ?? 0) + 1;
  return {
    location: apolloDir(),
    patchesUpdatedAt: state.patchesUpdatedAt,
    savesUpdatedAt: state.savesUpdatedAt,
    patchCounts: counts,
    saveTitleCounts: saveCounts,
    customCount: custom,
    autoUpdate: s.apollo?.autoUpdate ?? true,
    offline: s.apollo?.offline ?? false,
    cacheBytes: dirSize(apolloDir()),
  };
}

/** Drops the downloaded databases and community saves; the custom folder and backups stay. */
export function clearCache(): void {
  for (const d of [patchesDir(), savesDir()]) fs.rmSync(d, { recursive: true, force: true });
  for (const f of [patchIndexPath(), savesIndexPath()]) fs.rmSync(f, { force: true });
  writeJson(statePath(), { patchesUpdatedAt: null, savesUpdatedAt: null });
  patchIndexCache = null;
  savesIndexCache = null;
  titleNames = null;
}

/** Moves the database to a new folder (the setting) and re-reads it there. */
export function setLocation(location: string): void {
  const from = apolloDir();
  const s = loadSettings();
  saveSettings({ apollo: { ...s.apollo, location } });
  const to = apolloDir();
  if (from.toLowerCase() === to.toLowerCase()) return;
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
  } catch (err) {
    console.warn("[apollo] could not copy the database:", (err as Error).message);
  }
  patchIndexCache = null;
  savesIndexCache = null;
  titleNames = null;
}

/** On start-up: fetch the databases if never fetched, or refresh weekly when auto-update is on. */
export async function autoUpdate(): Promise<void> {
  const s = loadSettings();
  if (s.apollo?.offline) return;
  const state = loadState();
  const stale = (at: string | null) => !at || Date.now() - Date.parse(at) > AUTO_UPDATE_DAYS * 86400_000;
  if (!state.patchesUpdatedAt || (s.apollo?.autoUpdate !== false && stale(state.patchesUpdatedAt))) await updatePatches();
  if (!state.savesUpdatedAt || (s.apollo?.autoUpdate !== false && stale(state.savesUpdatedAt))) await updateSaves();
}
