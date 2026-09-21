import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { app, BrowserWindow, session } from "electron";
import { execFile } from "node:child_process";
import { isWindows } from "./platform";

/**
 * "Ghost", the voice assistant, runs entirely on the device. Vosk (Apache-2.0)
 * does the recognition through vosk-browser (WASM) inside a hidden BrowserWindow
 * served from a loopback HTTP port - Vosk's worker needs a real origin (IndexedDB,
 * fetch), which a file:// page can't give it. The small English model (about 40 MB
 * from alphacephei.com) is fetched on first enable, re-packed as the tar.gz the
 * worker wants, and served from the same port. The voice window posts transcripts;
 * the menu turns them into actions. No audio or text ever leaves the machine.
 */

const MODEL_NAME = "vosk-model-small-en-us-0.15";
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`;

export interface AssistantStatus {
  modelReady: boolean;
  modelUrl: string | null;
  modelName: string;
  listening: boolean;
}

function modelsDir(): string {
  return path.join(app.getPath("userData"), "models");
}

function archivePath(): string {
  return path.join(modelsDir(), `${MODEL_NAME}.tar.gz`);
}

function voiceDir(): string {
  return path.join(__dirname, "..", "renderer", "voice");
}

let server: http.Server | null = null;
let port = 0;
let voiceWindow: BrowserWindow | null = null;

function serve(): Promise<number> {
  if (server && port) return Promise.resolve(port);
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const url = (req.url ?? "/").split("?")[0];
      const cors = { "Access-Control-Allow-Origin": "*" };
      if (url === `/${MODEL_NAME}.tar.gz` && fs.existsSync(archivePath())) {
        const stat = fs.statSync(archivePath());
        res.writeHead(200, { ...cors, "Content-Type": "application/gzip", "Content-Length": stat.size });
        fs.createReadStream(archivePath()).pipe(res);
        return;
      }
      const files: Record<string, [string, string]> = {
        "/voice.html": [path.join(__dirname, "..", "renderer", "assets", "voice.html"), "text/html"],
        "/voice.js": [path.join(voiceDir(), "voice.js"), "application/javascript"],
      };
      const hit = files[url];
      if (hit && fs.existsSync(hit[0])) {
        res.writeHead(200, { ...cors, "Content-Type": hit[1] });
        fs.createReadStream(hit[0]).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      port = (server!.address() as { port: number }).port;
      resolve(port);
    });
  });
}

export async function assistantStatus(): Promise<AssistantStatus> {
  const ready = fs.existsSync(archivePath());
  const p = ready ? await serve() : 0;
  return { modelReady: ready, modelUrl: ready ? `http://127.0.0.1:${p}/${MODEL_NAME}.tar.gz` : null, modelName: MODEL_NAME, listening: !!voiceWindow };
}

/** Opens the hidden voice window; transcripts arrive on the "axm:voice" IPC channel. */
export async function startVoice(micId: string): Promise<boolean> {
  if (!fs.existsSync(archivePath())) return false;
  if (voiceWindow && !voiceWindow.isDestroyed()) return true;
  const p = await serve();
  // The voice page may use the microphone; nothing else.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === "media" && wc.getURL().startsWith(`http://127.0.0.1:${p}/`));
  });
  voiceWindow = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, "voicePreload.js"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  voiceWindow.on("closed", () => (voiceWindow = null));
  const q = new URLSearchParams({ model: `http://127.0.0.1:${p}/${MODEL_NAME}.tar.gz`, mic: micId });
  await voiceWindow.loadURL(`http://127.0.0.1:${p}/voice.html?${q.toString()}`);
  return true;
}

export function stopVoice(): void {
  if (voiceWindow && !voiceWindow.isDestroyed()) voiceWindow.close();
  voiceWindow = null;
}

function run(cmd: string, args: string[], cwd?: string): Promise<boolean> {
  return new Promise((resolve) => execFile(cmd, args, { cwd, windowsHide: true, timeout: 300_000 }, (err) => resolve(!err)));
}

/** Downloads and prepares the model; progress in bytes for the transfer toast. */
export async function installAssistantModel(onProgress: (done: number, total: number, note: string) => void): Promise<AssistantStatus> {
  const dir = modelsDir();
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, `${MODEL_NAME}.zip`);
  const res = await fetch(MODEL_URL, { headers: { "User-Agent": "A-X-M" } });
  if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const ws = fs.createWriteStream(zip);
  const reader = res.body.getReader();
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    if (value) {
      done += value.length;
      if (!ws.write(value)) await new Promise<void>((r) => ws.once("drain", () => r()));
      onProgress(done, total || done, "downloading the voice model");
    }
  }
  await new Promise<void>((resolve, reject) => ws.end((e?: Error | null) => (e ? reject(e) : resolve())));
  onProgress(total || done, total || done, "unpacking");
  const extracted = path.join(dir, MODEL_NAME);
  fs.rmSync(extracted, { recursive: true, force: true });
  const unzipped = isWindows
    ? await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`])
    : await run("unzip", ["-o", zip, "-d", dir]);
  if (!unzipped || !fs.existsSync(extracted)) throw new Error("Couldn't unpack the voice model");
  // The worker wants a gzipped tar with the model folder at the top level. Windows
  // ships bsdtar in System32; a Git / MSYS tar earlier on PATH can't always gzip.
  const tarExe = isWindows ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const packed = await run(tarExe, ["-czf", archivePath(), MODEL_NAME], dir);
  if (!packed) throw new Error("Couldn't pack the voice model (tar missing?)");
  fs.rmSync(zip, { force: true });
  fs.rmSync(extracted, { recursive: true, force: true });
  return assistantStatus();
}

export function removeAssistantModel(): void {
  stopVoice();
  fs.rmSync(archivePath(), { force: true });
}
