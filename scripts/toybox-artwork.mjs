/**
 * Fills the local Toybox artwork cache.
 *
 *   node scripts/toybox-artwork.mjs [--limit N] [--force]
 *
 * Only figures whose record carries a `remoteArtwork` reference are fetched, and
 * the file lands in toybox-data/artwork, which is gitignored. This is a cache for a
 * private local build, exactly like the box-art cache A-X-M already keeps for Steam
 * and SteamGridDB. The images belong to their publishers - the record already says
 * who, and `redistributable: false` - so nothing here is ever committed or shipped.
 *
 * Already-downloaded files are skipped, so the run resumes after an interruption.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "toybox-data", "build");
const ARTWORK = path.join(ROOT, "toybox-data", "artwork");

/** Polite to the host, and fast enough for a few thousand small icons. */
const CONCURRENCY = 6;

const args = process.argv.slice(2);
const force = args.includes("--force");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

const dbPath = path.join(BUILD, "figures.json");
if (!fs.existsSync(dbPath)) {
  console.error("No database yet. Run: node scripts/toybox-import.mjs");
  process.exit(1);
}

const { figures } = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
const wanted = figures.filter((f) => f.media?.remoteArtwork).slice(0, limit);

let done = 0;
let saved = 0;
let skipped = 0;
let failed = 0;
const failures = [];

async function fetchOne(figure) {
  const url = figure.media.remoteArtwork;
  const ext = path.extname(new URL(url).pathname) || ".png";
  const dir = path.join(ARTWORK, figure.platform);
  const file = path.join(dir, `${figure.id}${ext}`);

  if (!force && fs.existsSync(file) && fs.statSync(file).size > 0) {
    skipped++;
    return;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      failed++;
      failures.push(`${figure.id}: HTTP ${res.status}`);
      return;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) {
      failed++;
      failures.push(`${figure.id}: empty response`);
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    // Written to a temp name first, so an interrupted run leaves no truncated file
    // that the resume check would then treat as complete.
    const temp = `${file}.part`;
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, file);
    saved++;
  } catch (err) {
    failed++;
    failures.push(`${figure.id}: ${String(err).slice(0, 80)}`);
  }
}

let cursor = 0;
async function worker() {
  while (cursor < wanted.length) {
    const figure = wanted[cursor++];
    await fetchOne(figure);
    done++;
    if (done % 50 === 0) process.stdout.write(`  ${done}/${wanted.length}\r`);
  }
}

console.log(`\nFetching artwork for ${wanted.length} figures into toybox-data/artwork\n`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\n  Saved    ${String(saved).padStart(6)}`);
console.log(`  Skipped  ${String(skipped).padStart(6)}  (already present)`);
console.log(`  Failed   ${String(failed).padStart(6)}\n`);
for (const f of failures.slice(0, 10)) console.log(`  ! ${f}`);
if (failures.length > 10) console.log(`  ! ...and ${failures.length - 10} more`);
