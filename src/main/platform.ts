import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * The few places the app touches the shape of the OS, in one file, so the Steam Deck
 * (SteamOS, Linux) build shares everything else with Windows.
 *
 * - Drive roots: Windows letters, or Linux mount points (/run/media/<user>/*, /media/*,
 *   /mnt/*) plus the home folder - the Deck mounts its SD card under /run/media.
 * - Steam's install folder: the registry on Windows; ~/.local/share/Steam or
 *   ~/.steam/steam on Linux (the Deck uses the former, with SD-card libraries added
 *   through libraryfolders.vdf like anywhere else).
 *
 * Things that are Windows-only by nature (PowerShell readouts, netsh Wi-Fi, WinRT
 * Bluetooth, XInput Guide polling, Xbox / Game Pass, the Anker bank) simply return
 * nothing on Linux; their rows say so.
 */

export const isWindows = process.platform === "win32";
export const isLinux = process.platform === "linux";

/** The Steam Deck identifies itself in DMI; useful for the About row and defaults. */
export function isSteamDeck(): boolean {
  if (!isLinux) return false;
  try {
    const product = fs.readFileSync("/sys/devices/virtual/dmi/id/product_name", "utf-8").trim();
    return /jupiter|galileo|steam deck/i.test(product);
  } catch {
    return false;
  }
}

/** Every top-level place a drive can be: "C:\\" style on Windows, mount points on Linux. */
export function listDriveRoots(): string[] {
  if (isWindows) {
    const drives: string[] = [];
    for (let c = 65; c <= 90; c++) {
      const root = `${String.fromCharCode(c)}:\\`;
      if (fs.existsSync(root)) drives.push(root);
    }
    return drives;
  }
  const roots = new Set<string>([os.homedir()]);
  for (const base of [path.join("/run/media", os.userInfo().username), "/run/media", "/media", "/mnt"]) {
    try {
      for (const name of fs.readdirSync(base)) {
        const full = path.join(base, name);
        try {
          if (fs.statSync(full).isDirectory()) roots.add(full);
        } catch {
          // unmounted or unreadable
        }
      }
    } catch {
      // base doesn't exist on this distro
    }
  }
  return [...roots];
}

/** A drive's short label for rows: "N:" on Windows, the mount's folder name on Linux. */
export function driveLabel(root: string): string {
  if (isWindows) return root.slice(0, 2).toUpperCase();
  return path.basename(root) || root;
}

/** Steam's install directory when it exists here. */
export function steamRootCandidates(): string[] {
  if (isWindows) return ["C:\\Program Files (x86)\\Steam"];
  const home = os.homedir();
  return [
    path.join(home, ".local", "share", "Steam"),
    path.join(home, ".steam", "steam"),
    path.join(home, ".steam", "root"),
    path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
  ];
}

/** The system drive, so copy targets and System Information can mark it. */
export function isSystemRoot(root: string): boolean {
  if (isWindows) return root.slice(0, 2).toUpperCase() === (process.env.SystemDrive ?? "C:").toUpperCase();
  return root === "/" || root === os.homedir();
}
