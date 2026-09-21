import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { listCards, readSaves } from "../memoryCard";
import { Ps2Card, readPsu, readPsvPs2, removeSave } from "../ps2card";
import { apolloDir } from "./database";
import * as apollo from "./service";
import type { SaveListing, SavesFileMessage, SavesPatchesMessage, SavesResultMessage } from "../companion/protocol";

/**
 * The saves side of the companion: what the phone lists, the copies it keeps
 * offline, and Apollo's cheats at its request. All of it runs through the same
 * service the TV uses, so a code applied from the phone is byte-for-byte what
 * the Memory Card Utility would have written.
 */

const sha1 = (b: Buffer) => crypto.createHash("sha1").update(b).digest("hex");

export function listing(autoSync: boolean): SaveListing {
  const cards = listCards().map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    saves: readSaves(c.id).map((s) => {
      let hash = "";
      try {
        hash = sha1(apollo.exportSaveBundle({ cardId: c.id, save: s.name }).data);
      } catch {
        /* unreadable save: listed without a hash */
      }
      return { name: s.name, title: s.title, size: s.sizeBytes, sha1: hash };
    }),
  }));
  return { cards, autoSync };
}

export function copyOf(cardId: string, save: string): SavesFileMessage["payload"] | null {
  try {
    const b = apollo.exportSaveBundle({ cardId, save });
    const card = listCards().find((c) => c.id === cardId)!;
    const title = readSaves(cardId).find((s) => s.name === save)?.title ?? save;
    return { cardId, save, title, kind: card.kind, fileName: b.name, base64: b.data.toString("base64"), sha1: sha1(b.data), at: new Date().toISOString() };
  } catch {
    return null;
  }
}

/** The phone's copy back onto the card: the card is backed up, the save replaced, the result read back. */
export function pushBack(cardId: string, save: string, base64: string): SavesResultMessage["payload"] {
  const card = listCards().find((c) => c.id === cardId);
  if (!card || !fs.existsSync(card.filePath)) return { cardId, save, ok: false, message: "that card isn't here any more" };
  const data = Buffer.from(base64, "base64");
  const dir = path.join(apolloDir(), "backups", card.id, save.replace(/[^A-Za-z0-9._-]/g, "_"), new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(card.filePath, path.join(dir, "card.bak"));
  fs.writeFileSync(path.join(dir, "backup.json"), JSON.stringify({ id: path.basename(dir), at: new Date().toISOString(), cardId, save, applied: [], note: "Before a copy from the phone was put back" }, null, 2));
  try {
    if (card.kind === "ps1") {
      // The copy is the raw blocks; the same size goes straight back into the chain.
      const current = apollo.readSaveFiles({ cardId, save });
      if (data.length !== current.files[0].data.length) throw new Error("the copy's size doesn't match the save on the card");
      apollo.writeSaveFilesForPush(cardId, save, data);
    } else {
      const bundle = readPsvPs2(data) ?? readPsu(data);
      if (!bundle) throw new Error("the copy isn't a .psu or .psv save");
      const ps2 = Ps2Card.open(card.filePath);
      removeSave(ps2, save);
      ps2.addSave(bundle.name, bundle.files, bundle.attr);
      ps2.save(card.filePath);
      if (!Ps2Card.open(card.filePath).listSaves().some((s) => s.name === bundle.name)) throw new Error("the save didn't read back");
    }
    return { cardId, save, ok: true, message: `${save} put back on ${card.name}` };
  } catch (err) {
    fs.copyFileSync(path.join(dir, "card.bak"), card.filePath);
    return { cardId, save, ok: false, message: `${(err as Error).message} - the card was restored` };
  }
}

export function cheats(cardId: string, save: string): SavesPatchesMessage["payload"] {
  const empty = { cardId, save, gameName: null, productCode: "", region: "", attribution: [] as string[], codes: [] };
  try {
    const m = apollo.findPatches({ cardId, save });
    if (!m) return { ...empty, error: "This save's game couldn't be identified from its name." };
    return {
      cardId,
      save,
      gameName: m.identity.gameName,
      productCode: m.identity.productCode,
      region: m.identity.region,
      attribution: m.attribution,
      codes: m.codes.map((mc) => ({
        key: `${mc.patchFile}#${mc.code.id}`,
        name: mc.code.name,
        group: mc.code.group,
        isInfo: mc.code.isInfo,
        isRequired: mc.code.isRequired,
        isDefault: mc.code.isDefault,
        type: mc.code.type,
        targets: mc.targets,
        options: mc.code.options,
      })),
    };
  } catch (err) {
    return { ...empty, error: (err as Error).message };
  }
}

export function applyFromPhone(cardId: string, save: string, selections: { key: string; options: Record<string, string> }[], preview: boolean): SavesResultMessage["payload"] {
  const sel: apollo.Selection[] = selections.map((s) => {
    const hash = s.key.lastIndexOf("#");
    return { patchFile: s.key.slice(0, hash), codeId: Number(s.key.slice(hash + 1)), options: s.options };
  });
  if (preview) {
    const p = apollo.preview({ cardId, save }, sel);
    return { cardId, save, ok: p.ok, message: p.ok ? `${p.files.reduce((n, f) => n + f.changed, 0)} byte(s) would change${p.added.length ? ` · adds ${p.added.join(", ")}` : ""}` : p.error ?? "refused", preview: p.files.map((f) => ({ name: f.name, changed: f.changed, first: f.first })) };
  }
  const r = apollo.apply({ cardId, save }, sel, "from the phone");
  return { cardId, save, ok: r.ok, message: r.message };
}

export function restoreLast(cardId: string, save: string): SavesResultMessage["payload"] {
  const r = apollo.restoreBackup({ cardId, save });
  return { cardId, save, ok: r.ok, message: r.message };
}
