import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn, execFile, ChildProcess } from "node:child_process";
import { app } from "electron";
import { isWindows } from "./platform";

/**
 * Ghost speaks with a cloned voice: one short clip (assets/voice/ghost.wav, or one
 * the user picks) is the whole "training". The synthesis is Chatterbox (Resemble
 * AI, MIT) running in a Python virtual environment under the app's data folder,
 * talked to over stdin/stdout by assets/tts/ghost_tts.py. Nothing is sent
 * anywhere. There is deliberately no other voice: when the engine isn't installed
 * Ghost answers in text only.
 *
 * Every phrase Ghost has said is cached as WAV by a hash of its text, so the
 * fixed replies cost the model one run ever; only new game / playlist names
 * take a moment.
 */

export interface TtsStatus {
  /** Python 3.10 / 3.11 found on this machine. */
  python: string | null;
  engineReady: boolean;
  engineRunning: boolean;
  /** "cuda" or "cpu" once the worker has loaded. */
  device: string | null;
  voiceClip: string;
  installing: boolean;
  cacheCount: number;
}

function ttsDir(): string {
  return path.join(app.getPath("userData"), "tts");
}

function venvDir(): string {
  return path.join(ttsDir(), "venv");
}

function venvPython(): string {
  return isWindows ? path.join(venvDir(), "Scripts", "python.exe") : path.join(venvDir(), "bin", "python");
}

function cacheDir(): string {
  return path.join(ttsDir(), "cache");
}

function workerScript(): string {
  return path.join(__dirname, "..", "renderer", "assets", "tts", "ghost_tts.py");
}

/** The clip Ghost's voice is cloned from: the user's, else the one that ships with the menu. */
export function voiceClipPath(): string {
  const custom = path.join(ttsDir(), "ghost.wav");
  if (fs.existsSync(custom)) return custom;
  return path.join(__dirname, "..", "renderer", "assets", "voice", "ghost.wav");
}

function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf-8", windowsHide: true, timeout: opts.timeout ?? 20_000, cwd: opts.cwd, maxBuffer: 16 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout ?? ""}${stderr ?? ""}` }));
  });
}

/** Chatterbox wants Python 3.10 or 3.11; the launcher on Windows, python3.x on Linux. */
export async function findPython(): Promise<string | null> {
  const candidates: [string, string[]][] = isWindows
    ? [
        ["py", ["-3.11", "--version"]],
        ["py", ["-3.10", "--version"]],
        [path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Python", "Python311", "python.exe"), ["--version"]],
        [path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Python", "Python310", "python.exe"), ["--version"]],
      ]
    : [
        ["python3.11", ["--version"]],
        ["python3.10", ["--version"]],
        ["python3", ["--version"]],
      ];
  for (const [cmd, args] of candidates) {
    if (cmd.includes(path.sep) && !fs.existsSync(cmd)) continue;
    const r = await run(cmd, args, { timeout: 10_000 });
    if (r.ok && /Python 3\.1[01]\./.test(r.out)) return cmd.startsWith("py") && args[0].startsWith("-3") ? `${cmd} ${args[0]}` : cmd;
  }
  return null;
}

let installing = false;
let worker: ChildProcess | null = null;
let device: string | null = null;
let readyPromise: Promise<boolean> | null = null;
const pending = new Map<string, { resolve: (file: string | null) => void }>();

export async function ttsStatus(): Promise<TtsStatus> {
  let cacheCount = 0;
  try {
    cacheCount = fs.readdirSync(cacheDir()).filter((f) => f.endsWith(".wav")).length;
  } catch {
    /* no cache yet */
  }
  return { python: await findPython(), engineReady: fs.existsSync(venvPython()) && fs.existsSync(workerScript()), engineRunning: !!worker, device, voiceClip: voiceClipPath(), installing, cacheCount };
}

/**
 * Builds the voice engine: a venv, chatterbox-tts, and on machines with an NVIDIA
 * GPU the CUDA build of torch (the CPU build works everywhere, just slower). The
 * model weights arrive on the worker's first run.
 */
export async function installTts(onProgress: (note: string, step: number, steps: number) => void): Promise<TtsStatus> {
  if (installing) return ttsStatus();
  installing = true;
  try {
    const python = await findPython();
    if (!python) throw new Error("Ghost's voice needs Python 3.11 - install it from python.org (or Settings › System › Install Tools) and try again");
    fs.mkdirSync(ttsDir(), { recursive: true });
    fs.mkdirSync(cacheDir(), { recursive: true });
    const [cmd, ...pre] = python.split(" ");
    const steps = 4;
    onProgress("creating the Python environment", 1, steps);
    if (!fs.existsSync(venvPython())) {
      const v = await run(cmd, [...pre, "-m", "venv", venvDir()], { timeout: 180_000 });
      if (!v.ok || !fs.existsSync(venvPython())) throw new Error("Couldn't create the Python environment: " + v.out.slice(-300));
    }
    onProgress("installing Chatterbox (this is a few hundred MB)", 2, steps);
    const pip = await run(venvPython(), ["-m", "pip", "install", "--upgrade", "pip", "chatterbox-tts"], { timeout: 1_800_000 });
    if (!pip.ok) throw new Error("pip couldn't install chatterbox-tts: " + pip.out.slice(-400));
    const nvidia = isWindows ? fs.existsSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "nvidia-smi.exe")) : (await run("nvidia-smi", ["-L"], { timeout: 10_000 })).ok;
    if (nvidia) {
      onProgress("installing the CUDA build of torch for the GPU (about 2.5 GB)", 3, steps);
      const cuda = await run(venvPython(), ["-m", "pip", "install", "torch==2.6.0", "torchaudio==2.6.0", "--index-url", "https://download.pytorch.org/whl/cu124"], { timeout: 3_600_000 });
      if (!cuda.ok) console.warn("[tts] CUDA torch install failed, staying on CPU:", cuda.out.slice(-300));
    }
    onProgress("fetching the voice model", 4, steps);
    stopTts();
    const ok = await ensureWorker();
    if (!ok) throw new Error("The voice engine installed but didn't start - see the log");
    return ttsStatus();
  } finally {
    installing = false;
  }
}

export function removeTts(): void {
  stopTts();
  fs.rmSync(venvDir(), { recursive: true, force: true });
  fs.rmSync(cacheDir(), { recursive: true, force: true });
}

/** Replaces the voice clip with the user's own (any audio ffmpeg reads; mono 24 kHz WAV out). */
export async function setVoiceClip(src: string, ffmpeg: string | null): Promise<string> {
  fs.mkdirSync(ttsDir(), { recursive: true });
  const dst = path.join(ttsDir(), "ghost.wav");
  if (ffmpeg) {
    const r = await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "24000", "-t", "30", "-af", "loudnorm=I=-18:TP=-2", dst], { timeout: 60_000 });
    if (!r.ok) throw new Error("ffmpeg couldn't convert that clip: " + r.out.slice(-200));
  } else if (/\.wav$/i.test(src)) fs.copyFileSync(src, dst);
  else throw new Error("Converting that clip needs ffmpeg (Settings › System › Install Tools)");
  fs.rmSync(cacheDir(), { recursive: true, force: true });
  fs.mkdirSync(cacheDir(), { recursive: true });
  return dst;
}

export function resetVoiceClip(): void {
  fs.rmSync(path.join(ttsDir(), "ghost.wav"), { force: true });
  fs.rmSync(cacheDir(), { recursive: true, force: true });
  fs.mkdirSync(cacheDir(), { recursive: true });
}

function ensureWorker(): Promise<boolean> {
  if (worker && readyPromise) return readyPromise;
  if (!fs.existsSync(venvPython()) || !fs.existsSync(workerScript())) return Promise.resolve(false);
  fs.mkdirSync(cacheDir(), { recursive: true });
  const p = spawn(venvPython(), ["-u", workerScript()], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  worker = p;
  device = null;
  let buffer = "";
  readyPromise = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 20 * 60_000); // first run downloads the weights
    p.stdout?.on("data", (d: Buffer) => {
      buffer += String(d);
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        let msg: { status?: string; device?: string; id?: string; ok?: boolean; file?: string; error?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.status === "ready") {
          device = msg.device ?? null;
          clearTimeout(timer);
          resolve(true);
        } else if (msg.id) {
          const req = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) console.warn("[tts]", msg.error);
          req?.resolve(msg.ok && msg.file ? msg.file : null);
        }
      }
    });
    p.stderr?.on("data", (d: Buffer) => {
      const t = String(d);
      if (/error|traceback/i.test(t)) console.warn("[tts]", t.slice(0, 400));
    });
    p.on("exit", (code) => {
      console.log("[tts] worker exited", code);
      worker = null;
      readyPromise = null;
      device = null;
      clearTimeout(timer);
      resolve(false);
      for (const [, r] of pending) r.resolve(null);
      pending.clear();
    });
    p.on("error", () => resolve(false));
  });
  return readyPromise;
}

/** Warms the worker up (loads the model) so the first reply doesn't wait. */
export function startTts(): Promise<boolean> {
  return ensureWorker();
}

export function stopTts(): void {
  if (worker) {
    try {
      worker.stdin?.write(JSON.stringify({ quit: true }) + "\n");
    } catch {
      /* already gone */
    }
    setTimeout(() => worker?.kill(), 1500);
  }
  worker = null;
  readyPromise = null;
}

/**
 * The WAV for a line of Ghost's, from the cache or freshly made. Null when the
 * engine isn't there - the caller shows the text and stays silent.
 */
export async function speak(text: string): Promise<string | null> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const clip = voiceClipPath();
  const key = crypto.createHash("sha1").update(`${clip}|${clean}`).digest("hex");
  const out = path.join(cacheDir(), `${key}.wav`);
  if (fs.existsSync(out)) return out;
  if (!(await ensureWorker()) || !worker) return null;
  return new Promise((resolve) => {
    const id = key;
    pending.set(id, { resolve });
    worker!.stdin?.write(JSON.stringify({ id, text: clean, voice: clip, out }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(null);
      }
    }, 120_000);
  });
}

/** Fixed lines Ghost says often, rendered ahead of time in the background. */
export async function prewarm(lines: string[]): Promise<void> {
  for (const l of lines) await speak(l);
}
