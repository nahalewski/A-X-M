import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { Ps2Card, formatPs2Image } from "./ps2card";

/**
 * Virtual PlayStation and PlayStation 2 memory cards.
 *
 * These are the same files DuckStation and PCSX2 use, written here so a card can
 * be made from the menu rather than from an emulator's settings screen. Nothing
 * proprietary is involved: both layouts are long-documented, and an empty card is
 * just a header, a directory and a lot of zeroes.
 *
 * Cards live in one folder so the emulators can be pointed at it once and every
 * card made afterwards is found automatically.
 */

export type CardKind = "ps1" | "ps2";

export interface MemoryCard {
  /** Stable id, the file's base name. */
  id: string;
  name: string;
  kind: CardKind;
  filePath: string;
  sizeBytes: number;
  /** Slot the emulator should mount it in, 1 or 2. */
  slot: 1 | 2;
  createdAt: string;
}

export interface CardSave {
  /** The directory name, e.g. BASLUS-12345SAVEDATA. */
  name: string;
  /** Title from the save where one is readable, else the directory name. */
  title: string;
  sizeBytes: number;
  /** PS1 only: how many of the fifteen blocks this save occupies. */
  blocks?: number;
  /** PS2 only: the files inside the save directory. */
  files?: string[];
}

// ---------------------------------------------------------------- layout ----

/** PS1: sixteen 8 KB blocks. Block 0 is the directory, 1-15 hold saves. */
const PS1_BLOCK = 8192;
const PS1_BLOCKS = 16;
const PS1_SIZE = PS1_BLOCK * PS1_BLOCKS;
const PS1_FRAME = 128;

/** PS2: 8 MB, as 16384 pages of 512 bytes plus 16 bytes of spare each. */
const PS2_PAGE_DATA = 512;
const PS2_PAGE_SPARE = 16;
const PS2_PAGE = PS2_PAGE_DATA + PS2_PAGE_SPARE;
const PS2_PAGES = 16384;
const PS2_SIZE = PS2_PAGE * PS2_PAGES;

function cardsDir(): string {
  return path.join(app.getPath("userData"), "memcards");
}

function indexPath(): string {
  return path.join(cardsDir(), "cards.json");
}

/** Safe on disk, and still readable when an emulator lists the folder. */
function safe(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\.+$/, "").trim().slice(0, 60) || "Memory Card";
}

// ------------------------------------------------------------------- PS1 ----

/** Every PS1 frame ends with an XOR of the bytes before it. */
function ps1Checksum(frame: Buffer): number {
  let x = 0;
  for (let i = 0; i < PS1_FRAME - 1; i++) x ^= frame[i];
  return x;
}

/**
 * An empty PS1 card. Block 0 carries the header frame, fifteen free directory
 * entries, and the broken-sector table; the rest is zeroes.
 */
function buildPs1(): Buffer {
  const card = Buffer.alloc(PS1_SIZE, 0);

  const frame = (index: number): Buffer => card.subarray(index * PS1_FRAME, (index + 1) * PS1_FRAME);

  // Frame 0: the header. "MC" and then nothing until the checksum.
  const header = frame(0);
  header.write("MC", 0, "latin1");
  header[PS1_FRAME - 1] = ps1Checksum(header);

  // Frames 1-15: one directory entry per save block, all free.
  for (let i = 1; i <= 15; i++) {
    const entry = frame(i);
    entry.writeUInt32LE(0xa0, 0); // free, and the first block of its chain
    entry.writeUInt32LE(0, 4); // no size
    entry.writeUInt16LE(0xffff, 8); // no next block
    entry[PS1_FRAME - 1] = ps1Checksum(entry);
  }

  // Frames 16-35: the broken sector list, every slot marked unused.
  for (let i = 16; i <= 35; i++) {
    const entry = frame(i);
    entry.writeUInt32LE(0xffffffff, 0);
    entry.writeUInt16LE(0xffff, 8);
    entry[PS1_FRAME - 1] = ps1Checksum(entry);
  }

  // Frames 36-62 are unwritten, and frame 63 repeats the header as a write test.
  for (let i = 36; i <= 62; i++) frame(i).fill(0xff);
  const tail = frame(63);
  tail.fill(0);
  tail.write("MC", 0, "latin1");
  tail[PS1_FRAME - 1] = ps1Checksum(tail);

  return card;
}

/** Reads the directory. A free entry has 0xA0 in its state, so it is skipped. */
function readPs1Saves(file: string): CardSave[] {
  const card = fs.readFileSync(file);
  if (card.length < PS1_SIZE) return [];
  const saves: CardSave[] = [];

  for (let i = 1; i <= 15; i++) {
    const entry = card.subarray(i * PS1_FRAME, (i + 1) * PS1_FRAME);
    const state = entry.readUInt32LE(0);
    // 0x51 is a save's first block; 0x52 and 0x53 continue one, so only the
    // first is listed - otherwise one save would appear three times.
    if (state !== 0x51) continue;

    const size = entry.readUInt32LE(4);
    const raw = entry.subarray(10, 31).toString("latin1");
    const name = raw.slice(0, raw.indexOf("\u0000") === -1 ? raw.length : raw.indexOf("\u0000")).trim();
    if (!name) continue;

    // The save's own title, from the first block of its data - the directory
    // entry only carries a product code, which tells a person nothing.
    const start = i * PS1_BLOCK;
    let title = "";
    if (card.toString("latin1", start, start + 2) === "SC") {
      const raw = card.subarray(start + 4, start + 68);
      for (let k = 0; k < raw.length; k++) {
        const byte = raw[k];
        if (byte === 0) break;
        if ((byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xef)) {
          k++;
          continue;
        }
        if (byte >= 0x20 && byte < 0x7f) title += String.fromCharCode(byte);
      }
      title = title.replace(/\s{2,}/g, " ").trim();
    }

    saves.push({
      name,
      title: title || name.replace(/^B[AEIJ][A-Z]{4}-?\d{5,6}/i, "").trim() || name,
      sizeBytes: size,
      blocks: Math.max(1, Math.round(size / PS1_BLOCK)),
    });
  }
  return saves;
}

// ------------------------------------------------------------------- PS2 ----

/** PS2 saves are the directories under the card's root; ps2card.ts walks the FAT. */
function readPs2Saves(file: string): CardSave[] {
  return Ps2Card.open(file).listSaves().map((s) => ({ name: s.name, title: s.title, sizeBytes: s.sizeBytes, files: s.files.map((f) => f.name) }));
}

// ------------------------------------------------------------------ index ----

function loadIndex(): MemoryCard[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), "utf-8")) as MemoryCard[];
    return Array.isArray(parsed) ? parsed.filter((c) => fs.existsSync(c.filePath)) : [];
  } catch {
    return [];
  }
}

function saveIndex(cards: MemoryCard[]): void {
  try {
    fs.mkdirSync(cardsDir(), { recursive: true });
    const target = indexPath();
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(cards, null, 2), "utf-8");
    fs.renameSync(temp, target);
  } catch (err) {
    console.error("[A-X-M] could not save the memory card list:", err);
  }
}

export function listCards(): MemoryCard[] {
  return loadIndex();
}

export function cardsFolder(): string {
  return cardsDir();
}

/** Makes a card and records it. The file is the emulators' own format. */
export function createCard(kind: CardKind, name: string): MemoryCard {
  const cards = loadIndex();
  const clean = safe(name);
  const extension = kind === "ps1" ? "mcr" : "ps2";

  fs.mkdirSync(cardsDir(), { recursive: true });
  let base = clean;
  let file = path.join(cardsDir(), `${base}.${extension}`);
  // Two cards may share a name; the file cannot.
  for (let n = 2; fs.existsSync(file); n++) {
    base = `${clean} ${n}`;
    file = path.join(cardsDir(), `${base}.${extension}`);
  }

  fs.writeFileSync(file, kind === "ps1" ? buildPs1() : formatPs2Image());

  // New cards land in slot 1 until both are taken, matching what a console does.
  const usedSlots = cards.filter((c) => c.kind === kind).map((c) => c.slot);
  const slot: 1 | 2 = usedSlots.includes(1) ? 2 : 1;

  const card: MemoryCard = {
    id: base,
    name: clean,
    kind,
    filePath: file,
    sizeBytes: kind === "ps1" ? PS1_SIZE : PS2_SIZE,
    slot,
    createdAt: new Date().toISOString(),
  };
  cards.push(card);
  saveIndex(cards);
  return card;
}

export function renameCard(id: string, name: string): MemoryCard | null {
  const cards = loadIndex();
  const card = cards.find((c) => c.id === id);
  if (!card) return null;
  card.name = safe(name);
  saveIndex(cards);
  return card;
}

export function setCardSlot(id: string, slot: 1 | 2): MemoryCard | null {
  const cards = loadIndex();
  const card = cards.find((c) => c.id === id);
  if (!card) return null;
  // Slots are exclusive per kind, so whatever held it swaps with this card.
  const other = cards.find((c) => c.kind === card.kind && c.slot === slot && c.id !== id);
  if (other) other.slot = card.slot;
  card.slot = slot;
  saveIndex(cards);
  return card;
}

/** Removes the card from the list and deletes its file. */
export function deleteCard(id: string): boolean {
  const cards = loadIndex();
  const card = cards.find((c) => c.id === id);
  if (!card) return false;
  try {
    fs.rmSync(card.filePath, { force: true });
  } catch {
    // Gone already, or locked by a running emulator; drop it from the list anyway.
  }
  saveIndex(cards.filter((c) => c.id !== id));
  return true;
}

export function readSaves(id: string): CardSave[] {
  const card = loadIndex().find((c) => c.id === id);
  if (!card || !fs.existsSync(card.filePath)) return [];
  try {
    return card.kind === "ps1" ? readPs1Saves(card.filePath) : readPs2Saves(card.filePath);
  } catch {
    return [];
  }
}

/** Free and used blocks, for the card's own screen. PS1 counts in 8 KB blocks. */
export function cardUsage(id: string): { usedBlocks: number; totalBlocks: number } | null {
  const card = loadIndex().find((c) => c.id === id);
  if (!card) return null;
  if (card.kind !== "ps1") {
    // PS2: count in KB of the 8 MB, from what the saves hold.
    const used = readSaves(id).reduce((sum, s) => sum + s.sizeBytes, 0);
    return { usedBlocks: Math.ceil(used / 1024), totalBlocks: 8135 };
  }
  const used = readSaves(id).reduce((sum, s) => sum + (s.blocks ?? 1), 0);
  return { usedBlocks: used, totalBlocks: 15 };
}
