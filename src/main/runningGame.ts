import { execFile } from "node:child_process";
import { GameEntry } from "./types";
import { isWindows } from "./platform";

/**
 * Which game is running, for the in-game menu's "Quit Game". A launch through a
 * URI (Steam, Epic) doesn't hand back a process, so the game is found afterwards by
 * where its executables live: any process whose image path sits under the game's
 * install folder is the game. Quitting closes those processes.
 */

let lastLaunched: GameEntry | null = null;

export function noteLaunched(game: GameEntry): void {
  lastLaunched = game;
}

export interface RunningGame {
  id: string;
  name: string;
  pids: number[];
}

function ps(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf-8", timeout: 15_000, windowsHide: true }, (_e, out) => resolve(out ?? ""));
  });
}

export async function runningGame(): Promise<RunningGame | null> {
  const game = lastLaunched;
  if (!game?.installDir || !isWindows) return null;
  const dir = game.installDir.replace(/'/g, "''").replace(/\\+$/, "");
  const out = await ps(`Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${dir}', [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object -ExpandProperty Id`);
  const pids = out.split(/\r?\n/).map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (!pids.length) return null;
  return { id: game.id, name: game.name, pids };
}

export async function quitRunningGame(): Promise<boolean> {
  const running = await runningGame();
  if (!running) return false;
  // Ask nicely first (WM_CLOSE), then force what's left a few seconds later.
  await ps(`Get-Process -Id ${running.pids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }`);
  await new Promise((r) => setTimeout(r, 4000));
  await ps(`Stop-Process -Id ${running.pids.join(",")} -Force -ErrorAction SilentlyContinue`);
  return true;
}
