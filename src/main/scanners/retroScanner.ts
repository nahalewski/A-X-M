import * as fs from "node:fs";
import { rootDrive } from "../rootDrive";

/** One backslash, built rather than typed so editing tools cannot mangle it. */
const BACKSLASH = String.fromCharCode(92);
import * as path from "node:path";
import { GameEntry, RetroPlatform } from "../types";
import { isWindows } from "../platform";
import { inspectPs3Iso } from "../retro";

/**
 * Retro: console games that run through emulators. Each platform has folders to
 * look in and an emulator to hand the file to; the entry is an ordinary GameEntry
 * (source "retro") whose launch target is the emulator, so the launcher, Ghost,
 * Toybox and the Game column's options all treat it like any other game.
 *
 *   PS3     folder games (PS3_GAME/USRDIR/EBOOT.BIN)  -> RPCS3 --no-gui
 *           .iso                                       -> needs decrypting + extracting first
 *   PS2     .iso .chd .bin .cso .gz                    -> PCSX2
 *   PS1     .cue .chd .pbp .m3u .iso (.bin without a cue) -> DuckStation
 *   PSP     .iso .cso .pbp .chd                        -> PPSSPP
 *   Switch  .nsp .xci .nsz .xcz (base titles only)     -> Eden
 */

export const RETRO_PLATFORMS: RetroPlatform[] = ["ps5", "ps4", "ps3", "ps2", "ps1", "psp", "switch"];

export const RETRO_NAMES: Record<RetroPlatform, string> = { ps5: "PlayStation 5", ps4: "PlayStation 4", ps3: "PlayStation 3", ps2: "PlayStation 2", ps1: "PlayStation", psp: "PSP", switch: "Nintendo Switch" };

/** The folder name each platform uses under a library root (G:\GAMES\<x>, N:\GAME\ROMS\<x>). */
export const RETRO_FOLDER_NAMES: Record<RetroPlatform, string> = { ps5: "PS5", ps4: "PS4", ps3: "PS3", ps2: "PS2", ps1: "PS1", psp: "PSP", switch: "Switch" };

/**
 * Where each platform's games live when nothing has been configured.
 *
 * ROOT is the answer whenever one is set: its GAME folder is laid out with a
 * folder per console, which is the arrangement the menu creates and expects.
 * The older G: paths stay as a fallback for a machine with no ROOT drive, so an
 * existing library is not suddenly invisible.
 *
 * This is a function rather than a constant because ROOT can be changed in
 * settings while the menu is running, and a constant would have captured
 * whatever it was at import time.
 */
export function retroDefaultFolders(): Record<RetroPlatform, string[]> {
  const root = rootDrive();
  const G = "G:" + BACKSLASH + "GAMES" + BACKSLASH;

  // With a ROOT drive set it is the only place retro games are read from, so a
  // stray copy on another disk cannot show up twice or shadow the real library.
  if (root) {
    const on = (name: string): string[] => [`${root}${BACKSLASH}GAME${BACKSLASH}${name}`];
    return { ps5: on("PS5"), ps4: on("PS4"), ps3: on("PS3"), ps2: on("PS2"), ps1: on("PS1"), psp: on("PSP"), switch: on("SWITCH") };
  }

  // No ROOT: fall back to the older fixed paths so an existing library still reads.
  return {
    ps5: [G + "PS5"],
    ps4: [G + "PS4"],
    ps3: [G + "PS3"],
    ps2: [G + "PS2"],
    ps1: [G + "PS1"],
    psp: [G + "PSP"],
    switch: ["K:" + BACKSLASH + "Switch Games", G + "SWITCH"],
  };
}

/** Kept for callers that want the plain object; resolves ROOT at call time. */
export const RETRO_DEFAULT_FOLDERS: Record<RetroPlatform, string[]> = new Proxy({} as Record<RetroPlatform, string[]>, {
  get: (_t, key: string) => retroDefaultFolders()[key as RetroPlatform],
});

export interface EmulatorInfo {
  platform: RetroPlatform;
  name: string;
  exe: string | null;
  /** winget id for Install Tools. */
  winget: string | null;
  /** GitHub release to fetch when there is no winget package: repo, asset pattern, exe inside. */
  github?: { repo: string; asset: RegExp; exe: string };
  /** What it still needs from the user (a BIOS, keys) - shown, never fetched. */
  note?: string;
}

const EXT: Record<RetroPlatform, string[]> = {
  ps5: [".pkg", ".elf"],
  ps4: [".pkg"],
  ps3: [".iso"],
  ps2: [".iso", ".chd", ".bin", ".cso", ".gz", ".zso"],
  ps1: [".cue", ".chd", ".pbp", ".m3u", ".iso", ".bin", ".img", ".ecm"],
  psp: [".iso", ".cso", ".pbp", ".chd"],
  switch: [".nsp", ".xci", ".nsz", ".xcz"],
};

/** Folders inside a platform root that hold add-ons, not games. */
const SKIP_DIRS = /^(dlc|updates?|patches?|homebrew|artwork|saves?|bios|firmware|umd videos|textures|mods|cheats)$|\bdlc\b|unlocker|\bupdate\b/i;

function firstExisting(cands: string[]): string | null {
  return cands.find((c) => c && fs.existsSync(c)) ?? null;
}

export const EMULATORS_DIR = "C:\\Emulators";

function programDirs(): string[] {
  return [process.env.ProgramFiles ?? "C:\\Program Files", process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", path.join(process.env.LOCALAPPDATA ?? "", "Programs"), EMULATORS_DIR, "D:\\Emulators", "G:\\GAMES\\Emulators", "C:\\"];
}

function biosNote(dir: string | null, pattern: RegExp, what: string): string | undefined {
  if (!dir) return undefined;
  try {
    return fs.readdirSync(dir).some((f) => pattern.test(f)) ? undefined : what;
  } catch {
    return what;
  }
}

/** Where each emulator is, if anywhere; the user's own paths win. */
export function findEmulators(configured: Partial<Record<RetroPlatform, string>> = {}): EmulatorInfo[] {
  const dirs = programDirs();
  const look = (names: string[]) => firstExisting(dirs.flatMap((d) => names.map((n) => path.join(d, n))));
  const pick = (platform: RetroPlatform, name: string, winget: string | null, auto: string | null, extra: Partial<EmulatorInfo> = {}): EmulatorInfo => {
    const own = configured[platform];
    return { platform, name, exe: own && fs.existsSync(own) ? own : auto, winget, ...extra };
  };
  const pcsx2 = look(["PCSX2\\pcsx2-qt.exe", "PCSX2 2\\pcsx2-qt.exe", "pcsx2\\pcsx2-qt.exe", "PCSX2\\pcsx2.exe"]);
  const wingetPkgs = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  const wingetExe = (prefix: string, exe: string): string | null => {
    try {
      const d = fs.readdirSync(wingetPkgs).find((n) => n.startsWith(prefix));
      return d && fs.existsSync(path.join(wingetPkgs, d, exe)) ? path.join(wingetPkgs, d, exe) : null;
    } catch {
      return null;
    }
  };
  const duck = look(["DuckStation\\duckstation-qt-x64-ReleaseLTCG.exe", "duckstation\\duckstation-qt-x64-ReleaseLTCG.exe", "DuckStation\\duckstation-qt.exe"]) ?? wingetExe("Stenzek.DuckStation", "duckstation-qt-x64-ReleaseLTCG.exe");
  const appData = process.env.APPDATA ?? "";
  const docs = path.join(process.env.USERPROFILE ?? "", "Documents");
  return [
    pick("ps5", "Kyty", null, look(["Kyty\\launcher.exe", "kyty\\launcher.exe"]), { github: { repo: "InoriRus/Kyty", asset: /^Kyty-.*\.zip$/i, exe: "launcher.exe" }, note: "Kyty is an early experiment - it boots a handful of homebrew and samples, not retail PS5 games" }),
    pick("ps4", "shadPS4", null, look(["shadPS4\\shadPS4.exe", "shadps4\\shadPS4.exe", "shadPS4\\shadps4.exe"]), { github: { repo: "shadps4-emu/shadPS4", asset: /^shadps4-win64-sdl-.*\.zip$/i, exe: "shadPS4.exe" } }),
    pick("ps3", "RPCS3", null, look(["rpcs3\\rpcs3.exe", "RPCS3\\rpcs3.exe"]), { github: { repo: "RPCS3/rpcs3-binaries-win", asset: /win64_msvc\.7z$/i, exe: "rpcs3.exe" } }),
    pick("ps2", "PCSX2", "PCSX2Team.PCSX2", pcsx2, { note: biosNote(pcsx2 ? [path.join(docs, "PCSX2", "bios"), path.join(path.dirname(pcsx2), "bios")].find((d) => fs.existsSync(d)) ?? path.join(docs, "PCSX2", "bios") : null, /\.bin$/i, "needs a PS2 BIOS (scph*.bin) in Documents\\PCSX2\\bios - from your own console") }),
    pick("ps1", "DuckStation", "Stenzek.DuckStation", duck, { note: biosNote(duck ? [path.join(docs, "DuckStation", "bios"), path.join(path.dirname(duck), "bios")].find((d) => fs.existsSync(d)) ?? path.join(docs, "DuckStation", "bios") : null, /\.bin$/i, "needs a PS1 BIOS (scph*.bin) in Documents\\DuckStation\\bios - from your own console") }),
    pick("psp", "PPSSPP", "PPSSPPTeam.PPSSPP", look(["PPSSPP\\PPSSPPWindows64.exe", "ppsspp\\PPSSPPWindows64.exe", "PPSSPP\\PPSSPPWindows.exe"])),
    pick("switch", "Eden", null, look(["eden\\eden.exe", "Eden\\eden.exe", "yuzu\\yuzu.exe", "yuzu-windows-msvc\\yuzu.exe"]), { note: fs.existsSync(path.join(appData, "eden", "keys", "prod.keys")) || fs.existsSync(path.join(appData, "yuzu", "keys", "prod.keys")) ? undefined : "needs prod.keys and firmware from your own Switch (Eden: File > Install keys / firmware)" }),
  ];
}

/** The command line each emulator takes to boot straight into a game, full screen. */
export function launchArgsFor(platform: RetroPlatform, rom: string): string[] {
  switch (platform) {
    case "ps5":
      return [rom];
    case "ps4":
      return [rom];
    case "ps3":
      return ["--no-gui", rom];
    case "ps2":
      return ["-fullscreen", "--", rom];
    case "ps1":
      return ["-fullscreen", rom];
    case "psp":
      return ["--fullscreen", rom];
    case "switch":
      return ["-f", "-g", rom];
  }
}

function cleanName(file: string): string {
  return path
    .basename(file, path.extname(file))
    .replace(/\[[^\]]*\]/g, " ") // [0100A9D01C446000][v0][US]
    .replace(/\([^)]*\)/g, " ") // (USA) (En,Fr)
    .replace(/\b(taodung\.com|nsw2u|hexrom|romsfun)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*$/, "")
    .trim();
}

/** Switch files carry the title id in brackets; base titles end in 000, updates 800, DLC 1000+. */
function switchTitleId(file: string): string | null {
  return file.match(/\[([0-9A-Fa-f]{16})\]/)?.[1]?.toUpperCase() ?? null;
}

function walk(dir: string, depth: number, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0 && !SKIP_DIRS.test(e.name)) walk(full, depth - 1, out);
    } else out.push(full);
  }
}

/** An extracted PS4 package carries its title in sce_sys/param.sfo (same SFO layout as the PS3). */
function ps4Title(dir: string): string | null {
  return ps3Title(path.join(dir, "sce_sys")) ?? sfoTitle(path.join(dir, "sce_sys", "param.sfo"));
}

function sfoTitle(sfo: string): string | null {
  if (!fs.existsSync(sfo)) return null;
  try {
    const buf = fs.readFileSync(sfo);
    const keyTable = buf.readUInt32LE(8);
    const dataTable = buf.readUInt32LE(12);
    const count = buf.readUInt32LE(16);
    for (let i = 0; i < count; i++) {
      const e = 20 + i * 16;
      const keyOff = buf.readUInt16LE(e);
      const len = buf.readUInt32LE(e + 4);
      const dataOff = buf.readUInt32LE(e + 12);
      const key = buf.toString("utf8", keyTable + keyOff, buf.indexOf(0, keyTable + keyOff));
      if (key === "TITLE") return buf.toString("utf8", dataTable + dataOff, dataTable + dataOff + len).replace(/\0+$/, "").trim();
    }
  } catch {
    /* not an SFO */
  }
  return null;
}

function ps3FolderGames(root: string): { dir: string; eboot: string; name: string }[] {
  const out: { dir: string; eboot: string; name: string }[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const eboot = firstExisting([path.join(dir, "PS3_GAME", "USRDIR", "EBOOT.BIN"), path.join(dir, "USRDIR", "EBOOT.BIN")]);
    if (eboot) out.push({ dir, eboot, name: ps3Title(dir) ?? cleanName(e.name) });
  }
  return out;
}

/** The title from PARAM.SFO, when the folder has one (plain UTF-8 string in the data block). */
function ps3Title(dir: string): string | null {
  const sfo = firstExisting([path.join(dir, "PS3_GAME", "PARAM.SFO"), path.join(dir, "PARAM.SFO")]);
  if (!sfo) return null;
  try {
    const buf = fs.readFileSync(sfo);
    const keyTable = buf.readUInt32LE(8);
    const dataTable = buf.readUInt32LE(12);
    const count = buf.readUInt32LE(16);
    for (let i = 0; i < count; i++) {
      const e = 20 + i * 16;
      const keyOff = buf.readUInt16LE(e);
      const len = buf.readUInt32LE(e + 4);
      const dataOff = buf.readUInt32LE(e + 12);
      const key = buf.toString("utf8", keyTable + keyOff, buf.indexOf(0, keyTable + keyOff));
      if (key === "TITLE") return buf.toString("utf8", dataTable + dataOff, dataTable + dataOff + len).replace(/\0+$/, "").trim();
    }
  } catch {
    /* not a PARAM.SFO */
  }
  return null;
}

export function scanRetroGames(folders: Partial<Record<RetroPlatform, string[]>>, emulators: EmulatorInfo[]): GameEntry[] {
  if (!isWindows) return [];
  const games: GameEntry[] = [];
  const emu = (p: RetroPlatform) => emulators.find((e) => e.platform === p)!;
  const entry = (platform: RetroPlatform, rom: string, name: string, installDir: string, extra: Partial<GameEntry> = {}): GameEntry => {
    const e = emu(platform);
    return {
      id: `retro-${platform}-${Buffer.from(rom).toString("base64url")}`,
      name,
      source: "retro",
      launchType: "exe",
      launchTarget: e.exe ?? "",
      launchArgs: launchArgsFor(platform, rom),
      installDir,
      drive: rom.slice(0, 2).toUpperCase(),
      // No iconPath: SteamGridDB fills the box art in; the menu shows the platform's console until then.
      losslessProfile: null,
      hidden: false,
      platform,
      romPath: rom,
      emulator: e.exe,
      emulatorName: e.name,
      ...extra,
    };
  };

  for (const platform of RETRO_PLATFORMS) {
    const roots = [...(folders[platform] ?? RETRO_DEFAULT_FOLDERS[platform])];
    // Prepared PS3 games land in RPCS3's own games folder; list it with the rest.
    if (platform === "ps3" && emu("ps3").exe) roots.push(path.join(path.dirname(emu("ps3").exe!), "games"));
    const seenTitles = new Set<string>();
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      if (platform === "ps3") {
        for (const g of ps3FolderGames(root)) games.push(entry("ps3", g.eboot, g.name, g.dir));
      }
      if (platform === "ps4" || platform === "ps5") {
        let subs: fs.Dirent[] = [];
        try {
          subs = fs.readdirSync(root, { withFileTypes: true });
        } catch {
          subs = [];
        }
        for (const e of subs) {
          if (!e.isDirectory()) continue;
          const dir = path.join(root, e.name);
          const eboot = firstExisting([path.join(dir, "eboot.bin"), path.join(dir, "sce_sys", "..", "eboot.bin")]);
          if (eboot) games.push(entry(platform, eboot, ps4Title(dir) ?? cleanName(e.name), dir));
        }
      }
      const files: string[] = [];
      walk(root, 2, files);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!EXT[platform].includes(ext)) continue;
        if (platform === "ps1" && ext === ".bin" && files.some((f) => f.toLowerCase().endsWith(".cue") && path.dirname(f) === path.dirname(file))) continue;
        if (platform === "ps1" && ext === ".bin" && files.some((f) => /\.cue$/i.test(f) && path.dirname(f) === path.dirname(file))) continue;
        if (/\.dec\.iso$/i.test(file)) continue; // the decrypter's intermediate
        if (platform === "switch") {
          if (/\bdlc\b|\[up v|\bupdate\b/i.test(path.basename(file))) continue;
          const id = switchTitleId(file);
          if (id && !id.endsWith("000")) continue; // an update or DLC, not the game
          const key = (id ?? cleanName(file)).toLowerCase();
          if (seenTitles.has(key)) continue;
          seenTitles.add(key);
        }
        const name = cleanName(file);
        if (platform === "ps4" || platform === "ps5") {
          games.push(entry(platform, file, name, path.dirname(file), { needsPrep: platform === "ps4" ? "Package - install it in shadPS4 (its Qt build) or extract it here as a folder" : "Package - Kyty runs extracted samples only" }));
          continue;
        }
        if (platform === "ps3") {
          let encrypted = true;
          try {
            const info = inspectPs3Iso(file);
            encrypted = !!info.encryptedRegion && !info.plain;
          } catch {
            /* unreadable: treat as encrypted, the prep step will say */
          }
          const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, "") === b.toLowerCase().replace(/[^a-z0-9]+/g, "");
          const extracted = games.find((g) => g.platform === "ps3" && !g.needsPrep && same(g.name, name));
          games.push(entry("ps3", file, name, path.dirname(file), { needsPrep: extracted ? "Disc image - already extracted for RPCS3" : encrypted ? "Encrypted disc image - decrypt and extract for RPCS3" : "Disc image - extract for RPCS3", isoEncrypted: encrypted, extractedDir: extracted?.installDir }));
          continue;
        }
        games.push(entry(platform, file, name, path.dirname(file)));
      }
    }
  }
  return games;
}
