import * as fs from "node:fs";
import * as path from "node:path";
import { execFile, spawn } from "node:child_process";
import { BrowserWindow } from "electron";
import { isWindows } from "./platform";
import { destinationFor, MediaKind } from "./storage";

/**
 * Optical discs, the way the PS3 showed them: a disc row appears in the column it
 * belongs to only while a disc is actually in a drive, and it says what it is.
 *
 * - Audio CD  -> Music, with Import (rip) to MP3 / AAC / Opus via ffmpeg's libcdio
 * - DVD-Video -> Video, with Backup to MKV / H.265 10-bit via HandBrakeCLI (GPL)
 * - Blu-ray   -> Video, with Backup via MakeMKV's makemkvcon (its own licence)
 * - PS1 / PS2 -> Game (recognised from SYSTEM.CNF); shown for emulator use
 * - Data disc -> Video / Photo / Music if it carries the folders, else ignored
 *
 * The rippers are external, headless command-line tools driven from here with
 * progress parsed from their output, so nothing leaves the menu - but they have to
 * be installed: the rows say exactly which one is missing and where it goes.
 * ffmpeg needs a build with libcdio for audio CDs (the "full" builds have it).
 */

export type DiscKind = "audio-cd" | "dvd" | "bluray" | "ps1" | "ps2" | "data" | "unknown";

export interface Disc {
  drive: string;
  label: string;
  kind: DiscKind;
  /** Audio CD track count; DVD / BD title count is only known once the tool runs. */
  tracks?: number;
  /** For data discs: which media folders it carries. */
  photo?: string | null;
  video?: string | null;
  music?: string | null;
}

export interface DiscTools {
  ffmpeg: string | null;
  ffmpegCdio: boolean;
  handbrake: string | null;
  makemkv: string | null;
}

export type ImportFormat = "mp3" | "aac" | "opus" | "flac";

function run(cmd: string, args: string[], timeout = 20_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf-8", timeout, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout ?? "") + (stderr ?? "") }));
  });
}

function firstExisting(candidates: string[]): string | null {
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

async function onPath(exe: string): Promise<string | null> {
  const res = await run(isWindows ? "where" : "which", [exe], 8000);
  const line = res.out.split(/\r?\n/).find((l) => l.trim());
  return res.ok && line ? line.trim() : null;
}

let toolsCache: DiscTools | null = null;

export function resetDiscToolsCache(): void {
  toolsCache = null;
}

export async function findDiscTools(): Promise<DiscTools> {
  if (toolsCache) return toolsCache;
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const ffmpeg = (await onPath("ffmpeg")) ?? firstExisting([path.join(pf, "ffmpeg", "bin", "ffmpeg.exe"), "C:\\ffmpeg\\bin\\ffmpeg.exe"]);
  const handbrake = (await onPath("HandBrakeCLI")) ?? firstExisting([path.join(pf, "HandBrake", "HandBrakeCLI.exe"), path.join(pf86, "HandBrake", "HandBrakeCLI.exe"), "/usr/bin/HandBrakeCLI"]);
  const makemkv = (await onPath("makemkvcon")) ?? firstExisting([path.join(pf86, "MakeMKV", "makemkvcon64.exe"), path.join(pf, "MakeMKV", "makemkvcon64.exe"), "/usr/bin/makemkvcon"]);
  let ffmpegCdio = false;
  if (ffmpeg) {
    const f = await run(ffmpeg, ["-hide_banner", "-formats"], 15_000);
    ffmpegCdio = /\blibcdio\b/.test(f.out);
  }
  toolsCache = { ffmpeg, ffmpegCdio, handbrake, makemkv };
  return toolsCache;
}

function sniff(root: string): { kind: DiscKind; tracks?: number; photo?: string | null; video?: string | null; music?: string | null } {
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return { kind: "unknown" };
  }
  const upper = new Map(names.map((n) => [n.toUpperCase(), n]));
  const cda = names.filter((n) => /\.cda$/i.test(n));
  if (cda.length) return { kind: "audio-cd", tracks: cda.length };
  if (upper.has("BDMV")) return { kind: "bluray" };
  if (upper.has("VIDEO_TS")) return { kind: "dvd" };
  const cnf = upper.get("SYSTEM.CNF");
  if (cnf) {
    try {
      const text = fs.readFileSync(path.join(root, cnf), "latin1");
      if (/BOOT2\s*=/i.test(text)) return { kind: "ps2" };
      if (/BOOT\s*=/i.test(text)) return { kind: "ps1" };
    } catch {
      // unreadable: fall through
    }
  }
  const dir = (keys: string[]) => keys.map((k) => upper.get(k)).filter(Boolean).map((n) => path.join(root, n!)).find((p) => fs.existsSync(p)) ?? null;
  const photo = dir(["PHOTO", "PHOTOS", "DCIM"]);
  const video = dir(["VIDEO", "VIDEOS"]);
  const music = dir(["MUSIC"]);
  if (photo || video || music) return { kind: "data", photo, video, music };
  return { kind: "unknown" };
}

/** Every optical drive with a disc in it. Empty on machines without one (most handhelds). */
export async function listDiscs(): Promise<Disc[]> {
  const out: Disc[] = [];
  if (isWindows) {
    const res = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_CDROMDrive | Select-Object Drive, MediaLoaded, VolumeName | ConvertTo-Json -Compress"], 15_000);
    let rows: { Drive?: string; MediaLoaded?: boolean; VolumeName?: string }[] = [];
    try {
      const raw = JSON.parse(res.out.trim() || "[]");
      rows = Array.isArray(raw) ? raw : [raw];
    } catch {
      return out;
    }
    for (const r of rows) {
      if (!r.Drive || !r.MediaLoaded) continue;
      const root = r.Drive + "\\";
      const s = sniff(root);
      if (s.kind === "unknown") continue;
      out.push({ drive: r.Drive, label: r.VolumeName || r.Drive, ...s });
    }
  } else {
    for (const dev of ["/dev/sr0", "/dev/sr1", "/dev/cdrom"]) {
      if (!fs.existsSync(dev)) continue;
      // Mounted discs appear under /run/media; audio CDs don't mount, so ask cd-discid.
      const mounts = ["/run/media", "/media"].flatMap((b) => {
        try {
          return fs.readdirSync(b).flatMap((u) => {
            const p = path.join(b, u);
            try {
              return fs.readdirSync(p).map((m) => path.join(p, m));
            } catch {
              return [p];
            }
          });
        } catch {
          return [];
        }
      });
      for (const m of mounts) {
        const s = sniff(m);
        if (s.kind !== "unknown") out.push({ drive: dev, label: path.basename(m), ...s });
      }
    }
  }
  return out;
}

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

const jobs = new Map<string, ReturnType<typeof spawn>>();

export function cancelDiscJob(id: string): void {
  jobs.get(id)?.kill();
  jobs.delete(id);
}

/**
 * Rips every track of an audio CD to `target` (a drive letter or "home") in the
 * chosen format. Progress goes out as axm:transfer so the same toast shows it.
 */
export async function importAudioCd(disc: Disc, target: string, format: ImportFormat): Promise<string> {
  const tools = await findDiscTools();
  if (!tools.ffmpeg || !tools.ffmpegCdio) throw new Error("Importing a CD needs ffmpeg with libcdio (the 'full' build from gyan.dev, on PATH or in C:\\ffmpeg\\bin)");
  const outDir = path.join(destinationFor("music", target), `${disc.label !== disc.drive ? disc.label : "Audio CD"} ${new Date().toISOString().slice(0, 10)}`);
  fs.mkdirSync(outDir, { recursive: true });
  const codec = { mp3: ["-c:a", "libmp3lame", "-b:a", "320k"], aac: ["-c:a", "aac", "-b:a", "256k"], opus: ["-c:a", "libopus", "-b:a", "160k"], flac: ["-c:a", "flac", "-compression_level", "8"] }[format];
  const ext = format === "aac" ? "m4a" : format;
  const tracks = disc.tracks ?? 0;
  const id = `cd-${disc.drive}`;
  for (let t = 1; t <= tracks; t++) {
    const out = path.join(outDir, `Track ${String(t).padStart(2, "0")}.${ext}`);
    send("axm:transfer", { id, name: `Audio CD track ${t} of ${tracks}`, destination: outDir, done: t - 1, total: tracks, finished: false });
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "libcdio", "-track", String(t), "-i", isWindows ? disc.drive : disc.drive, ...codec, out];
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(tools.ffmpeg!, args, { windowsHide: true });
      jobs.set(id, p);
      p.on("close", (code) => resolve(code === 0));
      p.on("error", () => resolve(false));
    });
    jobs.delete(id);
    if (!ok) {
      send("axm:transfer", { id, name: "Audio CD", destination: outDir, done: t, total: tracks, finished: true, error: `Track ${t} couldn't be read` });
      throw new Error(`Track ${t} couldn't be read`);
    }
  }
  send("axm:transfer", { id, name: "Audio CD", destination: outDir, done: tracks, total: tracks, finished: true });
  return outDir;
}

/**
 * Turns a disc's volume label ("MARVEL_STUDIOS_DOCTOR_STRANGE", "JOHN_WICK_2_BD",
 * "DISC1") into a searchable movie title: studio prefixes and disc/format tags go,
 * underscores become spaces, and the rest is title-cased.
 */
export function guessDiscTitle(label: string): string {
  let t = label.replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(marvel studios|marvel|disney|pixar|walt disney|warner( bros)?|universal|sony( pictures)?|columbia|paramount|20th century( fox)?|fox|lionsgate|mgm|dreamworks|studiocanal|lucasfilm|a24|criterion)\b\s*/i, "");
  t = t.replace(/\b(blu ?ray|bluray|bd|dvd|disc ?\d*|d\d|4k|uhd|hdr|ntsc|pal|ws|fs|widescreen|region ?\d|r\d|us|uk|eu|na|special edition|collectors edition|extended|theatrical)\b/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return label;
  return t.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").trim() || "Disc";
}

/** An earlier backup of this disc on `target`, if there is one (MKV, then MakeMKV's folder). */
export function findDiscBackup(disc: Disc, target: string, name?: string): string | null {
  const outDir = destinationFor("video", target);
  const base = safeName(name ?? (disc.label !== disc.drive ? disc.label : disc.kind === "bluray" ? "Blu-ray" : "DVD"));
  const mkv = path.join(outDir, `${base}.mkv`);
  if (fs.existsSync(mkv)) return mkv;
  const mkvDir = path.join(outDir, `${base} (MKV)`);
  if (fs.existsSync(mkvDir)) {
    const files = fs.readdirSync(mkvDir).filter((f) => /\.mkv$/i.test(f)).map((f) => path.join(mkvDir, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    if (files.length) return files[0];
  }
  return null;
}

/** MakeMKV numbers drives itself; "disc:9999" lists them with their letters. */
async function makemkvDiscIndex(makemkv: string, drive: string): Promise<string> {
  const res = await run(makemkv, ["-r", "info", "disc:9999"], 60_000);
  for (const line of res.out.split(/\r?\n/)) {
    const m = line.match(/^DRV:(\d+),\d+,\d+,\d+,"[^"]*","[^"]*","([^"]*)"/);
    if (m && m[2].replace(/[\\/]+$/, "").toUpperCase() === drive.replace(/[\\/]+$/, "").toUpperCase()) return `disc:${m[1]}`;
  }
  return isWindows ? "disc:0" : `dev:${drive}`;
}

/**
 * Backs up a DVD (HandBrakeCLI, main title, H.264 MP4) or a Blu-ray (makemkvcon,
 * then HandBrakeCLI to MP4 when present) into VIDEO on `target`. Encrypted discs
 * need the tools' own decryption support (libdvdcss beside HandBrake; MakeMKV for
 * AACS) - that's their concern and their licence, not the menu's.
 */
export async function backupDisc(disc: Disc, target: string, title?: string): Promise<string> {
  const tools = await findDiscTools();
  const outDir = destinationFor("video", target);
  fs.mkdirSync(outDir, { recursive: true });
  const id = `disc-${disc.drive}`;
  const name = safeName(title ?? (disc.label !== disc.drive ? disc.label : disc.kind === "bluray" ? "Blu-ray" : "DVD"));
  const progress = (done: number, note = "") => send("axm:transfer", { id, name: `${name}${note ? " · " + note : ""}`, destination: outDir, done, total: 100, finished: false });

  if (disc.kind === "dvd") {
    if (!tools.handbrake) throw new Error("Backing up a DVD needs HandBrakeCLI (handbrake.fr/downloads2.php, put HandBrakeCLI.exe in C:\\Program Files\\HandBrake)");
    const out = path.join(outDir, `${name.replace(/[<>:"/\\|?*]/g, "")}.mkv`);
    const src = isWindows ? disc.drive + "\\" : disc.drive;
    return encodeWithHandbrake(tools.handbrake, src, out, id, progress, outDir, name, "dvd");
  }
  if (disc.kind === "bluray") {
    if (!tools.makemkv) throw new Error("Backing up a Blu-ray needs MakeMKV (makemkv.com; makemkvcon64.exe in C:\\Program Files (x86)\\MakeMKV)");
    const mkvDir = path.join(outDir, `${name} (MKV)`);
    fs.mkdirSync(mkvDir, { recursive: true });
    progress(0, "reading with MakeMKV");
    const discIndex = await makemkvDiscIndex(tools.makemkv, disc.drive);
    let needsLicence = false;
    // MakeMKV's total bar (PRGV total/max) runs once while it opens and scans the
    // disc and again while it saves, so the phase decides where it sits in ours:
    // scanning is the first 5%, saving the next 55%, HandBrake the last 40%.
    let saving = false;
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(tools.makemkv!, ["-r", "--progress=-same", "--minlength=1200", "mkv", discIndex, "all", mkvDir], { windowsHide: true });
      jobs.set(id, p);
      p.stdout?.on("data", (d: Buffer) => {
        const text = String(d);
        if (/PRG[TC]:\d+,\d+,"(Saving|Copying|Analyzing seamless)/.test(text)) saving = true;
        const m = text.match(/PRGV:(\d+),(\d+),(\d+)/);
        if (m) {
          const frac = Number(m[2]) / Math.max(1, Number(m[3]));
          progress(saving ? 5 + Math.round(frac * 55) : Math.round(frac * 5), saving ? "MakeMKV" : "reading with MakeMKV");
        }
        // 5053: "This functionality is shareware ... start evaluation period now?" -
        // the console tool can't answer that; the MakeMKV window can.
        if (/^MSG:5053,/m.test(text)) needsLicence = true;
      });
      p.on("close", (code) => resolve(code === 0));
      p.on("error", () => resolve(false));
    });
    jobs.delete(id);
    if (!ok) {
      const why = needsLicence ? "MakeMKV needs its evaluation started (or a key entered) in its own window first - opening it" : "MakeMKV couldn't read the disc";
      if (needsLicence) {
        const gui = path.join(path.dirname(tools.makemkv), isWindows ? "makemkv.exe" : "makemkv");
        if (fs.existsSync(gui)) spawn(gui, [], { detached: true, stdio: "ignore" }).unref();
      }
      send("axm:transfer", { id, name, destination: outDir, done: 0, total: 100, finished: true, error: why });
      throw new Error(why);
    }
    const mkvs = fs.readdirSync(mkvDir).filter((f) => /\.mkv$/i.test(f)).map((f) => path.join(mkvDir, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    if (!mkvs.length) throw new Error("MakeMKV produced no titles");
    if (!tools.handbrake) {
      send("axm:transfer", { id, name, destination: mkvDir, done: 100, total: 100, finished: true });
      return mkvDir; // MakeMKV's own MKV (original streams) plays in the menu as it is
    }
    const out = path.join(outDir, `${name.replace(/[<>:"/\\|?*]/g, "")}.mkv`);
    const result = await encodeWithHandbrake(tools.handbrake, mkvs[0], out, id, (d, n) => progress(60 + Math.round(d * 0.4), n), outDir, name, "bluray");
    return result;
  }
  throw new Error("Only DVD and Blu-ray discs can be backed up");
}

/**
 * The library preset: MKV, H.265 10-bit, same resolution and frame rate as the
 * source, slow preset, original audio passed through (TrueHD / DTS-HD MA / DTS /
 * AC3, AAC fallback), all subtitle tracks kept (PGS on Blu-ray, VobSub on DVD),
 * HDR10 metadata carried by x265. DVDs add comb detection with decomb and auto
 * anamorphic; RF 18 for Blu-ray, 19 for DVD.
 */
function handbrakeArgs(src: string, out: string, kind: "dvd" | "bluray"): string[] {
  const common = [
    "-i", src, "-o", out, "--main-feature", "--format", "av_mkv",
    "-e", "x265_10bit", "-q", kind === "dvd" ? "19" : "18", "--encoder-preset", "slow",
    "--vfr", "--crop-mode", "auto",
    "--all-audio", "-E", "copy", "--audio-copy-mask", "truehd,dtshd,dts,eac3,ac3,aac,flac", "--audio-fallback", "av_aac", "-B", "256",
    "--all-subtitles", "--subtitle-burned=none",
  ];
  if (kind === "dvd") common.push("--comb-detect", "--decomb", "--auto-anamorphic");
  else common.push("--no-comb-detect");
  return common;
}

function encodeWithHandbrake(exe: string, src: string, out: string, id: string, progress: (done: number, note?: string) => void, outDir: string, name: string, kind: "dvd" | "bluray" = "bluray"): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, handbrakeArgs(src, out, kind), { windowsHide: true });
    jobs.set(id, p);
    const onData = (d: Buffer) => {
      const m = String(d).match(/Encoding:.*?(\d+(?:\.\d+)?)\s*%/);
      if (m) progress(Math.round(Number(m[1])), "HandBrake");
    };
    p.stdout?.on("data", onData);
    p.stderr?.on("data", onData);
    p.on("close", (code) => {
      jobs.delete(id);
      if (code === 0) {
        send("axm:transfer", { id, name, destination: outDir, done: 100, total: 100, finished: true });
        resolve(out);
      } else {
        send("axm:transfer", { id, name, destination: outDir, done: 0, total: 100, finished: true, error: "HandBrake stopped early" });
        reject(new Error("HandBrake stopped early"));
      }
    });
    p.on("error", (e) => {
      jobs.delete(id);
      reject(e);
    });
  });
}

export type { MediaKind };
