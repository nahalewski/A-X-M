import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn } from "node:child_process";
import { app, BrowserWindow } from "electron";
import { isWindows } from "./platform";
import { GameEntry } from "./types";

/**
 * Getting a PS3 disc image into the shape RPCS3 boots:
 *
 *   1. find the disc key - a .dkey / .key beside the image, else the key
 *      collection (the app's keys/ps3 folder and %APPDATA%\A-X-M\ps3keys), each
 *      candidate checked against the disc itself (EBOOT.BIN must decrypt to "SCE")
 *   2. decrypt with assets/retro/ps3_decrypt.py in the app's Python environment
 *      (skipped when the image is already plain)
 *   3. extract with 7-Zip into <rpcs3>\games\<title>\
 *   4. optionally trim: the firmware in PS3_UPDATE, all-zero dummy / pad files,
 *      and language files for languages other than the menu's, each replaced
 *      by an empty file the way the community rippers do, with a TRIMMED.txt log
 *
 * Progress goes out on axm:transfer like a download.
 */

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

function venvPython(): string {
  const venv = path.join(app.getPath("userData"), "tts", "venv");
  return isWindows ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

function sevenZip(): string | null {
  const cands = [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "7-Zip", "7z.exe"), path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "7-Zip", "7z.exe"), "/usr/bin/7z", "/usr/bin/7zz"];
  return cands.find((c) => fs.existsSync(c)) ?? null;
}

function safe(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").trim();
}

// ------------------------------------------------------------- the image ----

const SECTOR = 2048;

interface IsoInfo {
  /** Sectors of the first encrypted region, or null when the image has none. */
  encryptedRegion: [number, number] | null;
  /** Where PS3_GAME/USRDIR/EBOOT.BIN starts, for checking a key. */
  ebootLba: number | null;
  /** True when that EBOOT already reads "SCE" without a key. */
  plain: boolean;
}

function readSectors(fd: number, lba: number, count = 1): Buffer {
  const buf = Buffer.alloc(SECTOR * count);
  fs.readSync(fd, buf, 0, buf.length, lba * SECTOR);
  return buf;
}

/** ISO9660 directory walk (little-endian fields), enough to find one file. */
function isoFind(fd: number, parts: string[]): { lba: number; size: number } | null {
  const pvd = readSectors(fd, 16);
  if (pvd.toString("latin1", 1, 6) !== "CD001") return null;
  let lba = pvd.readUInt32LE(158);
  let size = pvd.readUInt32LE(166);
  for (const part of parts) {
    const data = readSectors(fd, lba, Math.ceil(size / SECTOR));
    let i = 0;
    let found: { lba: number; size: number } | null = null;
    while (i < size) {
      const len = data[i];
      if (len === 0) {
        i = (Math.floor(i / SECTOR) + 1) * SECTOR;
        continue;
      }
      const nameLen = data[i + 32];
      const name = data.toString("latin1", i + 33, i + 33 + nameLen).split(";")[0];
      if (name.toUpperCase() === part.toUpperCase()) {
        found = { lba: data.readUInt32LE(i + 2), size: data.readUInt32LE(i + 10) };
        break;
      }
      i += len;
    }
    if (!found) return null;
    lba = found.lba;
    size = found.size;
  }
  return { lba, size };
}

export function inspectPs3Iso(iso: string): IsoInfo {
  const fd = fs.openSync(iso, "r");
  try {
    const head = readSectors(fd, 0);
    const plainRegions = head.readUInt32BE(0);
    const total = plainRegions * 2 - 1;
    let encryptedRegion: [number, number] | null = null;
    if (plainRegions >= 2 && total >= 2) {
      const start = head.readUInt32BE(8 + 4) + 1;
      const end = head.readUInt32BE(8 + 8) - 1;
      encryptedRegion = [start, end];
    }
    const eboot = isoFind(fd, ["PS3_GAME", "USRDIR", "EBOOT.BIN"]);
    const plain = !!eboot && readSectors(fd, eboot.lba).toString("latin1", 0, 3) === "SCE";
    return { encryptedRegion, ebootLba: eboot?.lba ?? null, plain };
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- keys ----

function keyDirs(): string[] {
  return [path.join(app.getPath("userData"), "ps3keys"), path.join(app.getAppPath(), "keys", "ps3"), path.join(app.getAppPath(), "keys", "ps3", "REDKEY")].filter((d) => fs.existsSync(d));
}

function readKeyFile(file: string): string | null {
  try {
    const buf = fs.readFileSync(file);
    if (/\.key$/i.test(file) && buf.length === 16) return buf.toString("hex");
    const m = buf.toString("latin1").match(/[0-9a-fA-F]{32}/);
    return m ? m[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

function decryptSector(keyHex: string, lba: number, data: Buffer): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(lba, 12);
  const d = crypto.createDecipheriv("aes-128-cbc", Buffer.from(keyHex, "hex"), iv);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(data), d.final()]);
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.(iso|dkey|key)$/i, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface KeyLookup {
  keyHex: string;
  source: string;
}

/**
 * The key for an image: beside it first, then the collection - by name, and if
 * that fails every key there is (a few thousand AES blocks, instant), each one
 * proven against the disc's own EBOOT before it is trusted.
 */
export function findPs3Key(iso: string, info: IsoInfo): KeyLookup | null {
  const base = iso.replace(/\.iso$/i, "");
  const beside = [base + ".dkey", base + ".key", iso + ".dkey"].find((c) => fs.existsSync(c));
  if (beside) {
    const k = readKeyFile(beside);
    if (k) return { keyHex: k, source: beside };
  }
  if (info.ebootLba === null) return null;
  const fd = fs.openSync(iso, "r");
  try {
    const enc = readSectors(fd, info.ebootLba);
    const works = (k: string) => decryptSector(k, info.ebootLba!, enc).toString("latin1", 0, 3) === "SCE";
    const all: { file: string; name: string }[] = [];
    for (const dir of keyDirs()) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of entries) if (/\.(dkey|key)$/i.test(f)) all.push({ file: path.join(dir, f), name: normName(f) });
    }
    const want = normName(path.basename(iso));
    const byName = all.filter((c) => c.name === want || c.name.startsWith(want) || want.startsWith(c.name));
    for (const list of [byName, all]) {
      for (const c of list) {
        const k = readKeyFile(c.file);
        if (k && works(k)) return { keyHex: k, source: c.file };
      }
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// ----------------------------------------------------------------- trim ----

export interface TrimOptions {
  update: boolean;
  dummy: boolean;
  languages: boolean;
  /** The menu's language, e.g. "en", "fr", "de"; files for the others go. */
  keepLanguage: string;
}

const LANG_TAGS: Record<string, string[]> = {
  en: ["en", "eng", "english", "en_us", "en_gb", "us", "uk", "usa"],
  fr: ["fr", "fra", "fre", "french", "fr_fr", "francais"],
  de: ["de", "deu", "ger", "german", "de_de", "deutsch"],
  es: ["es", "esp", "spa", "spanish", "es_es", "espanol"],
  it: ["it", "ita", "italian", "it_it", "italiano"],
  ja: ["ja", "jp", "jpn", "japanese", "ja_jp"],
  pt: ["pt", "por", "portuguese", "pt_br", "pt_pt", "br"],
  nl: ["nl", "nld", "dut", "dutch", "nl_nl"],
  ru: ["ru", "rus", "russian", "ru_ru"],
  pl: ["pl", "pol", "polish", "pl_pl"],
  ko: ["ko", "kor", "korean", "ko_kr"],
  zh: ["zh", "chi", "chinese", "zh_cn", "zh_tw", "cht", "chs"],
  sv: ["sv", "swe", "swedish"],
  no: ["no", "nor", "norwegian"],
  da: ["da", "dan", "danish"],
  fi: ["fi", "fin", "finnish"],
};

function languageOf(name: string): string | null {
  const stem = name.toLowerCase().replace(/\.[a-z0-9]+$/, "");
  for (const [lang, tags] of Object.entries(LANG_TAGS)) {
    for (const tag of tags) {
      // _FRA / -fra / .fra / (fra) / fra as a whole path segment; never inside a word.
      const re = new RegExp(`(^|[_\\-. (\\[/\\\\])${tag}($|[_\\-. )\\]/\\\\])`);
      if (re.test(stem) && tag.length >= 2) return lang;
    }
  }
  return null;
}

function isAllZero(file: string, size: number): boolean {
  if (size === 0) return false;
  const fd = fs.openSync(file, "r");
  try {
    // Sample the start, the middle and the end; a dummy file is zeros all through.
    for (const off of [0, Math.floor(size / 2), Math.max(0, size - 65536)]) {
      const buf = Buffer.alloc(Math.min(65536, size));
      fs.readSync(fd, buf, 0, buf.length, off);
      if (buf.some((b) => b !== 0)) return false;
    }
    return true;
  } finally {
    fs.closeSync(fd);
  }
}

/** Empties the files the options allow, keeping their names; returns bytes freed. */
export function trimPs3Folder(dir: string, opts: TrimOptions): { freed: number; log: string[] } {
  let freed = 0;
  const log: string[] = [];
  const empty = (file: string, why: string) => {
    const size = fs.statSync(file).size;
    if (size === 0) return;
    fs.truncateSync(file, 0);
    freed += size;
    log.push(`${why}\t${(size / 1048576).toFixed(1)} MB\t${path.relative(dir, file)}`);
  };
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = path.relative(dir, full).replace(/\\/g, "/");
      if (e.isDirectory()) {
        if (opts.update && /^PS3_UPDATE$/i.test(rel)) {
          for (const f of fs.readdirSync(full)) if (fs.statSync(path.join(full, f)).isFile()) empty(path.join(full, f), "firmware update");
          continue;
        }
        if (opts.languages && !/^PS3_GAME\/?$/i.test(rel) && languageOf(e.name) && languageOf(e.name) !== opts.keepLanguage) {
          const files: string[] = [];
          const collect = (x: string) => {
            for (const f of fs.readdirSync(x, { withFileTypes: true })) (f.isDirectory() ? collect : (p: string) => files.push(p))(path.join(x, f.name));
          };
          collect(full);
          for (const f of files) empty(f, `language ${languageOf(e.name)}`);
          continue;
        }
        walk(full);
        continue;
      }
      // Never touch what the system reads to boot.
      if (/^(PS3_GAME\/(PARAM\.SFO|ICON0\.PNG|PIC1\.PNG|PS3LOGO\.DAT|SND0\.AT3|USRDIR\/EBOOT\.BIN)|PS3_DISC\.SFB)$/i.test(rel)) continue;
      const size = fs.statSync(full).size;
      if (opts.dummy && (size > 4 * 1048576 && (/dummy|padding|filler|junk|\.pad$|\.dmy$|blank|empty/i.test(e.name) || size > 64 * 1048576)) && isAllZero(full, size)) {
        empty(full, "dummy / padding");
        continue;
      }
      if (opts.languages) {
        const lang = languageOf(e.name);
        if (lang && lang !== opts.keepLanguage && size > 512 * 1024) empty(full, `language ${lang}`);
      }
    }
  };
  walk(dir);
  if (log.length) fs.writeFileSync(path.join(dir, "TRIMMED.txt"), `Emptied by A-X-M (the names stay so the game still finds them)\n\n${log.join("\n")}\n`);
  return { freed, log };
}

// -------------------------------------------------------------- prepare ----

const jobs = new Map<string, ReturnType<typeof spawn>>();

export function cancelPrep(id: string): void {
  jobs.get(id)?.kill();
  jobs.delete(id);
}

export interface PrepResult {
  dir: string;
  keySource: string | null;
  decrypted: boolean;
  freed: number;
  /** The original image, offered for deletion afterwards. */
  iso: string;
  isoBytes: number;
}

export async function preparePs3(game: GameEntry, rpcs3Dir: string, trim: TrimOptions | null): Promise<PrepResult> {
  const iso = game.romPath ?? "";
  if (!/\.iso$/i.test(iso) || !fs.existsSync(iso)) throw new Error("That isn't a PS3 disc image");
  const zip = sevenZip();
  if (!zip) throw new Error("Extracting needs 7-Zip (Settings › System › Install Tools)");
  const info = inspectPs3Iso(iso);
  const id = `ps3-${game.id}`;
  const outDir = path.join(rpcs3Dir, "games", safe(game.name));
  const progress = (done: number, note: string, finished = false, error?: string) => send("axm:transfer", { id, name: `${game.name} · ${note}`, destination: outDir, done, total: 100, finished, error });

  let source = iso;
  let keySource: string | null = null;
  const needsDecrypt = !!info.encryptedRegion && !info.plain;
  if (needsDecrypt) {
    const key = findPs3Key(iso, info);
    if (!key) {
      progress(0, "no key", true, "No disc key matches this image");
      throw new Error("No disc key matches this image - put its .dkey next to the .iso");
    }
    keySource = key.source;
    if (!fs.existsSync(venvPython())) throw new Error("Decrypting needs the Python environment (Settings › System › Install Tools)");
    const script = path.join(__dirname, "..", "renderer", "assets", "retro", "ps3_decrypt.py");
    const dec = iso.replace(/\.iso$/i, ".dec.iso");
    if (!fs.existsSync(dec) || fs.statSync(dec).size !== fs.statSync(iso).size) {
      progress(0, "decrypting");
      await new Promise<void>((resolve, reject) => {
        const p = spawn(venvPython(), ["-u", script, iso, key.keyHex, dec], { windowsHide: true });
        jobs.set(id, p);
        let buf = "";
        p.stdout?.on("data", (d: Buffer) => {
          buf += String(d);
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            const m = line.match(/^PROGRESS (\d+) (\d+)/);
            if (m) progress(Math.round((Number(m[1]) / Math.max(1, Number(m[2]))) * 60), "decrypting");
          }
        });
        p.on("close", (code) => {
          jobs.delete(id);
          if (code === 0) resolve();
          else reject(new Error("Decrypting stopped early"));
        });
        p.on("error", reject);
      });
    }
    source = dec;
  }

  progress(60, "extracting");
  fs.mkdirSync(outDir, { recursive: true });
  try {
  await new Promise<void>((resolve, reject) => {
    // The ISO9660 view: 7-Zip's UDF reader trips on the disc's tail sectors and reports a header error.
    const p = spawn(zip, ["x", "-y", "-tiso", "-bsp1", "-bso0", `-o${outDir}`, source], { windowsHide: true });
    jobs.set(id, p);
    p.stdout?.on("data", (d: Buffer) => {
      const m = String(d).match(/(\d+)%/);
      if (m) progress(60 + Math.round(Number(m[1]) * 0.35), "extracting");
    });
    p.on("close", (code) => {
      jobs.delete(id);
      if (code === 0 || code === 1) resolve(); // 1 = warnings only
      else reject(new Error("7-Zip couldn't extract the image"));
    });
    p.on("error", reject);
  });
  if (!fs.existsSync(path.join(outDir, "PS3_GAME", "USRDIR", "EBOOT.BIN"))) {
    progress(0, "extracting", true, "No PS3_GAME folder came out of the image");
    throw new Error("No PS3_GAME folder came out of the image");
  }
  } finally {
    // The decrypted copy is the same size as the disc - ten gigabytes or more - and
    // it is useless once 7-Zip has read it. This has to run on every exit, not just
    // the happy one: a failed extract, a missing PS3_GAME, or a cancel used to
    // leave it stranded next to the original .iso with nothing pointing at it.
    if (needsDecrypt) fs.rmSync(source, { force: true });
  }
  let freed = 0;
  if (trim && (trim.update || trim.dummy || trim.languages)) {
    progress(96, "trimming");
    freed = trimPs3Folder(outDir, trim).freed;
  }
  progress(100, "ready for RPCS3", true);
  return { dir: outDir, keySource, decrypted: needsDecrypt, freed, iso, isoBytes: fs.statSync(iso).size };
}

/**
 * Removes decrypted intermediates left beside a disc image. One is written next to
 * the .iso while a PS3 disc is being extracted and deleted straight after; a build
 * that crashed mid-extract, or was killed, could leave one stranded. Each is the
 * size of the disc, so this is worth sweeping rather than waiting to be noticed.
 *
 * Only files with a matching .iso alongside them are touched, so nothing a user
 * named .dec.iso themselves is ever removed.
 */
export function sweepPs3Intermediates(dirs: string[]): { removed: string[]; freed: number } {
  const removed: string[] = [];
  let freed = 0;
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/\.dec\.iso$/i.test(entry)) continue;
      const full = path.join(dir, entry);
      const original = full.replace(/\.dec\.iso$/i, ".iso");
      if (!fs.existsSync(original)) continue;
      try {
        freed += fs.statSync(full).size;
        fs.rmSync(full, { force: true });
        removed.push(full);
      } catch {
        // Locked by something else; it will be caught on the next sweep.
      }
    }
  }
  return { removed, freed };
}

export function ps3FolderEboot(dir: string): string | null {
  const e = path.join(dir, "PS3_GAME", "USRDIR", "EBOOT.BIN");
  return fs.existsSync(e) ? e : null;
}

// --------------------------------------------------- emulators from GitHub ----

/**
 * Fetches an emulator's latest release asset into C:\Emulators\<name> and unpacks
 * it with 7-Zip. For the ones winget doesn't carry (shadPS4, Kyty, RPCS3).
 */
export async function installFromGithub(name: string, gh: { repo: string; asset: RegExp; exe: string }, onProgress: (done: number, total: number) => void): Promise<boolean> {
  const zip = sevenZip();
  if (!zip) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${gh.repo}/releases/latest`, { headers: { "User-Agent": "A-X-M", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return false;
    const rel = (await res.json()) as { assets: { name: string; browser_download_url: string; size: number }[] };
    const asset = rel.assets.find((a) => gh.asset.test(a.name));
    if (!asset) return false;
    const dir = path.join("C:\Emulators", name);
    fs.mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, asset.name);
    const dl = await fetch(asset.browser_download_url, { headers: { "User-Agent": "A-X-M" } });
    if (!dl.ok || !dl.body) return false;
    const ws = fs.createWriteStream(archive);
    const reader = dl.body.getReader();
    let done = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      if (value) {
        done += value.length;
        if (!ws.write(value)) await new Promise<void>((r) => ws.once("drain", () => r()));
        onProgress(done, asset.size || done);
      }
    }
    await new Promise<void>((resolve, reject) => ws.end((e?: Error | null) => (e ? reject(e) : resolve())));
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(zip, ["x", "-y", `-o${dir}`, archive], { windowsHide: true });
      p.on("close", (code) => resolve(code === 0 || code === 1));
      p.on("error", () => resolve(false));
    });
    fs.rmSync(archive, { force: true });
    return ok && fs.existsSync(path.join(dir, gh.exe));
  } catch {
    return false;
  }
}
