import { GameEntry } from "./types";
import { scanSteamGames } from "./scanners/steamScanner";
import { scanEpicGames } from "./scanners/epicScanner";
import { scanXboxGames } from "./scanners/xboxScanner";
import { scanGenericGames } from "./scanners/genericScanner";
import { scanRetroGames, findEmulators, RETRO_DEFAULT_FOLDERS } from "./scanners/retroScanner";
import { loadSettings } from "./settingsStore";
import { cartridgeDrives, cartridgeRetroFolders, cartridgeGameFolders } from "./cartridge";

export async function scanAllGames(): Promise<GameEntry[]> {
  const settings = loadSettings();
  // A drive on the Sabrent adapter is the "cartridge": its game folders join the scan.
  const cartridge = await cartridgeDrives();
  const cartRetro = cartridgeRetroFolders(cartridge);
  const retroFolders: typeof settings.retroFolders = { ...settings.retroFolders };
  for (const [platform, dirs] of Object.entries(cartRetro) as [keyof typeof cartRetro, string[]][]) {
    const base = retroFolders[platform] ?? RETRO_DEFAULT_FOLDERS[platform];
    retroFolders[platform] = [...base, ...dirs.filter((d) => !base.some((b) => b.toLowerCase() === d.toLowerCase()))];
  }
  const gameFolders = [...settings.extraGameFolders, ...cartridgeGameFolders(cartridge).filter((d) => !settings.extraGameFolders.some((b) => b.toLowerCase() === d.toLowerCase()))];

  const results = await Promise.allSettled([
    Promise.resolve().then(() => scanSteamGames()),
    Promise.resolve().then(() => scanEpicGames()),
    Promise.resolve().then(() => scanXboxGames()),
    Promise.resolve().then(() => scanGenericGames(gameFolders)),
    Promise.resolve().then(() => scanRetroGames(retroFolders, findEmulators(settings.emulators))),
  ]);

  let games: GameEntry[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") games = games.concat(r.value);
    else console.error("[A-X-M] scanner failed:", r.reason);
  }

  const seenIds = new Set<string>();
  games = games.filter((g) => {
    if (seenIds.has(g.id)) return false;
    seenIds.add(g.id);
    return true;
  });

  for (const game of games) {
    const override = settings.gameOverrides[game.id];
    if (override) {
      if (override.hidden !== undefined) game.hidden = override.hidden;
      if (override.losslessProfile !== undefined) game.losslessProfile = override.losslessProfile;
      // A hand-picked cover beats whatever the launcher or the lookup would supply.
      if (override.artUrl) game.iconPath = override.artUrl;
    }
  }

  games.sort((a, b) => a.name.localeCompare(b.name));
  console.log(
    `[A-X-M] scan complete: ${games.length} total (steam=${games.filter((g) => g.source === "steam").length}, epic=${games.filter((g) => g.source === "epic").length}, xbox=${games.filter((g) => g.source === "xbox").length}, generic=${games.filter((g) => g.source === "generic").length}, retro=${games.filter((g) => g.source === "retro").length})`
  );
  return games;
}
