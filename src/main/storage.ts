import * as fs from "node:fs";
import { isWindows, listDriveRoots, driveLabel, isSystemRoot } from "./platform";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { BrowserWindow } from "electron";

import { JellyfinLogin } from "./settingsStore";
import { cartridgeDrives } from "./cartridge";

/**
 * Drives and moving media between them.
 *
 * - `listVolumes` is the System Information view: every mounted drive with its
 *   size, used and free space.
 * - `copyMedia` copies a song, picture or video to a drive's MUSIC / PHOTO / VIDEO
 *   folder (created on demand) - or back into the user's own Music / Pictures /
 *   Videos - the way the PS3 copied to and from a USB stick.
 * - `downloadJellyfin` pulls a film or episode off the server into VIDEO on the
 *   chosen drive.
 *
 * Progress goes to the renderer as "axm:transfer" events so the row can show it.
 */

export interface VolumeInfo {
  drive: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  kind: "fixed" | "removable" | "network" | "other";
  system: boolean;
  /** Plugged in through the Sabrent SATA adapter - shown as a game cartridge. */
  cartridge?: boolean;
}

export type MediaKind = "music" | "photo" | "video";

const FOLDER_FOR: Record<MediaKind, string> = { music: "MUSIC", photo: "PHOTO", video: "VIDEO" };
const HOME_FOR: Record<MediaKind, string> = { music: "Music", photo: "Pictures", video: "Videos" };

export interface TransferProgress {
  id: string;
  name: string;
  destination: string;
  done: number;
  total: number;
  finished: boolean;
  error?: string;
}

export async function listVolumes(): Promise<VolumeInfo[]> {
  const volumes = await listVolumesRaw();
  const carts = await cartridgeDrives();
  for (const v of volumes) v.cartridge = carts.includes(v.drive.toUpperCase());
  return volumes;
}

function listVolumesRaw(): Promise<VolumeInfo[]> {
  if (!isWindows) return listVolumesPosix();
  const script =
    "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3,4 } | " +
    "Select-Object DeviceID, VolumeName, Size, FreeSpace, DriveType | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15_000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      try {
        const raw = JSON.parse(stdout) as Record<string, unknown> | Record<string, unknown>[];
        const rows = Array.isArray(raw) ? raw : [raw];
        const system = (process.env.SystemDrive ?? "C:").toUpperCase();
        resolve(
          rows
            .map((r) => {
              const total = Number(r.Size ?? 0);
              const free = Number(r.FreeSpace ?? 0);
              const type = Number(r.DriveType);
              return {
                drive: String(r.DeviceID),
                label: String(r.VolumeName ?? "") || (type === 2 ? "Removable Disk" : "Local Disk"),
                totalBytes: total,
                freeBytes: free,
                usedBytes: Math.max(0, total - free),
                kind: type === 2 ? "removable" : type === 3 ? "fixed" : type === 4 ? "network" : "other",
                system: String(r.DeviceID).toUpperCase() === system,
              } as VolumeInfo;
            })
            // Recovery and EFI partitions are a few hundred MB with no label: not storage.
            .filter((v) => v.totalBytes > 1e9)
            .sort((a, b) => a.drive.localeCompare(b.drive))
        );
      } catch {
        resolve([]);
      }
    });
  });
}

/** Linux: statfs over every mount root the menu knows about. */
async function listVolumesPosix(): Promise<VolumeInfo[]> {
  const out: VolumeInfo[] = [];
  for (const root of listDriveRoots()) {
    const stats = await new Promise<fs.StatsFs | null>((resolve) => fs.statfs(root, (err, st) => resolve(err ? null : st)));
    if (!stats) continue;
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    if (total <= 1e9) continue;
    out.push({
      drive: root,
      label: driveLabel(root),
      totalBytes: total,
      freeBytes: free,
      usedBytes: Math.max(0, total - free),
      kind: root.startsWith("/run/media") || root.startsWith("/media") ? "removable" : "fixed",
      system: isSystemRoot(root),
    });
  }
  return out;
}

/** Where a copy of `kind` lands on `target`: a drive letter, or "home" for the user's own folder. */
export function destinationFor(kind: MediaKind, target: string): string {
  if (target === "home") return path.join(os.homedir(), HOME_FOR[kind]);
  const root = isWindows ? target.replace(/[\\/]+$/, "") + "\\" : target;
  // Reuse a folder the drive already has (PHOTOS, Music, ...) rather than adding a twin.
  try {
    const wanted = [FOLDER_FOR[kind], FOLDER_FOR[kind] + "S"];
    const existing = fs.readdirSync(root).find((n) => wanted.includes(n.toUpperCase()) && fs.statSync(path.join(root, n)).isDirectory());
    if (existing) return path.join(root, existing);
  } catch {
    // unreadable root: fall through and let mkdir report it
  }
  return path.join(root, FOLDER_FOR[kind]);
}

function send(progress: TransferProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("axm:transfer", progress);
  }
}

function uniquePath(dir: string, name: string): string {
  let candidate = path.join(dir, name);
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

/** Copies one file (or a folder of them, for an album) with progress. Returns the destination. */
export async function copyMedia(kind: MediaKind, source: string, target: string): Promise<string> {
  const destDir = destinationFor(kind, target);
  fs.mkdirSync(destDir, { recursive: true });
  const id = `copy-${Date.now()}`;
  const stat = fs.statSync(source);
  const files: string[] = stat.isDirectory()
    ? fs.readdirSync(source).filter((n) => fs.statSync(path.join(source, n)).isFile()).map((n) => path.join(source, n))
    : [source];
  const outDir = stat.isDirectory() ? path.join(destDir, path.basename(source)) : destDir;
  fs.mkdirSync(outDir, { recursive: true });
  const total = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  let done = 0;
  const label = path.basename(source);
  const free = await freeBytes(outDir);
  if (free !== null && free < total) {
    const err = `Not enough space on ${target === "home" ? "this PC" : target}`;
    send({ id, name: label, destination: outDir, done, total, finished: true, error: err });
    throw new Error(err);
  }
  send({ id, name: label, destination: outDir, done, total, finished: false });
  for (const file of files) {
    const out = uniquePath(outDir, path.basename(file));
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(file);
      const ws = fs.createWriteStream(out);
      rs.on("data", (chunk: Buffer | string) => {
        done += chunk.length;
        send({ id, name: label, destination: outDir, done, total, finished: false });
      });
      rs.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", () => resolve());
      rs.pipe(ws);
    });
  }
  send({ id, name: label, destination: outDir, done: total, total, finished: true });
  return outDir;
}

function freeBytes(dir: string): Promise<number | null> {
  return new Promise((resolve) => {
    fs.statfs(dir, (err, stats) => {
      if (err) return resolve(null);
      resolve(stats.bavail * stats.bsize);
    });
  });
}

/** Downloads a Jellyfin item's file into VIDEO (or MUSIC) on the target drive. */
export async function downloadJellyfin(login: JellyfinLogin, itemId: string, name: string, kind: MediaKind, target: string, container: string): Promise<string> {
  const destDir = destinationFor(kind, target);
  fs.mkdirSync(destDir, { recursive: true });
  const id = `dl-${itemId}`;
  const safe = name.replace(/[<>:"/\\|?*]/g, "").trim() || itemId;
  const out = uniquePath(destDir, `${safe}.${container || "mkv"}`);
  // The Download endpoint needs the "allow media downloads" permission on the
  // Jellyfin user; when it's refused, the untranscoded stream is the same bytes.
  const headers = { Authorization: `MediaBrowser Token="${login.accessToken}"` };
  let res = await fetch(`${login.serverUrl}/Items/${itemId}/Download?api_key=${login.accessToken}`, { headers });
  if (res.status === 403 || res.status === 401) {
    res = await fetch(`${login.serverUrl}/Videos/${itemId}/stream?static=true&api_key=${login.accessToken}`, { headers });
  }
  if (!res.ok || !res.body) {
    const err = `Server refused the download (${res.status})`;
    send({ id, name, destination: destDir, done: 0, total: 0, finished: true, error: err });
    throw new Error(err);
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  const free = await freeBytes(destDir);
  if (free !== null && total > 0 && free < total) {
    const err = `Not enough space on ${target === "home" ? "this PC" : target}`;
    send({ id, name, destination: destDir, done: 0, total, finished: true, error: err });
    throw new Error(err);
  }
  let done = 0;
  let lastSent = 0;
  const ws = fs.createWriteStream(out);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      if (value) {
        done += value.length;
        if (!ws.write(value)) await new Promise<void>((r) => ws.once("drain", () => r()));
        if (Date.now() - lastSent > 250) {
          lastSent = Date.now();
          send({ id, name, destination: destDir, done, total, finished: false });
        }
      }
    }
    await new Promise<void>((resolve, reject) => ws.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    ws.destroy();
    try {
      fs.unlinkSync(out);
    } catch {
      // partial file already gone
    }
    send({ id, name, destination: destDir, done, total, finished: true, error: String(err) });
    throw err;
  }
  send({ id, name, destination: destDir, done: total || done, total: total || done, finished: true });
  return out;
}

/**
 * Saves a TV Streaming film or episode to VIDEO on `target`, refusing up front when
 * the drive can't hold it (the provider states the size in Content-Length). Same
 * toast and progress as a Jellyfin download; the URL carries the account, so it
 * is built in the main process and never shown.
 */
export async function downloadUrl(url: string, name: string, target: string, container: string, id = `dl-${Buffer.from(url).toString("base64url").slice(0, 24)}`): Promise<string> {
  const destDir = destinationFor("video", target);
  fs.mkdirSync(destDir, { recursive: true });
  const safe = name.replace(/[<>:"/\|?*]/g, "").trim() || "video";
  const out = uniquePath(destDir, `${safe}.${container || "mp4"}`);
  const res = await fetch(url, { headers: { "User-Agent": STREAM_USER_AGENT } });
  if (!res.ok || !res.body) {
    const err = `The service refused the download (${res.status})`;
    send({ id, name, destination: destDir, done: 0, total: 0, finished: true, error: err });
    throw new Error(err);
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  const free = await freeBytes(destDir);
  if (free !== null && total > 0 && free < total + 256 * 1024 * 1024) {
    const err = `Not enough space on ${target === "home" ? "this PC" : target} (${(total / 1073741824).toFixed(1)} GB needed, ${(free / 1073741824).toFixed(1)} GB free)`;
    send({ id, name, destination: destDir, done: 0, total, finished: true, error: err });
    throw new Error(err);
  }
  let done = 0;
  let lastSent = 0;
  const ws = fs.createWriteStream(out);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      if (value) {
        done += value.length;
        if (!ws.write(value)) await new Promise<void>((r) => ws.once("drain", () => r()));
        if (Date.now() - lastSent > 250) {
          lastSent = Date.now();
          send({ id, name, destination: destDir, done, total, finished: false });
        }
      }
    }
    await new Promise<void>((resolve, reject) => ws.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    ws.destroy();
    try {
      fs.unlinkSync(out);
    } catch {
      /* partial file already gone */
    }
    send({ id, name, destination: destDir, done, total, finished: true, error: String(err) });
    throw err;
  }
  send({ id, name, destination: destDir, done: total || done, total: total || done, finished: true });
  return out;
}

/** What a set-top box says; a few panels refuse a browser's own name. */
export const STREAM_USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";
