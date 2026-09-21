import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import { listZip } from "./zip";
import { rootFolder } from "./rootDrive";
import { locate, DUCKSTATION, PCSX2, EmulatorSpec } from "./emulatorLocate";

/**
 * HD texture packs for PS1 (DuckStation) and PS2 (PCSX2) games.
 *
 * There is no one database of these the way there is for cheats; packs live in
 * their authors' own GitHub repositories. So A-X-M ships a curated list
 * (assets/textures-db/index.json): which game, which serials, where the pack is
 * and how big. A pack is downloaded into ROOT\TEXTURES\<platform>\<SERIAL>\, its
 * replacement folder found inside whatever layout the author chose, and linked
 * (a junction, no copy) into the emulator's own textures folder - the place both
 * emulators read: <data>\textures\<SERIAL>\replacements. Enable and disable are
 * that link coming and going; the emulator's texture-replacement switch is turned
 * on in its ini when a pack is enabled.
 */

const execFileP = promisify(execFile);

export interface TexturePack {
  name: string;
  author: string;
  source: "github";
  repo: string;
  /** Branch for a source-archive download (no `asset`). */
  branch?: string;
  /** Regex on release asset names; every match is downloaded (multi-part packs). */
  asset?: string;
  /** Folder inside the archive that is the replacements root, when the layout says so. */
  path?: string;
  sizeMb: number;
  license?: string;
  notes?: string;
}

export interface TextureGame {
  platform: "ps1" | "ps2";
  title: string;
  serials: string[];
  packs: TexturePack[];
}

export interface TextureDb {
  note: string;
  moreSources: { name: string; url: string }[];
  games: TextureGame[];
}

export interface InstalledPack {
  platform: "ps1" | "ps2";
  serial: string;
  slug: string;
  name: string;
  repo: string;
  /** The folder with the textures, inside ROOT\TEXTURES. */
  folder: string;
  installedAt: string;
  enabled: boolean;
  /** Where it is linked when enabled. */
  linkedAt: string | null;
}

export interface PackStatus {
  game: TextureGame;
  serial: string;
  packs: { pack: TexturePack; slug: string; installed: InstalledPack | null }[];
  emulator: { found: boolean; dataPath: string | null; texturesDir: string | null };
}

// --------------------------------------------------------------- places ----

function dbFile(): string {
  return path.join(__dirname, "..", "renderer", "assets", "textures-db", "index.json");
}

let dbCache: TextureDb | null = null;
export function textureDb(): TextureDb {
  if (!dbCache) {
    try {
      dbCache = JSON.parse(fs.readFileSync(dbFile(), "utf-8")) as TextureDb;
    } catch {
      dbCache = { note: "", moreSources: [], games: [] };
    }
  }
  return dbCache;
}

function texturesRoot(): string {
  return rootFolder("TEXTURES") ?? path.join(app.getPath("userData"), "textures");
}

function stateFile(): string {
  return path.join(texturesRoot(), "packs.json");
}

function loadState(): InstalledPack[] {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf-8")) as InstalledPack[];
  } catch {
    return [];
  }
}

function saveState(list: InstalledPack[]): void {
  fs.mkdirSync(texturesRoot(), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(list, null, 2), "utf-8");
}

const slugOf = (pack: TexturePack) => pack.repo.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
const normSerial = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// -------------------------------------------------------------- serials ----

/**
 * The serial a game runs under: from the file name (SLUS-20909 in it), else from
 * SYSTEM.CNF inside a disc image (BOOT2 = cdrom0:\SLUS_209.09;1) read with 7-Zip.
 */
export async function serialOf(romPath: string): Promise<string | null> {
  const fromName = path.basename(romPath).match(/\b(S[CL][EUPKA][SMDT])[-_ ]?(\d{3})\.?(\d{2})\b/i);
  if (fromName) return `${fromName[1].toUpperCase()}-${fromName[2]}${fromName[3]}`;
  const zip = sevenZip();
  if (!zip || !/\.(iso|bin|img|mdf)$/i.test(romPath)) return null;
  try {
    const { stdout } = await execFileP(zip, ["e", "-so", "-tiso", romPath, "SYSTEM.CNF"], { windowsHide: true, timeout: 30_000, maxBuffer: 1 << 20 });
    const m = String(stdout).match(/(S[CL][EUPKA][SMDT])[_-]?(\d{3})\.?(\d{2})/i);
    return m ? `${m[1].toUpperCase()}-${m[2]}${m[3]}` : null;
  } catch {
    return null;
  }
}

function sevenZip(): string | null {
  const cands = [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "7-Zip", "7z.exe"), path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "7-Zip", "7z.exe"), "/usr/bin/7z", "/usr/bin/7zz"];
  return cands.find((c) => fs.existsSync(c)) ?? null;
}

/** The database entry for a game, by serial (any region listed) or, failing that, by title. */
export function findGame(platform: "ps1" | "ps2", serial: string | null, title: string): TextureGame | null {
  const db = textureDb();
  if (serial) {
    const n = normSerial(serial);
    const bySerial = db.games.find((g) => g.platform === platform && g.serials.some((s) => normSerial(s) === n));
    if (bySerial) return bySerial;
  }
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const t = clean(title);
  return db.games.find((g) => g.platform === platform && (clean(g.title) === t || t.includes(clean(g.title)) || clean(g.title).includes(t))) ?? null;
}

// ----------------------------------------------------------- emulators ----

async function emulatorTextures(platform: "ps1" | "ps2"): Promise<{ found: boolean; dataPath: string | null; texturesDir: string | null; spec: EmulatorSpec }> {
  const spec = platform === "ps1" ? DUCKSTATION : PCSX2;
  const l = await locate(spec);
  const data = l.dataPath;
  return { found: !!l.installPath, dataPath: data, texturesDir: data ? path.join(data, "textures") : null, spec };
}

/** Turns the emulator's texture replacement on in its ini (both keep it off by default). */
function enableInIni(platform: "ps1" | "ps2", dataPath: string): void {
  const file = path.join(dataPath, platform === "ps1" ? "settings.ini" : "PCSX2.ini");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    // Not run yet: a minimal ini with just the switch; the emulator fills in the rest and keeps it.
    text = "";
  }
  const section = platform === "ps1" ? "TextureReplacements" : "EmuCore/GS";
  const keys = platform === "ps1" ? { EnableTextureReplacements: "true" } : { LoadTextureReplacements: "true", PrecacheTextureReplacements: "true" };
  const lines = text.split(/\r?\n/);
  let start = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (start < 0) {
    lines.push(`[${section}]`);
    start = lines.length - 1;
  }
  let end = lines.findIndex((l, i) => i > start && /^\[.*\]$/.test(l.trim()));
  if (end < 0) end = lines.length;
  for (const [k, v] of Object.entries(keys)) {
    const i = lines.findIndex((l, idx) => idx > start && idx < end && l.trim().toLowerCase().startsWith(`${k.toLowerCase()} =`));
    if (i >= 0) lines[i] = `${k} = ${v}`;
    else {
      lines.splice(end, 0, `${k} = ${v}`);
      end++;
    }
  }
  fs.writeFileSync(file, lines.join("\n"), "utf-8");
}

// -------------------------------------------------------------- status ----

export async function packStatus(platform: "ps1" | "ps2", serial: string | null, title: string): Promise<PackStatus | null> {
  const game = findGame(platform, serial, title);
  if (!game) return null;
  const use = serial && game.serials.some((s) => normSerial(s) === normSerial(serial)) ? serial.toUpperCase() : game.serials[0];
  const state = loadState();
  const emu = await emulatorTextures(platform);
  return {
    game,
    serial: use,
    packs: game.packs.map((pack) => ({ pack, slug: slugOf(pack), installed: state.find((i) => i.platform === platform && normSerial(i.serial) === normSerial(use) && i.slug === slugOf(pack)) ?? null })),
    emulator: { found: emu.found, dataPath: emu.dataPath, texturesDir: emu.texturesDir },
  };
}

export function installedPacks(): InstalledPack[] {
  return loadState();
}

// ------------------------------------------------------------ download ----

async function githubJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "A-X-M", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function downloadTo(url: string, file: string, onProgress?: (note: string) => void): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "A-X-M" }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = fs.createWriteStream(`${file}.part`);
  let got = 0;
  let lastNote = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
    if (Date.now() - lastNote > 1000) {
      lastNote = Date.now();
      onProgress?.(total ? `${Math.round((got / total) * 100)}% · ${(got / 1048576).toFixed(0)} of ${(total / 1048576).toFixed(0)} MB` : `${(got / 1048576).toFixed(0)} MB`);
    }
  }
  await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
  fs.renameSync(`${file}.part`, file);
}

async function extract(archive: string, into: string): Promise<void> {
  fs.mkdirSync(into, { recursive: true });
  const zip = sevenZip();
  if (zip) {
    await execFileP(zip, ["x", "-y", `-o${into}`, archive], { windowsHide: true, maxBuffer: 1 << 24, timeout: 30 * 60_000 });
    return;
  }
  if (!/\.zip$/i.test(archive)) throw new Error("7-Zip is needed to unpack this pack (Settings › System › Install Tools)");
  for (const e of listZip(fs.readFileSync(archive))) {
    const target = path.join(into, e.name);
    if (!path.resolve(target).startsWith(path.resolve(into))) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.read());
  }
}

/** The folder inside an unpacked pack that holds the replacement textures. */
function findReplacements(dir: string, serial: string, hint?: string): string {
  if (hint) {
    const h = path.join(dir, ...hint.split(/[\\/]/));
    if (fs.existsSync(h)) return h;
    // GitHub wraps a source archive in "<repo>-<branch>/".
    for (const top of fs.readdirSync(dir)) {
      const h2 = path.join(dir, top, ...hint.split(/[\\/]/));
      if (fs.existsSync(h2)) return h2;
    }
  }
  const want = normSerial(serial);
  const walk = (d: string, depth: number): string | null => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return null;
    }
    const dirs = entries.filter((e) => e.isDirectory());
    const named = dirs.find((e) => e.name.toLowerCase() === "replacements");
    if (named) return path.join(d, named.name);
    const bySerial = dirs.find((e) => normSerial(e.name) === want);
    if (bySerial) {
      const inner = path.join(d, bySerial.name, "replacements");
      return fs.existsSync(inner) ? inner : path.join(d, bySerial.name);
    }
    if (depth >= 3) return null;
    for (const e of dirs) {
      const r = walk(path.join(d, e.name), depth + 1);
      if (r) return r;
    }
    return null;
  };
  const found = walk(dir, 0);
  if (found) return found;
  // Textures straight at the root (a source archive has one wrapper folder first).
  const tops = fs.readdirSync(dir, { withFileTypes: true });
  if (tops.length === 1 && tops[0].isDirectory()) return path.join(dir, tops[0].name);
  return dir;
}

export async function installPack(platform: "ps1" | "ps2", serial: string, slug: string, onProgress?: (note: string) => void): Promise<{ ok: boolean; message: string }> {
  const game = findGame(platform, serial, "");
  const pack = game?.packs.find((p) => slugOf(p) === slug);
  if (!game || !pack) return { ok: false, message: "that pack isn't in the list" };
  const base = path.join(texturesRoot(), platform, serial.toUpperCase());
  const archives: string[] = [];
  try {
    if (pack.asset) {
      const rel = await githubJson<{ tag_name: string; assets: { name: string; browser_download_url: string; size: number }[] }>(`https://api.github.com/repos/${pack.repo}/releases/latest`);
      const re = new RegExp(pack.asset, "i");
      const assets = rel.assets.filter((a) => re.test(a.name));
      if (!assets.length) return { ok: false, message: `the latest release (${rel.tag_name}) has no pack file yet` };
      for (const a of assets) {
        const file = path.join(base, `${slug}-${a.name}`);
        if (!fs.existsSync(file) || fs.statSync(file).size !== a.size) {
          onProgress?.(`Downloading ${a.name}…`);
          await downloadTo(a.browser_download_url, file, onProgress);
        }
        archives.push(file);
      }
    } else {
      const branch = pack.branch ?? "main";
      const file = path.join(base, `${slug}-${branch}.zip`);
      onProgress?.(`Downloading ${pack.repo}…`);
      await downloadTo(`https://github.com/${pack.repo}/archive/refs/heads/${branch}.zip`, file, onProgress);
      archives.push(file);
    }
    const dir = path.join(base, slug);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const a of archives) {
      onProgress?.(`Unpacking ${path.basename(a)}…`);
      await extract(a, dir);
    }
    const folder = findReplacements(dir, serial, pack.path);
    const state = loadState().filter((i) => !(i.platform === platform && normSerial(i.serial) === normSerial(serial) && i.slug === slug));
    state.push({ platform, serial: serial.toUpperCase(), slug, name: pack.name, repo: pack.repo, folder, installedAt: new Date().toISOString(), enabled: false, linkedAt: null });
    saveState(state);
    for (const a of archives) fs.rmSync(a, { force: true });
    return { ok: true, message: `${pack.name} downloaded` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Links the pack into the emulator's textures folder and turns replacement on. */
export async function enablePack(platform: "ps1" | "ps2", serial: string, slug: string): Promise<{ ok: boolean; message: string }> {
  const state = loadState();
  const inst = state.find((i) => i.platform === platform && normSerial(i.serial) === normSerial(serial) && i.slug === slug);
  if (!inst) return { ok: false, message: "download the pack first" };
  const emu = await emulatorTextures(platform);
  if (!emu.dataPath || !emu.texturesDir) return { ok: false, message: `${platform === "ps1" ? "DuckStation" : "PCSX2"} hasn't been run yet, so it has no textures folder` };
  const link = path.join(emu.texturesDir, serial.toUpperCase(), "replacements");
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    if (fs.existsSync(link)) {
      const st = fs.lstatSync(link);
      if (st.isSymbolicLink()) fs.unlinkSync(link);
      else fs.renameSync(link, `${link}.before-${Date.now()}`);
    }
    fs.symlinkSync(inst.folder, link, "junction");
    enableInIni(platform, emu.dataPath);
    for (const other of state) if (other.platform === platform && normSerial(other.serial) === normSerial(serial) && other.slug !== slug) { other.enabled = false; other.linkedAt = null; }
    inst.enabled = true;
    inst.linkedAt = link;
    saveState(state);
    return { ok: true, message: `${inst.name} is on for ${serial.toUpperCase()}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function disablePack(platform: "ps1" | "ps2", serial: string, slug: string): Promise<{ ok: boolean; message: string }> {
  const state = loadState();
  const inst = state.find((i) => i.platform === platform && normSerial(i.serial) === normSerial(serial) && i.slug === slug);
  if (!inst) return { ok: false, message: "that pack isn't installed" };
  try {
    if (inst.linkedAt && fs.existsSync(inst.linkedAt) && fs.lstatSync(inst.linkedAt).isSymbolicLink()) fs.unlinkSync(inst.linkedAt);
    inst.enabled = false;
    inst.linkedAt = null;
    saveState(state);
    return { ok: true, message: `${inst.name} is off` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function deletePack(platform: "ps1" | "ps2", serial: string, slug: string): Promise<{ ok: boolean; message: string }> {
  await disablePack(platform, serial, slug);
  const state = loadState();
  const inst = state.find((i) => i.platform === platform && normSerial(i.serial) === normSerial(serial) && i.slug === slug);
  if (!inst) return { ok: false, message: "that pack isn't installed" };
  try {
    fs.rmSync(path.join(texturesRoot(), platform, serial.toUpperCase(), slug), { recursive: true, force: true });
    saveState(state.filter((i) => i !== inst));
    return { ok: true, message: `${inst.name} deleted` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
