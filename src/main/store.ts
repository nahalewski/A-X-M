import * as fs from "node:fs";
import * as path from "node:path";
import { BrowserWindow } from "electron";
import { GameEntry, RetroPlatform } from "./types";
import { scanRetroGames, findEmulators, EmulatorInfo, RETRO_PLATFORMS, RETRO_NAMES, RETRO_FOLDER_NAMES, RETRO_DEFAULT_FOLDERS } from "./scanners/retroScanner";
import { resolveArt, isGameArtConfigured } from "./gameArt";
import { loadSettings } from "./settingsStore";

/**
 * The Store: your own shelf on drive N (N:\GAME\ROMS\<PS1|PS2|...>) and the
 * emulators that play it. Nothing is bought - "Install" copies a game into the
 * library folder the Retro column reads (G:\GAMES\<platform>), or fetches an
 * emulator. Art comes from SteamGridDB like everywhere else.
 */

export interface StoreItem {
  id: string;
  kind: "game" | "emulator";
  platform: RetroPlatform;
  name: string;
  /** Game: the file or folder on the shelf. Emulator: its exe when installed. */
  path: string | null;
  sizeBytes: number;
  installed: boolean;
  /** Where an installed game lives, or where it would go. */
  libraryDir: string;
  emulatorName: string;
  emulatorInstalled: boolean;
  note?: string;
  iconPath?: string;
  heroPath?: string;
  /** PS3 image that still needs decrypting after install. */
  needsPrep?: string;
}

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

function dirSize(p: string): number {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    let total = 0;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) total += dirSize(path.join(p, e.name));
    return total;
  } catch {
    return 0;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const artCache = new Map<string, { icon?: string; hero?: string }>();

function libraryDirFor(platform: RetroPlatform): string {
  const s = loadSettings();
  return (s.retroFolders[platform] ?? RETRO_DEFAULT_FOLDERS[platform])[0];
}

/** Everything on the shelf and every emulator, with what is installed already marked. */
export async function storeCatalogue(library: GameEntry[]): Promise<StoreItem[]> {
  const settings = loadSettings();
  const emulators = findEmulators(settings.emulators);
  const root = settings.storeRoot;
  const shelfFolders: Partial<Record<RetroPlatform, string[]>> = {};
  for (const p of RETRO_PLATFORMS) shelfFolders[p] = [path.join(root, RETRO_FOLDER_NAMES[p])];
  const onShelf = fs.existsSync(root) ? scanRetroGames(shelfFolders, emulators) : [];
  const installedNames = new Set(library.filter((g) => g.source === "retro").map((g) => `${g.platform}:${norm(g.name)}`));

  const items: StoreItem[] = emulators.map((e) => ({
    id: `emu-${e.platform}`,
    kind: "emulator",
    platform: e.platform,
    name: e.name,
    path: e.exe,
    sizeBytes: 0,
    installed: !!e.exe,
    libraryDir: e.exe ? path.dirname(e.exe) : "C:\\Emulators",
    emulatorName: e.name,
    emulatorInstalled: !!e.exe,
    note: e.note,
    iconPath: `assets/icons/retro-${e.platform}.png`,
  }));

  for (const g of onShelf) {
    const emu = emulators.find((e) => e.platform === g.platform)!;
    // A PS3 folder game's rom is its EBOOT; the thing to copy is the folder.
    const source = g.platform === "ps3" && !g.needsPrep ? g.installDir : g.platform === "ps4" || g.platform === "ps5" ? (g.needsPrep ? g.romPath! : g.installDir) : g.romPath!;
    const item: StoreItem = {
      id: `store-${g.id}`,
      kind: "game",
      platform: g.platform!,
      name: g.name,
      path: source,
      sizeBytes: dirSize(source),
      installed: installedNames.has(`${g.platform}:${norm(g.name)}`),
      libraryDir: libraryDirFor(g.platform!),
      emulatorName: emu.name,
      emulatorInstalled: !!emu.exe,
      note: emu.note,
      needsPrep: g.needsPrep,
    };
    const cached = artCache.get(g.name);
    if (cached) {
      item.iconPath = cached.icon;
      item.heroPath = cached.hero;
    }
    items.push(item);
  }
  void fillStoreArt(items);
  return items;
}

/** Box art and heroes for shelf games, pushed as they land (axm:storeArt). */
async function fillStoreArt(items: StoreItem[]): Promise<void> {
  if (!isGameArtConfigured()) return;
  for (const item of items) {
    if (item.kind !== "game" || (item.iconPath && item.heroPath)) continue;
    const icon = item.iconPath ?? (await resolveArt(item.name, "grid")) ?? undefined;
    const hero = item.heroPath ?? (await resolveArt(item.name, "hero")) ?? undefined;
    artCache.set(item.name, { icon, hero });
    if (icon || hero) send("axm:storeArt", { id: item.id, iconPath: icon, heroPath: hero });
  }
}

function copyWithProgress(src: string, dstDir: string, id: string, name: string): Promise<string> {
  const total = dirSize(src);
  let done = 0;
  const progress = (finished = false, error?: string) => send("axm:transfer", { id, name, destination: dstDir, done, total: total || 1, finished, error });
  const copyFile = (from: string, to: string) =>
    new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(from);
      const ws = fs.createWriteStream(to);
      rs.on("data", (chunk: Buffer | string) => {
        done += chunk.length;
        progress();
      });
      rs.on("error", reject);
      ws.on("error", reject);
      ws.on("finish", () => resolve());
      rs.pipe(ws);
    });
  const copyAny = async (from: string, to: string): Promise<void> => {
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(from)) await copyAny(path.join(from, e), path.join(to, e));
    } else await copyFile(from, to);
  };
  return (async () => {
    fs.mkdirSync(dstDir, { recursive: true });
    const dst = path.join(dstDir, path.basename(src));
    progress();
    try {
      await copyAny(src, dst);
      // A PS3 image brings its key along when it has one.
      if (/\.iso$/i.test(src)) for (const ext of [".dkey", ".key"]) if (fs.existsSync(src.replace(/\.iso$/i, ext))) fs.copyFileSync(src.replace(/\.iso$/i, ext), dst.replace(/\.iso$/i, ext));
      progress(true);
      return dst;
    } catch (err) {
      progress(true, (err as Error).message);
      throw err;
    }
  })();
}

/** Copies a shelf game into its platform's library folder. */
export async function storeInstall(item: StoreItem): Promise<string> {
  if (item.kind !== "game" || !item.path) throw new Error("Nothing to install");
  return copyWithProgress(item.path, item.libraryDir, item.id, item.name);
}

export function emulatorFor(platform: RetroPlatform): EmulatorInfo | undefined {
  return findEmulators(loadSettings().emulators).find((e) => e.platform === platform);
}

export { RETRO_NAMES };
