import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Working out what a memory card file actually is.
 *
 * Extensions lie. People rename a DexDrive dump to .mcr because that is what
 * their emulator asks for, tools write raw images as .bin, and a .psv could hold
 * either a PS1 or a PS2 save. Reading a file as the wrong format is how cards get
 * destroyed, so nothing here trusts the name: every format is identified by its
 * own signature or by the shape of its contents, and the extension is used only
 * to break a genuine tie.
 *
 * Anything that cannot be identified is reported as unknown rather than guessed
 * at. Refusing to touch a file is always better than corrupting somebody's save.
 */

export type Console = "ps1" | "ps2";

/** What a file holds: a whole card, or a single save lifted off one. */
export type Shape = "card" | "save";

export type FormatId =
  // PS1 whole cards
  | "ps1-raw"
  | "ps1-gme"
  | "ps1-vgs"
  | "ps1-vmp"
  // PS1 single saves
  | "ps1-mcs"
  | "ps1-psv"
  | "ps1-raw-save"
  // PS2 whole cards
  | "ps2-raw"
  | "ps2-noecc"
  | "ps2-folder"
  // PS2 single saves
  | "ps2-psu"
  | "ps2-max"
  | "ps2-cbs"
  | "ps2-sharkport"
  | "ps2-psv"
  | "unknown";

export interface Detected {
  format: FormatId;
  console: Console | null;
  shape: Shape | null;
  /** Short name for the badge in the menu, as on the Import/Export screen. */
  label: string;
  /** Bytes of header to skip to reach the card image, for whole-card formats. */
  headerLength: number;
  /** Size of the card image itself, once the header is skipped. */
  imageLength: number;
  /** Why this was rejected, when the format is unknown. */
  reason?: string;
}

const PS1_CARD = 131072; // 16 blocks of 8192
const PS1_BLOCK = 8192;
const PS1_FRAME = 128;
const GME_HEADER = 3904;
const VGS_HEADER = 64;
const VMP_HEADER = 128;

const PS2_PAGE = 512;
const PS2_SPARE = 16;
const PS2_RAW_8MB = 8650752; // 16384 pages of 528
const PS2_NOECC_8MB = 8388608; // the same card with the spare bytes stripped
const PS2_SUPERBLOCK = "Sony PS2 Memory Card Format ";

function unknown(reason: string): Detected {
  return { format: "unknown", console: null, shape: null, label: "?", headerLength: 0, imageLength: 0, reason };
}

function ascii(buf: Buffer, start: number, length: number): string {
  return buf.subarray(start, start + length).toString("latin1");
}

/**
 * A PS1 card image starts with "MC" and its directory frames each carry an XOR
 * checksum in the last byte. Checking a few of those separates a real card from
 * any other file that happens to begin with those two letters.
 */
function looksLikePs1Image(buf: Buffer, at: number): boolean {
  if (buf.length < at + PS1_CARD) return false;
  if (ascii(buf, at, 2) !== "MC") return false;

  let checked = 0;
  for (let frame = 0; frame <= 15; frame++) {
    const base = at + frame * PS1_FRAME;
    let xor = 0;
    for (let i = 0; i < PS1_FRAME - 1; i++) xor ^= buf[base + i];
    if (xor !== buf[base + PS1_FRAME - 1]) return false;
    checked++;
  }
  return checked === 16;
}

/** A PS2 card carries its format string in the first page of the superblock. */
function looksLikePs2Image(buf: Buffer, at: number): boolean {
  if (buf.length < at + PS2_SUPERBLOCK.length) return false;
  return ascii(buf, at, PS2_SUPERBLOCK.length) === PS2_SUPERBLOCK;
}

/** PS2 directory entry flags, as the console itself writes them. */
const PS2_EXISTS = 0x8000;
const PS2_DIRECTORY = 0x0020;

/** The name in a 512-byte entry header, which is NUL-padded to 32 bytes. */
function entryName(buf: Buffer, at: number): string {
  return ascii(buf, at + 0x40, 32).replace(/\u0000[\s\S]*$/, "");
}

/**
 * A .psu is a stream of 512-byte entry headers.
 *
 * The first entry is the save's own directory and carries its name - usually the
 * game code, like BASLUS-21050 - with a count of the entries it holds. The two
 * after it are the "." and ".." the console writes into every directory, and
 * finding both is what separates a .psu from any other file that happens to open
 * with a plausible word.
 */
function looksLikePsu(buf: Buffer): boolean {
  if (buf.length < PS2_PAGE * 3) return false;

  const mode = buf.readUInt32LE(0);
  if ((mode & PS2_EXISTS) === 0) return false;
  if ((mode & PS2_DIRECTORY) === 0) return false;

  // It must name itself, and claim to hold something.
  if (entryName(buf, 0).length === 0) return false;
  if (buf.readUInt32LE(4) === 0) return false;

  return entryName(buf, PS2_PAGE) === "." && entryName(buf, PS2_PAGE * 2) === "..";
}

/**
 * An .mcs is one directory frame followed by the save's blocks. The frame opens
 * with the in-use marker and the payload starts with the "SC" a save always has.
 */
function looksLikeMcs(buf: Buffer): boolean {
  if (buf.length < PS1_FRAME + PS1_BLOCK) return false;
  if ((buf.readUInt32LE(0) & 0xff) !== 0x51) return false;
  if ((buf.length - PS1_FRAME) % PS1_BLOCK !== 0) return false;
  return ascii(buf, PS1_FRAME, 2) === "SC";
}

/**
 * Identifies a file from its contents.
 *
 * Order matters: the formats with real magic numbers are tested first, and the
 * headerless ones - which can only be recognised by size and internal structure -
 * are left until nothing else has claimed the file.
 */
export function detectBuffer(buf: Buffer, hintName = ""): Detected {
  const ext = path.extname(hintName).toLowerCase();

  if (buf.length === 0) return unknown("the file is empty");

  // ---- formats that announce themselves --------------------------------------

  // DexDrive: a 3904-byte header, then an ordinary PS1 card.
  if (buf.length >= GME_HEADER + PS1_CARD && ascii(buf, 0, 11) === "123-456-STD") {
    if (looksLikePs1Image(buf, GME_HEADER)) {
      return { format: "ps1-gme", console: "ps1", shape: "card", label: "GME", headerLength: GME_HEADER, imageLength: PS1_CARD };
    }
    return unknown("a DexDrive header, but the card inside it is damaged");
  }

  // Virtual Game Station: 64-byte header, then an ordinary PS1 card.
  if (buf.length >= VGS_HEADER + PS1_CARD && ascii(buf, 0, 4) === "VgsM") {
    if (looksLikePs1Image(buf, VGS_HEADER)) {
      return { format: "ps1-vgs", console: "ps1", shape: "card", label: "VGS", headerLength: VGS_HEADER, imageLength: PS1_CARD };
    }
    return unknown("a VGS header, but the card inside it is damaged");
  }

  // PSP: a 128-byte signed header, then an ordinary PS1 card.
  if (buf.length >= VMP_HEADER + PS1_CARD && buf[0] === 0x00 && ascii(buf, 1, 3) === "PMV") {
    if (looksLikePs1Image(buf, VMP_HEADER)) {
      return { format: "ps1-vmp", console: "ps1", shape: "card", label: "VMP", headerLength: VMP_HEADER, imageLength: PS1_CARD };
    }
    return unknown("a PSP card header, but the card inside it is damaged");
  }

  // PS3 virtual save. The type word says which console it came from.
  if (buf.length > 0x40 && buf[0] === 0x00 && ascii(buf, 1, 3) === "VSP") {
    const type = buf.readUInt32LE(0x3c);
    if (type === 1) {
      return { format: "ps1-psv", console: "ps1", shape: "save", label: "PSV", headerLength: 0, imageLength: buf.length };
    }
    if (type === 2) {
      return { format: "ps2-psv", console: "ps2", shape: "save", label: "PSV", headerLength: 0, imageLength: buf.length };
    }
    return unknown(`a PSV save of an unrecognised type (${type})`);
  }

  // CodeBreaker.
  if (buf.length > 4 && ascii(buf, 0, 4) === "CFU\u0000") {
    return { format: "ps2-cbs", console: "ps2", shape: "save", label: "CBS", headerLength: 0, imageLength: buf.length };
  }

  // MAX Drive.
  if (buf.length > 12 && ascii(buf, 0, 12) === "Ps2PowerSave") {
    return { format: "ps2-max", console: "ps2", shape: "save", label: "MAX", headerLength: 0, imageLength: buf.length };
  }

  // SharkPort and X-Port: a length word, then the name of the format.
  if (buf.length > 4 + 13 && ascii(buf, 4, 13) === "SharkPortSave") {
    return { format: "ps2-sharkport", console: "ps2", shape: "save", label: ext === ".xps" ? "XPS" : "SPS", headerLength: 0, imageLength: buf.length };
  }

  // ---- formats recognised by their structure ---------------------------------

  if (looksLikePs2Image(buf, 0)) {
    // With the spare bytes the pages are 528 bytes; without them, 512.
    const withEcc = buf.length % (PS2_PAGE + PS2_SPARE) === 0;
    return {
      format: withEcc ? "ps2-raw" : "ps2-noecc",
      console: "ps2",
      shape: "card",
      label: withEcc ? "PS2" : "BIN",
      headerLength: 0,
      imageLength: buf.length,
    };
  }

  if (looksLikePs1Image(buf, 0)) {
    return { format: "ps1-raw", console: "ps1", shape: "card", label: ps1CardLabel(ext), headerLength: 0, imageLength: PS1_CARD };
  }

  if (looksLikePsu(buf)) {
    return { format: "ps2-psu", console: "ps2", shape: "save", label: "PSU", headerLength: 0, imageLength: buf.length };
  }

  if (looksLikeMcs(buf)) {
    return { format: "ps1-mcs", console: "ps1", shape: "save", label: "MCS", headerLength: 0, imageLength: buf.length };
  }

  // A bare save block, with no directory frame in front of it.
  if (buf.length % PS1_BLOCK === 0 && ascii(buf, 0, 2) === "SC") {
    return { format: "ps1-raw-save", console: "ps1", shape: "save", label: "PSX", headerLength: 0, imageLength: buf.length };
  }

  // ---- nothing matched -------------------------------------------------------

  if (buf.length === PS1_CARD) return unknown("the right size for a PS card, but its directory is not valid");
  if (buf.length === PS2_RAW_8MB || buf.length === PS2_NOECC_8MB) {
    return unknown("the right size for a PS2 card, but it has no superblock");
  }
  return unknown("not a memory card or save this can read");
}

/** PS1 raw images are the same bytes whatever they are called; keep the name. */
function ps1CardLabel(ext: string): string {
  switch (ext) {
    case ".mcd":
      return "MCD";
    case ".mc":
      return "MC";
    case ".gme":
      return "GME";
    case ".mem":
      return "MEM";
    case ".vgs":
      return "VGS";
    case ".srm":
      return "SRM";
    default:
      return "MCR";
  }
}

/**
 * Identifies a path, which may be a PCSX2 folder card rather than a file.
 *
 * Only the head of a large card is read: the superblock and directory sit at the
 * front, and pulling eight megabytes off disk to look at the first page would
 * make listing a folder of cards needlessly slow.
 */
export function detectPath(target: string): Detected {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return unknown("the file could not be opened");
  }

  if (stat.isDirectory()) {
    if (fs.existsSync(path.join(target, "_pcsx2_superblock"))) {
      return { format: "ps2-folder", console: "ps2", shape: "card", label: "FOLDER", headerLength: 0, imageLength: 0 };
    }
    return unknown("a folder, but not a PCSX2 folder card");
  }

  // Enough for every header and structural check above.
  const want = Math.min(stat.size, GME_HEADER + PS1_CARD);
  const buf = Buffer.alloc(want);
  try {
    const fd = fs.openSync(target, "r");
    try {
      fs.readSync(fd, buf, 0, want, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return unknown("the file could not be read");
  }

  const detected = detectBuffer(buf, path.basename(target));
  // Size-based judgements need the real length, not the length of the head read.
  if (detected.format === "ps2-raw" || detected.format === "ps2-noecc") {
    const withEcc = stat.size % (PS2_PAGE + PS2_SPARE) === 0;
    return {
      ...detected,
      format: withEcc ? "ps2-raw" : "ps2-noecc",
      label: withEcc ? "PS2" : "BIN",
      imageLength: stat.size,
    };
  }
  if (detected.shape === "save") return { ...detected, imageLength: stat.size };
  return detected;
}

/** True when this is something that can be written onto a card of that console. */
export function isImportableSave(d: Detected, onto: Console): boolean {
  return d.shape === "save" && d.console === onto;
}

/** True when the file is a whole card of that console. */
export function isCard(d: Detected, of: Console): boolean {
  return d.shape === "card" && d.console === of;
}
