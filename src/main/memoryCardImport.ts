import * as fs from "node:fs";
import * as path from "node:path";
import { CardKind } from "./memoryCard";
import { readPsu, readPsvPs2, iconSysTitle } from "./ps2card";

/**
 * Bringing existing saves onto a virtual card.
 *
 * People's saves arrive in whatever their old tool produced, so this reads the
 * formats that actually turn up rather than one blessed one:
 *
 *   .mcr .mcd .ps1  a raw PS card image; the whole 128 KB, saves and all
 *   .gme            DexDrive: a 3904-byte header, then exactly that image
 *   .psu            a PS2 save directory, packed as 512-byte entry headers
 *   .cbs            CodeBreaker, whose payload is compressed - recognised, not read
 *   .xdelta         a patch, not a save at all, and said so plainly
 *
 * The last two matter as much as the first three. A tool that silently ignores a
 * file the user believes is a save is worse than one that says what the file is.
 */

/** A PS card is sixteen 8 KB blocks; block 0 is the directory. */
const PS1_BLOCK = 8192;
const PS1_SIZE = PS1_BLOCK * 16;
const PS1_FRAME = 128;
const DEXDRIVE_HEADER = 3904;

/** Directory entry states. Anything else means the block is not a save's start. */
const STATE_FIRST = 0x51;
const STATE_FREE = 0xa0;

export interface ImportCandidate {
  filePath: string;
  fileName: string;
  kind: CardKind | null;
  format: "raw" | "dexdrive" | "psu" | "cbs" | "unsupported";
  /** Saves inside, where they can be read without guessing. */
  saves: { name: string; title: string; blocks: number }[];
  supported: boolean;
  /** Why not, when it isn't. Shown to the user rather than swallowed. */
  reason?: string;
}

export interface ImportOutcome {
  ok: boolean;
  imported: number;
  message: string;
}

function xorFrame(frame: Buffer): number {
  let x = 0;
  for (let i = 0; i < PS1_FRAME - 1; i++) x ^= frame[i];
  return x;
}

function entryName(entry: Buffer): string {
  const raw = entry.subarray(10, 31).toString("latin1");
  const end = raw.indexOf("\u0000");
  return (end === -1 ? raw : raw.slice(0, end)).trim();
}

/** Region and product code are noise when the point is to recognise the game. */
function prettyTitle(name: string): string {
  // BASLUS-001700, BESCES-01234, BISLPS-... - four letters after the region pair,
  // then five or six digits. An earlier, shorter pattern left the code in place.
  return name.replace(/^B[AEIJ][A-Z]{4}-?\d{5,6}/i, "").trim() || name;
}

/**
 * A PS save's own title, read from the first block of its data.
 *
 * Every save opens with "SC", two icon bytes, then 64 bytes of title. That is the
 * name the console shows, so it is what a list should show too - the directory
 * entry only carries a product code, which tells a person nothing. Titles are
 * Shift-JIS; for the Latin range that is ASCII, and anything outside it is
 * dropped rather than rendered as noise.
 */
function ps1SaveTitle(image: Buffer, block: number): string | null {
  const start = block * PS1_BLOCK;
  if (start + 68 > image.length) return null;
  if (image.toString("latin1", start, start + 2) !== "SC") return null;

  const raw = image.subarray(start + 4, start + 68);
  let title = "";
  for (let i = 0; i < raw.length; i++) {
    const byte = raw[i];
    if (byte === 0) break;
    // Shift-JIS lead bytes start a two-byte character we cannot render here.
    if ((byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xef)) {
      i++;
      continue;
    }
    if (byte >= 0x20 && byte < 0x7f) title += String.fromCharCode(byte);
  }
  // Console titles are padded and often full-width; collapse the gaps.
  return title.replace(/\s{2,}/g, " ").trim() || null;
}


/** Pulls the 128 KB card image out of whatever wrapper it arrived in. */
function ps1Image(file: string): Buffer | null {
  const data = fs.readFileSync(file);
  if (data.length === PS1_SIZE && data.toString("latin1", 0, 2) === "MC") return data;
  // DexDrive keeps a fixed header in front of an otherwise ordinary image.
  if (data.length === PS1_SIZE + DEXDRIVE_HEADER && data.toString("latin1", 0, 11) === "123-456-STD") {
    const image = data.subarray(DEXDRIVE_HEADER);
    return image.toString("latin1", 0, 2) === "MC" ? image : null;
  }
  // Some dumps carry trailing junk; the leading image is still usable.
  if (data.length > PS1_SIZE && data.toString("latin1", 0, 2) === "MC") return data.subarray(0, PS1_SIZE);
  return null;
}

/**
 * Every save on a card, with the chain of blocks it occupies.
 *
 * A save starts at a block whose state is 0x51 and continues through the link in
 * each entry. The link is the *zero-based* index among the fifteen data blocks, so
 * a link of 1 means block 2 - getting that off by one silently truncates saves.
 */
function ps1Chains(image: Buffer): { name: string; size: number; blocks: number[] }[] {
  const out: { name: string; size: number; blocks: number[] }[] = [];
  const frame = (i: number) => image.subarray(i * PS1_FRAME, (i + 1) * PS1_FRAME);

  for (let i = 1; i <= 15; i++) {
    const entry = frame(i);
    if ((entry.readUInt32LE(0) & 0xff) !== STATE_FIRST) continue;

    const name = entryName(entry);
    if (!name) continue;

    const blocks = [i];
    let link = entry.readUInt16LE(8);
    // Bounded by the block count: a corrupt link must not loop forever.
    for (let guard = 0; link !== 0xffff && guard < 15; guard++) {
      const next = link + 1;
      if (next < 1 || next > 15 || blocks.includes(next)) break;
      blocks.push(next);
      link = frame(next).readUInt16LE(8);
    }
    out.push({ name, size: entry.readUInt32LE(4), blocks });
  }
  return out;
}

/** Entries in a PSU are 512-byte headers; a directory's size is its child count. */
function psuEntries(file: string): { name: string; size: number }[] {
  const data = fs.readFileSync(file);
  const out: { name: string; size: number }[] = [];
  let offset = 0;

  while (offset + 512 <= data.length) {
    const mode = data.readUInt32LE(offset);
    const size = data.readUInt32LE(offset + 4);
    const raw = data.subarray(offset + 0x40, offset + 0x40 + 32).toString("latin1");
    const end = raw.indexOf("\u0000");
    const name = (end === -1 ? raw : raw.slice(0, end)).trim();
    offset += 512;

    // Bit 13 marks a directory; "." and ".." carry no payload to skip past.
    const isDir = (mode & 0x2000) !== 0;
    if (!isDir && name && name !== "." && name !== "..") {
      out.push({ name, size });
      // File data follows, padded up to the next 1024-byte boundary.
      offset += Math.ceil(size / 1024) * 1024;
    }
    if (out.length > 256) break;
  }
  return out;
}

/** Reads a file and says what it is, without changing anything. */
export function inspect(filePath: string): ImportCandidate {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const base: ImportCandidate = { filePath, fileName, kind: null, format: "unsupported", saves: [], supported: false };

  try {
    if ([".mcr", ".mcd", ".ps1", ".gme", ".mc", ".srm"].includes(ext)) {
      const image = ps1Image(filePath);
      if (!image) {
        return { ...base, kind: "ps1", reason: "This does not look like a PlayStation card image" };
      }
      const saves = ps1Chains(image).map((c) => ({
        name: c.name,
        // The save's own title first; the tidied directory name is the fallback.
        title: ps1SaveTitle(image, c.blocks[0]) ?? prettyTitle(c.name),
        blocks: c.blocks.length,
      }));
      return {
        ...base,
        kind: "ps1",
        format: ext === ".gme" ? "dexdrive" : "raw",
        saves,
        supported: true,
        reason: saves.length === 0 ? "The card image is readable but holds no saves" : undefined,
      };
    }

    if (ext === ".psu" || ext === ".psv") {
      // PS2 saves: read whole by ps2card.ts and written onto a card as a directory.
      const buf = fs.readFileSync(filePath);
      const bundle = ext === ".psv" ? readPsvPs2(buf) : readPsu(buf);
      if (!bundle) {
        return { ...base, kind: ext === ".psv" ? null : "ps2", format: "psu", reason: ext === ".psv" ? "A PS1 .psv, which the PS1 importer doesn't read yet" : "Not a .psu this reads" };
      }
      const icon = bundle.files.find((f) => f.name.toLowerCase() === "icon.sys");
      const title = icon ? iconSysTitle(icon.data) : "";
      return {
        ...base,
        kind: "ps2",
        format: "psu",
        saves: [{ name: bundle.name, title: title || prettyTitle(bundle.name), blocks: bundle.files.length }],
        supported: true,
      };
    }

    if (ext === ".cbs") {
      return {
        ...base,
        kind: "ps2",
        format: "cbs",
        reason: "CodeBreaker saves are compressed and not readable yet",
      };
    }

    if (ext === ".xdelta" || ext === ".vcdiff" || ext === ".ips" || ext === ".bps") {
      return { ...base, reason: "This is a patch for a game, not a save" };
    }

    return { ...base, reason: "Not a save format A-X-M knows" };
  } catch (err) {
    return { ...base, reason: `Could not read the file: ${(err as Error).message}` };
  }
}

/**
 * Copies saves from a source image onto a card.
 *
 * Blocks are rewritten into whatever slots are free on the target, so the chain
 * links are rebuilt rather than copied - a save that sat in blocks 3 and 4 can
 * land in 7 and 12 and still load. Anything that will not fit is reported instead
 * of being half-written, and the card is only touched once every save has a home.
 */
export function importPs1(cardPath: string, sourcePath: string, only?: string[]): ImportOutcome {
  const image = ps1Image(sourcePath);
  if (!image) return { ok: false, imported: 0, message: "That file is not a PlayStation card image" };

  const card = fs.readFileSync(cardPath);
  if (card.length !== PS1_SIZE) return { ok: false, imported: 0, message: "The target card is not a PS card" };

  const frame = (buf: Buffer, i: number) => buf.subarray(i * PS1_FRAME, (i + 1) * PS1_FRAME);
  const free: number[] = [];
  for (let i = 1; i <= 15; i++) {
    if ((frame(card, i).readUInt32LE(0) & 0xff) === STATE_FREE) free.push(i);
  }

  const wanted = ps1Chains(image).filter((c) => !only || only.includes(c.name));
  if (wanted.length === 0) return { ok: false, imported: 0, message: "Nothing on that image to bring over" };

  const needed = wanted.reduce((sum, c) => sum + c.blocks.length, 0);
  if (needed > free.length) {
    return {
      ok: false,
      imported: 0,
      message: `Needs ${needed} block${needed === 1 ? "" : "s"}, the card has ${free.length} free`,
    };
  }

  let cursor = 0;
  for (const save of wanted) {
    const targets = save.blocks.map(() => free[cursor++]);

    save.blocks.forEach((sourceBlock, index) => {
      const target = targets[index];
      // The block's 8 KB of data, copied across unchanged.
      image.copy(card, target * PS1_BLOCK, sourceBlock * PS1_BLOCK, (sourceBlock + 1) * PS1_BLOCK);

      const from = frame(image, sourceBlock);
      const to = frame(card, target);
      from.copy(to);

      // Relink: the next block is the following target, as a zero-based index.
      const isLast = index === targets.length - 1;
      to.writeUInt16LE(isLast ? 0xffff : targets[index + 1] - 1, 8);
      to[PS1_FRAME - 1] = xorFrame(to);
    });
  }

  const temp = `${cardPath}.tmp`;
  fs.writeFileSync(temp, card);
  fs.renameSync(temp, cardPath);

  return {
    ok: true,
    imported: wanted.length,
    message: `Brought over ${wanted.length} save${wanted.length === 1 ? "" : "s"}`,
  };
}

/**
 * Finds importable saves on a drive.
 *
 * The agreed shape is <drive>/SAVE/PS and <drive>/SAVE/PS2, so a stick can be
 * dropped in and the right files appear without anyone browsing for them. The
 * match is case-insensitive, because a card formatted on a console will not
 * necessarily agree with one formatted on a PC about capitalisation.
 */
export function scanDrive(root: string): { ps1: ImportCandidate[]; ps2: ImportCandidate[] } {
  const found = { ps1: [] as ImportCandidate[], ps2: [] as ImportCandidate[] };

  const dirIn = (parent: string, name: string): string | null => {
    try {
      const hit = fs.readdirSync(parent, { withFileTypes: true })
        .find((e) => e.isDirectory() && e.name.toLowerCase() === name.toLowerCase());
      return hit ? path.join(parent, hit.name) : null;
    } catch {
      return null;
    }
  };

  const saveDir = dirIn(root, "SAVE");
  if (!saveDir) return found;

  for (const [key, folder] of [["ps1", "PS"], ["ps2", "PS2"]] as const) {
    const dir = dirIn(saveDir, folder);
    if (!dir) continue;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        found[key].push(inspect(path.join(dir, entry.name)));
      }
    } catch {
      // Unreadable folder; the other one may still work.
    }
  }
  return found;
}
