import * as fs from "node:fs";
import * as path from "node:path";
import { getSteamInstallPath } from "./scanners/steamScanner";
import { parseVdf, VdfNode } from "./vdf";
import { loadSettings } from "./settingsStore";

/**
 * Trophy Collection: Steam achievements per game, and RetroAchievements.
 *
 * Steam's achievement data isn't readable from the client's files, so it comes
 * from the Steam Web API with the user's own key (steamcommunity.com/dev/apikey)
 * and their SteamID64, which the client's loginusers.vdf has. The profile's game
 * details must be public for GetPlayerAchievements to answer.
 *
 * RetroAchievements uses its Web API with the user's name and web API key (from
 * their RA profile page) - never a password.
 */

export interface Achievement {
  id: string;
  name: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string | null;
  icon: string | null;
  points?: number;
}

export interface TrophyGame {
  id: string;
  name: string;
  unlocked: number;
  total: number;
  icon: string | null;
  /** Steam appid or RA game id. */
  source: "steam" | "ra";
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "A-X-M" }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The most recently used Steam account's SteamID64, from the client's own file. */
export function steamId64(): string | null {
  const root = getSteamInstallPath();
  if (!root) return null;
  try {
    const users = parseVdf(fs.readFileSync(path.join(root, "config", "loginusers.vdf"), "utf-8"))["users"] as VdfNode;
    let best: string | null = null;
    let bestTime = -1;
    for (const [id, v] of Object.entries(users)) {
      const node = v as VdfNode;
      const t = Number(node["Timestamp"] ?? 0);
      if (node["MostRecent"] === "1" || t > bestTime) {
        best = id;
        bestTime = node["MostRecent"] === "1" ? Number.MAX_SAFE_INTEGER : t;
      }
    }
    return best;
  } catch {
    return null;
  }
}

export async function steamTrophyGames(): Promise<{ games: TrophyGame[]; error: string | null }> {
  const key = loadSettings().steamWebApiKey;
  const id = steamId64();
  if (!key) return { games: [], error: "Add your Steam Web API key in Settings › System › Trophies (steamcommunity.com/dev/apikey)" };
  if (!id) return { games: [], error: "No Steam account has signed in on this machine" };
  const owned = await getJson<{ response?: { games?: { appid: number; name: string; img_icon_url: string; playtime_forever: number }[] } }>(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${id}&include_appinfo=1&include_played_free_games=1`
  );
  const list = owned?.response?.games ?? [];
  if (!list.length) return { games: [], error: "Steam returned no games - check the key and that your profile's game details are public" };
  // Played games only, most played first; achievement totals are filled per game on demand.
  const played = list.filter((g) => g.playtime_forever > 0).sort((a, b) => b.playtime_forever - a.playtime_forever).slice(0, 80);
  return {
    games: played.map((g) => ({
      id: String(g.appid),
      name: g.name,
      unlocked: -1,
      total: -1,
      icon: g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : null,
      source: "steam",
    })),
    error: null,
  };
}

export async function steamAchievements(appid: string): Promise<{ list: Achievement[]; error: string | null }> {
  const key = loadSettings().steamWebApiKey;
  const id = steamId64();
  if (!key || !id) return { list: [], error: "Steam key or account missing" };
  const [player, schema] = await Promise.all([
    getJson<{ playerstats?: { success?: boolean; achievements?: { apiname: string; achieved: number; unlocktime: number }[]; error?: string } }>(
      `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${key}&steamid=${id}&appid=${appid}&l=english`
    ),
    getJson<{ game?: { availableGameStats?: { achievements?: { name: string; displayName: string; description?: string; icon: string; icongray: string }[] } } }>(
      `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${key}&appid=${appid}&l=english`
    ),
  ]);
  const defs = schema?.game?.availableGameStats?.achievements ?? [];
  if (!defs.length) return { list: [], error: player?.playerstats?.error ?? "This game has no achievements" };
  const got = new Map((player?.playerstats?.achievements ?? []).map((a) => [a.apiname, a]));
  return {
    list: defs.map((d) => {
      const a = got.get(d.name);
      return {
        id: d.name,
        name: d.displayName,
        description: d.description ?? "",
        unlocked: !!a?.achieved,
        unlockedAt: a?.achieved && a.unlocktime ? new Date(a.unlocktime * 1000).toISOString() : null,
        icon: a?.achieved ? d.icon : d.icongray,
      };
    }),
    error: null,
  };
}

// ---- RetroAchievements ---------------------------------------------------------------

const RA = "https://retroachievements.org/API";

function raAuth(): { u: string; y: string } | null {
  const s = loadSettings();
  return s.raUsername && s.raApiKey ? { u: s.raUsername, y: s.raApiKey } : null;
}

export async function raTrophyGames(): Promise<{ games: TrophyGame[]; error: string | null }> {
  const auth = raAuth();
  if (!auth) return { games: [], error: "Sign in to RetroAchievements first (username and web API key from your RA profile)" };
  const recent = await getJson<{ GameID: number; Title: string; ImageIcon: string; NumAchieved?: number; NumPossibleAchievements?: number; ConsoleName?: string }[]>(
    `${RA}/API_GetUserRecentlyPlayedGames.php?u=${encodeURIComponent(auth.u)}&y=${encodeURIComponent(auth.y)}&c=50`
  );
  if (!recent) return { games: [], error: "RetroAchievements didn't answer - check the username and API key" };
  return {
    games: recent.map((g) => ({
      id: String(g.GameID),
      name: `${g.Title}${g.ConsoleName ? ` · ${g.ConsoleName}` : ""}`,
      unlocked: g.NumAchieved ?? 0,
      total: g.NumPossibleAchievements ?? 0,
      icon: g.ImageIcon ? `https://media.retroachievements.org${g.ImageIcon}` : null,
      source: "ra",
    })),
    error: null,
  };
}

export async function raAchievements(gameId: string): Promise<{ list: Achievement[]; error: string | null }> {
  const auth = raAuth();
  if (!auth) return { list: [], error: "Not signed in" };
  const info = await getJson<{ Achievements?: Record<string, { ID: number; Title: string; Description: string; Points: number; BadgeName: string; DateEarned?: string; DateEarnedHardcore?: string }> }>(
    `${RA}/API_GetGameInfoAndUserProgress.php?u=${encodeURIComponent(auth.u)}&y=${encodeURIComponent(auth.y)}&g=${gameId}`
  );
  const defs = Object.values(info?.Achievements ?? {});
  if (!defs.length) return { list: [], error: "No achievements listed for this game" };
  return {
    list: defs.map((a) => ({
      id: String(a.ID),
      name: a.Title,
      description: a.Description,
      unlocked: !!(a.DateEarned || a.DateEarnedHardcore),
      unlockedAt: a.DateEarnedHardcore ?? a.DateEarned ?? null,
      icon: `https://media.retroachievements.org/Badge/${a.BadgeName}${a.DateEarned || a.DateEarnedHardcore ? "" : "_lock"}.png`,
      points: a.Points,
    })),
    error: null,
  };
}

/** Checks an RA username + web API key pair by asking for the user's profile. */
export async function raVerify(username: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  const res = await getJson<{ User?: string; TotalPoints?: number }>(`${RA}/API_GetUserProfile.php?u=${encodeURIComponent(username)}&y=${encodeURIComponent(apiKey)}`);
  if (!res?.User) return { ok: false, message: "RetroAchievements rejected that username / API key" };
  return { ok: true, message: `Signed in as ${res.User} · ${res.TotalPoints ?? 0} points` };
}
