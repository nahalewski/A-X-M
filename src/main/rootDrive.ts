import * as fs from "node:fs";
import * as path from "node:path";
import { loadSettings } from "./settingsStore";

/**
 * The ROOT drive: the one the menu shows for media, saves, textures, patches
 * and the NFC backups, with a fixed layout - GAME, GAME-PC, MUSIC, PHOTO, VIDEO,
 * SAVE, TEXTURES, PATCHES, NFC (and the four toy brands under NFC).
 *
 * Only those folders are ever looked at. Anything else sitting on the drive -
 * PC-Emulator, a recycle bin, somebody's downloads - is ignored rather than
 * guessed about, so the columns show what the menu put there and nothing else.
 *
 * Every other drive is kept out of the menu's media and retro lists. PC games
 * installed across this machine's own drives are a separate matter and still
 * scan normally; this is about the retro library and media.
 */

export const ROOT_FOLDERS = ["GAME", "GAME-PC", "MUSIC", "PHOTO", "VIDEO", "SAVE", "TEXTURES", "PATCHES", "NFC", "BOOT"] as const;

/**
 * Where PC game images sit, and where they install to.
 *
 * PCISO holds the disc images themselves; GAME-PC is where Install Package
 * Files puts the installed game, kept apart from GAME so the console folders
 * stay a clean one-folder-per-platform layout.
 */
export const PC_ISO_FOLDER = "PCISO";
export const PC_INSTALL_FOLDER = "GAME-PC";
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
  rootFolder("GAME", PC_ISO_FOLDER);
  rootFolder("SAVE", "PS");
  rootFolder("SAVE", "PS2");
  rootFolder("TEXTURES", "ps1");
  rootFolder("TEXTURES", "ps2");
}
