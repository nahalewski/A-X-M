import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveArt, isGameArtConfigured } from "./gameArt";

/**
 * The artwork that shows through the cartridge's window.
 *
 * The cartridge icon has an opening in it, and rather than leaving that empty
 * the games actually on the cartridge are shown through it, one at a time. It
 * reads as a window onto what is loaded, which is the point of a cartridge.
 *
 * The cache lives on the cartridge itself, in an ARTWORK folder, not in this
 * machine's user data. That is deliberate: the cartridge is meant to travel, so
 * carrying its own artwork means plugging it into another machine shows the same
 * window immediately instead of re-fetching everything over the network.
 *
 * Only the flat rectangular grid art is used. Box renders and wide banners are
 * the wrong shape for the opening - the window is roughly two-by-three, which is
 * what the grid art already is, so it fills the space without cropping.
 */

const ARTWORK_FOLDER = "ARTWORK";

export interface CartridgeGame {
  name: string;
  /** Where the game sits, used only to confirm it is on this cartridge. */
  filePath: string;
}

function artworkFolder(drive: string): string | null {
  const dir = path.join(`${drive.slice(0, 2)}${String.fromCharCode(92)}`, ARTWORK_FOLDER);
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    // A read-only or absent cartridge; nothing to cache into.
    return null;
  }
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "game";
}

/** An already-cached file for this game, whatever extension it was saved with. */
function cached(folder: string, name: string): string | null {
  const base = safeName(name);
  for (const ext of [".webp", ".png", ".jpg", ".jpeg"]) {
    const candidate = path.join(folder, base + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Downloads one game's artwork onto the cartridge, if it is not already there.
 *
 * Written to a temp name and renamed, so pulling the cartridge mid-download
 * leaves no half-written image that would later be shown as a broken tile.
 */
async function fetchInto(folder: string, name: string, url: string): Promise<string | null> {
  const ext = (url.match(/\.(webp|png|jpe?g)(?:\?|$)/i)?.[1] ?? "png").toLowerCase();
  const target = path.join(folder, `${safeName(name)}.${ext === "jpeg" ? "jpg" : ext}`);
  const temp = `${target}.part`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": "A-X-M" } });
    if (!res.ok) return null;
    fs.writeFileSync(temp, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(temp, target);
    return target;
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Nothing to clean up.
    }
    return null;
  }
}

/**
 * Every piece of artwork for the games on this cartridge, as file URLs.
 *
 * What is already cached comes back straight away; anything missing is fetched
 * in the background and picked up the next time round. The window starts
 * turning as soon as there is one image rather than waiting for the whole set.
 */
export async function cartridgeArtwork(drive: string, games: CartridgeGame[]): Promise<string[]> {
  const folder = artworkFolder(drive);
  if (!folder) return [];

  const onCartridge = games.filter((g) => g.filePath.slice(0, 2).toUpperCase() === drive.slice(0, 2).toUpperCase());

  const have: string[] = [];
  const missing: CartridgeGame[] = [];
  for (const game of onCartridge) {
    const hit = cached(folder, game.name);
    if (hit) have.push(hit);
    else missing.push(game);
  }

  // Fetch what is missing, a few at a time so a full cartridge does not open
  // dozens of connections at once.
  if (isGameArtConfigured() && missing.length > 0) {
    const queue = [...missing];
    const worker = async (): Promise<void> => {
      for (let game = queue.shift(); game; game = queue.shift()) {
        const url = await resolveArt(game.name, "grid").catch(() => null);
        if (!url) continue;
        const file = url.startsWith("file:") ? null : await fetchInto(folder, game.name, url);
        if (file) have.push(file);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  return have.map((file) => pathToFileURL(file).href);
}

/** Clears a cartridge's cached artwork, for when it is rebuilt from scratch. */
export function clearCartridgeArtwork(drive: string): number {
  const folder = artworkFolder(drive);
  if (!folder) return 0;
  let removed = 0;
  try {
    for (const file of fs.readdirSync(folder)) {
      fs.rmSync(path.join(folder, file), { force: true });
      removed++;
    }
  } catch {
    // Nothing to clear.
  }
  return removed;
}
