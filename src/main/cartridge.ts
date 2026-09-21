import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { RETRO_PLATFORMS, RETRO_FOLDER_NAMES } from "./scanners/retroScanner";
import { RetroPlatform } from "./types";

/**
 * The "cartridge": a drive plugged in through the Sabrent SATA adapter. It shows
 * in Game and Retro with a cartridge icon while it's connected, holding whatever
 * games are on it - GAME\ROMS\<platform> or GAMES\<platform> for the consoles,
 * and any launcher-free games found in GAME or GAMES.
 *
 * Detection is the physical disk's model / PNP id through WMI (the adapter
 * presents the disk as "SABRENT SCSI Disk Device"), joined to its drive letters.
 * Looked up every half minute at most; the menu asks whenever it lists volumes.
 */

const isWindows = process.platform === "win32";
const REFRESH_MS = 30_000;

let cached: string[] = [];
let checkedAt = 0;
let pending: Promise<string[]> | null = null;

/** Drive letters ("N:") whose disk sits behind the Sabrent adapter. */
export function cartridgeDrives(): Promise<string[]> {
  if (!isWindows) return Promise.resolve([]);
  if (Date.now() - checkedAt < REFRESH_MS) return Promise.resolve(cached);
  if (pending) return pending;
  const script =
    "$out = @(); foreach ($d in (Get-CimInstance Win32_DiskDrive | Where-Object { ($_.Model + ' ' + $_.PNPDeviceID) -match 'SABRENT' })) {" +
    " foreach ($p in (Get-CimInstance -Query \"ASSOCIATORS OF {Win32_DiskDrive.DeviceID='$($d.DeviceID)'} WHERE AssocClass=Win32_DiskDriveToDiskPartition\")) {" +
    " foreach ($l in (Get-CimInstance -Query \"ASSOCIATORS OF {Win32_DiskPartition.DeviceID='$($p.DeviceID)'} WHERE AssocClass=Win32_LogicalDiskToPartition\")) { $out += $l.DeviceID } } }; $out -join ','";
  pending = new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 20_000 }, (err, stdout) => {
      pending = null;
      checkedAt = Date.now();
      if (!err) cached = String(stdout).trim().split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]:$/.test(s));
      resolve(cached);
    });
  });
  return pending;
}

/** The last answer, without asking again - for scans that mustn't wait. */
export function cartridgeDrivesNow(): string[] {
  void cartridgeDrives();
  return cached;
}

/** Console folders on the cartridge, per platform, for the retro scanner. */
export function cartridgeRetroFolders(drives: string[]): Partial<Record<RetroPlatform, string[]>> {
  const out: Partial<Record<RetroPlatform, string[]>> = {};
  for (const drive of drives) {
    for (const platform of RETRO_PLATFORMS) {
      for (const base of ["GAME\\ROMS", "GAMES", "ROMS"]) {
        const dir = path.join(`${drive}\\`, base, RETRO_FOLDER_NAMES[platform]);
        if (fs.existsSync(dir)) (out[platform] ??= []).push(dir);
      }
    }
  }
  return out;
}

/** Plain game folders on the cartridge, for the generic scanner. */
export function cartridgeGameFolders(drives: string[]): string[] {
  const out: string[] = [];
  for (const drive of drives) {
    for (const base of ["GAME", "GAMES"]) {
      const dir = path.join(`${drive}\\`, base);
      if (fs.existsSync(dir)) out.push(dir);
    }
  }
  return out;
}
