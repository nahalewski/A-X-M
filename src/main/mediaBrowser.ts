import * as fs from "node:fs";
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

function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isUnderRoot(kind: BrowseKind, target: string): boolean {
  const root = path.resolve(mediaRoot(kind)).toLowerCase();
  const resolved = path.resolve(target).toLowerCase();
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function browseMedia(kind: BrowseKind, dirPath?: string | null): BrowseListing {
  const root = mediaRoot(kind);
  // Never browse outside the user's own media folder, whatever comes over IPC.
  const dir = dirPath && isUnderRoot(kind, dirPath) ? dirPath : root;

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
  return {
    kind,
    path: dir,
    parent: atRoot ? null : path.dirname(dir),
    title: atRoot ? HOME_FOLDER[kind] : path.basename(dir),
    entries: [...folders, ...files],
  };
}
