import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type MediaKind = "photo" | "video" | "music";

export interface MediaEntry {
  id: string;
  name: string;
  filePath: string;
}

const EXTENSIONS: Record<MediaKind, string[]> = {
  photo: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"],
  video: [".mp4", ".mkv", ".mov", ".avi", ".webm", ".wmv"],
  music: [".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac"],
};

const HOME_FOLDER: Record<MediaKind, string> = {
  photo: "Pictures",
  video: "Videos",
  music: "Music",
};

const DRIVE_FOLDER_NAMES: Record<MediaKind, string[]> = {
  photo: ["Photos", "Pictures"],
  video: ["Videos", "Movies"],
  music: ["Music"],
};

function listDrives(): string[] {
  const drives: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const root = `${letter}:\\`;
    if (fs.existsSync(root)) drives.push(root);
  }
  return drives;
}

function scanFolder(dir: string, extensions: string[], depth = 1): MediaEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: MediaEntry[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
      results.push({ id: Buffer.from(full).toString("base64url"), name: entry.name, filePath: full });
    } else if (entry.isDirectory() && depth > 0) {
      results.push(...scanFolder(full, extensions, depth - 1));
    }
  }
  return results;
}

export function scanMedia(kind: MediaKind): MediaEntry[] {
  const extensions = EXTENSIONS[kind];
  const roots = [path.join(os.homedir(), HOME_FOLDER[kind])];

  for (const drive of listDrives()) {
    for (const name of DRIVE_FOLDER_NAMES[kind]) {
      roots.push(path.join(drive, name));
    }
  }

  const seen = new Set<string>();
  const results: MediaEntry[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of scanFolder(root, extensions, 2)) {
      if (seen.has(entry.filePath)) continue;
      seen.add(entry.filePath);
      results.push(entry);
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}
