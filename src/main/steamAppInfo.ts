import * as fs from "node:fs";

/**
 * Reads names and types out of Steam's appinfo.vdf cache, offline and without an
 * API key. The client keeps this current for every app in the account's library,
 * which is exactly the set the Steam view needs to name.
 *
 * Format (version 29, current since 2024): a header pointing at a string table,
 * then one record per app, each ending in a binary KeyValues blob whose keys are
 * indices into that table. Only `common.name` and `common.type` are pulled out.
 */

const MAGIC_V29 = 0x07564429;
const MAGIC_V28 = 0x07564428;

export interface AppInfoSummary {
  name: string;
  /** Steam's own classification: game, dlc, tool, music, demo, application, ... */
  type: string;
}

class Reader {
  offset = 0;
  constructor(private buf: Buffer) {}
  u8(): number { return this.buf[this.offset++]; }
  u32(): number { const v = this.buf.readUInt32LE(this.offset); this.offset += 4; return v; }
  i64(): bigint { const v = this.buf.readBigInt64LE(this.offset); this.offset += 8; return v; }
  skip(n: number): void { this.offset += n; }
  cstring(): string {
    const end = this.buf.indexOf(0, this.offset);
    const s = this.buf.toString("utf-8", this.offset, end);
    this.offset = end + 1;
    return s;
  }
  eof(): boolean { return this.offset >= this.buf.length; }
}

function readStringTable(buf: Buffer, offset: number): string[] {
  const r = new Reader(buf);
  r.offset = offset;
  const count = r.u32();
  const table: string[] = new Array(count);
  for (let i = 0; i < count; i++) table[i] = r.cstring();
  return table;
}

/**
 * Walks one binary KeyValues object, returning only the fields we care about from
 * `common`. `keyOf` resolves a key for the format in use (index vs. inline string).
 */
function readObject(r: Reader, keyOf: (r: Reader) => string, into: Partial<AppInfoSummary>, path: string[]): void {
  for (;;) {
    const type = r.u8();
    if (type === 0x08) return; // end of object
    const key = keyOf(r);
    const here = [...path, key];
    switch (type) {
      case 0x00:
        readObject(r, keyOf, into, here);
        break;
      case 0x01: {
        const value = r.cstring();
        if (here.length === 3 && here[0] === "appinfo" && here[1] === "common") {
          if (key === "name") into.name = value;
          else if (key === "type") into.type = value.toLowerCase();
        }
        break;
      }
      case 0x02: r.skip(4); break; // int32
      case 0x03: r.skip(4); break; // float
      case 0x04: r.skip(4); break; // pointer
      case 0x05: r.cstring(); break; // wstring, stored as cstring in practice
      case 0x06: r.skip(4); break; // color
      case 0x07: r.skip(8); break; // uint64
      default:
        throw new Error(`unexpected KeyValues type 0x${type.toString(16)} at ${r.offset}`);
    }
  }
}

export function readAppInfo(appinfoPath: string): Map<number, AppInfoSummary> {
  const result = new Map<number, AppInfoSummary>();
  let buf: Buffer;
  try {
    buf = fs.readFileSync(appinfoPath);
  } catch {
    return result;
  }

  const r = new Reader(buf);
  const magic = r.u32();
  if (magic !== MAGIC_V29 && magic !== MAGIC_V28) return result;
  r.u32(); // universe

  let keyOf: (r: Reader) => string;
  if (magic === MAGIC_V29) {
    const tableOffset = Number(r.i64());
    const table = readStringTable(buf, tableOffset);
    keyOf = (rr) => table[rr.u32()] ?? "";
  } else {
    keyOf = (rr) => rr.cstring();
  }

  while (!r.eof()) {
    const appid = r.u32();
    if (appid === 0) break;
    const size = r.u32();
    const end = r.offset + size;
    try {
      r.u32(); // infoState
      r.u32(); // lastUpdated
      r.skip(8); // picsToken
      r.skip(20); // sha1 of text
      r.u32(); // changeNumber
      r.skip(20); // sha1 of binary (v28+)
      const info: Partial<AppInfoSummary> = {};
      // The blob is a single root object: type byte 0x00, key "appinfo", then fields.
      const rootType = r.u8();
      if (rootType === 0x00) {
        const rootKey = keyOf(r);
        readObject(r, keyOf, info, [rootKey]);
      }
      if (info.name) result.set(appid, { name: info.name, type: info.type ?? "unknown" });
    } catch {
      // A record we can't walk is skipped by size rather than derailing the rest.
    }
    r.offset = end;
  }
  return result;
}
