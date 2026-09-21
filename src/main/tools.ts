import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { isWindows } from "./platform";
import { findDiscTools, resetDiscToolsCache } from "./discs";
import { findPython, installTts, ttsStatus } from "./tts";

/**
 * Everything the menu leans on that isn't in the box: ffmpeg (CD import, clip
 * conversion), HandBrakeCLI (DVD / Blu-ray encoding), MakeMKV (Blu-ray reading),
 * Python 3.11 (Ghost's voice) and then the voice engine itself. On Windows they
 * come from winget, which Windows 11 ships with; on the Steam Deck / Linux the
 * distro's own package manager owns them, so only the voice engine is set up
 * here and the rest is reported as present or missing.
 */

export interface ToolState {
  id: "ffmpeg" | "handbrake" | "makemkv" | "python" | "voice";
  name: string;
  installed: boolean;
  detail: string;
}

export interface ToolsProgress {
  step: number;
  steps: number;
  note: string;
}

const WINGET: Record<string, string> = {
  ffmpeg: "Gyan.FFmpeg",
  handbrake: "HandBrake.HandBrake.CLI",
  makemkv: "GuinpinSoft.MakeMKV",
  python: "Python.Python.3.11",
};

function run(cmd: string, args: string[], timeout = 20_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf-8", windowsHide: true, timeout, maxBuffer: 16 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout ?? ""}${stderr ?? ""}` }));
  });
}

export async function toolsState(): Promise<ToolState[]> {
  resetDiscToolsCache();
  const disc = await findDiscTools();
  const python = await findPython();
  const tts = await ttsStatus();
  return [
    { id: "ffmpeg", name: "ffmpeg", installed: !!disc.ffmpeg, detail: disc.ffmpeg ? (disc.ffmpegCdio ? "with libcdio (CD import)" : "no libcdio - CD import needs the full build") : "not found" },
    { id: "handbrake", name: "HandBrakeCLI", installed: !!disc.handbrake, detail: disc.handbrake ?? "not found" },
    { id: "makemkv", name: "MakeMKV", installed: !!disc.makemkv, detail: disc.makemkv ?? "not found" },
    { id: "python", name: "Python 3.11", installed: !!python, detail: python ?? "not found" },
    { id: "voice", name: "Ghost voice engine", installed: tts.engineReady, detail: tts.engineReady ? `Chatterbox · ${tts.device ?? "not loaded yet"} · ${tts.cacheCount} phrases cached` : "not installed" },
  ];
}

let installing = false;

/** Installs whatever is missing, one tool at a time, reporting each step. */
export async function installTools(onProgress: (p: ToolsProgress) => void): Promise<ToolState[]> {
  if (installing) return toolsState();
  installing = true;
  try {
    const before = await toolsState();
    const missing = before.filter((t) => !t.installed);
    const steps = missing.length;
    let step = 0;
    for (const t of missing) {
      step++;
      if (t.id === "voice") continue; // last, below, once Python is there
      onProgress({ step, steps, note: `installing ${t.name}` });
      if (isWindows) {
        const r = await run("winget", ["install", "--id", WINGET[t.id], "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], 30 * 60_000);
        if (!r.ok && !/already installed|No newer package/i.test(r.out)) console.warn(`[tools] winget ${t.id}:`, r.out.slice(-300));
      } else {
        // The Deck's root is read-only; flatpak has MakeMKV and HandBrake, pacman the rest.
        const flat: Record<string, string | undefined> = { makemkv: "com.makemkv.MakeMKV", handbrake: "fr.handbrake.HandBrakeCLI" };
        if (flat[t.id]) await run("flatpak", ["install", "-y", "--user", "flathub", flat[t.id]!], 30 * 60_000);
      }
      refreshPath();
    }
    if (missing.some((t) => t.id === "voice")) {
      onProgress({ step: steps, steps, note: "setting up Ghost's voice" });
      try {
        await installTts((note, s, n) => onProgress({ step: steps, steps, note: `Ghost's voice · ${note} (${s}/${n})` }));
      } catch (err) {
        console.warn("[tools] voice engine:", (err as Error).message);
      }
    }
    return toolsState();
  } finally {
    installing = false;
  }
}

/** winget puts new tools on PATH for new shells; this process needs them now. */
function refreshPath(): void {
  if (!isWindows) return;
  const extra = [
    path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Python", "Python311"),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "HandBrake"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "MakeMKV"),
  ].filter((p) => fs.existsSync(p));
  const cur = process.env.PATH ?? "";
  for (const e of extra) if (!cur.toLowerCase().includes(e.toLowerCase())) process.env.PATH = `${e};${process.env.PATH}`;
  resetDiscToolsCache();
}

/**
 * MakeMKV's Blu-ray reading is licensed; while it is in beta the current key is
 * posted on makemkv.com's forum and entered in Settings › Disc. It goes into
 * MakeMKV's own settings file, which is where the console tool reads it from.
 */
export function applyMakemkvKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  const dir = isWindows ? path.join(process.env.APPDATA ?? "", "MakeMKV") : path.join(process.env.HOME ?? "", ".MakeMKV");
  const conf = path.join(dir, "settings.conf");
  try {
    const existing = fs.existsSync(conf) ? fs.readFileSync(conf, "utf-8") : "";
    if (new RegExp(`^app_Key\\s*=\\s*"${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "m").test(existing)) return true;
    fs.mkdirSync(dir, { recursive: true });
    const rest = existing
      .split(/\r?\n/)
      .filter((l) => !/^app_Key\s*=/.test(l))
      .join("\n")
      .trimEnd();
    fs.writeFileSync(conf, `${rest ? rest + "\n" : ""}app_Key = "${k}"\n`);
    return true;
  } catch (err) {
    console.warn("[tools] MakeMKV key:", (err as Error).message);
    return false;
  }
}
