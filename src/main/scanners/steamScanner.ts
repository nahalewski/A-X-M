import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseVdf, VdfNode } from "../vdf";
import { GameEntry } from "../types";

export function getSteamInstallPath(): string | null {
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
      { encoding: "utf-8" }
    );
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match) return match[1].trim().replace(/\//g, "\\");
  } catch {
    // Steam not installed / registry key missing
  }
  const fallback = "C:\\Program Files (x86)\\Steam";
  return fs.existsSync(fallback) ? fallback : null;
}

/** Windows paths are case-insensitive and mix separators, so compare on a normalized form. */
function normalizePath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function getLibraryFolders(steamPath: string): string[] {
  const libs = [steamPath];
  const seen = new Set([normalizePath(steamPath)]);
  const vdfPath = path.join(steamPath, "steamapps", "libraryfolders.vdf");
  try {
    const text = fs.readFileSync(vdfPath, "utf-8");
    const parsed = parseVdf(text);
    const root = parsed["libraryfolders"] as VdfNode;
    for (const key of Object.keys(root)) {
      const entry = root[key];
      if (typeof entry === "object" && entry.path) {
        const p = (entry.path as string).replace(/\\\\/g, "\\");
        if (seen.has(normalizePath(p))) continue;
        seen.add(normalizePath(p));
        libs.push(p);
      }
    }
  } catch {
    // no extra libraries
  }
  return libs;
}

export function scanSteamGames(): GameEntry[] {
  const steamPath = getSteamInstallPath();
  if (!steamPath) return [];
  const libraries = getLibraryFolders(steamPath);
  const games: GameEntry[] = [];
  const seenAppIds = new Set<string>();

  for (const lib of libraries) {
    const steamappsDir = path.join(lib, "steamapps");
    let files: string[] = [];
    try {
      files = fs.readdirSync(steamappsDir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        const text = fs.readFileSync(path.join(steamappsDir, file), "utf-8");
        const parsed = parseVdf(text) as VdfNode;
        const app = parsed["AppState"] as VdfNode;
        if (!app) continue;
        const appId = app["appid"] as string;
        const name = app["name"] as string;
        const installDirName = app["installdir"] as string;
        if (!appId || !name || !installDirName) continue;

        // A game installed in one library can still have a stale manifest in another.
        if (seenAppIds.has(appId)) continue;
        seenAppIds.add(appId);

        // Skip redistributables / drivers / tools that show up alongside real games
        if (
          /steamworks common redistributables|steam controller configs|steam linux runtime|dts audio|proton|steamvr|redistributable|lossless scaling/i.test(
            name
          )
        ) {
          continue;
        }

        const installDir = path.join(steamappsDir, "common", installDirName);

        games.push({
          id: `steam-${appId}`,
          name,
          source: "steam",
          launchType: "uri",
          launchTarget: `steam://rungameid/${appId}`,
          installDir,
          drive: lib.slice(0, 2).toUpperCase(),
          iconPath: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
          // Steam ships the same wide banner the store uses; the renderer falls back
          // to the wave if a given app doesn't have one.
          heroPath: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
          losslessProfile: null,
          hidden: false,
        });
      } catch {
        // skip malformed manifest
      }
    }
  }

  return games;
}
