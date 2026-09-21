import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { apolloDir, patchIndex, loadPatch, normaliseTitleId, titleName, listCommunitySaves, fetchCommunitySave, ApolloPlatform, PatchIndexEntry } from "./database";
import { ApolloCode, ApolloPatch, wildcardMatch } from "./savepatch";
import { applyCode, ByteOrder } from "./engine";
import { listCards, MemoryCard } from "../memoryCard";
import { Ps2Card, readPsu, readPsvPs2, writePsu } from "../ps2card";

/**
 * Apollo cheats for the saves on the menu's memory cards - the part that knows
 * where a save's bytes live (a PS1 block chain, a PS2 directory), which patches
 * name that game, and how to change the bytes without ever losing the original.
 *
 * Every apply: back the whole card up first (timestamped, with what was applied
 * written beside it), run the codes on copies, check the result reads back as a
 * save, and only then write. Anything wrong on the way restores the backup.
 */

export interface SaveRef {
  cardId: string;
  /** PS1: the directory entry's name; PS2: the save directory. */
  save: string;
}

export interface SaveIdentity {
  platform: ApolloPlatform;
  /** "SLUS20216" */
  titleId: string;
  /** "SLUS-20216" as written on the disc / in the save name. */
  productCode: string;
  region: string;
  gameName: string | null;
  /** The save's files (PS2), or the one blob (PS1). */
  files: { name: string; size: number }[];
}

export interface MatchedCode {
  patchFile: string;
  patchTitle: string | null;
  author: string | null;
  source: "apollo" | "custom";
  code: ApolloCode;
  /** Which of the save's files it would touch. */
  targets: string[];
}

export interface PatchMatch {
  identity: SaveIdentity;
  codes: MatchedCode[];
  /** Codes the patch file has that don't fit this save (other file names, other region folder). */
  hidden: number;
  attribution: string[];
}

export interface Selection {
  patchFile: string;
  codeId: number;
  options: Record<string, string>;
}

export interface Preview {
  ok: boolean;
  error?: string;
  files: { name: string; before: number; after: number; changed: number; first: { offset: number; from: string; to: string }[] }[];
  log: string[];
  /** Required codes added on top of the selection. */
  added: string[];
}

export interface BackupInfo {
  id: string;
  at: string;
  cardId: string;
  save: string;
  applied: string[];
  note: string;
}

// ----------------------------------------------------------- identity ----

const REGIONS: Record<string, string> = { A: "America", E: "Europe", I: "Japan", K: "Korea", C: "China", H: "Hong Kong" };

/** "BASLUS-20216SAVEDATA" → SLUS-20216, region A. Product codes are 4 letters, dash, 5 digits. */
export function identify(platform: "ps1" | "ps2", saveName: string): { titleId: string; productCode: string; region: string } | null {
  const m = saveName.match(/^B([A-Z])([A-Z]{4})-?(\d{5})/i) ?? saveName.match(/([A-Z]{4})[-_]?(\d{5})/i);
  if (!m) return null;
  if (m.length === 4) return { titleId: normaliseTitleId(m[2] + m[3]), productCode: `${m[2].toUpperCase()}-${m[3]}`, region: REGIONS[m[1].toUpperCase()] ?? m[1].toUpperCase() };
  void platform;
  return { titleId: normaliseTitleId(m[1] + m[2]), productCode: `${m[1].toUpperCase()}-${m[2]}`, region: "" };
}

function cardOf(cardId: string): MemoryCard {
  const card = listCards().find((c) => c.id === cardId);
  if (!card || !fs.existsSync(card.filePath)) throw new Error("that memory card isn't here");
  return card;
}

// PS1: a save is a chain of 8 KB blocks named by its directory frame.
const PS1_FRAME = 128;
const PS1_BLOCK = 8192;

function ps1Chain(image: Buffer, saveName: string): number[] | null {
  for (let i = 1; i <= 15; i++) {
    const entry = image.subarray(i * PS1_FRAME, (i + 1) * PS1_FRAME);
    if (entry.readUInt32LE(0) !== 0x51) continue;
    const raw = entry.subarray(10, 31).toString("latin1");
    const name = raw.slice(0, raw.indexOf("\0") === -1 ? raw.length : raw.indexOf("\0")).trim();
    if (name !== saveName) continue;
    const blocks = [i];
    let next = entry.readUInt16LE(8);
    while (next !== 0xffff && next + 1 <= 15 && blocks.length < 15) {
      blocks.push(next + 1);
      next = image.readUInt16LE((next + 1) * PS1_FRAME + 8);
    }
    return blocks;
  }
  return null;
}

/** The save's files as bytes: one blob for PS1, the directory's files for PS2. */
export function readSaveFiles(ref: SaveRef): { card: MemoryCard; files: { name: string; data: Buffer }[] } {
  const card = cardOf(ref.cardId);
  if (card.kind === "ps1") {
    const image = fs.readFileSync(card.filePath);
    const blocks = ps1Chain(image, ref.save);
    if (!blocks) throw new Error("that save isn't on the card");
    const size = image.readUInt32LE(blocks[0] * PS1_FRAME + 4) || blocks.length * PS1_BLOCK;
    const data = Buffer.concat(blocks.map((b) => image.subarray(b * PS1_BLOCK, (b + 1) * PS1_BLOCK))).subarray(0, size);
    return { card, files: [{ name: ref.save, data: Buffer.from(data) }] };
  }
  const files = Ps2Card.open(card.filePath).readSave(ref.save);
  if (!files) throw new Error("that save isn't on the card");
  return { card, files: files.map((f) => ({ name: f.name, data: f.data })) };
}

function writeSaveFiles(card: MemoryCard, save: string, files: { name: string; data: Buffer }[]): void {
  if (card.kind === "ps1") {
    const image = fs.readFileSync(card.filePath);
    const blocks = ps1Chain(image, save);
    if (!blocks) throw new Error("that save isn't on the card");
    const data = files[0].data;
    if (data.length > blocks.length * PS1_BLOCK) throw new Error("a PS1 save can't grow past its blocks");
    for (let i = 0; i < blocks.length; i++) {
      const chunk = Buffer.alloc(PS1_BLOCK, 0);
      data.copy(chunk, 0, i * PS1_BLOCK, Math.min(data.length, (i + 1) * PS1_BLOCK));
      chunk.copy(image, blocks[i] * PS1_BLOCK);
    }
    const tmp = `${card.filePath}.tmp`;
    fs.writeFileSync(tmp, image);
    fs.renameSync(tmp, card.filePath);
    return;
  }
  const ps2 = Ps2Card.open(card.filePath);
  for (const f of files) ps2.writeFile(save, f.name, f.data);
  ps2.save(card.filePath);
}

/** A whole copy back onto a PS1 save (same size) - the companion's push. */
export function writeSaveFilesForPush(cardId: string, save: string, data: Buffer): void {
  writeSaveFiles(cardOf(cardId), save, [{ name: save, data }]);
}

export function identifySave(ref: SaveRef): SaveIdentity | null {
  const { card, files } = readSaveFiles(ref);
  const platform: ApolloPlatform = card.kind === "ps1" ? "PS1" : "PS2";
  const id = identify(card.kind, ref.save);
  if (!id) return null;
  return { platform, ...id, gameName: titleName(platform, id.titleId), files: files.map((f) => ({ name: f.name, size: f.data.length })) };
}

// ------------------------------------------------------------ matching ----

function codeTargets(code: ApolloCode, save: string, files: string[]): string[] {
  // A folder in the target must match the save directory itself.
  if (code.target.folder && !wildcardMatch(code.target.folder, save)) return [];
  return files.filter((f) => wildcardMatch(code.target.file, f));
}

/** Patches in the database that name this save's game, with only the codes that fit its files. */
export function findPatches(ref: SaveRef): PatchMatch | null {
  const identity = identifySave(ref);
  if (!identity) return null;
  const names = identity.files.map((f) => f.name);
  const codes: MatchedCode[] = [];
  let hidden = 0;
  const attribution = new Set<string>();
  const entries = patchIndex().filter((e) => e.platform === identity.platform && e.titleId === identity.titleId);
  for (const entry of entries) {
    const patch = loadPatch(entry);
    if (!patch) continue;
    for (const code of patch.codes) {
      const targets = codeTargets(code, ref.save, names);
      if (!targets.length) {
        if (!code.isInfo) hidden++;
        continue;
      }
      codes.push({ patchFile: entry.file, patchTitle: patch.title ?? entry.title, author: patch.author ?? entry.author, source: entry.source, code, targets });
    }
    attribution.add(`${path.basename(entry.file)} · ${entry.source === "apollo" ? "Apollo Save Tool patch database (bucanero, GPL-3.0)" : "your own folder"}${patch.author ? ` · by ${patch.author}` : ""}`);
  }
  return { identity, codes, hidden, attribution: [...attribution] };
}

// ------------------------------------------------------------ applying ----

interface Prepared {
  card: MemoryCard;
  original: { name: string; data: Buffer }[];
  patched: { name: string; data: Buffer }[];
  applied: string[];
  added: string[];
  log: string[];
}

function prepare(ref: SaveRef, selections: Selection[]): Prepared | { error: string; log: string[] } {
  const { card, files } = readSaveFiles(ref);
  const match = findPatches(ref);
  if (!match) return { error: "this save's game couldn't be identified", log: [] };
  const order: ByteOrder = "le";
  const log: string[] = [];
  const patched: { name: string; data: Buffer }[] = files.map((f) => ({ name: f.name, data: Buffer.from(f.data) }));
  const applied: string[] = [];
  const added: string[] = [];

  // What runs: the selection, then every (Required) code of the same patch files, once.
  const chosen = selections.map((s) => match.codes.find((c) => c.patchFile === s.patchFile && c.code.id === s.codeId)).filter((c): c is MatchedCode => !!c);
  if (!chosen.length) return { error: "nothing selected", log };
  const runList: { mc: MatchedCode; options: Record<string, string> }[] = chosen.map((mc) => ({ mc, options: selections.find((s) => s.patchFile === mc.patchFile && s.codeId === mc.code.id)?.options ?? {} }));
  for (const mc of match.codes) {
    if (mc.code.isRequired && !mc.code.isInfo && !runList.some((r) => r.mc === mc) && chosen.some((c) => c.patchFile === mc.patchFile)) {
      runList.push({ mc, options: {} });
      added.push(mc.code.name);
    }
  }

  for (const { mc, options } of runList) {
    // Options an option-bearing required code shares with the selection (the DMC3 slot).
    const opts: Record<string, string> = { ...options };
    for (const o of mc.code.options) {
      if (!opts[o.tag]) {
        const fromSelection = runList.map((r) => r.options[o.tag]).find(Boolean);
        opts[o.tag] = fromSelection ?? o.choices[0]?.value ?? "";
      }
    }
    for (const target of mc.targets) {
      const file = patched.find((f) => f.name === target)!;
      const r = applyCode(file.data, mc.code, opts, mc.code.order ?? order);
      log.push(`— ${mc.code.name} → ${target}`, ...r.log.map((l) => `   ${l}`));
      if (!r.ok) return { error: `"${mc.code.name}" on ${target}: ${r.error}`, log };
      file.data = Buffer.from(r.data);
    }
    applied.push(mc.code.name + (Object.keys(opts).length ? ` [${Object.values(opts).join(", ")}]` : ""));
  }
  return { card, original: files, patched, applied, added, log };
}

export function preview(ref: SaveRef, selections: Selection[]): Preview {
  const p = prepare(ref, selections);
  if ("error" in p) return { ok: false, error: p.error, files: [], log: p.log, added: [] };
  const files = p.patched.map((f, i) => {
    const before = p.original[i].data;
    let changed = 0;
    const first: { offset: number; from: string; to: string }[] = [];
    const n = Math.max(before.length, f.data.length);
    for (let k = 0; k < n; k++) {
      if (before[k] !== f.data[k]) {
        changed++;
        if (first.length < 24) first.push({ offset: k, from: k < before.length ? before[k].toString(16).padStart(2, "0") : "--", to: k < f.data.length ? f.data[k].toString(16).padStart(2, "0") : "--" });
      }
    }
    return { name: f.name, before: before.length, after: f.data.length, changed, first };
  });
  return { ok: true, files, log: p.log, added: p.added };
}

const backupsDir = () => path.join(apolloDir(), "backups");

function sha1(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

/** Applies the codes: backup, patch, write, verify, or restore. */
export function apply(ref: SaveRef, selections: Selection[], note = ""): { ok: boolean; message: string; backupId?: string; log: string[] } {
  const p = prepare(ref, selections);
  if ("error" in p) return { ok: false, message: p.error, log: p.log };
  if (p.card.kind === "ps1" && p.patched[0].data.length !== p.original[0].data.length) return { ok: false, message: "the codes change the save's size, which a PS1 block can't take", log: p.log };

  // The backup: the whole card, and the save's files beside it, with a note of what was done.
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(backupsDir(), p.card.id, ref.save.replace(/[^A-Za-z0-9._-]/g, "_"), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(p.card.filePath, path.join(dir, "card.bak"));
  for (const f of p.original) fs.writeFileSync(path.join(dir, `${f.name.replace(/[^A-Za-z0-9._-]/g, "_")}.orig`), f.data);
  const info: BackupInfo = { id, at: new Date().toISOString(), cardId: p.card.id, save: ref.save, applied: p.applied, note };
  fs.writeFileSync(path.join(dir, "backup.json"), JSON.stringify({ ...info, before: p.original.map((f) => ({ name: f.name, sha1: sha1(f.data), size: f.data.length })), after: p.patched.map((f) => ({ name: f.name, sha1: sha1(f.data), size: f.data.length })) }, null, 2));

  try {
    writeSaveFiles(p.card, ref.save, p.patched);
    // Read it back: the save must still be there with exactly the bytes we meant.
    const check = readSaveFiles(ref);
    for (const f of p.patched) {
      const got = check.files.find((x) => x.name === f.name);
      if (!got || !got.data.equals(f.data)) throw new Error(`${f.name} didn't read back as written`);
    }
  } catch (err) {
    fs.copyFileSync(path.join(dir, "card.bak"), p.card.filePath);
    return { ok: false, message: `${(err as Error).message} - the card was restored from the backup`, log: p.log };
  }
  return { ok: true, message: `${p.applied.length} code${p.applied.length === 1 ? "" : "s"} applied${p.added.length ? ` (+ ${p.added.join(", ")})` : ""}`, backupId: id, log: p.log };
}

export function listBackups(ref: SaveRef): BackupInfo[] {
  const dir = path.join(backupsDir(), ref.cardId, ref.save.replace(/[^A-Za-z0-9._-]/g, "_"));
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "card.bak")));
  } catch {
    return [];
  }
  return ids
    .map((id) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, id, "backup.json"), "utf-8")) as BackupInfo;
      } catch {
        return { id, at: id, cardId: ref.cardId, save: ref.save, applied: [], note: "" };
      }
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Puts the card back exactly as it was before that edit (or the latest, for Undo). */
export function restoreBackup(ref: SaveRef, backupId?: string): { ok: boolean; message: string } {
  const list = listBackups(ref);
  const b = backupId ? list.find((x) => x.id === backupId) : list[0];
  if (!b) return { ok: false, message: "no backup for this save" };
  const card = cardOf(ref.cardId);
  const file = path.join(backupsDir(), ref.cardId, ref.save.replace(/[^A-Za-z0-9._-]/g, "_"), b.id, "card.bak");
  try {
    fs.copyFileSync(file, card.filePath);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  return { ok: true, message: `Restored the card from ${new Date(b.at).toLocaleString()}${b.applied.length ? ` (before: ${b.applied.join(", ")})` : ""}` };
}

// ------------------------------------------------------ community saves ----

export async function communitySavesFor(ref: SaveRef | { platform: ApolloPlatform; titleId: string }) {
  const id = "cardId" in ref ? identifySave(ref) : null;
  const platform = "cardId" in ref ? id?.platform : ref.platform;
  const titleId = "cardId" in ref ? id?.titleId : ref.titleId;
  if (!platform || !titleId) return { gameName: null as string | null, saves: [] as Awaited<ReturnType<typeof listCommunitySaves>>, titleId: "" };
  return { gameName: titleName(platform, titleId), titleId, saves: await listCommunitySaves(platform, titleId) };
}

/** Downloads a community save and puts it on the card, as a new save directory (PS2) - a backup of the card first. */
export async function importCommunitySave(cardId: string, platform: ApolloPlatform, titleId: string, zip: string): Promise<{ ok: boolean; message: string }> {
  const card = cardOf(cardId);
  if (card.kind !== "ps2" || platform !== "PS2") return { ok: false, message: "community saves import onto PS2 cards here; PS1 saves come as .psv the PS1 importer doesn't read yet" };
  const files = await fetchCommunitySave(platform, titleId, zip);
  const inner = files.find((f) => /\.(psv|psu)$/i.test(f.name));
  if (!inner) return { ok: false, message: "the zip holds no .psv or .psu save" };
  const bundle = /\.psv$/i.test(inner.name) ? readPsvPs2(inner.data) : readPsu(inner.data);
  if (!bundle) return { ok: false, message: `${inner.name} isn't a PS2 save this reads` };
  const dir = path.join(backupsDir(), card.id, "_import", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(card.filePath, path.join(dir, "card.bak"));
  try {
    const ps2 = Ps2Card.open(card.filePath);
    if (ps2.listSaves().some((s) => s.name === bundle.name)) return { ok: false, message: `${bundle.name} is already on the card` };
    ps2.addSave(bundle.name, bundle.files, bundle.attr);
    ps2.save(card.filePath);
    const back = Ps2Card.open(card.filePath).listSaves().find((s) => s.name === bundle.name);
    if (!back) throw new Error("the save didn't read back");
    return { ok: true, message: `${back.title || bundle.name} added to ${card.name}` };
  } catch (err) {
    fs.copyFileSync(path.join(dir, "card.bak"), card.filePath);
    return { ok: false, message: `${(err as Error).message} - the card was restored` };
  }
}

/** A save as a .psu (PS2) or the raw blocks (PS1), for the phone's copy or export. */
export function exportSaveBundle(ref: SaveRef): { name: string; data: Buffer; kind: "psu" | "ps1" } {
  const { card, files } = readSaveFiles(ref);
  if (card.kind === "ps1") return { name: `${ref.save}.mcs`, data: files[0].data, kind: "ps1" };
  const ps2 = Ps2Card.open(card.filePath);
  const full = ps2.readSave(ref.save)!;
  const rootAttr = 0x8427;
  return { name: `${ref.save}.psu`, data: writePsu({ name: ref.save, attr: rootAttr, files: full.map((f) => ({ name: f.name, data: f.data, attr: f.attr, created: f.created, modified: f.modified })) }), kind: "psu" };
}

export function apolloEntryFor(platform: ApolloPlatform, titleId: string): PatchIndexEntry[] {
  return patchIndex().filter((e) => e.platform === platform && e.titleId === normaliseTitleId(titleId));
}

export type { ApolloPatch };
