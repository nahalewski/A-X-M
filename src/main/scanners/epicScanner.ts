import * as fs from "node:fs";
import * as path from "node:path";
import { GameEntry } from "../types";

interface EpicManifest {
  DisplayName?: string;
  InstallLocation?: string;
  LaunchExecutable?: string;
  CatalogNamespace?: string;
  CatalogItemId?: string;
  AppName?: string;
  bIsIncompleteInstall?: boolean;
  bIsApplication?: boolean;
  /** Set on DLC and add-ons, pointing at the game they belong to. Empty on a base game. */
  MainGameAppName?: string;
  AppCategories?: string[];
}

const MANIFEST_DIR = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";

export function scanEpicGames(): GameEntry[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(MANIFEST_DIR).filter((f) => f.toLowerCase().endsWith(".item"));
  } catch {
    return [];
  }

  const games: GameEntry[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(MANIFEST_DIR, file), "utf-8");
      const m: EpicManifest = JSON.parse(raw);
      if (m.bIsIncompleteInstall) continue;
      // DLC, expansion packs and add-ons carry their parent's AppName; soundtracks,
      // art books and the like are tagged digitalextras and launch a script rather
      // than an executable. None of them belong in a games list.
      if (m.MainGameAppName) continue;
      if (m.AppCategories?.includes("digitalextras")) continue;
      if (!m.LaunchExecutable || !/\.exe$/i.test(m.LaunchExecutable)) continue;
      if (!m.DisplayName || !m.InstallLocation || !m.CatalogNamespace || !m.CatalogItemId || !m.AppName) continue;

      games.push({
        id: `epic-${m.AppName}`,
        name: m.DisplayName,
        source: "epic",
        launchType: "uri",
        launchTarget: `com.epicgames.launcher://apps/${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}?action=launch&silent=true`,
        installDir: m.InstallLocation,
        drive: m.InstallLocation.slice(0, 2).toUpperCase(),
        losslessProfile: null,
        hidden: false,
      });
    } catch {
      // skip malformed manifest
    }
  }
  return games;
}
