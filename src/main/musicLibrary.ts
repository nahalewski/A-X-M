import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import { loadSettings } from "./settingsStore";

/**
 * Lazy, folder-at-a-time browsing of the music library, so the menu mirrors however
 * the files are actually laid out on disk (artist / album / tracks) instead of
 * flattening potentially tens of thousands of files up front.
 */

const AUDIO_EXTENSIONS = [".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".wma", ".opus"];

export interface MusicEntry {
  kind: "folder" | "track";
  name: string;
  /** Absolute path on disk - used as the id and for descending into folders. */
  filePath: string;
  /** file:// URL, only for tracks, for the renderer's audio element. */
  url?: string;
}

export interface MusicListing {
  /** The folder being listed, or null when showing the configured roots. */
  path: string | null;
  /** Parent folder to go back up to, or null if already at the top. */
  parent: string | null;
  title: string;
  entries: MusicEntry[];
}

function listDrives(): string[] {
  const drives: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    if (fs.existsSync(root)) drives.push(root);
  }
  return drives;
}

/** Configured roots if set, otherwise the usual Windows music locations. */
export function getMusicRoots(): string[] {
  const configured = loadSettings().musicFolders;
  if (configured.length > 0) return configured.filter((p) => fs.existsSync(p));

  const roots = [path.join(os.homedir(), "Music")];
  for (const drive of listDrives()) roots.push(path.join(drive, "Music"), path.join(drive, "MUSIC"));
  return roots.filter((p) => fs.existsSync(p));
}

/** Natural sort so "2 - x" comes before "10 - y". */
function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isUnderRoots(target: string): boolean {
  const resolved = path.resolve(target).toLowerCase();
  return getMusicRoots().some((root) => {
    const r = path.resolve(root).toLowerCase();
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}

export function browseMusic(dirPath?: string | null): MusicListing {
  const roots = getMusicRoots();

  // Top level: a single root browses straight into it, several are listed as folders.
  if (!dirPath) {
    if (roots.length === 1) return browseMusic(roots[0]);
    return {
      path: null,
      parent: null,
      title: "Music",
      entries: roots.map((root) => ({
        kind: "folder" as const,
        name: path.basename(root) || root,
        filePath: root,
      })),
    };
  }

  // Never browse outside the configured roots, whatever path comes back over IPC.
  if (!isUnderRoots(dirPath)) return browseMusic(null);

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return browseMusic(null);
  }

  const folders: MusicEntry[] = [];
  const tracks: MusicEntry[] = [];
  for (const entry of dirents) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      folders.push({ kind: "folder", name: entry.name, filePath: full });
    } else if (AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      tracks.push({
        kind: "track",
        name: path.basename(entry.name, path.extname(entry.name)),
        filePath: full,
        url: pathToFileURL(full).href,
      });
    }
  }

  folders.sort((a, b) => compareNatural(a.name, b.name));
  tracks.sort((a, b) => compareNatural(a.name, b.name));

  const isRoot = roots.some((r) => path.resolve(r).toLowerCase() === path.resolve(dirPath).toLowerCase());
  const parent = isRoot ? (roots.length > 1 ? null : null) : path.dirname(dirPath);

  return {
    path: dirPath,
    parent,
    title: path.basename(dirPath) || dirPath,
    entries: [...folders, ...tracks],
  };
}
