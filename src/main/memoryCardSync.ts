import * as fs from "node:fs";
import * as path from "node:path";
import { CardKind, MemoryCard, listCards } from "./memoryCard";
import { DUCKSTATION, PCSX2, EmulatorSpec, LocatedEmulator, locate, ensureCardFolder } from "./emulatorLocate";

/**
 * Where the emulators keep their memory cards, and getting saves back out.
 *
 * The point of finding DuckStation's and PCSX2's own card folders is that nobody
 * should have to configure a path twice. A card made in the menu is written where
 * the emulator already looks, so it appears in the emulator's own slot list
 * without anyone pointing anything at anything.
 *
 * Finding them is delegated to emulatorLocate, which asks Windows rather than
 * guessing - this has to work on whatever machine the menu is installed on, not
 * just one where the emulators happen to sit in Program Files.
 */

export type EmulatorId = "duckstation" | "pcsx2";

export interface EmulatorCards {
  id: EmulatorId;
  name: string;
  kind: CardKind;
  /** Where its executable was found, if it was. */
  installPath: string | null;
  /** Its own data folder, if it has been run at least once. */
  dataPath: string | null;
  /** Its memory card folder, if it exists yet. */
  cardFolder: string | null;
  /** True when that folder came from the emulator's config rather than a default. */
  cardFolderFromConfig: boolean;
  /** Where it will keep cards once run, whether or not that exists yet. */
  defaultCardFolder: string;
  /** Cards already sitting in that folder. */
  cards: string[];
}

const SPECS: Record<EmulatorId, { name: string; kind: CardKind; spec: EmulatorSpec }> = {
  duckstation: { name: "DuckStation", kind: "ps1", spec: DUCKSTATION },
  pcsx2: { name: "PCSX2", kind: "ps2", spec: PCSX2 },
};

/**
 * Card file extensions each emulator recognises in its own folder.
 *
 * This is only for listing what is already sitting there, where the name is all
 * there is to go on. Anything actually read or imported is identified by its
 * contents instead.
 */
const CARD_EXTENSIONS: Record<CardKind, string[]> = {
  ps1: [".mcr", ".mcd", ".mc", ".ps1", ".srm", ".gme"],
  ps2: [".ps2", ".mc2", ".bin"],
};

/** Discovery reads the registry, so a result is kept for a while and reused. */
const CACHE_MS = 30_000;
const cache = new Map<EmulatorId, { at: number; value: EmulatorCards }>();

function listCardFiles(folder: string | null, kind: CardKind): string[] {
  if (!folder) return [];
  try {
    const wanted = CARD_EXTENSIONS[kind];
    return fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((e) => {
        // A PCSX2 folder card is a directory, and counts just as much as a file.
        if (e.isDirectory()) {
          return kind === "ps2" && fs.existsSync(path.join(folder, e.name, "_pcsx2_superblock"));
        }
        return wanted.includes(path.extname(e.name).toLowerCase());
      })
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export async function findEmulator(id: EmulatorId, refresh = false): Promise<EmulatorCards> {
  const hit = cache.get(id);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const { name, kind, spec } = SPECS[id];
  const found: LocatedEmulator = await locate(spec);
  const value: EmulatorCards = {
    id,
    name,
    kind,
    installPath: found.installPath,
    dataPath: found.dataPath,
    cardFolder: found.cardFolder,
    cardFolderFromConfig: found.cardFolderFromConfig,
    defaultCardFolder: found.defaultCardFolder,
    cards: listCardFiles(found.cardFolder, kind),
  };
  cache.set(id, { at: Date.now(), value });
  return value;
}

export async function findEmulators(refresh = false): Promise<EmulatorCards[]> {
  return Promise.all((Object.keys(SPECS) as EmulatorId[]).map((id) => findEmulator(id, refresh)));
}

/** Forgets what was found, so the next look picks up a fresh install. */
export function forgetEmulators(): void {
  cache.clear();
}

/**
 * Copies a card into the emulator's folder so it shows up in its slot list.
 *
 * A copy, not a move: the menu keeps its own card as the one it manages, and the
 * emulator gets an identical file under the same name. Writing in place into the
 * emulator's folder while it is running is how cards get corrupted, so this is
 * only ever done between sessions.
 */
export async function publishToEmulator(card: MemoryCard, id: EmulatorId): Promise<{ ok: boolean; message: string }> {
  const emulator = await findEmulator(id, true);
  if (emulator.kind !== card.kind) {
    return { ok: false, message: `${emulator.name} does not take ${card.kind === "ps1" ? "PS" : "PS2"} cards` };
  }
  if (!emulator.installPath) {
    return { ok: false, message: `${emulator.name} does not look to be installed on this machine` };
  }

  // A fresh install has nowhere to put cards yet, so make the folder it would.
  const folder =
    emulator.cardFolder ??
    ensureCardFolder(
      {
        id,
        installPath: emulator.installPath,
        dataPath: emulator.dataPath,
        cardFolder: null,
        cardFolderFromConfig: false,
        defaultCardFolder: emulator.defaultCardFolder,
      },
      SPECS[id].spec,
    );
  if (!folder) {
    return { ok: false, message: `Could not find where ${emulator.name} keeps its cards. Run it once, then try again.` };
  }

  const target = path.join(folder, path.basename(card.filePath));
  try {
    // Anything already under that name is kept, in case it holds somebody's save.
    if (fs.existsSync(target)) {
      fs.copyFileSync(target, `${target}.backup-${Date.now()}`);
    }
    // Temp then rename, so the emulator never sees a partly written card.
    const temp = `${target}.tmp`;
    fs.copyFileSync(card.filePath, temp);
    fs.renameSync(temp, target);
    cache.delete(id);
    return { ok: true, message: `${card.name} is now in ${emulator.name}` };
  } catch (err) {
    return { ok: false, message: `Could not write to ${emulator.name}: ${(err as Error).message}` };
  }
}

/** Brings a card the emulator owns into the menu's own folder, leaving the original. */
export async function adoptFromEmulator(
  id: EmulatorId,
  fileName: string,
  into: string,
): Promise<{ ok: boolean; message: string }> {
  const emulator = await findEmulator(id);
  if (!emulator.cardFolder) return { ok: false, message: `No ${emulator.name} card folder found` };

  const source = path.join(emulator.cardFolder, fileName);
  if (!fs.existsSync(source)) return { ok: false, message: `${fileName} is not there any more` };

  try {
    fs.mkdirSync(into, { recursive: true });
    fs.copyFileSync(source, path.join(into, fileName));
    return { ok: true, message: `Brought ${fileName} in from ${emulator.name}` };
  } catch (err) {
    return { ok: false, message: `Could not copy it: ${(err as Error).message}` };
  }
}

// ------------------------------------------------------------------ export --

const PS1_BLOCK = 8192;
const PS1_FRAME = 128;

/**
 * Writes one save out as a .mcs - a single directory frame followed by the save's
 * blocks. It is the format every PS card tool reads, so a save exported here can
 * go straight onto a real card or into somebody else's emulator.
 */
export function exportSave(
  cardPath: string,
  saveName: string,
  intoFolder: string,
): { ok: boolean; message: string; file?: string } {
  let card: Buffer;
  try {
    card = fs.readFileSync(cardPath);
  } catch {
    return { ok: false, message: "That card could not be read" };
  }
  if (card.length < PS1_BLOCK * 16) return { ok: false, message: "Only PS cards can export single saves yet" };

  const frame = (i: number) => card.subarray(i * PS1_FRAME, (i + 1) * PS1_FRAME);

  for (let i = 1; i <= 15; i++) {
    const entry = frame(i);
    if ((entry.readUInt32LE(0) & 0xff) !== 0x51) continue;

    const raw = entry.subarray(10, 31).toString("latin1");
    const nul = raw.indexOf("\u0000");
    const name = (nul === -1 ? raw : raw.slice(0, nul)).trim();
    if (name !== saveName) continue;

    // Follow the chain so a multi-block save exports whole.
    const blocks = [i];
    let link = entry.readUInt16LE(8);
    for (let guard = 0; link !== 0xffff && guard < 15; guard++) {
      const next = link + 1;
      if (next < 1 || next > 15 || blocks.includes(next)) break;
      blocks.push(next);
      link = frame(next).readUInt16LE(8);
    }

    const out = Buffer.alloc(PS1_FRAME + blocks.length * PS1_BLOCK);
    entry.copy(out, 0);
    blocks.forEach((block, index) => {
      card.copy(out, PS1_FRAME + index * PS1_BLOCK, block * PS1_BLOCK, (block + 1) * PS1_BLOCK);
    });

    try {
      fs.mkdirSync(intoFolder, { recursive: true });
      const file = path.join(intoFolder, `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")}.mcs`);
      fs.writeFileSync(file, out);
      return { ok: true, message: `Exported ${name}`, file };
    } catch (err) {
      return { ok: false, message: `Could not write it: ${(err as Error).message}` };
    }
  }
  return { ok: false, message: `${saveName} is not on that card` };
}

/** Copies a whole card out, in the format the emulators already use. */
export function exportCard(card: MemoryCard, intoFolder: string): { ok: boolean; message: string; file?: string } {
  try {
    fs.mkdirSync(intoFolder, { recursive: true });
    const file = path.join(intoFolder, path.basename(card.filePath));
    fs.copyFileSync(card.filePath, file);
    return { ok: true, message: `Exported ${card.name}`, file };
  } catch (err) {
    return { ok: false, message: `Could not export it: ${(err as Error).message}` };
  }
}

/** Every card the menu manages, plus whatever the emulators have of their own. */
export async function overview(): Promise<{ managed: MemoryCard[]; emulators: EmulatorCards[] }> {
  return { managed: listCards(), emulators: await findEmulators() };
}
