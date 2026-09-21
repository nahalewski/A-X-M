import * as fs from "node:fs";
import * as path from "node:path";
import { app, shell } from "electron";
import { isWindows } from "./platform";

/**
 * System Update: asks GitHub for the newest release, compares it with the running
 * version, and can fetch the matching build (installer on Windows, AppImage on
 * Linux) into Downloads and open it. Pre-releases count, since every build so far
 * is a beta.
 */

const RELEASES = "https://api.github.com/repos/nahalewski/A-X-M/releases";

export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  notes: string;
  url: string | null;
  assetUrl: string | null;
  assetName: string | null;
  checkedAt: string;
  error: string | null;
}

function parse(v: string): number[] {
  // "0.3.0-beta.1" -> [0, 3, 0, -1, 1]; a release without a suffix ranks above its betas.
  const m = v.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.?(\d+)?)?/i);
  if (!m) return [0];
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? -1 : 0, Number(m[5] ?? 0)];
}

function newer(a: string, b: string): boolean {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  const base: UpdateInfo = { current, latest: null, newer: false, notes: "", url: null, assetUrl: null, assetName: null, checkedAt: new Date().toISOString(), error: null };
  try {
    const res = await fetch(RELEASES + "?per_page=10", { headers: { "User-Agent": "A-X-M", Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ...base, error: `GitHub answered ${res.status}` };
    const list = (await res.json()) as { tag_name: string; html_url: string; body?: string; draft: boolean; assets: { name: string; browser_download_url: string }[] }[];
    const release = list.filter((r) => !r.draft).sort((a, b) => (newer(a.tag_name, b.tag_name) ? -1 : 1))[0];
    if (!release) return { ...base, error: "No releases published yet" };
    const latest = release.tag_name.replace(/^v/, "");
    const want = isWindows ? /Setup-.*\.exe$/i : /steamdeck.*\.AppImage$/i;
    const asset = release.assets.find((a) => want.test(a.name)) ?? null;
    return { ...base, latest, newer: newer(latest, current), notes: (release.body ?? "").slice(0, 1500), url: release.html_url, assetUrl: asset?.browser_download_url ?? null, assetName: asset?.name ?? null };
  } catch (err) {
    return { ...base, error: String((err as Error).message ?? err) };
  }
}

/** Fetches the release build into Downloads, reporting bytes; then opens it (the installer) on request. */
export async function downloadUpdate(assetUrl: string, assetName: string, onProgress: (done: number, total: number) => void): Promise<string> {
  const out = path.join(app.getPath("downloads"), assetName);
  const res = await fetch(assetUrl, { headers: { "User-Agent": "A-X-M" } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const ws = fs.createWriteStream(out);
  const reader = res.body.getReader();
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    if (value) {
      done += value.length;
      if (!ws.write(value)) await new Promise<void>((r) => ws.once("drain", () => r()));
      onProgress(done, total || done);
    }
  }
  await new Promise<void>((resolve, reject) => ws.end((e?: Error | null) => (e ? reject(e) : resolve())));
  if (!isWindows) fs.chmodSync(out, 0o755);
  return out;
}

export async function openUpdate(file: string): Promise<void> {
  await shell.openPath(file);
  // The installer takes over from here; the running copy should get out of its way.
  setTimeout(() => app.quit(), 1500);
}
