import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Channel logos the user drops in themselves.
 *
 * A folder called `network logos` next to the app. Anything in it overrides what
 * the TV provider serves, which is the point: providers ship whatever artwork they
 * happen to have, often at poor quality or not at all, and this lets a real set be
 * used instead without waiting on them.
 *
 * Nothing is bundled. Broadcaster marks belong to their owners, so only the folder
 * and its README are part of the project; what goes inside is the user's own.
 *
 * Matching is forgiving because channel names are not: a provider might call a
 * channel "BBC One HD", "BBC ONE" or "UK| BBC One FHD" and the same file should
 * answer for all three.
 */

const EXTENSIONS = [".png", ".webp", ".jpg", ".jpeg", ".svg"];

/** Built once per scan and thrown away when the folder changes. */
let index: Map<string, string> | null = null;
let indexedAt = 0;
let indexedFrom: string | null = null;

/** How long an index is trusted before the folder is read again. */
const RESCAN_AFTER_MS = 30_000;

export function logoSearchPaths(): string[] {
  const paths = [path.join(process.cwd(), "network logos")];
  try {
    paths.push(path.join(path.dirname(app.getPath("exe")), "network logos"));
    paths.push(path.join(app.getPath("userData"), "network logos"));
  } catch {
    // Before the app is ready the working directory is enough.
  }
  return paths;
}

export function logoFolder(): string {
  for (const dir of logoSearchPaths()) {
    if (fs.existsSync(dir)) return dir;
  }
  return logoSearchPaths()[0];
}

/**
 * Strips everything that varies between providers but not between channels:
 * quality suffixes, country prefixes, punctuation and spacing. "UK| BBC One FHD"
 * and "bbc-one.png" both reduce to "bbcone".
 */
function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/^[a-z]{2,3}\s*[|:]\s*/i, "")
    .replace(/\b(fhd|uhd|hd|sd|4k|1080p?|720p?|raw|backup|vip)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function buildIndex(): Map<string, string> {
  const map = new Map<string, string>();
  const dir = logoFolder();
  indexedFrom = dir;
  try {
    for (const entry of fs.readdirSync(dir)) {
      const ext = path.extname(entry).toLowerCase();
      if (!EXTENSIONS.includes(ext)) continue;
      const k = key(entry);
      // First file wins, so a deliberate "bbc one.png" is not replaced by a
      // stray "BBC One (1).png" that reduces to the same key.
      if (k && !map.has(k)) map.set(k, path.join(dir, entry));
    }
  } catch {
    // No folder yet, which is the normal state until someone adds one.
  }
  return map;
}

function currentIndex(): Map<string, string> {
  const now = Date.now();
  if (!index || now - indexedAt > RESCAN_AFTER_MS || indexedFrom !== logoFolder()) {
    index = buildIndex();
    indexedAt = now;
  }
  return index;
}

/** Forces a rescan, for after the user has added files without restarting. */
export function refreshLogos(): number {
  index = buildIndex();
  indexedAt = Date.now();
  return index.size;
}

/**
 * A file:// URL for this channel's logo, or null to fall back to the provider's
 * own artwork. Tries the whole name, then progressively shorter leading words, so
 * "Sky Sports Main Event HD" still finds a file called "Sky Sports".
 */
export function logoFor(channelName: string): string | null {
  const map = currentIndex();
  if (map.size === 0) return null;

  const exact = map.get(key(channelName));
  if (exact) return pathToFileURL(exact).href;

  const words = channelName.split(/[\s|:_-]+/).filter(Boolean);
  for (let take = words.length - 1; take >= 2; take--) {
    const hit = map.get(key(words.slice(0, take).join(" ")));
    if (hit) return pathToFileURL(hit).href;
  }
  return null;
}

export function logoStatus(): { folder: string; count: number } {
  return { folder: logoFolder(), count: currentIndex().size };
}
