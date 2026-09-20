import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Finds where games keep their saves, for the Saved Data Utility folder. PC games
 * are inconsistent about this, so it checks the places that are conventional
 * enough to be worth listing: the Windows "Saved Games" folder, "Documents\My
 * Games", and Steam's per-account cloud sync directory. AppData is deliberately
 * left alone - nearly everything in it isn't a game.
 */

export interface SaveEntry {
  id: string;
  name: string;
  /** Folder to open in Explorer. */
  filePath: string;
  source: "Saved Games" | "My Games" | "Steam Cloud";
  /** Last modified, ISO string, for "when did I last play this". */
  modified: string;
}

function getSteamPath(): string | null {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], {
      encoding: "utf-8",
    });
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match) return match[1].trim().replace(/\//g, "\\");
  } catch {
    // no Steam
  }
  return null;
}

function listFolders(dir: string): { name: string; full: string; mtime: Date }[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const full = path.join(dir, d.name);
        return { name: d.name, full, mtime: fs.statSync(full).mtime };
      });
  } catch {
    return [];
  }
}

/**
 * Steam keeps cloud saves under userdata/<account>/<appid>/remote. The appid is
 * only meaningful with a name, so the caller passes a lookup from the game scan;
 * anything unmatched is shown by its appid rather than dropped.
 */
function scanSteamSaves(nameByAppId: Map<string, string>): SaveEntry[] {
  const steamPath = getSteamPath();
  if (!steamPath) return [];
  const entries: SaveEntry[] = [];
  for (const account of listFolders(path.join(steamPath, "userdata"))) {
    for (const app of listFolders(account.full)) {
      if (!/^\d+$/.test(app.name)) continue;
      const remote = path.join(app.full, "remote");
      if (!fs.existsSync(remote)) continue;
      // Steam's own client storage (config, screenshots) uses a handful of
      // reserved ids that aren't games.
      if (["7", "241100", "760"].includes(app.name)) continue;
      entries.push({
        id: `steam-save-${account.name}-${app.name}`,
        name: nameByAppId.get(app.name) ?? `Steam App ${app.name}`,
        filePath: remote,
        source: "Steam Cloud",
        modified: fs.statSync(remote).mtime.toISOString(),
      });
    }
  }
  return entries;
}

export function scanSaves(nameByAppId: Map<string, string>): SaveEntry[] {
  const home = os.homedir();
  const entries: SaveEntry[] = [];

  for (const f of listFolders(path.join(home, "Saved Games"))) {
    entries.push({ id: `sg-${f.name}`, name: f.name, filePath: f.full, source: "Saved Games", modified: f.mtime.toISOString() });
  }
  for (const f of listFolders(path.join(home, "Documents", "My Games"))) {
    entries.push({ id: `mg-${f.name}`, name: f.name, filePath: f.full, source: "My Games", modified: f.mtime.toISOString() });
  }
  entries.push(...scanSteamSaves(nameByAppId));

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return entries;
}
