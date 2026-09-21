import * as zlib from "node:zlib";

/**
 * A zip reader with no dependencies: walks the central directory, so it copes
 * with archives whose local headers carry no sizes (GitHub's do), and inflates
 * stored or deflated entries. Enough for source-archive downloads and the small
 * packs a save database hands out; not a general archiver.
 */

export interface ZipEntry {
  name: string;
  size: number;
  read(): Buffer;
}

export function listZip(buf: Buffer): ZipEntry[] {
  // The end-of-central-directory record sits in the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    out.push({
      name,
      size,
      read: () => {
        const lnameLen = buf.readUInt16LE(local + 26);
        const lextraLen = buf.readUInt16LE(local + 28);
        const start = local + 30 + lnameLen + lextraLen;
        const data = buf.subarray(start, start + compSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return zlib.inflateRawSync(data);
        throw new Error(`unsupported zip method ${method} for ${name}`);
      },
    });
  }
  return out;
}
