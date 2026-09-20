import * as fs from "node:fs";
import * as path from "node:path";
import { GameEntry } from "../types";

const IGNORE_EXE_PATTERN =
  /(^unins|setup|redist|vcredist|dxsetup|crashhandler|crashpad|easyanticheat|battleye|eossdk|ue4prereq|directx|dotnet|vc_redist|helper|updater|launcher-service|cef|report|dump|tool|convert|downloader|browser|_cia|pkg|unpack|extract|patch|update|quicksfv|sfv|cracktro|^arc\.exe$)/i;

/**
 * Subfolders that never hold the game itself: checksum sets, embedded installers,
 * group intros, redistributables, and anything dot-prefixed. An unpacked repack
 * archive is usually nothing but these, so skipping them is also what keeps
 * not-yet-installed downloads out of the list.
 */
const IGNORE_DIR_PATTERN = /^(\.|md5$|sfv$|_?commonredist$|redist|fairlight$|crack$|_?installer$|setup$|extras?$|soundtrack$|ost$|dlc$)/i;

const CANDIDATE_FOLDER_NAMES = ["Games", "Game", "GOG Games", "My Games"];

/**
 * Folders under a Games directory that hold console ROMs and emulator tooling
 * rather than PC games. The only executables in them are converters and
 * downloaders, which would otherwise be picked up as the "game".
 */
const ROM_PLATFORM_FOLDERS = new Set(
  [
    "psp", "ps vita", "vita", "ps1", "ps2", "ps3", "psx", "3ds", "nds", "ds", "switch", "wii", "wiiu", "wii u",
    "gamecube", "gc", "n64", "snes", "nes", "gba", "gb", "gbc", "xbox", "xbox 360", "roms", "emulators", "emulation",
    "bios", "saves", "tools",
  ].map((s) => s.toLowerCase())
);

/** Container folders that group PC games one level down, e.g. Games\PC\<Game>. */
const CONTAINER_FOLDERS = new Set(["pc", "windows", "installed", "steam", "epic", "gog"]);

function listDrives(): string[] {
  const drives: string[] = [];
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const root = `${letter}:\\`;
    if (fs.existsSync(root)) drives.push(root);
  }
  return drives;
}

function findMainExe(dir: string, depth = 2): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  const exeCandidates = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".exe"))
    .filter((e) => !IGNORE_EXE_PATTERN.test(e.name))
    .map((e) => path.join(dir, e.name));

  if (exeCandidates.length > 0) {
    // Prefer the largest exe - usually the real game binary vs small launcher stubs.
    let best = exeCandidates[0];
    let bestSize = 0;
    for (const c of exeCandidates) {
      try {
        const size = fs.statSync(c).size;
        if (size > bestSize) {
          bestSize = size;
          best = c;
        }
      } catch {
        // ignore
      }
    }
    return best;
  }

  if (depth > 0) {
    const subdirs = entries.filter((e) => e.isDirectory() && !IGNORE_DIR_PATTERN.test(e.name));
    for (const sub of subdirs) {
      const found = findMainExe(path.join(dir, sub.name), depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function scanRoot(rootDir: string, drive: string): GameEntry[] {
  let subdirs: fs.Dirent[];
  try {
    subdirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }

  const games: GameEntry[] = [];
  for (const sub of subdirs) {
    const key = sub.name.toLowerCase();
    if (ROM_PLATFORM_FOLDERS.has(key)) continue;

    const installDir = path.join(rootDir, sub.name);

    // Games\PC\<Game> - the container isn't a game itself; its children are.
    // Without this the whole folder shows up as one entry called "PC".
    if (CONTAINER_FOLDERS.has(key)) {
      games.push(...scanRoot(installDir, drive));
      continue;
    }

    const exe = findMainExe(installDir, 2);
    if (!exe) continue;
    games.push({
      id: `generic-${Buffer.from(exe).toString("base64url")}`,
      name: sub.name,
      source: "generic",
      launchType: "exe",
      launchTarget: exe,
      installDir,
      drive,
      losslessProfile: null,
      hidden: false,
    });
  }
  return games;
}

export function scanGenericGames(extraFolders: string[]): GameEntry[] {
  const games: GameEntry[] = [];
  const seen = new Set<string>();

  const roots: string[] = [...extraFolders];
  for (const drive of listDrives()) {
    for (const name of CANDIDATE_FOLDER_NAMES) {
      roots.push(path.join(drive, name));
    }
  }

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const drive = root.slice(0, 2).toUpperCase();
    for (const g of scanRoot(root, drive)) {
      if (seen.has(g.installDir)) continue;
      seen.add(g.installDir);
      games.push(g);
    }
  }
  return games;
}
