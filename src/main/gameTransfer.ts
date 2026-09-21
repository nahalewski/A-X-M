import { BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { GameEntry } from "./types";
import { TransferProgress } from "./storage";

/**
 * Moving a PC game between this machine and the cartridge, and uninstalling it.
 *
 * Two things make this more than a file copy. The first is space: a modern game
 * is tens of gigabytes and finding out halfway that the target is full leaves a
 * useless half-copy, so the size is measured and checked before anything is
 * written. The second is the launcher. Steam, Epic and the rest keep their own
 * record of where a game lives, and a game moved behind their back looks
 * uninstalled - so the move is only offered where that record can be updated,
 * and the update happens as part of the move.
 *
 * Nothing is deleted until the copy has been verified. A move is a copy, then a
 * check that the copy is whole, then the delete - in that order, so an
 * interrupted move costs disk space rather than the game.
 */

export type Launcher = "steam" | "epic" | "gog" | "ubisoft" | "ea" | "amazon" | "xbox" | "other";

export const LAUNCHER_NAMES: Record<Launcher, string> = {
  steam: "Steam",
  epic: "Epic Games",
  gog: "GOG Galaxy",
  ubisoft: "Ubisoft Connect",
  ea: "EA app",
  amazon: "Amazon Games",
  xbox: "Xbox",
  other: "this PC",
};

const BS = String.fromCharCode(92);

function send(progress: TransferProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("axm:transfer", progress);
  }
}

function freeBytes(dir: string): Promise<number | null> {
  return new Promise((resolve) => {
    fs.statfs(dir, (err, stats) => {
      if (err) return resolve(null);
      resolve(stats.bavail * stats.bsize);
    });
  });
}

/** Total size of a folder tree, and how many files are in it. */
function measure(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size;
          files++;
        } catch {
          // Locked or vanished; not counted.
        }
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

// ---------------------------------------------------------------- launcher --

/** Which launcher owns a game, from its id and then from where it sits. */
export function detectLauncher(game: GameEntry): Launcher {
  if (game.source === "steam") return "steam";
  if (game.source === "epic") return "epic";
  if (game.source === "xbox") return "xbox";

  const dir = (game.installDir || "").toLowerCase();
  if (dir.includes(`${BS}gog galaxy${BS}`) || dir.includes(`${BS}gog games${BS}`)) return "gog";
  if (dir.includes("ubisoft")) return "ubisoft";
  if (dir.includes(`${BS}ea games${BS}`) || dir.includes("electronic arts") || dir.includes(`${BS}ea${BS}`)) return "ea";
  if (dir.includes("amazon game")) return "amazon";
  if (dir.includes(`${BS}steamapps${BS}`)) return "steam";
  return "other";
}

/** The Steam app id, recoverable from the entry's id or launch URL. */
function steamAppId(game: GameEntry): string | null {
  return game.id.match(/^steam-(\d+)$/)?.[1] ?? game.launchTarget.match(/rungameid\/(\d+)/)?.[1] ?? null;
}

/** The Epic app name, which its manifests key on. */
function epicAppName(game: GameEntry): string | null {
  return game.id.match(/^epic-(.+)$/)?.[1] ?? null;
}

// -------------------------------------------------------------------- plan --

export interface TransferPlan {
  ok: boolean;
  /** Why the transfer cannot be offered, when it cannot. */
  reason?: string;
  sizeBytes: number;
  files: number;
  freeBytes: number | null;
  launcher: Launcher;
  /** True when the launcher's own record can be updated to match. */
  registers: boolean;
  /** Warning to show even though the transfer is allowed. */
  note?: string;
  targetDir: string;
}

/**
 * Works out whether a game can be moved or copied to `targetDrive`, and what it
 * would cost.
 *
 * This is deliberately consulted before the menu offers the action, so an
 * impossible transfer is never presented as a choice the user can make.
 */
export async function planTransfer(game: GameEntry, targetDrive: string): Promise<TransferPlan> {
  const launcher = detectLauncher(game);
  const blank: TransferPlan = { ok: false, sizeBytes: 0, files: 0, freeBytes: null, launcher, registers: false, targetDir: "" };

  if (!game.installDir || !fs.existsSync(game.installDir)) {
    return { ...blank, reason: "Its install folder could not be found" };
  }

  // Microsoft Store games live under WindowsApps, which is ACL-locked: the files
  // cannot be read, let alone moved, and Windows has its own mover for them.
  if (launcher === "xbox") {
    return { ...blank, reason: "Xbox and Microsoft Store games have to be moved from Windows' own Apps settings" };
  }

  const drive = targetDrive.slice(0, 2).toUpperCase();
  if ((game.drive || "").slice(0, 2).toUpperCase() === drive) {
    return { ...blank, reason: "It is already on that drive" };
  }

  const { bytes, files } = measure(game.installDir);
  const targetDir = path.join(`${drive}${BS}`, "GAME", path.basename(game.installDir));

  let free: number | null = null;
  try {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    free = await freeBytes(path.dirname(targetDir));
  } catch {
    return { ...blank, sizeBytes: bytes, files, reason: `${drive} could not be written to` };
  }

  // A little headroom, since the figure moves while a copy is running.
  const headroom = 256 * 1024 * 1024;
  if (free !== null && free < bytes + headroom) {
    return {
      ...blank,
      sizeBytes: bytes,
      files,
      freeBytes: free,
      targetDir,
      reason: `Not enough room on ${drive} - it needs ${gb(bytes)} and has ${gb(free)} free`,
    };
  }

  const registers = launcher === "steam" || launcher === "epic";
  const note = registers
    ? undefined
    : `${LAUNCHER_NAMES[launcher]} cannot be told about the new location automatically, so it may need repairing or re-pointing there afterwards.`;

  return { ok: true, sizeBytes: bytes, files, freeBytes: free, launcher, registers, note, targetDir };
}

function gb(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

// ---------------------------------------------------------------- transfer --

/** Copies a tree, reporting progress as it goes. Returns bytes written. */
async function copyTree(from: string, to: string, id: string, label: string, total: number): Promise<number> {
  let done = 0;
  const copyDir = async (src: string, dst: string): Promise<void> => {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        await copyDir(s, d);
        continue;
      }
      if (!entry.isFile()) continue;
      await new Promise<void>((resolve, reject) => {
        const rs = fs.createReadStream(s);
        const ws = fs.createWriteStream(d);
        rs.on("data", (chunk: Buffer | string) => {
          done += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
          send({ id, name: label, destination: to, done, total, finished: false });
        });
        rs.on("error", reject);
        ws.on("error", reject);
        ws.on("close", () => resolve());
        rs.pipe(ws);
      });
    }
  };
  await copyDir(from, to);
  return done;
}

/**
 * Checks a copy is whole before the original is removed.
 *
 * Compares the file count and total size rather than hashing every byte: on a
 * forty-gigabyte game a full hash would double the time, and a truncated or
 * missing file - which is what actually goes wrong - changes both of these.
 */
function verify(from: string, to: string): { ok: boolean; message: string } {
  const a = measure(from);
  const b = measure(to);
  if (a.files !== b.files) return { ok: false, message: `the copy has ${b.files} files but the original has ${a.files}` };
  if (a.bytes !== b.bytes) return { ok: false, message: `the copy is ${gb(b.bytes)} but the original is ${gb(a.bytes)}` };
  return { ok: true, message: "" };
}

export interface TransferResult {
  ok: boolean;
  message: string;
  newPath?: string;
}

/**
 * Moves or copies a game, then tells its launcher where it went.
 *
 * The order matters on a move: copy, verify, register, and only then delete the
 * original. An interrupted move therefore costs disk space, never the game.
 */
export async function transferGame(game: GameEntry, targetDrive: string, mode: "move" | "copy"): Promise<TransferResult> {
  const plan = await planTransfer(game, targetDrive);
  if (!plan.ok) return { ok: false, message: plan.reason ?? "That transfer is not possible" };

  const id = `game-${mode}-${game.id}`;
  const label = game.name;
  const from = game.installDir;
  const to = plan.targetDir;

  if (fs.existsSync(to)) {
    return { ok: false, message: `${path.basename(to)} is already there. Remove it first, or the two would be merged.` };
  }

  send({ id, name: label, destination: to, done: 0, total: plan.sizeBytes, finished: false });

  try {
    await copyTree(from, to, id, label, plan.sizeBytes);
  } catch (err) {
    send({ id, name: label, destination: to, done: 0, total: plan.sizeBytes, finished: true, error: String(err) });
    return { ok: false, message: `The copy failed: ${(err as Error).message}. Anything written is in ${to}.` };
  }

  const check = verify(from, to);
  if (!check.ok) {
    send({ id, name: label, destination: to, done: plan.sizeBytes, total: plan.sizeBytes, finished: true, error: check.message });
    return { ok: false, message: `The copy did not come out whole - ${check.message}. The original has been left alone.` };
  }

  // Tell the launcher before removing the original, so a failure here still
  // leaves a working install behind.
  let registered = "";
  if (mode === "move" && plan.registers) {
    const reg = await registerMove(game, to);
    registered = reg.message;
    if (!reg.ok) {
      send({ id, name: label, destination: to, done: plan.sizeBytes, total: plan.sizeBytes, finished: true, error: reg.message });
      return { ok: false, message: `Copied, but ${LAUNCHER_NAMES[plan.launcher]} could not be updated: ${reg.message}. The original is still in place.` };
    }
  }

  if (mode === "move") {
    try {
      fs.rmSync(from, { recursive: true, force: true });
    } catch (err) {
      send({ id, name: label, destination: to, done: plan.sizeBytes, total: plan.sizeBytes, finished: true });
      return { ok: true, newPath: to, message: `Moved to ${to}, but the old copy could not be deleted: ${(err as Error).message}` };
    }
  }

  send({ id, name: label, destination: to, done: plan.sizeBytes, total: plan.sizeBytes, finished: true });
  const what = mode === "move" ? "Moved" : "Copied";
  const tail = registered ? ` ${registered}` : plan.note ? ` ${plan.note}` : "";
  return { ok: true, newPath: to, message: `${what} ${game.name} to ${to}.${tail}` };
}

// ---------------------------------------------------------- registration --

/**
 * Points the launcher at the game's new home.
 *
 * Only Steam and Epic are done automatically, because those two keep their
 * records in files with a documented shape that can be edited safely. The
 * others keep theirs in registry keys or SQLite databases that differ between
 * versions, and a wrong guess there breaks the launcher's whole library rather
 * than one game - so those are reported as needing a repair instead.
 */
async function registerMove(game: GameEntry, newDir: string): Promise<{ ok: boolean; message: string }> {
  const launcher = detectLauncher(game);
  if (launcher === "steam") return registerSteamMove(game, newDir);
  if (launcher === "epic") return registerEpicMove(game, newDir);
  return { ok: true, message: "" };
}

/**
 * Steam: add the drive as a library, and move the game's manifest into it.
 *
 * Steam decides where a game is from the appmanifest sitting in a steamapps
 * folder it knows about, so both halves are needed - the library entry, and the
 * manifest beside the game.
 */
async function registerSteamMove(game: GameEntry, newDir: string): Promise<{ ok: boolean; message: string }> {
  const appId = steamAppId(game);
  if (!appId) return { ok: false, message: "its Steam app id could not be worked out" };

  const oldSteamapps = findSteamappsAbove(game.installDir);
  if (!oldSteamapps) return { ok: false, message: "its current Steam library could not be found" };

  const manifest = path.join(oldSteamapps, `appmanifest_${appId}.acf`);
  if (!fs.existsSync(manifest)) return { ok: false, message: `appmanifest_${appId}.acf was not there` };

  // Steam expects <library>\steamapps\common\<game>; the copy went to GAME\<game>,
  // so it is placed where Steam will look for it.
  const libraryRoot = path.join(path.parse(newDir).root, "SteamLibrary");
  const common = path.join(libraryRoot, "steamapps", "common");
  const finalDir = path.join(common, path.basename(newDir));

  try {
    fs.mkdirSync(common, { recursive: true });
    if (fs.existsSync(finalDir)) return { ok: false, message: `${finalDir} already exists` };
    fs.renameSync(newDir, finalDir);
    fs.copyFileSync(manifest, path.join(libraryRoot, "steamapps", path.basename(manifest)));
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }

  const added = addSteamLibraryFolder(libraryRoot);
  if (!added.ok) return added;

  try {
    fs.rmSync(manifest, { force: true });
  } catch {
    // Leaving the old manifest would make Steam think it is in both places, but
    // it is not worth failing the move over; Steam drops it on next validate.
  }
  return { ok: true, message: `Steam now has it in ${finalDir}. Restart Steam so it re-reads its libraries.` };
}

/** The steamapps folder a game sits under, walking up from its install dir. */
function findSteamappsAbove(dir: string): string | null {
  let current = dir;
  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (path.basename(parent).toLowerCase() === "steamapps") return parent;
    current = parent;
  }
  return null;
}

/**
 * Adds a library folder to libraryfolders.vdf.
 *
 * The file is a Valve key-values document. A new entry is appended with the
 * next free numeric key rather than the whole file being rewritten, so
 * everything Steam keeps in there - sizes, per-app records - is left untouched.
 */
function addSteamLibraryFolder(libraryRoot: string): { ok: boolean; message: string } {
  const steam = steamInstallPath();
  if (!steam) return { ok: false, message: "Steam's own folder could not be found" };

  const vdf = path.join(steam, "steamapps", "libraryfolders.vdf");
  let text: string;
  try {
    text = fs.readFileSync(vdf, "utf-8");
  } catch {
    return { ok: false, message: "libraryfolders.vdf could not be read" };
  }

  const escaped = libraryRoot.split(BS).join(BS + BS);
  if (text.includes(escaped) || text.includes(libraryRoot)) return { ok: true, message: "" };

  const keys = [...text.matchAll(/^\s*"(\d+)"/gm)].map((m) => Number(m[1]));
  const next = keys.length ? Math.max(...keys) + 1 : 0;

  const entry = [
    ``,
    `\t"${next}"`,
    `\t{`,
    `\t\t"path"\t\t"${escaped}"`,
    `\t\t"label"\t\t""`,
    `\t\t"contentid"\t\t"0"`,
    `\t\t"totalsize"\t\t"0"`,
    `\t\t"update_clean_bytes_tally"\t\t"0"`,
    `\t\t"time_last_update_corruption"\t\t"0"`,
    `\t\t"apps"`,
    `\t\t{`,
    `\t\t}`,
    `\t}`,
  ].join("\n");

  const lastBrace = text.lastIndexOf("}");
  if (lastBrace < 0) return { ok: false, message: "libraryfolders.vdf is not in the expected shape" };

  try {
    fs.copyFileSync(vdf, `${vdf}.axm-backup`);
    fs.writeFileSync(vdf, text.slice(0, lastBrace) + entry + "\n" + text.slice(lastBrace));
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  return { ok: true, message: "" };
}

function steamInstallPath(): string | null {
  const candidates = [
    path.join(process.env["ProgramFiles(x86)"] ?? "C:" + BS + "Program Files (x86)", "Steam"),
    path.join(process.env["ProgramFiles"] ?? "C:" + BS + "Program Files", "Steam"),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, "steamapps"))) ?? null;
}

/**
 * Epic: rewrite the game's manifest so the launcher looks in the new place.
 *
 * Epic keeps one JSON file per installed game under ProgramData, and reads the
 * install location straight out of it, so this is a contained edit. A backup is
 * written first because a malformed manifest makes the game disappear from the
 * launcher entirely.
 */
function registerEpicMove(game: GameEntry, newDir: string): { ok: boolean; message: string } {
  const appName = epicAppName(game);
  if (!appName) return { ok: false, message: "its Epic app name could not be worked out" };

  const manifestDir = path.join(process.env["ProgramData"] ?? "C:" + BS + "ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
  let files: string[];
  try {
    files = fs.readdirSync(manifestDir).filter((f) => f.toLowerCase().endsWith(".item"));
  } catch {
    return { ok: false, message: "the Epic manifests folder could not be read" };
  }

  for (const file of files) {
    const full = path.join(manifestDir, file);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (data["AppName"] !== appName) continue;

    try {
      fs.copyFileSync(full, `${full}.axm-backup`);
      data["InstallLocation"] = newDir;
      data["ManifestLocation"] = path.join(newDir, ".egstore");
      data["StagingLocation"] = path.join(newDir, ".egstore", "bps");
      fs.writeFileSync(full, JSON.stringify(data, null, 4));
      return { ok: true, message: "Epic now has it in the new location. Restart the launcher so it re-reads its manifests." };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }
  return { ok: false, message: `no Epic manifest for ${appName} was found` };
}

// --------------------------------------------------------------- uninstall --

/**
 * Hands a game to its launcher's own uninstaller.
 *
 * Nothing is deleted here. Every one of these launchers keeps a record of what
 * is installed, and deleting the files from underneath leaves the game showing
 * as installed and broken, so the launcher is asked to do it and it removes its
 * own record as part of that. Where there is no launcher, the program's own
 * entry in Windows' uninstall list is used, which is the same thing Add or
 * Remove Programs would run.
 */
export async function uninstallGame(game: GameEntry): Promise<TransferResult> {
  const launcher = detectLauncher(game);

  switch (launcher) {
    case "steam": {
      const appId = steamAppId(game);
      if (!appId) return { ok: false, message: "Its Steam app id could not be worked out" };
      await shell.openExternal(`steam://uninstall/${appId}`);
      return { ok: true, message: `Steam has been asked to uninstall ${game.name}. Confirm it in Steam.` };
    }
    case "epic": {
      const appName = epicAppName(game);
      if (!appName) return { ok: false, message: "Its Epic app name could not be worked out" };
      await shell.openExternal(`com.epicgames.launcher://apps/${appName}?action=uninstall`);
      return { ok: true, message: `Epic has been asked to uninstall ${game.name}. Confirm it in the launcher.` };
    }
    case "xbox": {
      await shell.openExternal("ms-settings:appsfeatures");
      return { ok: true, message: "Xbox and Microsoft Store games are removed from Windows' Apps settings, which has been opened." };
    }
    default: {
      const entry = await findUninstallEntry(game);
      if (!entry) {
        return {
          ok: false,
          message: `No uninstaller was registered for ${game.name}. ${LAUNCHER_NAMES[launcher]} should be able to remove it.`,
        };
      }
      try {
        spawn("cmd.exe", ["/c", "start", "", "/wait", entry], { windowsHide: false, detached: true, stdio: "ignore" }).unref();
      } catch (err) {
        return { ok: false, message: `Its uninstaller could not be started: ${(err as Error).message}` };
      }
      return { ok: true, message: `The uninstaller for ${game.name} has been started.` };
    }
  }
}

/**
 * Finds a game's uninstall command in the registry.
 *
 * Matched on the install location rather than the name, because a display name
 * rarely matches what the scanner called the game, while the folder it lives in
 * is exactly what was scanned.
 */
function findUninstallEntry(game: GameEntry): Promise<string | null> {
  if (process.platform !== "win32" || !game.installDir) return Promise.resolve(null);

  const dir = game.installDir.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$keys=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
    "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
    `$want='${dir}'`,
    "foreach ($k in $keys) {",
    "  Get-ItemProperty $k | Where-Object {",
    "    $_.UninstallString -and ($_.InstallLocation -and $_.InstallLocation.TrimEnd('\\') -ieq $want.TrimEnd('\\'))",
    "  } | Select-Object -First 1 -ExpandProperty UninstallString",
    "}",
  ].join("\n");

  return new Promise((resolve) => {
    let out = "";
    try {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
      const timer = setTimeout(() => child.kill(), 20_000);
      child.stdout?.on("data", (d) => (out += String(d)));
      child.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on("close", () => {
        clearTimeout(timer);
        const line = out.trim().split(/\r?\n/).find((l) => l.trim().length > 0);
        resolve(line ? line.trim() : null);
      });
    } catch {
      resolve(null);
    }
  });
}
