import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { rootDrive, rootFolder, PC_ISO_FOLDER, PC_INSTALL_FOLDER } from "./rootDrive";

/**
 * PC game disc images: listing them, mounting them, and installing them.
 *
 * The images live in ROOT\GAME\PCISO and install into ROOT\GAME-PC. Most are
 * Amigo or FitGirl repacks, which are ordinary Windows installers wrapped in an
 * ISO, so the work is: mount the image, find the installer, work out which kind
 * it is, and run it with that kind's own silent switches pointed at the target
 * folder.
 *
 * "Headless" only goes as far as the installer allows. Inno Setup, NSIS and MSI
 * all document silent switches and those are used. An installer that is none of
 * those is opened normally rather than being fed switches it may not understand
 * - guessing at flags is how you end up with a half-installed game or an
 * installer silently writing to the wrong drive.
 *
 * The image is always dismounted afterwards, including when the install fails,
 * so a failed attempt does not leave a phantom drive letter behind.
 */

export type InstallerKind = "inno" | "nsis" | "msi" | "installshield" | "unknown";

export interface PcPackage {
  /** Stable id for the renderer, derived from the path. */
  id: string;
  /** The file name without its extension, used for artwork lookup. */
  name: string;
  filePath: string;
  sizeBytes: number;
  /** Set once it has been installed into ROOT\GAME-PC. */
  installed: boolean;
  installPath: string | null;
  /** Box art once SteamGridDB has it; the menu shows a disc until then. */
  artUrl: string | null;
}

/** Disc image extensions worth offering to mount. */
const IMAGE_EXTENSIONS = [".iso", ".img", ".mdf", ".nrg", ".cue", ".bin"];

/** Where the images live, or null when there is no ROOT drive. */
export function packagesFolder(): string | null {
  const root = rootDrive();
  if (!root) return null;
  return path.join(`${root}${String.fromCharCode(92)}`, "GAME", PC_ISO_FOLDER);
}

/** Where installs land, created on demand. */
export function installFolder(): string | null {
  return rootFolder(PC_INSTALL_FOLDER);
}

/**
 * A tidy name for a repack, for artwork lookup and the row label.
 *
 * Repack file names carry a lot of freight - "FitGirl Repack", version numbers,
 * DLC counts, language lists. SteamGridDB finds nothing for those, so the
 * decoration comes off and the bare title is what gets searched.
 */
export function cleanPackageName(fileName: string): string {
  // Strip the extension, then bracketed groups - "[FitGirl Repack]", "(MULTi14)".
  let name = fileName.replace(/\.[^.]+$/, "");
  name = name.replace(/[([{][^)\]}]*[)\]}]/g, " ");

  // Version numbers go before the dots become spaces, since they rely on them.
  name = name.replace(/\bv?\d+(\.\d+)+/gi, " ");

  // Dots and underscores are separators in these names, not punctuation. This
  // has to happen before the tokens below are stripped, because an underscore
  // counts as a word character: "Red_Dead_MULTi14" has no word boundary before
  // MULTi, so the language tag would survive the strip.
  name = name.replace(/[._]+/g, " ");

  // Repacker names, scene tags and language markers.
  name = name.replace(/\b(fitgirl|dodi|elamigos|el amigos|amigos|amigo|repacks?|multi\d*|rus|eng|selective download|update only|update|crack|cracked|codex|plaza|skidrow|empress|razor1911|goldberg|portable|gog|proper|readnfo)\b/gi, " ");

  // Counts the brackets did not catch, e.g. "+ 25 DLCs", "build 12345".
  name = name.replace(/[-+]\s*\d+\s*DLCs?\b/gi, " ");
  name = name.replace(/\bbuild\s*\d+/gi, " ");

  // Collapse, then trim separators left stranded by the removals above.
  name = name.replace(/\s{2,}/g, " ").trim();
  name = name.replace(/^[\s\-+_:,]+|[\s\-+_:,]+$/g, "");
  return name.trim();
}

function idFor(filePath: string): string {
  return "pciso:" + Buffer.from(filePath.toLowerCase()).toString("base64url").slice(0, 40);
}

/** Every disc image sitting in PCISO, with whether it has been installed. */
export function listPackages(): PcPackage[] {
  const folder = packagesFolder();
  if (!folder || !fs.existsSync(folder)) return [];

  const installs = installFolder();
  const out: PcPackage[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!IMAGE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;

    const filePath = path.join(folder, entry.name);
    const name = cleanPackageName(entry.name);
    // A .cue and its .bin are one disc; the .bin alone is not worth listing.
    if (path.extname(entry.name).toLowerCase() === ".bin" && fs.existsSync(filePath.replace(/\.bin$/i, ".cue"))) continue;

    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(filePath).size;
    } catch {
      // Unreadable; still worth listing so the user can see it is there.
    }

    const installPath = installs ? path.join(installs, sanitiseFolder(name)) : null;
    out.push({
      id: idFor(filePath),
      name,
      filePath,
      sizeBytes,
      installed: !!installPath && fs.existsSync(installPath),
      installPath,
      artUrl: null,
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function sanitiseFolder(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\.+$/, "").trim() || "Game";
}

// ------------------------------------------------------------------- mount --

function powershell(script: string, timeoutMs = 120_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    try {
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout?.on("data", (d) => (out += String(d)));
      child.stderr?.on("data", (d) => (out += String(d)));
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ ok: false, out });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, out });
      });
    } catch {
      resolve({ ok: false, out });
    }
  });
}

/**
 * Mounts a disc image and returns the drive letter Windows gave it.
 *
 * Windows mounts images itself, so nothing has to be installed for this. The
 * drive letter is read back from the mounted volume rather than assumed, since
 * Windows picks whichever letter is free.
 */
export async function mountImage(filePath: string): Promise<{ ok: boolean; drive?: string; message: string }> {
  if (process.platform !== "win32") return { ok: false, message: "Mounting disc images needs Windows" };
  if (!fs.existsSync(filePath)) return { ok: false, message: "That image is not there any more" };

  const escaped = filePath.replace(/'/g, "''");
  const script = [
    `$img = Mount-DiskImage -ImagePath '${escaped}' -PassThru -ErrorAction Stop`,
    `$vol = $img | Get-Volume`,
    `if ($vol.DriveLetter) { Write-Output $vol.DriveLetter } else { exit 1 }`,
  ].join("; ");

  const res = await powershell(script);
  const letter = res.out.trim().split(/\r?\n/).pop()?.trim() ?? "";
  if (!res.ok || !/^[A-Za-z]$/.test(letter)) {
    return { ok: false, message: `Could not mount that image: ${res.out.trim().slice(0, 200) || "no drive letter was assigned"}` };
  }
  return { ok: true, drive: `${letter.toUpperCase()}:`, message: `Mounted as ${letter.toUpperCase()}:` };
}

export async function dismountImage(filePath: string): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const escaped = filePath.replace(/'/g, "''");
  const res = await powershell(`Dismount-DiskImage -ImagePath '${escaped}' -ErrorAction SilentlyContinue | Out-Null`, 60_000);
  return res.ok;
}

// --------------------------------------------------------------- installer --

export interface FoundInstaller {
  exe: string;
  kind: InstallerKind;
}

/**
 * Works out what kind of installer an executable is, by looking inside it.
 *
 * Each toolkit leaves its own marker in the binary: Inno Setup writes its name
 * and a "loader" string, NSIS writes "Nullsoft.NSIS", InstallShield says so.
 * The file is read in chunks and searched for those, so a 2 GB setup.exe does
 * not have to be held in memory.
 */
function installerKind(exePath: string): InstallerKind {
  const markers: [InstallerKind, string[]][] = [
    ["inno", ["Inno Setup", "JR.Inno.Setup", "InnoSetupLdr"]],
    ["nsis", ["Nullsoft.NSIS", "NullsoftInst", "Nullsoft Install System"]],
    ["installshield", ["InstallShield", "ISSetupStream"]],
  ];

  try {
    const size = fs.statSync(exePath).size;
    const fd = fs.openSync(exePath, "r");
    try {
      // The toolkit's signature sits near the front or the very end.
      const spans: [number, number][] = [
        [0, Math.min(size, 2 * 1024 * 1024)],
        [Math.max(0, size - 1024 * 1024), Math.min(size, 1024 * 1024)],
      ];
      for (const [offset, length] of spans) {
        if (length <= 0) continue;
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, offset);
        const text = buf.toString("latin1");
        for (const [kind, needles] of markers) {
          if (needles.some((n) => text.includes(n))) return kind;
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Unreadable; treat it as unknown rather than claiming a kind.
  }
  return "unknown";
}

/** Finds the installer on a mounted disc, preferring the one autorun names. */
export function findInstaller(mountedDrive: string): FoundInstaller | null {
  const root = `${mountedDrive}${String.fromCharCode(92)}`;

  // autorun.inf names the right executable when a disc has several.
  const named: string[] = [];
  try {
    const inf = fs.readFileSync(path.join(root, "autorun.inf"), "latin1");
    const open = inf.match(/^\s*open\s*=\s*(.+)$/im)?.[1]?.trim();
    if (open) named.push(open.split(/\s+/)[0].replace(/^"|"$/g, ""));
  } catch {
    // No autorun, which is common enough.
  }

  const candidates = [...named, "setup.exe", "Setup.exe", "install.exe", "Install.exe", "autorun.exe"];
  for (const candidate of candidates) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return { exe: full, kind: installerKind(full) };
    }
  }

  // An .msi on its own is an installer too.
  try {
    const msi = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith(".msi"));
    if (msi) return { exe: path.join(root, msi), kind: "msi" };
  } catch {
    // Unreadable disc root.
  }

  return null;
}

/** The silent switches for each toolkit, pointed at the target folder. */
function silentArgs(kind: InstallerKind, target: string): string[] | null {
  switch (kind) {
    case "inno":
      // FitGirl and most repacks are Inno; these are its documented switches.
      return ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", `/DIR=${target}`];
    case "nsis":
      // NSIS wants /D last and unquoted, as the final argument.
      return ["/S", `/D=${target}`];
    case "msi":
      return ["/qn", "/norestart", `TARGETDIR=${target}`];
    case "installshield":
      return ["/s", "/v/qn"];
    default:
      return null;
  }
}

export interface InstallOutcome {
  ok: boolean;
  message: string;
  installPath?: string;
  /** True when the installer had to be opened with its own window. */
  interactive?: boolean;
}

/**
 * Mounts an image, installs what is on it, and dismounts again.
 *
 * The dismount is in a finally, so an install that throws still releases the
 * drive letter. Nothing is deleted on failure: a partly written target folder
 * is left where it is, because a repack that failed at 90% is worth resuming
 * rather than silently throwing away.
 */
export async function installPackage(
  filePath: string,
  onProgress?: (message: string) => void,
): Promise<InstallOutcome> {
  const say = (m: string) => onProgress?.(m);

  const installs = installFolder();
  if (!installs) return { ok: false, message: "No ROOT drive is set, so there is nowhere to install to" };

  const name = cleanPackageName(path.basename(filePath));
  const target = path.join(installs, sanitiseFolder(name));

  say(`Mounting ${name}`);
  const mounted = await mountImage(filePath);
  if (!mounted.ok || !mounted.drive) return { ok: false, message: mounted.message };

  try {
    say("Looking for the installer");
    const installer = findInstaller(mounted.drive);
    if (!installer) {
      return { ok: false, message: `No installer found on ${mounted.drive} - the image may just be files to copy` };
    }

    const args = silentArgs(installer.kind, target);
    fs.mkdirSync(target, { recursive: true });

    if (!args) {
      // Unknown toolkit: open it normally rather than guess at switches.
      say("Opening the installer");
      spawn(installer.exe, [], { detached: true, stdio: "ignore", cwd: path.dirname(installer.exe) }).unref();
      return {
        ok: true,
        interactive: true,
        installPath: target,
        message: `This installer is not one that can be run silently, so it has been opened. Install it to ${target}`,
      };
    }

    say(`Installing to ${target}`);
    const command = installer.kind === "msi" ? "msiexec.exe" : installer.exe;
    const argv = installer.kind === "msi" ? ["/i", installer.exe, ...args] : args;

    const code = await new Promise<number>((resolve) => {
      const child = spawn(command, argv, { windowsHide: true, cwd: path.dirname(installer.exe) });
      child.on("error", () => resolve(-1));
      child.on("close", (c) => resolve(c ?? -1));
    });

    if (code !== 0) {
      return { ok: false, installPath: target, message: `The installer stopped with code ${code}. Anything it wrote is still in ${target}` };
    }

    say("Done");
    return { ok: true, installPath: target, message: `${name} installed to ${target}` };
  } finally {
    say("Dismounting");
    await dismountImage(filePath);
  }
}
