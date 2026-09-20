import * as fs from "node:fs";
import { listDriveRoots, driveLabel, isSystemRoot } from "./platform";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";

/**
 * Folder-at-a-time browsing for the Photo and Video columns, rooted at the user's
 * own Pictures and Videos directories so the menu mirrors how Windows already
 * organises them (Screenshots, Camera Roll, and so on). Video is deliberately
 * limited to MP4 - it's the one container the in-app player is guaranteed to
 * decode, so nothing listed can turn out to be unplayable.
 */

export type BrowseKind = "photo" | "video";

const EXTENSIONS: Record<BrowseKind, string[]> = {
  photo: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"],
  video: [".mp4"],
};

const HOME_FOLDER: Record<BrowseKind, string> = { photo: "Pictures", video: "Videos" };

export interface BrowseEntry {
  kind: "folder" | "file";
  name: string;
  filePath: string;
  /** file:// URL, only for files, for the renderer's <img>/<video>. */
  url?: string;
}

export interface BrowseListing {
  kind: BrowseKind;
  path: string;
  /** Folder to go back up to, or null at the root. */
  parent: string | null;
  title: string;
  entries: BrowseEntry[];
}

export function mediaRoot(kind: BrowseKind): string {
  return path.join(os.homedir(), HOME_FOLDER[kind]);
}

/**
 * A drive with a PHOTO, VIDEO or GAME folder (or the plural) at its root is treated
 * as a media drive: each such folder is surfaced in the matching column. Anything without
 * them (or the Windows drive) is ignored, so a plain USB stick adds nothing.
 */
export interface MediaDrive {
  /** "D:" */
  drive: string;
  photo: string | null;
  video: string | null;
  game: string | null;
  music: string | null;
}

const DRIVE_FOLDERS = { photo: ["PHOTO", "PHOTOS"], video: ["VIDEO", "VIDEOS"], game: ["GAME", "GAMES"], music: ["MUSIC"] } as const;

export function listMediaDrives(): MediaDrive[] {
  const drives: MediaDrive[] = [];
  for (const root of listDriveRoots()) {
    if (isSystemRoot(root)) continue;
    // "N:" on Windows; the mount point itself on Linux (path.join copes with both).
    const drive = process.platform === "win32" ? root.slice(0, 2).toUpperCase() : root;
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    const upper = new Map(names.map((n) => [n.toUpperCase(), n]));
    const found = (key: keyof typeof DRIVE_FOLDERS): string | null => {
      const real = DRIVE_FOLDERS[key].map((n) => upper.get(n)).find(Boolean);
      if (!real) return null;
      const full = path.join(root, real);
      try {
        return fs.statSync(full).isDirectory() ? full : null;
      } catch {
        return null;
      }
    };
    const entry = { drive: process.platform === "win32" ? drive : driveLabel(root), photo: found("photo"), video: found("video"), game: found("game"), music: found("music") };
    if (entry.photo || entry.video || entry.game || entry.music) drives.push(entry);
  }
  return drives;
}

/**
 * Makes a folder, but only inside a drive's PHOTO / VIDEO / MUSIC tree - the one
 * place the menu is allowed to reshape. Returns the new path.
 */
export function createMediaFolder(parentDir: string, name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim();
  if (!clean || clean === "." || clean === "..") throw new Error("That name can't be used");
  const resolved = path.resolve(parentDir).toLowerCase();
  const allowed = listMediaDrives().some((d) =>
    [d.photo, d.video, d.music].some((root) => {
      if (!root) return false;
      const r = path.resolve(root).toLowerCase();
      return resolved === r || resolved.startsWith(r + path.sep);
    })
  );
  if (!allowed) throw new Error("Folders can only be made inside a drive's PHOTO, VIDEO or MUSIC folder");
  const full = path.join(parentDir, clean);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

/** The drive folder (if any) that a path sits under, for the given column. */
function driveRootOf(kind: BrowseKind, target: string): string | null {
  const resolved = path.resolve(target).toLowerCase();
  for (const d of listMediaDrives()) {
    const root = d[kind];
    if (!root) continue;
    const r = path.resolve(root).toLowerCase();
    if (resolved === r || resolved.startsWith(r + path.sep)) return root;
  }
  return null;
}

function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isUnderRoot(kind: BrowseKind, target: string): boolean {
  const root = path.resolve(mediaRoot(kind)).toLowerCase();
  const resolved = path.resolve(target).toLowerCase();
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function browseMedia(kind: BrowseKind, dirPath?: string | null): BrowseListing {
  const home = mediaRoot(kind);
  // Never browse outside the user's own media folder or a drive's PHOTO/VIDEO
  // folder, whatever comes over IPC.
  const driveRoot = dirPath ? driveRootOf(kind, dirPath) : null;
  const dir = dirPath && (driveRoot || isUnderRoot(kind, dirPath)) ? dirPath : home;
  const root = driveRoot ?? home;

  let dirents: fs.Dirent[] = [];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // missing or unreadable - an empty listing is the honest answer
  }

  const folders: BrowseEntry[] = [];
  const files: BrowseEntry[] = [];
  for (const entry of dirents) {
    if (entry.name.startsWith(".") || entry.name.toLowerCase() === "desktop.ini") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      folders.push({ kind: "folder", name: entry.name, filePath: full });
    } else if (EXTENSIONS[kind].includes(path.extname(entry.name).toLowerCase())) {
      files.push({
        kind: "file",
        name: path.basename(entry.name, path.extname(entry.name)),
        filePath: full,
        url: pathToFileURL(full).href,
      });
    }
  }
  folders.sort((a, b) => compareNatural(a.name, b.name));
  files.sort((a, b) => compareNatural(a.name, b.name));

  const atRoot = path.resolve(dir).toLowerCase() === path.resolve(root).toLowerCase();
  // Backing out of a drive's folder lands in the home listing, where its row lives.
  const parent = atRoot ? (driveRoot ? home : null) : path.dirname(dir);
  return {
    kind,
    path: dir,
    parent,
    title: atRoot ? driveRoot ?? HOME_FOLDER[kind] : path.basename(dir),
    entries: [...folders, ...files],
  };
}
