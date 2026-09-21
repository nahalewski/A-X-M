import * as fs from "node:fs";

/**
 * The PlayStation 2 memory card filesystem, read and written.
 *
 * A card is pages of 512 bytes (plus a 16-byte spare holding ECC when the card
 * says so), grouped into clusters of two. The superblock names the geometry and
 * the indirect FAT; the FAT chains clusters into files; directories are files
 * whose contents are 512-byte entries. This is the layout Sony's own cards use
 * and PCSX2's .ps2 files copy, long documented (Ross Ridge's ps2mc notes).
 *
 * What the menu needs: list the saves (directories under the root), read a
 * save's files, write a file back the same size (a patch), and add a whole save
 * (an import). Everything else - deleting, formatting - stays the emulator's.
 */

const ENTRY = 512;
const MODE_FILE = 0x0010;
const MODE_DIR = 0x0020;
const MODE_EXISTS = 0x8000;
const FAT_ALLOC = 0x80000000;
const FAT_LAST = 0x7fffffff;

export interface Ps2DirEntry {
  mode: number;
  length: number;
  cluster: number;
  name: string;
  created: Buffer;
  modified: Buffer;
  attr: number;
  /** Index of the entry within its directory. */
  index: number;
}

export interface Ps2SaveFile {
  name: string;
  size: number;
  attr: number;
}

export interface Ps2Save {
  /** Directory name, e.g. BASLUS-20216. */
  name: string;
  files: Ps2SaveFile[];
  sizeBytes: number;
  /** Title from icon.sys when present. */
  title: string;
}

/** Column and line parity, as the card controller computes it (and PCSX2). */
const ECC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let b = 0; b < 256; b++) {
    const bit = (n: number) => (b >> n) & 1;
    const par = (bits: number[]) => bits.reduce((a, n) => a ^ bit(n), 0);
    const p = par([0, 1, 2, 3, 4, 5, 6, 7]);
    const cp0 = par([0, 2, 4, 6]);
    const cp1 = par([1, 3, 5, 7]);
    const cp2 = par([0, 1, 4, 5]);
    const cp3 = par([2, 3, 6, 7]);
    const cp4 = par([0, 1, 2, 3]);
    const cp5 = par([4, 5, 6, 7]);
    t.push((p << 7) | (cp5 << 6) | (cp3 << 5) | (cp1 << 4) | (cp4 << 2) | (cp2 << 1) | cp0);
  }
  return t;
})();

function eccChunk(data: Buffer): [number, number, number] {
  let c0 = 0;
  let c1 = 0;
  let c2 = 0;
  for (let i = 0; i < 128; i++) {
    const c = ECC_TABLE[data[i]];
    c0 ^= c;
    if (c & 0x80) {
      c1 ^= ~i;
      c2 ^= i;
    }
  }
  return [~c0 & 0x77, ~c1 & 0x7f, ~c2 & 0x7f];
}

export class Ps2Card {
  private buf: Buffer;
  readonly pageLen: number;
  readonly pagesPerCluster: number;
  readonly clustersPerCard: number;
  readonly allocOffset: number;
  /** Count of allocatable clusters after allocOffset. */
  readonly allocEnd: number;
  readonly rootCluster: number;
  readonly ifcList: number[];
  readonly ecc: boolean;
  readonly rawPage: number;
  readonly clusterBytes: number;
  private fatCache = new Map<number, Buffer>();

  constructor(buf: Buffer) {
    this.buf = buf;
    if (buf.toString("latin1", 0, 28) !== "Sony PS2 Memory Card Format ") throw new Error("not a formatted PS2 memory card");
    this.pageLen = buf.readUInt16LE(0x28);
    this.pagesPerCluster = buf.readUInt16LE(0x2a);
    this.clustersPerCard = buf.readUInt32LE(0x30);
    this.allocOffset = buf.readUInt32LE(0x34);
    this.allocEnd = buf.readUInt32LE(0x38);
    this.rootCluster = buf.readUInt32LE(0x3c);
    this.ifcList = [];
    for (let i = 0; i < 32; i++) {
      const v = buf.readUInt32LE(0x50 + i * 4);
      if (v === 0xffffffff) break;
      this.ifcList.push(v);
    }
    this.ecc = (buf[0x151] & 0x01) !== 0;
    this.rawPage = this.pageLen + (this.ecc ? 16 : 0);
    this.clusterBytes = this.pageLen * this.pagesPerCluster;
    // A file-backed card without spare areas is exactly pages × 512; with them 528.
    if (buf.length < this.clustersPerCard * this.pagesPerCluster * this.rawPage) {
      throw new Error("card file is shorter than its superblock says");
    }
  }

  static open(file: string): Ps2Card {
    return new Ps2Card(fs.readFileSync(file));
  }

  image(): Buffer {
    return this.buf;
  }

  // -------------------------------------------------------------- pages ----

  /** The data of an absolute cluster (spare bytes skipped). */
  private readCluster(abs: number): Buffer {
    const out = Buffer.alloc(this.clusterBytes);
    for (let p = 0; p < this.pagesPerCluster; p++) {
      const at = (abs * this.pagesPerCluster + p) * this.rawPage;
      this.buf.copy(out, p * this.pageLen, at, at + this.pageLen);
    }
    return out;
  }

  private writeCluster(abs: number, data: Buffer): void {
    for (let p = 0; p < this.pagesPerCluster; p++) {
      const at = (abs * this.pagesPerCluster + p) * this.rawPage;
      const page = data.subarray(p * this.pageLen, (p + 1) * this.pageLen);
      page.copy(this.buf, at);
      if (this.ecc) {
        const spare = Buffer.alloc(16, 0);
        for (let c = 0; c < this.pageLen / 128; c++) {
          const [a, b, d] = eccChunk(page.subarray(c * 128, (c + 1) * 128));
          spare[c * 3] = a;
          spare[c * 3 + 1] = b;
          spare[c * 3 + 2] = d;
        }
        spare.copy(this.buf, at + this.pageLen);
      }
    }
  }

  // ---------------------------------------------------------------- FAT ----

  private entriesPerCluster(): number {
    return this.clusterBytes / 4;
  }

  /** Absolute cluster of the FAT cluster that holds entry `rel`. */
  private fatClusterFor(rel: number): number {
    const per = this.entriesPerCluster();
    const fatIndex = Math.floor(rel / per);
    const ifcIndex = Math.floor(fatIndex / per);
    const ifc = this.ifcList[ifcIndex];
    if (ifc === undefined) throw new Error("cluster outside the FAT");
    const indirect = this.readCluster(ifc);
    return indirect.readUInt32LE((fatIndex % per) * 4);
  }

  fatGet(rel: number): number {
    const abs = this.fatClusterFor(rel);
    let c = this.fatCache.get(abs);
    if (!c) {
      c = this.readCluster(abs);
      this.fatCache.set(abs, c);
    }
    return c.readUInt32LE((rel % this.entriesPerCluster()) * 4);
  }

  fatSet(rel: number, value: number): void {
    const abs = this.fatClusterFor(rel);
    let c = this.fatCache.get(abs);
    if (!c) {
      c = this.readCluster(abs);
      this.fatCache.set(abs, c);
    }
    c.writeUInt32LE(value >>> 0, (rel % this.entriesPerCluster()) * 4);
    this.writeCluster(abs, c);
  }

  /** Relative clusters of a chain, in order. */
  chain(first: number): number[] {
    const out: number[] = [];
    let c = first;
    const guard = this.clustersPerCard + 1;
    while (c !== 0xffffffff && out.length < guard) {
      out.push(c);
      const fat = this.fatGet(c);
      if ((fat & FAT_ALLOC) === 0) break; // not allocated: corrupt chain
      const next = fat & FAT_LAST;
      if (next === FAT_LAST) break;
      c = next;
    }
    return out;
  }

  private freeClusters(count: number): number[] {
    const out: number[] = [];
    for (let rel = 0; rel < this.allocEnd && out.length < count; rel++) {
      if ((this.fatGet(rel) & FAT_ALLOC) === 0) out.push(rel);
    }
    if (out.length < count) throw new Error("the card is full");
    return out;
  }

  private linkChain(clusters: number[]): void {
    for (let i = 0; i < clusters.length; i++) {
      this.fatSet(clusters[i], FAT_ALLOC | (i + 1 < clusters.length ? clusters[i + 1] : FAT_LAST));
    }
  }

  // --------------------------------------------------------------- files ----

  /** Reads a chain's bytes (up to `length`). */
  readChain(first: number, length: number): Buffer {
    const parts: Buffer[] = [];
    let left = length;
    for (const rel of this.chain(first)) {
      if (left <= 0) break;
      const data = this.readCluster(this.allocOffset + rel);
      parts.push(data.subarray(0, Math.min(this.clusterBytes, left)));
      left -= this.clusterBytes;
    }
    return Buffer.concat(parts);
  }

  private parseEntry(raw: Buffer, index: number): Ps2DirEntry {
    const name = raw.subarray(0x40, 0x60).toString("latin1").replace(/\0.*$/s, "");
    return {
      mode: raw.readUInt16LE(0),
      length: raw.readUInt32LE(4),
      created: Buffer.from(raw.subarray(8, 16)),
      cluster: raw.readUInt32LE(0x10),
      modified: Buffer.from(raw.subarray(0x18, 0x20)),
      attr: raw.readUInt32LE(0x20),
      name,
      index,
    };
  }

  /** Entries of a directory whose first cluster is `cluster` and which holds `count` entries. */
  readDir(cluster: number, count: number): Ps2DirEntry[] {
    const data = this.readChain(cluster, count * ENTRY);
    const out: Ps2DirEntry[] = [];
    for (let i = 0; i < count && (i + 1) * ENTRY <= data.length; i++) out.push(this.parseEntry(data.subarray(i * ENTRY, (i + 1) * ENTRY), i));
    return out;
  }

  private rootEntries(): Ps2DirEntry[] {
    const first = this.readChain(this.rootCluster, ENTRY);
    const dot = this.parseEntry(first, 0);
    return this.readDir(this.rootCluster, dot.length);
  }

  /** The saves on the card: every live directory under the root. */
  listSaves(): Ps2Save[] {
    const out: Ps2Save[] = [];
    for (const e of this.rootEntries()) {
      if (!(e.mode & MODE_EXISTS) || !(e.mode & MODE_DIR) || e.name === "." || e.name === "..") continue;
      const files: Ps2SaveFile[] = [];
      let total = 0;
      let title = "";
      for (const f of this.readDir(e.cluster, e.length)) {
        if (!(f.mode & MODE_EXISTS) || !(f.mode & MODE_FILE)) continue;
        files.push({ name: f.name, size: f.length, attr: f.attr });
        total += f.length;
        if (f.name.toLowerCase() === "icon.sys") {
          const sys = this.readChain(f.cluster, f.length);
          title = iconSysTitle(sys);
        }
      }
      out.push({ name: e.name, files, sizeBytes: total, title: title || e.name });
    }
    return out;
  }

  private findSaveDir(saveName: string): Ps2DirEntry | null {
    return this.rootEntries().find((e) => (e.mode & MODE_EXISTS) && (e.mode & MODE_DIR) && e.name === saveName) ?? null;
  }

  private findFile(saveName: string, fileName: string): Ps2DirEntry | null {
    const dir = this.findSaveDir(saveName);
    if (!dir) return null;
    return this.readDir(dir.cluster, dir.length).find((f) => (f.mode & MODE_EXISTS) && (f.mode & MODE_FILE) && f.name === fileName) ?? null;
  }

  readFile(saveName: string, fileName: string): Buffer | null {
    const f = this.findFile(saveName, fileName);
    return f ? this.readChain(f.cluster, f.length) : null;
  }

  /** Every file of a save, for export or patching. */
  readSave(saveName: string): { name: string; data: Buffer; attr: number; created: Buffer; modified: Buffer }[] | null {
    const dir = this.findSaveDir(saveName);
    if (!dir) return null;
    return this.readDir(dir.cluster, dir.length)
      .filter((f) => (f.mode & MODE_EXISTS) && (f.mode & MODE_FILE))
      .map((f) => ({ name: f.name, data: this.readChain(f.cluster, f.length), attr: f.attr, created: f.created, modified: f.modified }));
  }

  /**
   * Writes a file's bytes back. The same length overwrites the chain in place; a
   * different length re-allocates (the old clusters are freed) and updates the
   * directory entry. The card image is changed in memory; save() writes it out.
   */
  writeFile(saveName: string, fileName: string, data: Buffer): void {
    const dir = this.findSaveDir(saveName);
    if (!dir) throw new Error(`no save ${saveName} on the card`);
    const entries = this.readDir(dir.cluster, dir.length);
    const f = entries.find((x) => (x.mode & MODE_EXISTS) && (x.mode & MODE_FILE) && x.name === fileName);
    if (!f) throw new Error(`no file ${fileName} in ${saveName}`);
    const need = Math.ceil(data.length / this.clusterBytes);
    let clusters = f.cluster === 0xffffffff ? [] : this.chain(f.cluster);
    if (clusters.length !== need) {
      for (const c of clusters) this.fatSet(c, FAT_LAST); // free
      clusters = need ? this.freeClusters(need) : [];
      this.linkChain(clusters);
    }
    for (let i = 0; i < clusters.length; i++) {
      const chunk = Buffer.alloc(this.clusterBytes, 0);
      data.copy(chunk, 0, i * this.clusterBytes, Math.min(data.length, (i + 1) * this.clusterBytes));
      this.writeCluster(this.allocOffset + clusters[i], chunk);
    }
    // The entry: length, first cluster, modified time.
    this.updateEntry(dir.cluster, f.index, (raw) => {
      raw.writeUInt32LE(data.length, 4);
      raw.writeUInt32LE(clusters.length ? clusters[0] : 0xffffffff, 0x10);
      ps2Time(new Date()).copy(raw, 0x18);
    });
  }

  private updateEntry(dirCluster: number, index: number, edit: (raw: Buffer) => void): void {
    const chain = this.chain(dirCluster);
    const perCluster = this.clusterBytes / ENTRY;
    const rel = chain[Math.floor(index / perCluster)];
    const abs = this.allocOffset + rel;
    const data = this.readCluster(abs);
    edit(data.subarray((index % perCluster) * ENTRY, (index % perCluster + 1) * ENTRY));
    this.writeCluster(abs, data);
  }

  /**
   * Adds a whole save: a directory under the root with the given files. Refuses
   * a name already on the card; the caller decides about replacing.
   */
  addSave(saveName: string, files: { name: string; data: Buffer; attr?: number; created?: Buffer; modified?: Buffer }[], dirAttr = 0x8427): void {
    if (this.findSaveDir(saveName)) throw new Error(`${saveName} is already on the card`);
    const now = ps2Time(new Date());
    const entryFor = (name: string, mode: number, length: number, cluster: number, attr: number, created?: Buffer, modified?: Buffer, dirEntry = 0): Buffer => {
      const raw = Buffer.alloc(ENTRY, 0);
      raw.writeUInt16LE(mode, 0);
      raw.writeUInt32LE(length, 4);
      (created ?? now).copy(raw, 8);
      raw.writeUInt32LE(cluster, 0x10);
      raw.writeUInt32LE(dirEntry, 0x14);
      (modified ?? now).copy(raw, 0x18);
      raw.writeUInt32LE(attr, 0x20);
      raw.write(name.slice(0, 31), 0x40, "latin1");
      return raw;
    };

    // The save directory's own contents: ".", "..", then the files.
    const root = this.rootEntries();
    const rootDot = root[0];
    const dirEntries: Buffer[] = [];
    const fileClusters: number[][] = [];
    // Clusters for every file first, so a full card fails before anything is written.
    for (const f of files) fileClusters.push(f.data.length ? this.freeClustersExcluding(Math.ceil(f.data.length / this.clusterBytes), fileClusters.flat()) : []);
    const dirCount = 2 + files.length;
    const dirClusters = this.freeClustersExcluding(Math.ceil((dirCount * ENTRY) / this.clusterBytes), fileClusters.flat());
    // Room in the root for one more entry?
    const rootPer = this.clusterBytes / ENTRY;
    const rootChain = this.chain(this.rootCluster);
    const newIndex = rootDot.length;
    const rootNeeds = Math.ceil((newIndex + 1) / rootPer);
    const extraRoot = rootNeeds > rootChain.length ? this.freeClustersExcluding(rootNeeds - rootChain.length, [...fileClusters.flat(), ...dirClusters]) : [];

    // Write the files.
    for (let i = 0; i < files.length; i++) {
      const cl = fileClusters[i];
      this.linkChain(cl);
      for (let k = 0; k < cl.length; k++) {
        const chunk = Buffer.alloc(this.clusterBytes, 0);
        files[i].data.copy(chunk, 0, k * this.clusterBytes, Math.min(files[i].data.length, (k + 1) * this.clusterBytes));
        this.writeCluster(this.allocOffset + cl[k], chunk);
      }
      dirEntries.push(entryFor(files[i].name, MODE_EXISTS | MODE_FILE | 0x0007 | (files[i].attr ?? 0) & 0x0400, files[i].data.length, cl.length ? cl[0] : 0xffffffff, files[i].attr ?? 0, files[i].created, files[i].modified));
    }
    // The directory itself.
    this.linkChain(dirClusters);
    const dot = entryFor(".", MODE_EXISTS | MODE_DIR | 0x0007, dirCount, 0, 0, undefined, undefined, newIndex);
    const dotdot = entryFor("..", MODE_EXISTS | MODE_DIR | 0x0007, 0, 0, 0);
    const dirData = Buffer.concat([dot, dotdot, ...dirEntries]);
    for (let k = 0; k < dirClusters.length; k++) {
      const chunk = Buffer.alloc(this.clusterBytes, 0);
      dirData.copy(chunk, 0, k * this.clusterBytes, Math.min(dirData.length, (k + 1) * this.clusterBytes));
      this.writeCluster(this.allocOffset + dirClusters[k], chunk);
    }
    // The root: a new entry, and a longer chain if it spilled over.
    if (extraRoot.length) {
      const last = rootChain[rootChain.length - 1];
      this.fatSet(last, FAT_ALLOC | extraRoot[0]);
      this.linkChain(extraRoot);
      for (const c of extraRoot) this.writeCluster(this.allocOffset + c, Buffer.alloc(this.clusterBytes, 0));
    }
    const dirMode = dirAttr & 0xffff ? (dirAttr & 0xffff) | MODE_EXISTS | MODE_DIR : MODE_EXISTS | MODE_DIR | 0x0007;
    this.updateEntry(this.rootCluster, newIndex, (raw) => entryFor(saveName, dirMode, dirCount, dirClusters[0], 0).copy(raw));
    this.updateEntry(this.rootCluster, 0, (raw) => raw.writeUInt32LE(newIndex + 1, 4));
  }

  private freeClustersExcluding(count: number, taken: number[]): number[] {
    const skip = new Set(taken);
    const out: number[] = [];
    for (let rel = 0; rel < this.allocEnd && out.length < count; rel++) {
      if (skip.has(rel)) continue;
      if ((this.fatGet(rel) & FAT_ALLOC) === 0) out.push(rel);
    }
    if (out.length < count) throw new Error("the card is full");
    return out;
  }

  /** Writes the image out through a temp file so a crash can't leave half a card. */
  save(file: string): void {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, this.buf);
    fs.renameSync(tmp, file);
  }
}

/** Sony's timestamp: reserved, sec, min, hour, day, month, year (LE16). */
export function ps2Time(d: Date): Buffer {
  const b = Buffer.alloc(8, 0);
  b[1] = d.getUTCSeconds();
  b[2] = d.getUTCMinutes();
  b[3] = d.getUTCHours();
  b[4] = d.getUTCDate();
  b[5] = d.getUTCMonth() + 1;
  b.writeUInt16LE(d.getUTCFullYear(), 6);
  return b;
}

/** The two title lines from icon.sys (Shift-JIS full-width text, ASCII where it can be). */
export function iconSysTitle(sys: Buffer): string {
  if (sys.length < 0xc0 || sys.toString("latin1", 0, 4) !== "PS2D") return "";
  return fullWidthToAscii(sys.subarray(0xc0, 0xc0 + 68));
}

/** Shift-JIS full-width text (what PS1 and PS2 save titles are written in) as plain ASCII. */
export function fullWidthToAscii(raw: Buffer): string {
  let out = "";
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const hi = raw[i];
    const lo = raw[i + 1];
    if (hi === 0 && lo === 0) break;
    // Full-width ASCII: 0x8140 is a space, 0x824F-0x8258 digits, 0x8260- letters.
    if (hi === 0x81 && lo === 0x40) out += " ";
    else if (hi === 0x82 && lo >= 0x4f && lo <= 0x58) out += String.fromCharCode(48 + lo - 0x4f);
    else if (hi === 0x82 && lo >= 0x60 && lo <= 0x79) out += String.fromCharCode(65 + lo - 0x60);
    else if (hi === 0x82 && lo >= 0x81 && lo <= 0x9a) out += String.fromCharCode(97 + lo - 0x81);
    else if (hi === 0x81) out += { 0x43: ",", 0x44: ".", 0x46: ":", 0x49: "!", 0x48: "?", 0x5e: "/", 0x7c: "-", 0x66: "'", 0x69: "(", 0x6a: ")", 0x93: "%", 0x95: "&", 0x7b: "+" }[lo] ?? "";
    else if (hi >= 0x20 && hi < 0x7f) { out += String.fromCharCode(hi); if (lo >= 0x20 && lo < 0x7f) out += String.fromCharCode(lo); }
  }
  return out.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------- PSU / PSV ----

export interface Ps2SaveBundle {
  name: string;
  attr: number;
  files: { name: string; data: Buffer; attr: number; created?: Buffer; modified?: Buffer }[];
}

/** A .psu (uLaunchELF / PS2 Save Builder): directory entries with file data padded to 1 KB. */
export function readPsu(buf: Buffer): Ps2SaveBundle | null {
  if (buf.length < ENTRY * 3) return null;
  const first = buf.subarray(0, ENTRY);
  const mode = first.readUInt16LE(0);
  if (!(mode & MODE_DIR)) return null;
  const count = first.readUInt32LE(4);
  const name = first.subarray(0x40, 0x60).toString("latin1").replace(/\0.*$/s, "");
  const files: Ps2SaveBundle["files"] = [];
  let off = ENTRY;
  for (let i = 0; i < count && off + ENTRY <= buf.length; i++) {
    const e = buf.subarray(off, off + ENTRY);
    const m = e.readUInt16LE(0);
    const size = e.readUInt32LE(4);
    const n = e.subarray(0x40, 0x60).toString("latin1").replace(/\0.*$/s, "");
    off += ENTRY;
    if (m & MODE_DIR) continue; // "." and ".."
    files.push({ name: n, data: Buffer.from(buf.subarray(off, off + size)), attr: e.readUInt32LE(0x20), created: Buffer.from(e.subarray(8, 16)), modified: Buffer.from(e.subarray(0x18, 0x20)) });
    off += Math.ceil(size / 1024) * 1024;
  }
  return { name, attr: first.readUInt32LE(0x20), files };
}

/** A PS3 .psv holding a PS2 save (type 2 at 0x3C): a file table then the data. */
export function readPsvPs2(buf: Buffer): Ps2SaveBundle | null {
  if (buf.length < 0xa8 || buf[0] !== 0 || buf.toString("latin1", 1, 4) !== "VSP" || buf.readUInt32LE(0x3c) !== 2) return null;
  // 0x40: display size, icon.sys and the three icons (pos, size), then the file count.
  const count = buf.readUInt32LE(0x64);
  // 0x68: the save directory - created, modified, entries, attribute, then its name at 0x80.
  const name = buf.subarray(0x80, 0xa0).toString("latin1").replace(/\0.*$/s, "");
  const attr = buf.readUInt32LE(0x7c);
  const files: Ps2SaveBundle["files"] = [];
  // 0xA0: one 60-byte record per file - created, modified, size, attribute, name, position.
  let off = 0xa0;
  for (let i = 0; i < count && off + 60 <= buf.length; i++) {
    const size = buf.readUInt32LE(off + 16);
    const fattr = buf.readUInt32LE(off + 20);
    const fname = buf.subarray(off + 24, off + 56).toString("latin1").replace(/\0.*$/s, "");
    const pos = buf.readUInt32LE(off + 56);
    files.push({ name: fname, data: Buffer.from(buf.subarray(pos, pos + size)), attr: fattr, created: Buffer.from(buf.subarray(off, off + 8)), modified: Buffer.from(buf.subarray(off + 8, off + 16)) });
    off += 60;
  }
  return { name, attr, files };
}

/**
 * Writes a save out as .psu, the format every PS2 save tool reads. The directory
 * entries take the earliest file's timestamps rather than "now", so the same
 * save always produces the same bytes - the phone compares copies by hash.
 */
export function writePsu(save: Ps2SaveBundle): Buffer {
  const stamps = save.files.map((f) => f.created).filter((c): c is Buffer => !!c).sort(Buffer.compare);
  const now = stamps[0] ?? Buffer.alloc(8, 0);
  const entry = (name: string, mode: number, length: number, attr: number, created?: Buffer, modified?: Buffer): Buffer => {
    const raw = Buffer.alloc(ENTRY, 0);
    raw.writeUInt16LE(mode, 0);
    raw.writeUInt32LE(length, 4);
    (created ?? now).copy(raw, 8);
    (modified ?? now).copy(raw, 0x18);
    raw.writeUInt32LE(attr, 0x20);
    raw.write(name.slice(0, 31), 0x40, "latin1");
    return raw;
  };
  const parts: Buffer[] = [entry(save.name, MODE_EXISTS | MODE_DIR | 0x0007, save.files.length + 2, save.attr), entry(".", MODE_EXISTS | MODE_DIR | 0x0007, 0, 0), entry("..", MODE_EXISTS | MODE_DIR | 0x0007, 0, 0)];
  for (const f of save.files) {
    parts.push(entry(f.name, MODE_EXISTS | MODE_FILE | 0x0007, f.data.length, f.attr, f.created, f.modified));
    const padded = Buffer.alloc(Math.ceil(f.data.length / 1024) * 1024, 0);
    f.data.copy(padded);
    parts.push(padded);
  }
  return Buffer.concat(parts);
}

// -------------------------------------------------------------- format ----

/**
 * An empty 8 MB card, fully formatted: superblock, the indirect FAT, the FAT
 * itself (everything free but the root), and a root directory with "." and
 * "..". The same layout mymc and the console's own format produce, so PCSX2
 * mounts it as-is and a game finds a real filesystem, not one it has to make.
 */
export function formatPs2Image(): Buffer {
  const pageLen = 512;
  const ppc = 2;
  const rawPage = pageLen + 16;
  const clusters = 8192;
  const allocOffset = 41;
  const allocEnd = clusters - allocOffset - 16;
  const buf = Buffer.alloc(clusters * ppc * rawPage, 0xff);

  const sb = Buffer.alloc(pageLen, 0);
  sb.write("Sony PS2 Memory Card Format ", 0, "latin1");
  sb.write("1.2.0.0", 28, "latin1");
  sb.writeUInt16LE(pageLen, 0x28);
  sb.writeUInt16LE(ppc, 0x2a);
  sb.writeUInt16LE(16, 0x2c);
  sb.writeUInt16LE(0xff00, 0x2e);
  sb.writeUInt32LE(clusters, 0x30);
  sb.writeUInt32LE(allocOffset, 0x34);
  sb.writeUInt32LE(allocEnd, 0x38);
  sb.writeUInt32LE(0, 0x3c);
  sb.writeUInt32LE(1023, 0x40);
  sb.writeUInt32LE(1022, 0x44);
  for (let i = 0; i < 32; i++) sb.writeUInt32LE(i === 0 ? 8 : 0xffffffff, 0x50 + i * 4);
  for (let i = 0; i < 32; i++) sb.writeUInt32LE(0xffffffff, 0xd0 + i * 4);
  sb[0x150] = 2;
  sb[0x151] = 0x2b;

  // The superblock goes in before the class reads it back.
  sb.copy(buf, 0);
  const card = new Ps2Card(buf);
  const c0 = Buffer.alloc(pageLen * ppc, 0xff);
  sb.copy(c0, 0);
  (card as unknown as { writeCluster(abs: number, data: Buffer): void }).writeCluster(0, c0);

  // Indirect FAT at cluster 8: the 32 FAT clusters 9..40, then nothing.
  const ifc = Buffer.alloc(pageLen * ppc, 0xff);
  for (let i = 0; i < 32; i++) ifc.writeUInt32LE(9 + i, i * 4);
  (card as unknown as { writeCluster(abs: number, data: Buffer): void }).writeCluster(8, ifc);
  // FAT: everything free (0x7FFFFFFF); the root directory's cluster allocated and last.
  for (let i = 0; i < 32; i++) {
    const fat = Buffer.alloc(pageLen * ppc, 0);
    for (let k = 0; k < fat.length / 4; k++) fat.writeUInt32LE(0x7fffffff, k * 4);
    if (i === 0) fat.writeUInt32LE(0xffffffff, 0);
    (card as unknown as { writeCluster(abs: number, data: Buffer): void }).writeCluster(9 + i, fat);
  }
  // The root directory: "." (2 entries in here) and "..".
  const now = ps2Time(new Date());
  const entry = (name: string, length: number): Buffer => {
    const raw = Buffer.alloc(ENTRY, 0);
    raw.writeUInt16LE(MODE_EXISTS | MODE_DIR | 0x0007, 0);
    raw.writeUInt32LE(length, 4);
    now.copy(raw, 8);
    raw.writeUInt32LE(0, 0x10);
    raw.writeUInt32LE(0, 0x14);
    now.copy(raw, 0x18);
    raw.write(name, 0x40, "latin1");
    return raw;
  };
  (card as unknown as { writeCluster(abs: number, data: Buffer): void }).writeCluster(allocOffset, Buffer.concat([entry(".", 2), entry("..", 0)]));
  return card.image();
}

/** Marks a save's directory and files as deleted and frees their clusters, as the console does. */
export function removeSave(card: Ps2Card, saveName: string): boolean {
  const c = card as unknown as {
    rootEntries(): Ps2DirEntry[];
    readDir(cluster: number, count: number): Ps2DirEntry[];
    chain(first: number): number[];
    fatSet(rel: number, value: number): void;
    updateEntry(dirCluster: number, index: number, edit: (raw: Buffer) => void): void;
    rootCluster: number;
  };
  const dir = c.rootEntries().find((e) => (e.mode & MODE_EXISTS) && (e.mode & MODE_DIR) && e.name === saveName);
  if (!dir) return false;
  for (const f of c.readDir(dir.cluster, dir.length)) {
    if (!(f.mode & MODE_EXISTS) || !(f.mode & MODE_FILE) || f.cluster === 0xffffffff) continue;
    for (const rel of c.chain(f.cluster)) c.fatSet(rel, FAT_LAST);
  }
  for (const rel of c.chain(dir.cluster)) c.fatSet(rel, FAT_LAST);
  c.updateEntry(c.rootCluster, dir.index, (raw) => raw.writeUInt16LE(raw.readUInt16LE(0) & ~MODE_EXISTS, 0));
  return true;
}
