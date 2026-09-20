import * as fs from "node:fs";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { isWindows } from "./platform";

/**
 * The System Settings the PS3 kept in its own menu, done from inside ours:
 * power (plans and timeouts, via powercfg), the clock (time zone and a resync via
 * w32tm), and the machine itself (shut down, restart, sleep). Plus a file stat for
 * the Information screen.
 */

export interface PowerPlan {
  guid: string;
  name: string;
  active: boolean;
}

export interface PowerSettings {
  plans: PowerPlan[];
  /** Minutes before the screen turns off on battery / plugged in; 0 = never. */
  screenOffBattery: number;
  screenOffPlugged: number;
  sleepBattery: number;
  sleepPlugged: number;
}

export interface ClockInfo {
  now: string;
  timeZone: string;
  timeZoneOffsetMin: number;
  /** Windows' own automatic-time setting, read from the registry. */
  autoTime: boolean | null;
}

export interface FileInfo {
  sizeBytes: number;
  modified: string;
  created: string;
  exists: boolean;
}

function run(cmd: string, args: string[], timeout = 15_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf-8", timeout, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout ?? "") + (stderr ?? "") }));
  });
}

// ---- Power ------------------------------------------------------------------------

async function timeoutValue(subgroup: string, setting: string): Promise<{ ac: number; dc: number }> {
  const res = await run("powercfg", ["/query", "SCHEME_CURRENT", subgroup, setting]);
  const ac = res.out.match(/Current AC Power Setting Index:\s*0x([0-9a-f]+)/i);
  const dc = res.out.match(/Current DC Power Setting Index:\s*0x([0-9a-f]+)/i);
  return { ac: ac ? Math.round(parseInt(ac[1], 16) / 60) : 0, dc: dc ? Math.round(parseInt(dc[1], 16) / 60) : 0 };
}

export async function getPowerSettings(): Promise<PowerSettings> {
  if (!isWindows) return { plans: [], screenOffBattery: 0, screenOffPlugged: 0, sleepBattery: 0, sleepPlugged: 0 };
  const list = await run("powercfg", ["/list"]);
  const plans: PowerPlan[] = [];
  for (const m of list.out.matchAll(/GUID:\s*([0-9a-f-]+)\s+\((.+?)\)\s*(\*)?/gi)) {
    plans.push({ guid: m[1], name: m[2].trim(), active: !!m[3] });
  }
  const [screen, sleep] = await Promise.all([timeoutValue("SUB_VIDEO", "VIDEOIDLE"), timeoutValue("SUB_SLEEP", "STANDBYIDLE")]);
  return { plans, screenOffBattery: screen.dc, screenOffPlugged: screen.ac, sleepBattery: sleep.dc, sleepPlugged: sleep.ac };
}

export async function setPowerPlan(guid: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(guid)) return false;
  return (await run("powercfg", ["/setactive", guid])).ok;
}

/** Minutes, 0 = never. `what` picks screen or sleep; `onBattery` picks DC or AC. */
export async function setPowerTimeout(what: "screen" | "sleep", onBattery: boolean, minutes: number): Promise<boolean> {
  const key = what === "screen" ? (onBattery ? "monitor-timeout-dc" : "monitor-timeout-ac") : onBattery ? "standby-timeout-dc" : "standby-timeout-ac";
  return (await run("powercfg", ["/change", key, String(Math.max(0, Math.round(minutes)))])).ok;
}

export async function powerAction(action: "shutdown" | "restart" | "sleep"): Promise<boolean> {
  if (isWindows) {
    if (action === "sleep") return (await run("rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"])).ok;
    return (await run("shutdown", [action === "shutdown" ? "/s" : "/r", "/t", "0"])).ok;
  }
  if (action === "sleep") return (await run("systemctl", ["suspend"])).ok;
  return (await run("systemctl", [action === "shutdown" ? "poweroff" : "reboot"])).ok;
}

// ---- Clock ------------------------------------------------------------------------

export async function getClock(): Promise<ClockInfo> {
  const now = new Date();
  let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let autoTime: boolean | null = null;
  if (isWindows) {
    const tz = await run("tzutil", ["/g"]);
    if (tz.ok && tz.out.trim()) timeZone = tz.out.trim();
    const reg = await run("reg", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\Parameters", "/v", "Type"]);
    const type = reg.out.match(/Type\s+REG_SZ\s+(\w+)/i)?.[1];
    if (type) autoTime = type.toUpperCase() !== "NOSYNC";
  }
  return { now: now.toISOString(), timeZone, timeZoneOffsetMin: -now.getTimezoneOffset(), autoTime };
}

/** Asks Windows' time service for a resync. Needs an elevated shell on most PCs; reports honestly. */
export async function syncClock(): Promise<{ ok: boolean; message: string }> {
  if (!isWindows) return { ok: false, message: "Use the system's own time settings on this OS" };
  const res = await run("w32tm", ["/resync"], 30_000);
  if (res.ok && /completed successfully/i.test(res.out)) return { ok: true, message: "Clock synced with the time server" };
  if (/access is denied|0x80070005/i.test(res.out)) return { ok: false, message: "Windows needs administrator rights for a manual resync - it still syncs on its own schedule" };
  return { ok: false, message: res.out.trim().split(/\r?\n/).filter(Boolean).pop() ?? "Sync failed" };
}

export async function listTimeZones(): Promise<string[]> {
  if (!isWindows) return [Intl.DateTimeFormat().resolvedOptions().timeZone];
  const res = await run("tzutil", ["/l"], 20_000);
  // tzutil prints "display name\nid\n\n" groups; the ids are what /s wants.
  const lines = res.out.split(/\r?\n/);
  const ids: string[] = [];
  for (let i = 1; i < lines.length; i++) if (lines[i - 1].trim() && lines[i].trim() && !lines[i].startsWith("(")) ids.push(lines[i].trim());
  return [...new Set(ids)];
}

export async function setTimeZone(id: string): Promise<boolean> {
  if (!isWindows) return false;
  return (await run("tzutil", ["/s", id])).ok;
}

// ---- Files and identity -----------------------------------------------------------

export function fileInfo(filePath: string): FileInfo {
  try {
    const st = fs.statSync(filePath);
    let size = st.size;
    if (st.isDirectory()) {
      // One level is enough for an album or a game folder's headline size.
      size = 0;
      for (const name of fs.readdirSync(filePath)) {
        try {
          size += fs.statSync(`${filePath}${filePath.endsWith("\\") || filePath.endsWith("/") ? "" : os.platform() === "win32" ? "\\" : "/"}${name}`).size;
        } catch {
          // unreadable child
        }
      }
    }
    return { sizeBytes: size, modified: st.mtime.toISOString(), created: st.birthtime.toISOString(), exists: true };
  } catch {
    return { sizeBytes: 0, modified: "", created: "", exists: false };
  }
}

export function hostName(): string {
  return os.hostname();
}
