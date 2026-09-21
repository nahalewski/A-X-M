#!/usr/bin/env node
/**
 * Pulls LEGO Dimensions figure artwork into the local toybox cache.
 *
 * Source: https://github.com/skylandersNFC/LEGO-Dimensions-NFC
 * The set used is Chteupnin's, under Dimensions_Images/images/Separate, whose
 * files are named by LEGO Dimensions character id - exactly the key the toybox
 * figures already carry, so the two line up without any name matching.
 *
 * Nothing is committed. toybox-data is local-only and every figure entry is
 * marked redistributable: false, because the characters belong to LEGO and
 * Warner Bros. and the community assets that depict them carry no licence of
 * their own. This fetches them onto the user's own machine and credits the
 * people who made them; it does not put them in the repository.
 *
 * Existing files are left alone, so a rerun only fills gaps.
 *
 * Usage: node scripts/toybox-lego-art.mjs [--force]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "toybox-data", "artwork", "lego-dimensions");
const FIGURES = path.join(root, "toybox-data", "build", "figures.json");
const SOURCES = path.join(root, "toybox-data", "build", "SOURCES.md");

const REPO = "skylandersNFC/LEGO-Dimensions-NFC";
const BRANCH = "main";
const ASSET_AUTHOR = "Chteupnin";
const ASSET_DIR = "Dimensions_Images/images/Separate/Chteupnin's Assets";

const force = process.argv.includes("--force");

/** Every blob in the repo, so the exact paths come from the tree, not a guess. */
async function repoTree() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`, {
    headers: { "User-Agent": "A-X-M-toybox-import", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub tree: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.truncated) throw new Error("the repository tree came back truncated");
  return data.tree.filter((t) => t.type === "blob").map((t) => t.path);
}

/** The character ids the toybox actually has figures for. */
function wantedIds() {
  const raw = JSON.parse(fs.readFileSync(FIGURES, "utf-8"));
  const rows = Array.isArray(raw) ? raw : (raw.figures ?? []);
  const ids = new Map();
  for (const row of rows) {
    if (row.platform !== "lego-dimensions") continue;
    const id = row.attributes?.characterId;
    if (id) ids.set(String(id), row.name ?? "");
  }
  return ids;
}

async function download(url) {
  const res = await fetch(url, { headers: { "User-Agent": "A-X-M-toybox-import" } });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const wanted = wantedIds();
  const paths = await repoTree();

  // Map character id -> path in the repo, from that one author's folder.
  const available = new Map();
  for (const p of paths) {
    if (!p.startsWith(ASSET_DIR)) continue;
    const m = /\/(\d+)\.png$/.exec(p);
    if (m) available.set(m[1], p);
  }

  const todo = [...wanted.keys()].filter((id) => available.has(id));
  const missing = [...wanted.keys()].filter((id) => !available.has(id));

  console.log(`${wanted.size} LEGO figures, ${available.size} images in ${ASSET_AUTHOR}'s set`);
  console.log(`  ${todo.length} can be filled, ${missing.length} have no image`);

  let written = 0;
  let skipped = 0;
  let failed = 0;

  // A few at a time: polite to the host, and fast enough for a few hundred.
  const queue = [...todo];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const target = path.join(OUT, `lego-dimensions-character-${id}.png`);
      if (!force && fs.existsSync(target)) {
        skipped++;
        continue;
      }
      const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${available.get(id).split("/").map(encodeURIComponent).join("/")}`;
      const body = await download(url);
      if (!body) {
        failed++;
        continue;
      }
      // Temp then rename, so an interrupted run leaves no half-written image.
      const temp = `${target}.part`;
      fs.writeFileSync(temp, body);
      fs.renameSync(temp, target);
      written++;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  console.log(`\nwrote ${written}, kept ${skipped} already there, ${failed} failed`);
  if (missing.length) {
    console.log(`no image for character ids: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? " ..." : ""}`);
  }

  // Record where these came from, beside the other source notes.
  const note = [
    "",
    "## LEGO-Dimensions-NFC",
    "",
    `- URL: https://github.com/${REPO}`,
    "- Licence: none stated by the repository",
    `- Retrieved: ${new Date().toISOString().slice(0, 10)}`,
    `- Artwork: ${ASSET_AUTHOR}'s asset set (Dimensions_Images/images/Separate).`,
    "  Other sets in the same repository are by Jeneric, iranzo, Moto28, James Mcat,",
    "  J1onelonewolf and andromeda.333.",
    "- Note: LEGO Dimensions characters and marks belong to LEGO and Warner Bros.",
    "  These are community-made images, cached locally and never redistributed.",
    "",
  ].join("\n");

  let sources = fs.existsSync(SOURCES) ? fs.readFileSync(SOURCES, "utf-8") : "# Toybox data sources\n";
  if (!sources.includes("LEGO-Dimensions-NFC")) {
    fs.writeFileSync(SOURCES, sources.trimEnd() + "\n" + note);
    console.log("SOURCES.md updated");
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
