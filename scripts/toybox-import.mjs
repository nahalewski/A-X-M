/**
 * Builds the Toybox figure database from the downloaded community sources.
 *
 *   node scripts/toybox-import.mjs            build into toybox-data/build
 *   node scripts/toybox-import.mjs --install  also copy it into A-X-M's userData
 *
 * Sources live in toybox-data/sources and are gitignored, along with everything
 * this produces: the A-X-M repository is public, and none of this data is ours to
 * republish. It is pulled for a private local build only.
 *
 * Identification metadata only. Nothing here reads, stores or produces tag dumps,
 * keys or decrypted game data - only enough to say "this tag is that figure".
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = path.join(ROOT, "toybox-data", "sources");
const BUILD = path.join(ROOT, "toybox-data", "build");
const SCHEMA_VERSION = 1;

/** Provenance for every record, so credits are generated rather than remembered. */
const PROVENANCE = {
  amiibo: {
    type: "metadata",
    project: "AmiiboAPI",
    url: "https://github.com/N3evin/AmiiboAPI",
    license: "MIT",
    note: "Archived upstream. The MIT licence covers the compiled dataset, not Nintendo's artwork.",
  },
  skylanders: {
    type: "metadata",
    project: "Skylander-IDs",
    url: "https://github.com/Texthead1/Skylander-IDs",
    license: "unlicensed",
    note: "No licence declared upstream, so all rights reserved. Local use only; do not redistribute.",
  },
  "lego-dimensions": {
    type: "metadata",
    project: "ldnfctags",
    url: "https://github.com/phogar/ldnfctags",
    license: "GPL-3.0",
    note: "Only the identification tables are used - characters, vehicles, worlds, sets and waves. None of the project's tag-writing or key material is read or stored.",
  },
};

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ---------------------------------------------------------------- amiibo ----

/**
 * An amiibo's 16 hex digits carry every field we need:
 *   AABB CC DD EEFF GG HH
 *   AABB character (its top 12 bits are the game series)
 *   CC   character variant   DD figure type
 *   EEFF model number        GG amiibo series   HH always 02
 * The NFC head is the first 8 digits and the tail the last 8, which is the split
 * a reader reports, so the database can be indexed on exactly what a scan gives us.
 */
function importAmiibo() {
  const file = path.join(SOURCES, "amiibo.json");
  if (!fs.existsSync(file)) return { figures: [], skipped: ["amiibo.json missing"] };

  const db = JSON.parse(fs.readFileSync(file, "utf-8"));
  const figures = [];
  const skipped = [];

  for (const [rawId, entry] of Object.entries(db.amiibos ?? {})) {
    const hex = rawId.replace(/^0x/i, "").toLowerCase();
    if (hex.length !== 16) {
      skipped.push(`amiibo ${rawId}: id is not 16 hex digits`);
      continue;
    }

    const head = hex.slice(0, 8);
    const tail = hex.slice(8);
    const characterKey = `0x${hex.slice(0, 4)}`;
    const gameSeriesKey = `0x${hex.slice(0, 3)}`;
    const typeKey = `0x${hex.slice(6, 8)}`;
    const seriesKey = `0x${hex.slice(12, 14)}`;

    const character = db.characters?.[characterKey];
    const gameSeries = db.game_series?.[gameSeriesKey];
    const type = db.types?.[typeKey];
    const amiiboSeries = db.amiibo_series?.[seriesKey];

    const attributes = {};
    if (character) attributes.character = character;
    if (type) attributes.type = type;
    if (amiiboSeries) attributes.amiiboSeries = amiiboSeries;
    for (const [region, date] of Object.entries(entry.release ?? {})) {
      if (date) attributes[`released_${region}`] = date;
    }

    figures.push({
      schemaVersion: SCHEMA_VERSION,
      id: `amiibo-${head}-${tail}`,
      platform: "amiibo",
      name: entry.name ?? character ?? rawId,
      franchise: gameSeries ?? undefined,
      series: amiiboSeries ?? undefined,
      manufacturer: "Nintendo",
      variant: type ?? undefined,
      attributes,
      nfc: { technology: "ntag215", identifierType: "head-tail", head, tail },
      media: {
        // Nintendo's artwork. Referenced with its owner recorded, never copied into
        // anything shareable; A-X-M may cache it locally at runtime.
        remoteArtwork: `https://raw.githubusercontent.com/N3evin/AmiiboAPI/master/images/icon_${head}-${tail}.png`,
        copyrightOwner: "Nintendo",
        redistributable: false,
      },
      compatibleGames: [],
      sources: [{ ...PROVENANCE.amiibo, retrieved: new Date().toISOString().slice(0, 10) }],
    });
  }

  return { figures, skipped };
}

// ------------------------------------------------------------ skylanders ----

/**
 * The upstream file is one markdown document: `### Series` headings, then rows of
 * `Name | CharacterID | VariantID`. A character and variant pair is what a portal
 * reports, so that pair is the identifier here.
 */
function importSkylanders() {
  const file = path.join(SOURCES, "skylander-ids.md");
  if (!fs.existsSync(file)) return { figures: [], skipped: ["skylander-ids.md missing"] };

  const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
  const figures = [];
  const skipped = [];
  const seen = new Set();
  let series = null;
  let inInfo = false;

  for (const line of lines) {
    if (/^##\s+Info\s*$/i.test(line)) {
      inInfo = true;
      continue;
    }
    // Credits and everything after it are prose, not data.
    if (/^##\s+Credits/i.test(line)) break;
    if (!inInfo) continue;

    const heading = /^###\s+(.*?)\s*$/.exec(line);
    if (heading) {
      series = heading[1];
      continue;
    }

    const parts = line.split("|").map((p) => p.trim());
    if (parts.length !== 3) continue;
    const [name, characterId, variantId] = parts;
    // Skips the header row and the dashed rule under it.
    if (!/^\d+$/.test(characterId) || !/^\d+$/.test(variantId)) continue;
    if (!name || name === "?") {
      skipped.push(`skylanders ${characterId}/${variantId}: no name`);
      continue;
    }

    const id = `skylanders-${characterId}-${variantId}`;
    if (seen.has(id)) {
      // Upstream lists a few figures under more than one series; first wins.
      skipped.push(`skylanders ${id}: duplicate of an earlier row (${name})`);
      continue;
    }
    seen.add(id);

    // "Spyro (Series 2)" - the base name is the character, the bracket the variant.
    const variantMatch = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
    const baseName = variantMatch ? variantMatch[1] : name;
    const variant = variantMatch ? variantMatch[2] : "Standard";

    figures.push({
      schemaVersion: SCHEMA_VERSION,
      id,
      platform: "skylanders",
      name: baseName,
      franchise: "Skylanders",
      series: series ?? undefined,
      manufacturer: "Activision",
      variant,
      attributes: { characterId, variantId, listedAs: name },
      nfc: { technology: "mifare-classic-1k", identifierType: "character-variant", characterId, variantId },
      media: {
        // No artwork source with clear permission has been identified, so nothing is
        // referenced rather than guessed at.
        copyrightOwner: "Activision",
        redistributable: false,
      },
      compatibleGames: [],
      sources: [{ ...PROVENANCE.skylanders, retrieved: new Date().toISOString().slice(0, 10) }],
    });
  }

  return { figures, skipped };
}


// -------------------------------------------------------- lego dimensions ----

/**
 * Upstream ships its identification tables as a small SQL dump. Only the rows that
 * name things are read - characters, vehicles, worlds, sets and waves. The rest of
 * that project is a tag-writing tool, and none of it is touched here.
 */
function importLegoDimensions() {
  const file = path.join(SOURCES, "ldtags.sql");
  if (!fs.existsSync(file)) return { figures: [], skipped: ["ldtags.sql missing"] };

  const sql = fs.readFileSync(file, "utf-8");
  const skipped = [];

  /** Pulls every INSERT row for one table, splitting on commas outside quotes. */
  const rows = (table) => {
    const out = [];
    const re = new RegExp(`INSERT INTO [\`"]${table}[\`"] VALUES\((.*?)\);`, "g");
    let m;
    while ((m = re.exec(sql)) !== null) {
      const values = [];
      let current = "";
      let quoted = false;
      for (let i = 0; i < m[1].length; i++) {
        const c = m[1][i];
        // '' is an escaped quote inside a SQL string, not the end of one.
        if (c === "'" && m[1][i + 1] === "'") {
          current += "'";
          i++;
        } else if (c === "'") quoted = !quoted;
        else if (c === "," && !quoted) {
          values.push(current.trim());
          current = "";
        } else current += c;
      }
      values.push(current.trim());
      out.push(values);
    }
    return out;
  };

  const worlds = new Map(rows("worlds").map((r) => [r[0], r[1]]));
  const waves = new Map(rows("waves").map((r) => [r[0], r[1]]));
  const packaging = new Map(rows("packaging").map((r) => [r[0], r[1]]));
  const sets = new Map(rows("sets").map((r) => [r[0], { wave: waves.get(r[1]), packaging: packaging.get(r[2]) }]));

  const figures = [];
  const seen = new Set();

  const add = (characterId, name, world, set, kind, extra = {}) => {
    const id = `lego-dimensions-${kind}-${characterId}`;
    if (seen.has(id)) {
      skipped.push(`lego ${id}: duplicate row (${name})`);
      return;
    }
    seen.add(id);
    const info = sets.get(set);
    figures.push({
      schemaVersion: SCHEMA_VERSION,
      id,
      platform: "lego-dimensions",
      name,
      franchise: world ? worlds.get(world) : undefined,
      series: info?.wave ? `Wave ${info.wave}` : undefined,
      manufacturer: "LEGO / Warner Bros.",
      variant: kind === "vehicle" ? "Vehicle" : "Character",
      attributes: {
        characterId: String(characterId),
        kind,
        ...(info?.packaging ? { packaging: info.packaging } : {}),
        ...(set ? { set: String(set) } : {}),
        ...extra,
      },
      nfc: { technology: "ntag213", identifierType: "character-variant", characterId: String(characterId), variantId: "0" },
      media: { copyrightOwner: "LEGO / Warner Bros.", redistributable: false },
      compatibleGames: [],
      sources: [{ ...PROVENANCE["lego-dimensions"], retrieved: new Date().toISOString().slice(0, 10) }],
    });
  };

  for (const [id, set, world, name] of rows("characters")) add(id, name, world, set, "character");
  // A vehicle's world comes from the character it belongs to, which is how upstream
  // models it - vehicles carry no world of their own.
  const charWorld = new Map(rows("characters").map((r) => [r[0], r[2]]));
  for (const [id, characterId, name] of rows("vehicles")) add(id, name, charWorld.get(characterId), null, "vehicle");

  return { figures, skipped };
}

// -------------------------------------------------------------- validate ----

function validate(figures) {
  const errors = [];
  const ids = new Set();
  const tags = new Map();

  for (const f of figures) {
    if (!f.id) errors.push("a figure has no id");
    else if (ids.has(f.id)) errors.push(`duplicate id: ${f.id}`);
    else ids.add(f.id);

    if (!f.name) errors.push(`${f.id}: no name`);
    if (!f.platform) errors.push(`${f.id}: no platform`);
    if (!f.sources?.length) errors.push(`${f.id}: no provenance`);

    const n = f.nfc ?? {};
    const key =
      f.platform === "amiibo"
        ? `amiibo:${n.head}-${n.tail}`
        : `${f.platform}:${n.characterId}-${n.variantId ?? "0"}`;
    // Two figures resolving to one tag would make a scan ambiguous.
    if (tags.has(key)) errors.push(`tag clash: ${f.id} and ${tags.get(key)} both map to ${key}`);
    else tags.set(key, f.id);

    if (f.media?.png && !fs.existsSync(path.join(ROOT, "toybox-data", f.media.png))) {
      errors.push(`${f.id}: bundled artwork missing at ${f.media.png}`);
    }
  }
  return errors;
}

// ----------------------------------------------------------------- build ----

const results = {
  amiibo: importAmiibo(),
  skylanders: importSkylanders(),
  "lego-dimensions": importLegoDimensions(),
};
const figures = Object.values(results).flatMap((r) => r.figures);
const skipped = Object.values(results).flatMap((r) => r.skipped);
const errors = validate(figures);

const byPlatform = {};
let withArtwork = 0;
let referencedArtwork = 0;
let missingArtwork = 0;
for (const f of figures) {
  byPlatform[f.platform] = (byPlatform[f.platform] ?? 0) + 1;
  if (f.media?.png || f.media?.thumbnail) withArtwork++;
  else if (f.media?.remoteArtwork) referencedArtwork++;
  else missingArtwork++;
}

const manifest = {
  databaseVersion: Date.now(),
  schemaVersion: SCHEMA_VERSION,
  updatedAt: new Date().toISOString(),
  figures: byPlatform,
};

fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(path.join(BUILD, "figures.json"), JSON.stringify({ figures }), "utf-8");
fs.writeFileSync(path.join(BUILD, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

// Credits, generated from the data rather than maintained by hand.
const used = new Map();
for (const f of figures) for (const s of f.sources ?? []) used.set(s.project, s);
const sourcesMd = [
  "# Toybox data sources",
  "",
  "Generated by scripts/toybox-import.mjs. Do not edit by hand.",
  "",
  ...[...used.values()].flatMap((s) => [
    `## ${s.project}`,
    "",
    `- URL: ${s.url}`,
    `- Licence: ${s.license}`,
    `- Retrieved: ${s.retrieved}`,
    ...(s.note ? [`- Note: ${s.note}`] : []),
    "",
  ]),
  "## Artwork",
  "",
  "Character artwork for these franchises belongs to its publishers and is not",
  "redistributed here. Records carry a reference and the copyright owner; A-X-M may",
  "cache an image locally at runtime for this private build.",
  "",
].join("\n");
fs.writeFileSync(path.join(BUILD, "SOURCES.md"), sourcesMd, "utf-8");

console.log("\nToybox Database\n");
for (const [platform, n] of Object.entries(byPlatform)) {
  console.log(`  ${platform.padEnd(18)} ${String(n).padStart(6)}`);
}
console.log(`  ${"".padEnd(18)} ${"------".padStart(6)}`);
console.log(`  ${"Total".padEnd(18)} ${String(figures.length).padStart(6)}\n`);
console.log(`  Bundled artwork    ${String(withArtwork).padStart(6)}`);
console.log(`  Referenced artwork ${String(referencedArtwork).padStart(6)}`);
console.log(`  No artwork         ${String(missingArtwork).padStart(6)}`);
console.log(`  Rows skipped       ${String(skipped.length).padStart(6)}`);
console.log(`  Validation errors  ${String(errors.length).padStart(6)}\n`);

for (const e of errors.slice(0, 15)) console.log(`  ! ${e}`);
if (errors.length > 15) console.log(`  ! ...and ${errors.length - 15} more`);
for (const s of skipped.slice(0, 8)) console.log(`  - skipped: ${s}`);
if (skipped.length > 8) console.log(`  - ...and ${skipped.length - 8} more`);

if (process.argv.includes("--install")) {
  const appData = process.env.APPDATA ?? path.join(process.env.HOME ?? "", ".config");
  const target = path.join(appData, "A-X-M", "toybox");
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(BUILD, "figures.json"), path.join(target, "figures.json"));
  fs.copyFileSync(path.join(BUILD, "manifest.json"), path.join(target, "manifest.json"));
  console.log(`\n  Installed into ${target}\n`);
}

process.exit(errors.length > 0 ? 1 : 0);
