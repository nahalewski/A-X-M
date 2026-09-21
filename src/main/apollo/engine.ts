import * as crypto from "node:crypto";
import * as zlib from "node:zlib";
import { ApolloCode, substituteOptions } from "./savepatch";

/**
 * The Apollo patch engine, in TypeScript: Save Wizard / Game Genie codes and
 * BSD (Bruteforce Save Data) scripts, applied to one save file's bytes.
 *
 * This follows apollo-lib's `patches.c` (Damian "bucanero" Parrino, GPL-3.0)
 * rule for rule - the pointer and end-pointer, the search-skip behaviour, the
 * inclusive checksum ranges, the carry rule for add() / wadd(), variables kept
 * as the bytes they will be written as. Anything apollo-lib does that is not
 * ported here (Python codes, the game-specific checksums and ciphers, zlib
 * blocks) is refused with a message rather than approximated: a patch that
 * half-applies is worse than one that says it can't.
 *
 * Values are read and written in the platform's byte order (PS2 little-endian,
 * PS3 big-endian) unless the code header says [LE:] or [BE:], as Apollo does.
 */

export type ByteOrder = "le" | "be";

export interface ApplyResult {
  ok: boolean;
  data: Buffer;
  /** Why it was refused, in words fit to show. */
  error?: string;
  log: string[];
}

// ------------------------------------------------------------ helpers ----

function inBounds(size: number, off: number, len: number): boolean {
  return off >= 0 && len >= 0 && off + len <= size;
}

function readUInt(buf: Buffer, off: number, len: number, order: ByteOrder): bigint {
  let v = 0n;
  for (let i = 0; i < len; i++) {
    const b = BigInt(buf[order === "le" ? off + len - 1 - i : off + i]);
    v = (v << 8n) | b;
  }
  return v;
}

function writeUInt(buf: Buffer, off: number, len: number, value: bigint, order: ByteOrder): void {
  for (let i = 0; i < len; i++) {
    const b = Number((value >> BigInt(8 * i)) & 0xffn);
    buf[order === "le" ? off + i : off + len - 1 - i] = b;
  }
}

function hexBytes(hex: string): Buffer {
  const clean = hex.replace(/^0x/i, "").replace(/[^0-9a-fA-F]/g, "");
  return Buffer.from(clean.length % 2 ? clean.slice(0, -1) : clean, "hex");
}

function findForward(data: Buffer, start: number, needle: Buffer, count: number): number {
  if (needle.length === 0 || data.length < needle.length) return -1;
  let k = 1;
  for (let i = Math.max(0, start); i <= data.length - needle.length; i++) {
    if (data.compare(needle, 0, needle.length, i, i + needle.length) === 0 && k++ === count) return i;
  }
  return -1;
}

function findBackward(data: Buffer, start: number, needle: Buffer, count: number): number {
  if (needle.length === 0 || data.length < needle.length) return -1;
  let k = 1;
  for (let i = start; i >= 0; i--) {
    if (i <= data.length - needle.length && data.compare(needle, 0, needle.length, i, i + needle.length) === 0 && k++ === count) return i;
  }
  return -1;
}

// ------------------------------------------------------------- hashes ----

interface CrcParams { width: number; poly: bigint; init: bigint; xorOut: bigint; refIn: boolean; refOut: boolean }

function reflect(v: bigint, bits: number): bigint {
  let r = 0n;
  for (let i = 0; i < bits; i++) if ((v >> BigInt(i)) & 1n) r |= 1n << BigInt(bits - 1 - i);
  return r;
}

/** A table-less CRC of any width, from the classic parameter model. */
function crc(data: Buffer, p: CrcParams): bigint {
  const mask = (1n << BigInt(p.width)) - 1n;
  const top = 1n << BigInt(p.width - 1);
  let reg = p.init & mask;
  for (const byte of data) {
    let b = BigInt(byte);
    if (p.refIn) b = reflect(b, 8);
    reg ^= b << BigInt(p.width - 8);
    for (let i = 0; i < 8; i++) reg = reg & top ? ((reg << 1n) ^ p.poly) & mask : (reg << 1n) & mask;
  }
  if (p.refOut) reg = reflect(reg, p.width);
  return (reg ^ p.xorOut) & mask;
}

function adler(data: Buffer, mod: number, shift: number): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % mod;
    b = (b + a) % mod;
  }
  return ((b << shift) | a) >>> 0;
}

function fletcher16(data: Buffer): number {
  let c0 = 0;
  let c1 = 0;
  for (const byte of data) {
    c0 = (c0 + byte) % 255;
    c1 = (c1 + c0) % 255;
  }
  return (c1 << 8) | c0;
}

function fletcher32(data: Buffer): number {
  let c0 = 0;
  let c1 = 0;
  for (let i = 0; i < data.length; i += 2) {
    const w = data[i] | ((i + 1 < data.length ? data[i + 1] : 0) << 8);
    c0 = (c0 + w) % 65535;
    c1 = (c1 + c0) % 65535;
  }
  return ((c1 << 16) | c0) >>> 0;
}

function murmur3(data: Buffer, seed: number): number {
  let h = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const n = data.length & ~3;
  for (let i = 0; i < n; i += 4) {
    let k = data.readUInt32LE(i);
    k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2);
    h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  let k = 0;
  switch (data.length & 3) {
    case 3: k ^= data[n + 2] << 16; // falls through
    case 2: k ^= data[n + 1] << 8; // falls through
    case 1: k ^= data[n]; k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2); h ^= k;
  }
  h ^= data.length; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

function jenkinsOaat(data: Buffer, seed: number): number {
  let h = seed >>> 0;
  for (const b of data) { h = (h + b) >>> 0; h = (h + (h << 10)) >>> 0; h ^= h >>> 6; }
  h = (h + (h << 3)) >>> 0; h ^= h >>> 11; h = (h + (h << 15)) >>> 0;
  return h >>> 0;
}

function sdbm(data: Buffer, init: number): number {
  let h = init >>> 0;
  for (const b of data) h = (b + (h << 6) + (h << 16) - h) >>> 0;
  return h;
}

function djb2(data: Buffer): number {
  let h = 5381;
  for (const b of data) h = (Math.imul(h, 33) + b) >>> 0;
  return h;
}

function fnv1(data: Buffer, init: number): number {
  let h = init >>> 0;
  for (const b of data) { h = Math.imul(h, 0x01000193) >>> 0; h ^= b; }
  return h >>> 0;
}

// --------------------------------------------------------- Save Wizard ----

const swWidth = (t: string): number => 1 << ((parseInt(t, 16) || 0) & 3);
const isPtr = (t: string): boolean => parseInt(t, 16) >= 8;

/** Runs one Save Wizard code over the data (never resizes). */
export function applySaveWizard(input: Buffer, lines: string[], order: ByteOrder, log: string[]): ApplyResult {
  const data = Buffer.from(input);
  const size = data.length;
  let pointer = 0;
  let endPointer = 0;
  let ptrValue = 0;
  let i = 0;
  const next = (): string | null => (i < lines.length ? lines[i++] : null);
  const hex = (s: string) => parseInt(s, 16) >>> 0;
  /** Skips to the next search code (8 / B / C not from pointer) after a failed search. */
  const skipToNextSearch = () => {
    let l: string | null;
    do { l = next(); } while (l && ((l[0] !== "8" && l[0] !== "B" && l[0] !== "C") || l[1] === "8"));
    if (l) i--; // leave it to be run
    pointer = 0;
  };
  /** Pattern lines after a search / bulk-write header, 8 bytes per line, big-endian as written. */
  const collect = (first: string, len: number): Buffer | null => {
    const out = Buffer.alloc(Math.max(4, (len + 3) & ~3));
    Buffer.from(first, "hex").copy(out, 0);
    for (let k = 4; k < len; k += 8) {
      const l = next();
      if (!l || l.length < 17) return null;
      Buffer.from(l.slice(0, 8), "hex").copy(out, k);
      if (k + 4 < len) Buffer.from(l.slice(9, 17), "hex").copy(out, k + 4);
    }
    return out.subarray(0, len);
  };

  while (i < lines.length) {
    const line = lines[i++];
    if (line.length < 17) { log.push(`skip malformed line "${line}"`); continue; }
    const t = line[1].toUpperCase();
    const off6 = hex(line.slice(2, 8));
    const val = hex(line.slice(9, 17));
    switch (line[0].toUpperCase()) {
      case "0": case "1": case "2": {
        const bytes = 1 << parseInt(line[0], 10);
        const off = off6 + (t === "8" ? pointer : 0);
        if (!inBounds(size, off, bytes)) { log.push(`skip out-of-bounds write at 0x${off.toString(16)}`); break; }
        writeUInt(data, off, bytes, BigInt(val), order);
        log.push(`wrote ${bytes} byte(s) ${val.toString(16)} at 0x${off.toString(16)}`);
        break;
      }
      case "3": {
        const off = off6 + (isPtr(t) ? pointer : 0);
        const bytes = swWidth(t);
        if (!inBounds(size, off, bytes)) { log.push(`skip out-of-bounds add/sub at 0x${off.toString(16)}`); break; }
        const sub = (parseInt(t, 16) & 4) !== 0;
        const cur = readUInt(data, off, bytes, order);
        const mask = (1n << BigInt(8 * bytes)) - 1n;
        const res = (sub ? cur - BigInt(val) : cur + BigInt(val)) & mask;
        writeUInt(data, off, bytes, res, order);
        log.push(`${sub ? "sub" : "add"} ${val} at 0x${off.toString(16)} → ${res}`);
        break;
      }
      case "4": {
        const off = off6 + (isPtr(t) ? pointer : 0);
        const l2 = next();
        if (!l2 || l2.length < 17) return { ok: false, data: input, error: "truncated multi-write code", log };
        const incremental = ["4", "5", "6", "C", "D", "E"].includes(t);
        const n = incremental ? hex(l2.slice(0, 4)) : hex(l2.slice(1, 4));
        const incOff = hex(l2.slice(4, 8));
        const incVal = hex(l2.slice(9, 17));
        const bytes = swWidth(t);
        let v = val;
        for (let k = 0; k < n; k++) {
          const at = off + incOff * k;
          if (inBounds(size, at, bytes)) writeUInt(data, at, bytes, BigInt(v >>> 0) & ((1n << BigInt(8 * bytes)) - 1n), order);
          v = (v + incVal) >>> 0;
        }
        log.push(`multi-write ${n}× ${bytes} byte(s) from 0x${off.toString(16)}`);
        break;
      }
      case "5": {
        const src = off6 + (t === "8" ? pointer : 0);
        const l2 = next();
        if (!l2 || l2.length < 17) return { ok: false, data: input, error: "truncated copy code", log };
        const dst = hex(l2.slice(2, 8)) + (l2[1] === "8" ? pointer : 0);
        if (!inBounds(size, src, val) || !inBounds(size, dst, val)) { log.push("skip out-of-bounds copy"); break; }
        data.copy(data, dst, src, src + val);
        log.push(`copied ${val} bytes 0x${src.toString(16)} → 0x${dst.toString(16)}`);
        break;
      }
      case "6": {
        const w = line[2];
        const x = line[3];
        const y = line[5];
        const z = line[7];
        const bytes = swWidth(t);
        const base = isPtr(t) ? pointer : 0;
        switch (w) {
          case "0": {
            let v = val + (x === "1" ? ptrValue : 0);
            if (y === "1") pointer = v;
            if (!inBounds(size, v + base, bytes)) { log.push("skip out-of-bounds type-6 read"); break; }
            ptrValue = Number(readUInt(data, v + base, bytes, order));
            v = ptrValue;
            break;
          }
          case "1":
            ptrValue = x === "0" ? ptrValue + val : x === "1" ? ptrValue - val : ptrValue * val;
            ptrValue += z === "1" ? pointer : 0;
            pointer = ptrValue;
            break;
          case "2":
            pointer = x === "0" ? pointer + val : x === "1" ? pointer - val : pointer * val;
            if (y === "1") ptrValue = pointer;
            break;
          case "4":
            if (inBounds(size, pointer, bytes)) writeUInt(data, pointer, bytes, BigInt(val) & ((1n << BigInt(8 * bytes)) - 1n), order);
            break;
        }
        break;
      }
      case "7": {
        const off = off6 + (isPtr(t) ? pointer : 0);
        const bytes = swWidth(t);
        if (!inBounds(size, off, bytes)) { log.push("skip out-of-bounds conditional write"); break; }
        const mask = (1n << BigInt(8 * bytes)) - 1n;
        const want = BigInt(val) & mask;
        const cur = readUInt(data, off, bytes, order);
        const noLess = (parseInt(t, 16) & 4) === 0;
        const res = noLess ? (want > cur ? want : cur) : want < cur ? want : cur;
        writeUInt(data, off, bytes, res, order);
        break;
      }
      case "8": case "B": {
        const cnt = hex(line.slice(2, 4)) || 1;
        const len = hex(line.slice(4, 8));
        if (len <= 0) return { ok: false, data: input, error: "empty search pattern", log };
        const needle = collect(line.slice(9, 17), len);
        if (!needle) return { ok: false, data: input, error: "truncated search pattern", log };
        let found: number;
        if (line[0].toUpperCase() === "8") found = findForward(data, t === "8" ? pointer : 0, needle, cnt);
        else {
          if (!endPointer) endPointer = size - 1;
          found = findBackward(data, t === "8" ? pointer : endPointer, needle, cnt);
        }
        if (found < 0) { log.push("search pattern not found - skipping to the next search"); skipToNextSearch(); break; }
        pointer = found;
        log.push(`search found at 0x${found.toString(16)}`);
        break;
      }
      case "9": {
        switch (t) {
          case "0": if (inBounds(size, val, 4)) pointer = data.readUInt32BE(val); break;
          case "1": if (inBounds(size, val, 4)) pointer = data.readUInt32LE(val); break;
          case "2": pointer += val; break;
          case "3": pointer -= val; break;
          case "4": pointer = size - val; break;
          case "5": pointer = val; break;
          case "D": endPointer = val; break;
          case "E": endPointer = pointer + val; break;
        }
        break;
      }
      case "A": {
        const off = off6 + (t === "8" ? pointer : 0);
        const block = Buffer.alloc(Math.max(4, (val + 3) & ~3));
        for (let k = 0; k < val; k += 8) {
          const l = next();
          if (!l || l.length < 17) return { ok: false, data: input, error: "truncated bulk write", log };
          Buffer.from(l.slice(0, 8), "hex").copy(block, k);
          if (k + 4 < val) Buffer.from(l.slice(9, 17), "hex").copy(block, k + 4);
        }
        if (inBounds(size, off, val)) block.copy(data, off, 0, val);
        else log.push("skip out-of-bounds bulk write");
        break;
      }
      case "C": {
        const cnt = hex(line.slice(2, 4)) || 1;
        const len = hex(line.slice(4, 8));
        const addr = val + (t === "8" || t === "C" ? pointer : 0);
        if (!inBounds(size, addr, len)) { skipToNextSearch(); break; }
        const needle = Buffer.from(data.subarray(addr, addr + len));
        const found = t === "4" || t === "C" ? findForward(data.subarray(0, addr + len), 0, needle, cnt) : findForward(data, addr + len, needle, cnt);
        if (found < 0) { skipToNextSearch(); break; }
        pointer = found;
        break;
      }
      case "D": {
        const off = off6 + (t === "8" ? pointer : 0);
        const skip = hex(line.slice(9, 11));
        const bit = line[11];
        const op = line[12];
        let want = hex(line.slice(13, 17));
        let src = 0;
        if (inBounds(size, off, bit === "1" ? 1 : 2)) {
          if (bit === "0") src = (data[off] << 8) | data[off + 1];
          else if (bit === "1") { want &= 0xff; src = data[off]; }
          else src = (data[off + 1] << 8) | data[off];
        }
        const pass = op === "0" ? src === want : op === "1" ? src !== want : op === "2" ? src > want : op === "3" ? src < want : true;
        if (!pass) { log.push(`byte test failed - skipping ${skip} line(s)`); i += skip; }
        break;
      }
      default:
        log.push(`unknown code type ${line[0]}`);
    }
  }
  return { ok: true, data, log };
}

// ----------------------------------------------------------------- BSD ----

/** A variable: the bytes exactly as they will be written; numbers read big-endian, as Apollo emits them. */
type Vars = Map<string, Buffer>;

const varValue = (v: Buffer | undefined): number => {
  if (!v || v.length === 0) return 0;
  if (v.length > 4) return Number(readUInt(v, 0, 4, "be"));
  return Number(readUInt(v, 0, v.length, "be"));
};

/** An n-byte slice of a 32-bit value, the way Apollo's _set_var_slice lays it out. */
const slice32 = (value: number, len: number, msb: boolean): Buffer => {
  const be = Buffer.alloc(4);
  be.writeUInt32BE(value >>> 0);
  return Buffer.from(msb ? be.subarray(0, len) : be.subarray(4 - len));
};
const u32 = (value: number): Buffer => slice32(value, 4, false);
const u16 = (value: number): Buffer => slice32(value & 0xffff, 2, false);
const u64 = (value: bigint): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64BE(value & 0xffffffffffffffffn); return b; };

export function applyBsd(input: Buffer, lines: string[], log: string[]): ApplyResult {
  let data = Buffer.from(input);
  const vars: Vars = new Map();
  let pointer = 0;
  let rangeStart = 0;
  let rangeEnd = data.length; // exclusive, as Apollo keeps it after parsing
  let carry = 0;
  let eof = 0;
  const custom: CrcParams = { width: 32, poly: 0n, init: 0n, xorOut: 0n, refIn: false, refOut: false };
  const fail = (error: string): ApplyResult => ({ ok: false, data: input, error, log });

  /** Apollo's _parse_int_value: hex, "pointer", "eof", [var], with +/- chaining. */
  const intValue = (s: string, ptr = pointer): number => {
    s = s.trim();
    if (!s) return 0;
    let neg = false;
    if (s[0] === "+") s = s.slice(1);
    if (s[0] === "-") { neg = true; s = s.slice(1); }
    let ret = 0;
    if (/^pointer/i.test(s)) ret = ptr + intValue(s.slice(7), ptr);
    else if (/^eof/i.test(s)) ret = data.length - 1 + intValue(s.slice(3), ptr);
    else if (s.startsWith("[")) {
      const end = s.indexOf("]");
      const v = vars.get(s.slice(1, end).toLowerCase());
      ret = (v && v.length <= 4 ? varValue(v) : 0) + intValue(s.slice(end + 1), ptr);
    } else if (/^\(\d+\)/.test(s)) ret = parseInt(s.slice(1), 10);
    else ret = parseInt(s.replace(/^0x/i, ""), 16) || 0;
    return neg ? -ret : ret;
  };

  /** Apollo's _decode_variable_data: "text", [var], or hex bytes. */
  const decode = (s: string): Buffer => {
    s = s.trim();
    if (s.startsWith('"')) return Buffer.from(s.slice(1, s.lastIndexOf('"')), "latin1");
    if (s.startsWith("[")) return Buffer.from(vars.get(s.slice(1, s.indexOf("]")).toLowerCase()) ?? Buffer.alloc(0));
    return hexBytes(s);
  };
  const startEnd = (s: string): [number, number] => {
    const comma = s.indexOf(",");
    const close = s.indexOf(")", comma);
    return [intValue(s.slice(0, comma)), intValue(s.slice(comma + 1, close < 0 ? undefined : close))];
  };
  /** Inclusive [start, end] clamped to the data, as _clamp_range. */
  const clamp = (start: number, end: number): [number, number] => {
    if (start < 0) start = 0;
    if (start >= data.length) return [data.length, 0];
    if (end < 0 || end >= data.length) end = data.length - 1;
    return end < start ? [start, 0] : [start, end - start + 1];
  };
  const range = () => data.subarray(rangeStart, rangeEnd);
  const setVar = (name: string, value: Buffer) => vars.set(name.toLowerCase(), value);
  const applyCarry = (add: number): number => {
    while (carry > 0 && add > 0xffff) add = ((add & 0xffff) + Math.floor((add & 0xffff0000) / 2 ** (8 * carry))) >>> 0;
    return add >>> 0;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const lower = line.toLowerCase();

    if (/^carry\(\d+\)$/i.test(line)) {
      carry = Math.min(4, Math.max(0, parseInt(line.slice(6), 10)));
      continue;
    }

    if (lower.startsWith("set ")) {
      const body = line.slice(4).trim();
      const colon = body.indexOf(":");
      if (colon < 0) return fail(`bad set line: ${line}`);
      const what = body.slice(0, colon).trim();
      const arg = body.slice(colon + 1).trim();
      const wl = what.toLowerCase();

      if (wl === "pointer") {
        const al = arg.toLowerCase();
        if (al.startsWith("eof") || al.startsWith("lastbyte")) { eof = 1; pointer = data.length + (parseInt(arg.slice(al.startsWith("eof") ? 3 : 8).trim().replace(/^0x/i, ""), 16) || 0) - 1; }
        else if (al.startsWith("pointer")) pointer += parseInt(arg.slice(7).trim().replace(/^0x/i, ""), 16) || 0;
        else if (al.startsWith("read(")) { const [a] = startEnd(arg.slice(5)); pointer = inBounds(data.length, a, 4) ? data.readUInt32BE(a) : 0; }
        else if (al.startsWith("[")) pointer = intValue(arg);
        else pointer = parseInt(arg.replace(/^0x/i, ""), 16) || 0;
        log.push(`pointer = 0x${pointer.toString(16)}`);
        continue;
      }
      if (wl === "range") {
        const comma = arg.indexOf(",");
        rangeStart = Math.min(data.length, Math.max(0, intValue(arg.slice(0, comma))));
        rangeEnd = Math.min(data.length, intValue(arg.slice(comma + 1), pointer - eof) + 1);
        if (rangeEnd < rangeStart) rangeEnd = rangeStart;
        log.push(`range = 0x${rangeStart.toString(16)}..0x${(rangeEnd - 1).toString(16)}`);
        continue;
      }
      if (wl.startsWith("crc_")) {
        const key = wl.slice(4);
        if (key === "bandwidth") custom.width = parseInt(arg, 10) || 32;
        else if (key === "polynomial") custom.poly = BigInt("0x" + arg.replace(/^0x/i, ""));
        else if (key === "initial_value") custom.init = arg.startsWith("[") ? BigInt(varValue(vars.get(arg.slice(1, arg.indexOf("]")).toLowerCase()))) : BigInt("0x" + arg.replace(/^0x/i, ""));
        else if (key === "output_xor") custom.xorOut = BigInt("0x" + arg.replace(/^0x/i, ""));
        else if (key === "reflection_input") custom.refIn = parseInt(arg, 10) !== 0;
        else if (key === "reflection_output") custom.refOut = parseInt(arg, 10) !== 0;
        continue;
      }
      if (!what.startsWith("[")) return fail(`unsupported set target: ${what}`);

      const name = what.slice(1, what.indexOf("]"));
      const old = varValue(vars.get(name.toLowerCase()));
      const a = arg;
      const al = a.toLowerCase();
      const r = range();
      const [cs, ce] = [rangeStart, rangeEnd];
      void cs; void ce;

      if (al.startsWith("xor:") || al.startsWith("and:") || al.startsWith("or:")) {
        const op = al.slice(0, al.indexOf(":"));
        const rhs = decode(a.slice(op.length + 1));
        const cur = vars.get(name.toLowerCase()) ?? Buffer.alloc(rhs.length);
        const out = Buffer.alloc(Math.max(cur.length, rhs.length));
        for (let k = 0; k < out.length; k++) {
          const x = cur[cur.length - 1 - k] ?? 0;
          const y = rhs[rhs.length - 1 - k] ?? 0;
          out[out.length - 1 - k] = op === "xor" ? x ^ y : op === "and" ? x & y : x | y;
        }
        setVar(name, out);
      } else if (al.startsWith("endian_swap")) {
        const cur = vars.get(name.toLowerCase());
        if (!cur || ![2, 4, 8].includes(cur.length)) return fail(`[${name}]:endian_swap needs a 2, 4 or 8 byte value`);
        setVar(name, Buffer.from(cur).reverse());
      } else if (al.startsWith("[") || al.startsWith("eof") || al.startsWith("pointer")) {
        setVar(name, u32(intValue(a)));
      } else if (al.startsWith("crc32")) {
        const init = a.includes(":") ? BigInt("0x" + a.slice(a.indexOf(":") + 1).replace(/^0x/i, "")) : 0xffffffffn;
        const big = al.startsWith("crc32big");
        setVar(name, u32(Number(crc(r, { width: 32, poly: 0x04c11db7n, init, xorOut: 0xffffffffn, refIn: !big, refOut: !big }))));
      } else if (al.startsWith("crc16")) {
        setVar(name, u16(Number(crc(r, { width: 16, poly: 0x1021n, init: 0n, xorOut: 0n, refIn: false, refOut: false }))));
      } else if (al.startsWith("crc64")) {
        const ecma = al.startsWith("crc64_ecma");
        setVar(name, u64(ecma ? crc(r, { width: 64, poly: 0x42f0e1eba9ea3693n, init: 0n, xorOut: 0n, refIn: false, refOut: false }) : crc(r, { width: 64, poly: 0x000000000000001bn, init: 0xffffffffffffffffn, xorOut: 0xffffffffffffffffn, refIn: true, refOut: true })));
      } else if (al === "crc" || al.startsWith("crc ")) {
        const v = crc(r, custom);
        setVar(name, custom.width === 16 ? u16(Number(v)) : custom.width === 64 ? u64(v) : u32(Number(v)));
      } else if (al.startsWith("md5_xor")) {
        const h = crypto.createHash("md5").update(r).digest();
        const out = Buffer.alloc(4);
        for (let k = 0; k < 16; k++) out[k % 4] ^= h[k];
        setVar(name, out);
      } else if (al.startsWith("sha1_xor64")) {
        const h = crypto.createHash("sha1").update(r).digest();
        const out = Buffer.alloc(8);
        for (let k = 0; k < 20; k++) out[k % 8] ^= h[k];
        setVar(name, out);
      } else if (al.startsWith("hmac_sha1(")) {
        const key = decode(a.slice(10, a.lastIndexOf(")")));
        setVar(name, crypto.createHmac("sha1", key).update(r).digest());
      } else if (/^(md5|sha1|sha224|sha256|sha384|sha512)\b/.test(al)) {
        setVar(name, crypto.createHash(al.match(/^(md5|sha1|sha224|sha256|sha384|sha512)/)![1]).update(r).digest());
      } else if (al.startsWith("adler32")) setVar(name, u32(adler(r, 65521, 16)));
      else if (al.startsWith("adler16")) setVar(name, u16(adler(r, 251, 8)));
      else if (al.startsWith("fletcher16")) setVar(name, u16(fletcher16(r)));
      else if (al.startsWith("fletcher32")) setVar(name, u32(fletcher32(r)));
      else if (al.startsWith("murmur3_32")) setVar(name, u32(murmur3(r, a.includes(":") ? intValue(a.slice(a.indexOf(":") + 1)) : 0)));
      else if (al.startsWith("jenkins_oaat")) setVar(name, u32(jenkinsOaat(r, a.includes(":") ? intValue(a.slice(a.indexOf(":") + 1)) : 0)));
      else if (al.startsWith("sdbm")) setVar(name, u32(sdbm(r, a.includes(":") ? intValue(a.slice(a.indexOf(":") + 1)) : 0)));
      else if (al.startsWith("djb2")) setVar(name, u32(djb2(r)));
      else if (al.startsWith("fnv1")) setVar(name, u32(fnv1(r, a.includes(":") ? intValue(a.slice(a.indexOf(":") + 1)) : 0x811c9dc5)));
      else if (al.startsWith("checksum32")) { let s = 0; for (const b of r) s = (s + ((b << 24) >> 24)) | 0; setVar(name, u32(s >>> 0)); }
      else if (al.startsWith("qwadd(")) {
        const [s, e] = startEnd(a.slice(6)); const [st, len] = clamp(s, e);
        let add = old >>> 0;
        for (let k = st + 4; k + 4 <= st + len; k += 8) add = (add + data.readUInt32BE(k)) >>> 0;
        setVar(name, u32(add));
      } else if (al.startsWith("dwadd(") || al.startsWith("dwadd_le(")) {
        const le = al.startsWith("dwadd_le(");
        const [s, e] = startEnd(a.slice(le ? 9 : 6)); const [st, len] = clamp(s, e);
        let add = old >>> 0;
        for (let k = st; k + 4 <= st + len; k += 4) add = (add + (le ? data.readUInt32LE(k) : data.readUInt32BE(k))) >>> 0;
        setVar(name, u32(add));
      } else if (al.startsWith("wadd(") || al.startsWith("wadd_le(")) {
        const le = al.startsWith("wadd_le(");
        const [s, e] = startEnd(a.slice(le ? 8 : 5)); const [st, len] = clamp(s, e);
        let add = old >>> 0;
        for (let k = st; k + 2 <= st + len; k += 2) add = (add + (le ? data.readUInt16LE(k) : data.readUInt16BE(k))) >>> 0;
        if (le) setVar(name, u32(add));
        else setVar(name, slice32(applyCarry(add), 4 - carry, false));
      } else if (al.startsWith("add(")) {
        const [s, e] = startEnd(a.slice(4)); const [st, len] = clamp(s, e);
        let add = old >>> 0;
        for (let k = st; k < st + len; k++) add = (add + data[k]) >>> 0;
        setVar(name, slice32(applyCarry(add), 4 - carry, false));
      } else if (al.startsWith("wsub(")) {
        const [s, e] = startEnd(a.slice(5)); const [st, len] = clamp(s, e);
        let sub = old >>> 0;
        for (let k = st; k + 2 <= st + len; k += 2) sub = (sub - data.readUInt16BE(k)) >>> 0;
        setVar(name, u32(sub));
      } else if (al.startsWith("xor(")) {
        const parts = a.slice(4, a.lastIndexOf(")")).split(",");
        let xs = Math.min(data.length, Math.max(0, intValue(parts[0])));
        const xe = Math.min(data.length, Math.max(0, intValue(parts[1])));
        const xi = Math.min(4, Math.max(1, intValue(parts[2])));
        const out = Buffer.alloc(4);
        while (xs < xe && xs + xi <= data.length) { for (let j = 0; j < xi; j++) out[j] ^= data[xs + j]; xs += xi; }
        setVar(name, out);
      } else if (al.startsWith("read(")) {
        const [s, l] = startEnd(a.slice(5));
        if (!inBounds(data.length, s, l)) return fail(`read(0x${s.toString(16)}, ${l}) is outside the save`);
        setVar(name, Buffer.from(data.subarray(s, s + l)));
      } else if (al.startsWith("right(")) {
        const [v, l] = startEnd(a.slice(6));
        if (l < 0 || l > 4) return fail("right() length out of range");
        setVar(name, slice32(v, l, false));
      } else if (al.startsWith("left(")) {
        const [v, l] = startEnd(a.slice(5));
        if (l < 0 || l > 4) return fail("left() length out of range");
        setVar(name, slice32(v, l, true));
      } else if (al.startsWith("mid(")) {
        const parts = a.slice(4, a.lastIndexOf(")")).split(",");
        const src = decode(parts[0]);
        const ms = intValue(parts[1]);
        const mc = intValue(parts[2]);
        if (ms < 0 || mc < 0 || ms + mc > src.length) return fail("invalid mid() arguments");
        setVar(name, Buffer.from(src.subarray(ms, ms + mc)));
      } else if (al.startsWith("force_crc32:")) {
        return fail("force_crc32 is not supported yet");
      } else if (/^(eachecksum|ffx_checksum|ff13_checksum|castlevania_checksum|deadrising_checksum|dbzxv2_checksum|rockstar_checksum|kh25_checksum|khcom_checksum|mgs2_checksum|mgspw_checksum|sw4_checksum|toz_checksum|tiara2_checksum|lookup3_little2|jhash|host_)/.test(al)) {
        return fail(`the "${a.split(/[(:]/)[0]}" checksum isn't supported here yet`);
      } else if (/^0x/i.test(a) && a.length <= 10) {
        // "0x1234" up to eight digits is a 32-bit number; longer hex is a byte string.
        setVar(name, u32(parseInt(a.slice(2), 16) >>> 0));
      } else {
        // A literal: hex bytes or "text".
        setVar(name, decode(a));
      }
      log.push(`[${name}] = ${(vars.get(name.toLowerCase()) ?? Buffer.alloc(0)).toString("hex") || "(empty)"}`);
      continue;
    }

    if (lower.startsWith("write ") || lower.startsWith("insert ")) {
      const isInsert = lower.startsWith("insert ");
      const rest = line.slice(isInsert ? 7 : 6).trim();
      const rl = rest.toLowerCase();
      let fromPointer: boolean;
      let after: string;
      if (rl.startsWith("at")) { fromPointer = false; after = rest.slice(2); }
      else if (rl.startsWith("next")) { fromPointer = true; after = rest.slice(4); }
      else return fail(`bad ${isInsert ? "insert" : "write"} line: ${line}`);
      const colon = after.indexOf(":");
      if (colon < 0) return fail(`bad ${isInsert ? "insert" : "write"} line: ${line}`);
      const offText = after.slice(0, colon).trim();
      const off = (offText.startsWith("(") ? parseInt(offText.slice(1), 10) : parseInt(offText.replace(/^0x/i, ""), 16) || 0) + (fromPointer ? pointer : 0);
      let value = after.slice(colon + 1).trim();
      let bytes: Buffer;
      if (value.toLowerCase().startsWith("xor:")) {
        bytes = decode(value.slice(4));
        if (!inBounds(data.length, off, bytes.length)) return fail("xor write outside the save");
        for (let k = 0; k < bytes.length; k++) bytes[k] ^= data[off + k];
      } else if (value.toLowerCase().startsWith("repeat(")) {
        const comma = value.indexOf(",");
        const n = intValue(value.slice(7, comma));
        const unit = decode(value.slice(comma + 1, value.lastIndexOf(")")));
        bytes = Buffer.concat(Array.from({ length: Math.max(0, n) }, () => unit));
      } else bytes = decode(value);
      if (isInsert) {
        if (off < 0 || off > data.length) return fail("insert outside the save");
        data = Buffer.concat([data.subarray(0, off), bytes, data.subarray(off)]);
        rangeEnd = Math.min(data.length, rangeEnd + bytes.length);
        log.push(`inserted ${bytes.length} bytes at 0x${off.toString(16)}`);
      } else {
        if (inBounds(data.length, off, bytes.length)) bytes.copy(data, off);
        else log.push(`skip out-of-bounds write of ${bytes.length} bytes at 0x${off.toString(16)}`);
        log.push(`wrote ${bytes.toString("hex")} at 0x${off.toString(16)}`);
      }
      continue;
    }

    if (lower.startsWith("delete ")) {
      const rest = line.slice(7).trim();
      const rl = rest.toLowerCase();
      const fromPointer = rl.startsWith("next");
      const after = rest.slice(fromPointer ? 4 : 2);
      const colon = after.indexOf(":");
      const offText = after.slice(0, colon).trim();
      const off = (offText.startsWith("(") ? parseInt(offText.slice(1), 10) : parseInt(offText.replace(/^0x/i, ""), 16) || 0) + (fromPointer ? pointer : 0);
      const arg = after.slice(colon + 1).trim();
      let len: number;
      if (arg.toLowerCase().startsWith("until")) {
        const needle = decode(arg.slice(5));
        const at = findForward(data, off, needle, 1);
        if (at < 0) return fail("delete until: pattern not found");
        len = at - off;
      } else len = intValue(arg);
      if (!inBounds(data.length, off, len)) return fail("delete outside the save");
      data = Buffer.concat([data.subarray(0, off), data.subarray(off + len)]);
      rangeEnd = Math.min(data.length, rangeEnd);
      log.push(`deleted ${len} bytes at 0x${off.toString(16)}`);
      continue;
    }

    if (lower.startsWith("search ")) {
      let rest = line.slice(7).trim();
      const fromPointer = /^next\b/i.test(rest);
      if (fromPointer) rest = rest.slice(4).trim();
      let count = 1;
      // "pattern:count" - but a quoted pattern may hold a colon of its own.
      const m = rest.match(/^(".*"|\S+?)(?::(\d+))?$/);
      if (m) { rest = m[1]; if (m[2]) count = parseInt(m[2], 10); }
      const needle = decode(rest);
      const found = findForward(data, fromPointer ? pointer : 0, needle, count);
      if (found < 0) return fail(`search pattern ${rest} not found`);
      pointer = found;
      log.push(`search found at 0x${found.toString(16)}`);
      continue;
    }

    if (lower.startsWith("copy ")) {
      const [f, t, s] = line.slice(5).split(":").map((x) => intValue(x));
      if (!inBounds(data.length, f, s) || !inBounds(data.length, t, s)) return fail("copy outside the save");
      data.copy(data, t, f, f + s);
      continue;
    }

    if (lower.startsWith("endian_swap(")) {
      const mode = parseInt(line.slice(12), 10);
      const r = range();
      if (![2, 4, 8].includes(mode)) return fail(`endian_swap(${mode}) unsupported`);
      for (let k = 0; k + mode <= r.length; k += mode) r.subarray(k, k + mode).reverse();
      continue;
    }

    if (lower.startsWith("msgbox")) continue;

    if (lower.startsWith("decrypt ") || lower.startsWith("encrypt ")) {
      const enc = lower.startsWith("encrypt ");
      const spec = line.slice(8).trim();
      const sl = spec.toLowerCase();
      const r = range();
      const args = spec.includes("(") ? spec.slice(spec.indexOf("(") + 1, spec.lastIndexOf(")")).split(",").map((x) => decode(x)) : [];
      const run = (algo: string, key: Buffer, iv: Buffer | null) => {
        const c = enc ? crypto.createCipheriv(algo, key, iv) : crypto.createDecipheriv(algo, key, iv);
        c.setAutoPadding(false);
        const out = Buffer.concat([c.update(r), c.final()]);
        out.copy(data, rangeStart);
      };
      try {
        if (sl.startsWith("aes_ecb(")) run(`aes-${args[0].length * 8}-ecb`, args[0], null);
        else if (sl.startsWith("aes_cbc(")) run(`aes-${args[0].length * 8}-cbc`, args[0], args[1]);
        else if (sl.startsWith("aes_ctr(")) run(`aes-${args[0].length * 8}-ctr`, args[0], args[1]);
        else if (sl.startsWith("des3_ecb(")) run("des-ede3", args[0], null);
        else if (sl.startsWith("des3_cbc(")) run("des-ede3-cbc", args[0], args[1]);
        else return fail(`the "${spec.split("(")[0]}" cipher isn't supported here yet`);
      } catch (err) {
        return fail(`${enc ? "encrypt" : "decrypt"} failed: ${(err as Error).message}`);
      }
      continue;
    }

    if (lower.startsWith("decompress(") || lower.startsWith("compress(")) {
      return fail("zlib blocks (decompress / compress) aren't supported here yet");
    }

    return fail(`unknown BSD command: ${line}`);
  }

  void zlib;
  return { ok: true, data, log };
}

// --------------------------------------------------------------- entry ----

/** Applies one code with its option choices; a refused code leaves the data untouched. */
export function applyCode(data: Buffer, code: ApolloCode, selections: Record<string, string>, platformOrder: ByteOrder): ApplyResult {
  const log: string[] = [];
  const lines = substituteOptions(code.lines, selections);
  if (lines.some((l) => /\{[A-Za-z0-9_]+\}/.test(l))) return { ok: false, data, error: "an option has no value chosen", log };
  if (code.type === "python") return { ok: false, data, error: "Python codes aren't supported here yet", log };
  const order = code.order ?? platformOrder;
  return code.type === "sw" ? applySaveWizard(data, lines, order, log) : applyBsd(data, lines, log);
}
