import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { ToyFigure } from "./types";

/**
 * Where a figure's picture comes from at runtime. Nothing publisher-owned ships
 * in the repository, so the order is: an image bundled with the database, then
 * the local cache (a development checkout's toybox-data/artwork, or the user's
 * data folder), then the referenced remote image - fetched once into the user's
 * cache, never redistributed.
 */

function cacheDir(): string {
  return path.join(app.getPath("userData"), "toybox", "artwork");
}

function devArtworkDir(): string {
  return path.join(app.getAppPath(), "toybox-data", "artwork");
}

const inFlight = new Set<string>();

function localFile(figure: ToyFigure): string | null {
  const candidates: string[] = [];
  for (const ext of [".png", ".jpg", ".webp"]) candidates.push(path.join(cacheDir(), `${figure.id}${ext}`), path.join(devArtworkDir(), figure.platform, `${figure.id}${ext}`), path.join(devArtworkDir(), `${figure.id}${ext}`));
  if (figure.media?.png) candidates.push(path.join(app.getPath("userData"), "toybox", figure.media.png));
  if (figure.media?.thumbnail) candidates.push(path.join(app.getPath("userData"), "toybox", figure.media.thumbnail));
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** A URL the renderer can put in an <img>, or null when the figure has no picture anywhere. */
export function artUrl(figure: ToyFigure): string | null {
  const local = localFile(figure);
  if (local) return pathToFileURL(local).href;
  const remote = figure.media?.remoteArtwork;
  if (remote && /^https:\/\//.test(remote)) {
    void cacheRemote(figure, remote);
    return remote;
  }
  return null;
}

async function cacheRemote(figure: ToyFigure, url: string): Promise<void> {
  const ext = path.extname(new URL(url).pathname).toLowerCase() || ".png";
  const dst = path.join(cacheDir(), `${figure.id}${ext}`);
  if (fs.existsSync(dst) || inFlight.has(figure.id)) return;
  inFlight.add(figure.id);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "A-X-M" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return;
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
  } catch {
    /* offline: the remote URL still works for the <img> when it can */
  } finally {
    inFlight.delete(figure.id);
  }
}
