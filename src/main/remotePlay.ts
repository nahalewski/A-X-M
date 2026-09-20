import * as fs from "node:fs";
import * as path from "node:path";
import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { isWindows } from "./platform";

/**
 * PS4 / PS5 Remote Play through chiaki-ng (github.com/streetpea/chiaki-ng, GPL),
 * the open-source client. There is no browser-based Remote Play - Sony's protocol
 * needs a native client - so chiaki-ng is the engine: the menu fetches it into its
 * own tools folder on first use (with the user's say-so), launches it full-screen
 * over the menu, and takes over again when it exits. Console registration and PSN
 * sign-in happen inside chiaki-ng; the menu never sees those credentials.
 */

const RELEASES_API = "https://api.github.com/repos/streetpea/chiaki-ng/releases/latest";

export interface RemotePlayStatus {
  installed: boolean;
  exe: string | null;
  version: string | null;
  running: boolean;
}

function toolsDir(): string {
  return path.join(app.getPath("userData"), "tools", "chiaki-ng");
}

function findExe(): string | null {
  const dir = toolsDir();
  const names = isWindows ? ["chiaki.exe", "chiaki-ng.exe"] : ["chiaki-ng.AppImage", "chiaki", "chiaki-ng"];
  const walk = (d: string, depth: number): string | null => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isFile() && names.includes(e.name)) return full;
      if (e.isDirectory() && depth < 3) {
        const hit = walk(full, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(dir, 0);
}

let child: ReturnType<typeof spawn> | null = null;

export function remotePlayStatus(): RemotePlayStatus {
  const exe = findExe();
  let version: string | null = null;
  try {
    version = fs.readFileSync(path.join(toolsDir(), "VERSION"), "utf-8").trim();
  } catch {
    // not recorded
  }
  return { installed: !!exe, exe, version, running: !!child };
}

/** Downloads the latest chiaki-ng release for this OS into the tools folder. */
export async function installRemotePlay(onProgress: (done: number, total: number, note: string) => void): Promise<RemotePlayStatus> {
  const res = await fetch(RELEASES_API, { headers: { "User-Agent": "A-X-M", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const rel = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string; size: number }[] };
  const want = isWindows ? /win.*x64.*\.zip$/i : /linux.*x86_64.*\.AppImage$/i;
  const asset = rel.assets.find((a) => want.test(a.name)) ?? rel.assets.find((a) => (isWindows ? /\.zip$/i : /\.AppImage$/i).test(a.name));
  if (!asset) throw new Error("No chiaki-ng build for this OS in the latest release");
  const dir = toolsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, asset.name);
  const dl = await fetch(asset.browser_download_url, { headers: { "User-Agent": "A-X-M" } });
  if (!dl.ok || !dl.body) throw new Error(`Download failed (${dl.status})`);
  const total = Number(dl.headers.get("content-length") ?? asset.size);
  const ws = fs.createWriteStream(file);
  const reader = dl.body.getReader();
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    if (value) {
      done += value.length;
      if (!ws.write(value)) await new Promise<void>((r) => ws.once("drain", () => r()));
      onProgress(done, total, "downloading chiaki-ng");
    }
  }
  await new Promise<void>((resolve, reject) => ws.end((e?: Error | null) => (e ? reject(e) : resolve())));
  if (isWindows) {
    onProgress(total, total, "unpacking");
    await new Promise<void>((resolve, reject) => {
      const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${file.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`], { windowsHide: true });
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("Couldn't unpack chiaki-ng"))));
      p.on("error", reject);
    });
    try {
      fs.unlinkSync(file);
    } catch {
      // keep going
    }
  } else {
    fs.chmodSync(file, 0o755);
  }
  fs.writeFileSync(path.join(dir, "VERSION"), rel.tag_name);
  return remotePlayStatus();
}

/** Launches chiaki-ng full-screen; resolves when it exits so the menu can come back. */
export function launchRemotePlay(onExit: () => void): boolean {
  const exe = findExe();
  if (!exe || child) return false;
  child = spawn(exe, ["--fullscreen"], { cwd: path.dirname(exe), detached: false, stdio: "ignore", windowsHide: false });
  child.on("exit", () => {
    child = null;
    onExit();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.show();
      win.focus();
    }
  });
  child.on("error", () => {
    child = null;
    onExit();
  });
  return true;
}

export function stopRemotePlay(): void {
  child?.kill();
}
