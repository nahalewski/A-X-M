import * as fs from "node:fs";
import * as path from "node:path";
import { loadSettings } from "./settingsStore";

/**
 * The ROOT drive: the one the menu shows for media, saves, textures, patches
 * and the NFC backups, with a fixed layout - GAME, MUSIC, PHOTO, VIDEO, SAVE,
 * TEXTURES, PATCHES, NFC (and the four toy brands under NFC). Every other drive
 * is kept out of the menu's lists; game folders elsewhere still scan.
 */

export const ROOT_FOLDERS = ["GAME", "MUSIC", "PHOTO", "VIDEO", "SAVE", "TEXTURES", "PATCHES", "NFC"] as const;
export const NFC_FOLDERS: Record<string, string> = { amiibo: "AMIIBO", skylanders: "SKYLANDERS", "disney-infinity": "DISNEY INFINITY", "lego-dimensions": "LEGO DIMENSIONS" };

/** "N:" when set and present, else null (every drive shows). */
export function rootDrive(): string | null {
  const d = (loadSettings().rootDrive || "").trim().toUpperCase();
  if (!/^[A-Z]:$/.test(d)) return null;
  return fs.existsSync(`${d}\\`) ? d : null;
}

export function isRootDrive(drive: string): boolean {
  const root = rootDrive();
  return !!root && drive.slice(0, 2).toUpperCase() === root;
}

/** A folder on ROOT, made if missing; null when there is no ROOT. */
export function rootFolder(...parts: string[]): string | null {
  const root = rootDrive();
  if (!root) return null;
  const dir = path.join(`${root}\\`, ...parts);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  return dir;
}

/** Lays the whole tree out, so a fresh drive reads right in every column. */
export function ensureRootLayout(): void {
  const root = rootDrive();
  if (!root) return;
  for (const f of ROOT_FOLDERS) rootFolder(f);
  for (const b of Object.values(NFC_FOLDERS)) rootFolder("NFC", b);
  rootFolder("SAVE", "PS");
  rootFolder("SAVE", "PS2");
  rootFolder("TEXTURES", "ps1");
  rootFolder("TEXTURES", "ps2");
}
