import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseVdf, VdfNode } from "../vdf";
import { GameEntry } from "../types";

function getSteamInstallPath(): string | null {
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

function getLibraryFolders(steamPath: string): string[] {
  const libs = [steamPath];
  const vdfPath = path.join(steamPath, "steamapps", "libraryfolders.vdf");
  try {
    const text = fs.readFileSync(vdfPath, "utf-8");
    const parsed = parseVdf(text);
    const root = parsed["libraryfolders"] as VdfNode;
    for (const key of Object.keys(root)) {
      const entry = root[key];
      if (typeof entry === "object" && entry.path) {
        const p = (entry.path as string).replace(/\\\\/g, "\\");
        if (!libs.includes(p)) libs.push(p);
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

        // Skip Steamworks redistributables / tools that show up as "games"
        if (/steamworks common redistributables|steam controller configs|steam linux runtime/i.test(name)) continue;

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
