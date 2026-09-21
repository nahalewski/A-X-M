import { app } from "electron";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Finding where an emulator is installed and where it keeps its memory cards, on
 * someone else's machine rather than this one.
 *
 * A list of guessed paths is not good enough. The same program lands in Program
 * Files from one installer, in AppData\Local\Programs from another, under Scoop or
 * Chocolatey or WinGet from a package manager, or in a folder the user chose. So
 * this asks the system rather than guessing: the registry's uninstall entries and
 * App Paths first, which is where every real installer records itself, then the
 * usual roots, then PATH.
 *
 * The card folder is the same story. Both emulators can be told to keep cards
 * anywhere, and both write that choice into their own config, so the config is
 * read before any default is assumed. A portable install keeps everything beside
 * the executable and is checked first, or a stale folder from an older install
 * would win.
 */

export interface EmulatorSpec {
  id: string;
  /** Names the executable may have; the first one found wins. */
  executables: string[];
  /** Fragments that identify it in the registry's DisplayName. */
  registryNames: string[];
  /** Folder names it installs into, under the usual roots. */
  folderNames: string[];
  /** Its config file, relative to the data folder. */
  configFile: string;
  /** Section and key in that config holding the card directory. */
  configSection: string;
  configKey: string;
  /** Data folder names, tried under Documents and AppData. */
  dataNames: string[];
  /** Where cards sit inside the data folder when the config says nothing. */
  cardSubfolder: string;
}

export const DUCKSTATION: EmulatorSpec = {
  id: "duckstation",
  executables: ["duckstation-qt-x64-ReleaseLTCG.exe", "duckstation-qt.exe", "duckstation.exe", "DuckStation.exe"],
  registryNames: ["duckstation"],
  folderNames: ["DuckStation"],
  configFile: "settings.ini",
  configSection: "MemoryCards",
  configKey: "Directory",
  dataNames: ["DuckStation"],
  cardSubfolder: "memcards",
};

export const PCSX2: EmulatorSpec = {
  id: "pcsx2",
  executables: ["pcsx2-qt.exe", "pcsx2x64.exe", "pcsx2.exe", "PCSX2.exe"],
  registryNames: ["pcsx2"],
  folderNames: ["PCSX2"],
  configFile: "PCSX2.ini",
  configSection: "Folders",
  configKey: "MemoryCards",
  dataNames: ["PCSX2"],
  cardSubfolder: "memcards",
};

const HOME = os.homedir();

function documents(): string {
  try {
    return app.getPath("documents");
  } catch {
    return path.join(HOME, "Documents");
  }
}

function exists(p: string | null | undefined): p is string {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Every root an installer might have used. Package managers and per-user
 * installers are included because that is where a lot of these actually land -
 * this very machine had DuckStation under AppData\Local\Programs, which a
 * Program Files-only search misses entirely.
 */
function installRoots(): string[] {
  const roots = [
    process.env["ProgramFiles"] ?? "C:\\Program Files",
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    path.join(HOME, "AppData", "Local", "Programs"),
    path.join(HOME, "AppData", "Local"),
    path.join(HOME, "scoop", "apps"),
    "C:\\ProgramData\\chocolatey\\lib",
    path.join(HOME, "Desktop"),
    path.join(HOME, "Downloads"),
    "C:\\Emulators",
    "C:\\Games",
  ];
  // Linux and SteamOS, for the same binaries under their own names.
  if (process.platform !== "win32") {
    roots.push("/usr/bin", "/usr/local/bin", path.join(HOME, "Applications"), path.join(HOME, ".local", "bin"));
  }
  return roots.filter(Boolean);
}

function run(cmd: string, args: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    try {
      const child = spawn(cmd, args, { windowsHide: true });
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout?.on("data", (d) => (out += String(d)));
      child.on("error", () => {
        clearTimeout(timer);
        resolve("");
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(out);
      });
    } catch {
      resolve("");
    }
  });
}

/**
 * Asks Windows where the program is installed.
 *
 * Both hives and both bitness views are read, because a 32-bit installer on a
 * 64-bit machine records itself under WOW6432Node and would otherwise be missed.
 * App Paths is checked too: it maps an executable name straight to its full path
 * and is what the Run box uses.
 */
async function registryInstallPaths(spec: EmulatorSpec): Promise<string[]> {
  if (process.platform !== "win32") return [];

  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$out=@()",
    "$keys=@(",
    "'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
    "foreach ($k in $keys) {",
    "  Get-ItemProperty $k | Where-Object { $_.DisplayName -match '" + spec.registryNames.join("|") + "' } |",
    "    ForEach-Object { if ($_.InstallLocation) { $out += $_.InstallLocation } }",
    "}",
    "foreach ($exe in @('" + spec.executables.join("','") + "')) {",
    "  foreach ($h in @('HKLM','HKCU')) {",
    "    $p = Get-ItemProperty \"$($h):\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\$exe\"",
    "    if ($p -and $p.'(default)') { $out += (Split-Path $p.'(default)' -Parent) }",
    "  }",
    "}",
    "$out | Sort-Object -Unique",
  ].join("\n");

  const text = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^"|"$/g, ""))
    .filter((l) => l.length > 0);
}

/** The first of this emulator's executables inside a folder, if any. */
function executableIn(folder: string, spec: EmulatorSpec): string | null {
  for (const name of spec.executables) {
    const candidate = path.join(folder, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** Locates the executable: registry, then known roots, then PATH. */
export async function findInstall(spec: EmulatorSpec): Promise<string | null> {
  for (const folder of await registryInstallPaths(spec)) {
    const hit = executableIn(folder, spec);
    if (hit) return hit;
  }

  for (const root of installRoots()) {
    for (const name of spec.folderNames) {
      const folder = path.join(root, name);
      const hit = executableIn(folder, spec);
      if (hit) return hit;
      // Scoop and Chocolatey nest a version folder under the app name.
      try {
        for (const sub of fs.readdirSync(folder, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const nested = executableIn(path.join(folder, sub.name), spec);
          if (nested) return nested;
        }
      } catch {
        // Not a directory, or unreadable.
      }
    }
    // Some installers drop the executable straight into the root.
    const bare = executableIn(root, spec);
    if (bare) return bare;
  }

  // WinGet names its package folders after the publisher and a source hash, so
  // the folder is not called "DuckStation" and only a substring match finds it.
  const wingetPackages = path.join(HOME, "AppData", "Local", "Microsoft", "WinGet", "Packages");
  try {
    for (const entry of fs.readdirSync(wingetPackages, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const lower = entry.name.toLowerCase();
      if (!spec.folderNames.some((n) => lower.includes(n.toLowerCase()))) continue;
      const hit = executableIn(path.join(wingetPackages, entry.name), spec);
      if (hit) return hit;
    }
  } catch {
    // No WinGet on this machine.
  }

  // PATH last: a shim here may point at a copy already found above.
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const hit = executableIn(dir, spec);
    if (hit) return hit;
  }
  return null;
}

/** Reads one key out of an INI, tolerating comments and stray whitespace. */
function readIni(file: string, section: string, key: string): string | null {
  try {
    const text = fs.readFileSync(file, "utf-8");
    let inSection = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith(";") || line.startsWith("#")) continue;
      if (line.startsWith("[")) {
        inSection = line.slice(1, -1).trim().toLowerCase() === section.toLowerCase();
        continue;
      }
      if (!inSection) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      if (line.slice(0, eq).trim().toLowerCase() !== key.toLowerCase()) continue;
      const value = line.slice(eq + 1).trim().replace(/^"|"$/g, "");
      return value || null;
    }
  } catch {
    // No config yet, which is normal before the emulator's first run.
  }
  return null;
}

/** True when the install keeps its data beside the executable rather than in Documents. */
function isPortable(installPath: string | null): boolean {
  if (!installPath) return false;
  const beside = path.dirname(installPath);
  return exists(path.join(beside, "portable.txt")) || exists(path.join(beside, "portable.ini"));
}

/**
 * The folder the emulator will use if left alone: beside the executable for a
 * portable install, Documents otherwise.
 *
 * This is deliberately not "wherever the executable happens to be". A normal
 * install sits in Program Files, which the emulator never reads data from and
 * which needs administrator rights to write to - a card put there would be
 * invisible to the emulator and probably fail to write at all.
 */
function defaultDataRoot(spec: EmulatorSpec, installPath: string | null): string {
  if (isPortable(installPath) && installPath) return path.dirname(installPath);
  if (process.platform === "win32") return path.join(documents(), spec.dataNames[0]);
  return path.join(HOME, ".config", spec.dataNames[0].toLowerCase());
}

/** Data folders to try, most specific first. */
function dataRoots(spec: EmulatorSpec, installPath: string | null): string[] {
  const roots: string[] = [];
  // Only beside the executable when it actually says it is portable.
  if (isPortable(installPath) && installPath) roots.push(path.dirname(installPath));
  for (const name of spec.dataNames) {
    roots.push(path.join(documents(), name));
    roots.push(path.join(HOME, "AppData", "Roaming", name));
    roots.push(path.join(HOME, ".config", name.toLowerCase()));
    roots.push(path.join(HOME, ".local", "share", name.toLowerCase()));
  }
  roots.push(path.join(app.getPath("userData"), "emulators", spec.id));
  return roots;
}

export interface LocatedEmulator {
  id: string;
  installPath: string | null;
  dataPath: string | null;
  cardFolder: string | null;
  /** True when the folder came from the emulator's own config rather than a default. */
  cardFolderFromConfig: boolean;
  /** Where it would keep cards once run, whether or not that exists yet. */
  defaultCardFolder: string;
}

/**
 * Locates the install and its card folder.
 *
 * The config is consulted before any default, because both emulators let the card
 * directory be moved and a user who moved it would otherwise have cards written
 * somewhere their emulator never looks.
 */
export async function locate(spec: EmulatorSpec): Promise<LocatedEmulator> {
  const installPath = await findInstall(spec);
  const roots = dataRoots(spec, installPath);
  const dataPath = roots.find(exists) ?? null;

  let cardFolder: string | null = null;
  let fromConfig = false;

  for (const root of roots) {
    const config = path.join(root, spec.configFile);
    if (!exists(config)) continue;
    const configured = readIni(config, spec.configSection, spec.configKey);
    if (configured) {
      // The value may be relative to the data folder.
      const resolved = path.isAbsolute(configured) ? configured : path.join(root, configured);
      if (exists(resolved)) {
        cardFolder = resolved;
        fromConfig = true;
        break;
      }
    }
    const fallback = path.join(root, spec.cardSubfolder);
    if (exists(fallback)) {
      cardFolder = fallback;
      break;
    }
  }

  // No config yet: the default folder may still be sitting there from a first run.
  if (!cardFolder) {
    cardFolder = roots.map((r) => path.join(r, spec.cardSubfolder)).find(exists) ?? null;
  }

  return {
    id: spec.id,
    installPath,
    dataPath,
    cardFolder,
    cardFolderFromConfig: fromConfig,
    defaultCardFolder: path.join(defaultDataRoot(spec, installPath), spec.cardSubfolder),
  };
}

/**
 * The folder to write a card into, creating it if the emulator is installed but
 * has not been run yet.
 *
 * A brand new install has no folders at all, and making the one it is going to
 * make anyway is safe: it is the same path the emulator derives on first launch,
 * so a card put there is waiting in the slot list the first time it starts.
 */
export function ensureCardFolder(located: LocatedEmulator, _spec: EmulatorSpec): string | null {
  if (located.cardFolder) return located.cardFolder;
  try {
    fs.mkdirSync(located.defaultCardFolder, { recursive: true });
    return located.defaultCardFolder;
  } catch {
    return null;
  }
}
