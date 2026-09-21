import { app } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CardKind, MemoryCard, listCards } from "./memoryCard";

/**
 * Where the emulators keep their memory cards, and getting saves back out.
 *
 * The point of finding DuckStation's and PCSX2's own card folders is that nobody
 * should have to configure a path twice. A card made in the menu is written where
 * the emulator already looks, so it appears in the emulator's own slot list
 * without anyone pointing anything at anything.
 *
 * Both emulators keep cards beside their configuration, and both support portable
 * installs where that sits next to the executable instead. Every plausible place
 * is checked and whatever exists wins; nothing is created speculatively, because a
 * folder made in the wrong spot is worse than none.
 */

export type EmulatorId = "duckstation" | "pcsx2";

export interface EmulatorCards {
  id: EmulatorId;
  name: string;
  kind: CardKind;
  /** Where its executable was found, if it was. */
  installPath: string | null;
  /** Its memory card folder, if it exists yet. */
  cardFolder: string | null;
  /** Cards already sitting in that folder. */
  cards: string[];
}

const HOME = os.homedir();

/** Documents can be redirected; ask the app before assuming the usual place. */
function documents(): string {
  try {
    return app.getPath("documents");
  } catch {
    return path.join(HOME, "Documents");
  }
}

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // Unreadable path; try the next.
    }
  }
  return null;
}

const SPEC: Record<EmulatorId, { name: string; kind: CardKind; exe: string[]; data: string[] }> = {
  duckstation: {
    name: "DuckStation",
    kind: "ps1",
    exe: [
      path.join("C:\\Program Files", "DuckStation", "duckstation-qt-x64-ReleaseLTCG.exe"),
      path.join("C:\\Program Files", "DuckStation", "duckstation-qt.exe"),
      path.join(HOME, "AppData", "Local", "DuckStation", "duckstation-qt-x64-ReleaseLTCG.exe"),
      path.join(app.getPath("userData"), "emulators", "duckstation", "duckstation-qt-x64-ReleaseLTCG.exe"),
    ],
    data: [
      path.join(documents(), "DuckStation"),
      path.join(HOME, ".local", "share", "duckstation"),
      path.join(app.getPath("userData"), "emulators", "duckstation"),
    ],
  },
  pcsx2: {
    name: "PCSX2",
    kind: "ps2",
    exe: [
      path.join("C:\\Program Files", "PCSX2", "pcsx2-qt.exe"),
      path.join("C:\\Program Files", "PCSX2", "pcsx2.exe"),
      path.join(HOME, "AppData", "Local", "PCSX2", "pcsx2-qt.exe"),
      path.join(app.getPath("userData"), "emulators", "pcsx2", "pcsx2-qt.exe"),
    ],
    data: [
      path.join(documents(), "PCSX2"),
      path.join(HOME, ".config", "PCSX2"),
      path.join(app.getPath("userData"), "emulators", "pcsx2"),
    ],
  },
};

/** Card file extensions each emulator recognises in its folder. */
const CARD_EXTENSIONS: Record<CardKind, string[]> = {
  ps1: [".mcr", ".mcd", ".ps1", ".srm"],
  ps2: [".ps2", ".mc2", ".bin"],
};

export function findEmulator(id: EmulatorId): EmulatorCards {
  const spec = SPEC[id];
  const installPath = firstExisting(spec.exe);

  // A portable install keeps its data beside the executable, so that is checked
  // first - otherwise a stale Documents folder from an old install would win.
  const portable = installPath ? path.join(path.dirname(installPath), "memcards") : null;
  const dataRoot = firstExisting(spec.data);
  const cardFolder = firstExisting([
    ...(portable ? [portable] : []),
    ...(dataRoot ? [path.join(dataRoot, "memcards")] : []),
  ]);

  let cards: string[] = [];
  if (cardFolder) {
    try {
      cards = fs
        .readdirSync(cardFolder)
        .filter((f) => CARD_EXTENSIONS[spec.kind].includes(path.extname(f).toLowerCase()));
    } catch {
      cards = [];
    }
  }

  return { id, name: spec.name, kind: spec.kind, installPath, cardFolder, cards };
}

export function findEmulators(): EmulatorCards[] {
  return (Object.keys(SPEC) as EmulatorId[]).map(findEmulator);
}

/**
 * Copies a card into the emulator's folder so it shows up in its slot list.
 *
 * A copy, not a move: the menu keeps its own card as the one it manages, and the
 * emulator gets an identical file under the same name. Writing in place into the
 * emulator's folder while it is running is how cards get corrupted, so this is
 * only ever done between sessions.
 */
export function publishToEmulator(card: MemoryCard, id: EmulatorId): { ok: boolean; message: string } {
  const emulator = findEmulator(id);
  if (emulator.kind !== card.kind) {
    return { ok: false, message: `${emulator.name} does not take ${card.kind === "ps1" ? "PS" : "PS2"} cards` };
  }
  if (!emulator.cardFolder) {
    return {
      ok: false,
      message: `Could not find ${emulator.name}'s memory card folder. Run it once so it creates one.`,
    };
  }

  const target = path.join(emulator.cardFolder, path.basename(card.filePath));
  try {
    // Temp then rename, so the emulator never sees a partly written card.
    const temp = `${target}.tmp`;
    fs.copyFileSync(card.filePath, temp);
    fs.renameSync(temp, target);
    return { ok: true, message: `${card.name} is now in ${emulator.name}` };
  } catch (err) {
    return { ok: false, message: `Could not write to ${emulator.name}: ${(err as Error).message}` };
  }
}

/** Brings a card the emulator owns into the menu's own folder, leaving the original. */
export function adoptFromEmulator(id: EmulatorId, fileName: string, into: string): { ok: boolean; message: string } {
  const emulator = findEmulator(id);
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
export function exportSave(cardPath: string, saveName: string, intoFolder: string): { ok: boolean; message: string; file?: string } {
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
      const file = path.join(intoFolder, `${name.replace(/[<>:"/\\|?*]/g, "")}.mcs`);
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
export function overview(): { managed: MemoryCard[]; emulators: EmulatorCards[] } {
  return { managed: listCards(), emulators: findEmulators() };
}
