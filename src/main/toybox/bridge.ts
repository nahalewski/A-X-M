import * as fs from "node:fs";
import * as path from "node:path";
import { isWindows } from "../platform";

/**
 * The hand-off to the emulators. Neither RPCS3 nor Eden can be told from outside
 * to load a figure, but both load figure files from a folder through their own
 * dialogs - so a scanned toy's read-only copy is put where those dialogs look:
 *
 *   - amiibo         -> Eden's (or yuzu's) amiibo folder, File > Load Amiibo
 *   - Skylanders     -> <rpcs3>\skylanders\, Utilities > Skylanders Portal > Load
 *   - Disney Infinity-> <rpcs3>\infinity\,   Utilities > Infinity Base > Load
 *
 * A real portal / base / toy pad plugged into the PC goes straight to RPCS3 via
 * its USB passthrough and needs none of this.
 */

export interface EmulatorPaths {
  rpcs3: string | null;
  edenAmiibo: string | null;
}

function firstDir(candidates: string[]): string | null {
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

export function findEmulators(gameTargets: string[] = []): EmulatorPaths {
  const appData = process.env.APPDATA ?? "";
  const fromGames = gameTargets.filter((t) => /rpcs3(\.exe)?$/i.test(t)).map((t) => path.dirname(t));
  const rpcs3 = firstDir([...fromGames, "C:\\rpcs3", path.join(process.env.ProgramFiles ?? "", "rpcs3"), path.join(process.env.LOCALAPPDATA ?? "", "Programs", "rpcs3")].filter(Boolean));
  const edenAmiibo = isWindows
    ? firstDir([path.join(appData, "eden", "amiibo"), path.join(appData, "yuzu", "amiibo"), path.join(appData, "eden"), path.join(appData, "yuzu")].filter(Boolean))
    : firstDir([path.join(process.env.HOME ?? "", ".local", "share", "eden", "amiibo"), path.join(process.env.HOME ?? "", ".local", "share", "yuzu", "amiibo")]);
  return { rpcs3, edenAmiibo: edenAmiibo && !/amiibo$/i.test(edenAmiibo) ? path.join(edenAmiibo, "amiibo") : edenAmiibo };
}

/** Copies a figure file next to the emulator that plays that ecosystem. Returns where it went. */
export function handOff(ecosystem: string, file: string, gameTargets: string[] = []): string[] {
  const emus = findEmulators(gameTargets);
  const targets: string[] = [];
  if (ecosystem === "amiibo" && emus.edenAmiibo) targets.push(emus.edenAmiibo);
  if (ecosystem === "skylanders" && emus.rpcs3) targets.push(path.join(emus.rpcs3, "skylanders"));
  if (ecosystem === "disney-infinity" && emus.rpcs3) targets.push(path.join(emus.rpcs3, "infinity"));
  const done: string[] = [];
  for (const dir of targets) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const dst = path.join(dir, path.basename(file));
      fs.copyFileSync(file, dst);
      done.push(dst);
    } catch {
      /* a read-only emulator folder is not worth failing a scan over */
    }
  }
  return done;
}
