import * as fs from "node:fs";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { shell } from "electron";
import { parseVdf, VdfNode } from "./vdf";
import { getSteamInstallPath, getLibraryFolders } from "./scanners/steamScanner";
import { readAppInfo } from "./steamAppInfo";

/**
 * The account's Steam library, installed or not, built entirely from what the
 * Steam client already keeps on disk - no API key and no network:
 *
 * - which apps the account has: userdata/<id>/config/localconfig.vdf
 * - what they're called and whether they're games: appcache/appinfo.vdf
 * - which are installed, or mid-download: steamapps/appmanifest_*.acf
 *
 * Steam's community and app-list web endpoints both went behind a login in 2025,
 * so the local route isn't just simpler, it's the one that still works.
 */

export type SteamInstallState = "installed" | "installing" | "not-installed";

export interface SteamLibraryEntry {
  appid: number;
  name: string;
  state: SteamInstallState;
  lastPlayed: number;
  coverUrl: string;
}

export interface SteamLibrary {
  account: string | null;
  games: SteamLibraryEntry[];
}

/** StateFlags in an appmanifest. 4 alone means fully installed; anything else is in flux. */
const STATE_FULLY_INSTALLED = 4;

function findKey(node: VdfNode | undefined, name: string): VdfNode | string | undefined {
  if (!node) return undefined;
  const key = Object.keys(node).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? node[key] : undefined;
}

function mostRecentAccount(steamPath: string): { id64: string; accountId: string; name: string } | null {
  try {
    const text = fs.readFileSync(path.join(steamPath, "config", "loginusers.vdf"), "utf-8");
    const users = parseVdf(text)["users"] as VdfNode;
    let best: { id64: string; name: string; ts: number } | null = null;
    for (const id64 of Object.keys(users)) {
      const u = users[id64] as VdfNode;
      const ts = Number(u["Timestamp"] ?? 0);
      const recent = u["MostRecent"] === "1";
      if (!best || recent || ts > best.ts) {
        best = { id64, name: (u["PersonaName"] as string) ?? (u["AccountName"] as string) ?? id64, ts };
      }
    }
    if (!best) return null;
    // SteamID64 = 76561197960265728 + 32-bit account id; the userdata folder is the latter.
    const accountId = (BigInt(best.id64) - 76561197960265728n).toString();
    return { id64: best.id64, accountId, name: best.name };
  } catch {
    return null;
  }
}

function ownedAppIds(steamPath: string, accountId: string): Map<number, number> {
  const owned = new Map<number, number>(); // appid -> lastPlayed
  try {
    const text = fs.readFileSync(path.join(steamPath, "userdata", accountId, "config", "localconfig.vdf"), "utf-8");
    const root = parseVdf(text);
    const store = root[Object.keys(root)[0]] as VdfNode;
    const apps = findKey(
      findKey(findKey(findKey(store, "Software") as VdfNode, "Valve") as VdfNode, "Steam") as VdfNode,
      "apps"
    ) as VdfNode | undefined;
    if (!apps) return owned;
    for (const key of Object.keys(apps)) {
      if (!/^\d+$/.test(key)) continue;
      const entry = apps[key] as VdfNode;
      owned.set(Number(key), Number(entry?.["LastPlayed"] ?? 0));
    }
  } catch {
    // no localconfig for this account
  }
  return owned;
}

function installStates(steamPath: string): Map<number, SteamInstallState> {
  const states = new Map<number, SteamInstallState>();
  for (const lib of getLibraryFolders(steamPath)) {
    const dir = path.join(lib, "steamapps");
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const app = parseVdf(fs.readFileSync(path.join(dir, file), "utf-8"))["AppState"] as VdfNode;
        const appid = Number(app["appid"]);
        const flags = Number(app["StateFlags"] ?? 0);
        // A manifest exists from the moment a download starts, so its presence alone
        // isn't "installed". Only the clean flag value is.
        states.set(appid, flags === STATE_FULLY_INSTALLED ? "installed" : "installing");
      } catch {
        // skip malformed
      }
    }
  }
  return states;
}

export function getSteamLibrary(): SteamLibrary {
  const steamPath = getSteamInstallPath();
  if (!steamPath) return { account: null, games: [] };

  const account = mostRecentAccount(steamPath);
  const owned = account ? ownedAppIds(steamPath, account.accountId) : new Map<number, number>();
  const states = installStates(steamPath);
  const info = readAppInfo(path.join(steamPath, "appcache", "appinfo.vdf"));

  // Installed games belong in the library even if localconfig hasn't caught up.
  for (const appid of states.keys()) if (!owned.has(appid)) owned.set(appid, 0);

  const games: SteamLibraryEntry[] = [];
  for (const [appid, lastPlayed] of owned) {
    const meta = info.get(appid);
    // Unknown to the cache, or not a game by Steam's own classification (DLC, tools,
    // soundtracks, redistributables) - none of that belongs in a games list.
    if (!meta || (meta.type !== "game" && meta.type !== "demo")) continue;
    games.push({
      appid,
      name: meta.name,
      state: states.get(appid) ?? "not-installed",
      lastPlayed,
      coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
    });
  }

  games.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { account: account?.name ?? null, games };
}

/**
 * Asks the Steam client to install an app; it downloads in the background from there.
 *
 * Steam has no silent-install command for the desktop client, so the install
 * dialog always appears. With `handsOff` on, the dialog is confirmed for the
 * user: the window titled "Install - <game>" is found once it appears, Enter is
 * sent to accept its defaults (Steam's own default library, which is the drive
 * chosen in Steam's settings), and the menu is brought back to the front. The
 * space check is Steam's - it refuses an install that doesn't fit, and the dialog
 * is then left open for the user to see. Best effort: if the dialog never shows,
 * nothing is pressed.
 */
export function installSteamGame(appid: number, handsOff: boolean, onDone?: () => void): void {
  if (!Number.isInteger(appid) || appid <= 0) return;
  shell.openExternal(`steam://install/${appid}`);
  if (!handsOff) return;
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string t); }
"@
Add-Type -AssemblyName System.Windows.Forms
$deadline = (Get-Date).AddSeconds(25); $dlg = $null
while ((Get-Date) -lt $deadline) {
  $dlg = Get-Process steamwebhelper,steam -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle } | Where-Object { $_ -like 'Install - *' } | Select-Object -First 1
  if ($dlg) { break }
  Start-Sleep -Milliseconds 500
}
if ($dlg) {
  $h = [W]::FindWindow($null, $dlg)
  if ($h -ne [IntPtr]::Zero) {
    [W]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Start-Sleep -Milliseconds 900
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); Start-Sleep -Milliseconds 600
  }
}
$axm = [W]::FindWindow($null, 'A-X-M'); if ($axm -ne [IntPtr]::Zero) { [W]::SetForegroundWindow($axm) | Out-Null }
"`;
  execFile("powershell", ["-NoProfile", "-NonInteractive", "-STA", "-Command", script], { windowsHide: true, timeout: 40_000 }, () => onDone?.());
}
