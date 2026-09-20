import * as fs from "node:fs";
import * as path from "node:path";
import { shell } from "electron";

/**
 * Lossless Scaling (Steam AppID 993090) does its own per-app auto-profile switching
 * based on filters (exe name / window title) that the user configures inside LS itself.
 * Its Settings.xml schema is undocumented and not installed on this dev machine, so
 * A-X-M does NOT attempt to write that file directly - a bad blind edit could corrupt
 * a working config on the actual Ally. Instead: the user creates up to 3 profiles inside
 * LS (named e.g. "Profile 1/2/3" or whatever they like), and A-X-M just remembers which
 * profile number you want per game (see settingsStore.GameOverride.losslessProfile) and
 * makes sure LS is running before launching the game, so LS's own auto-switch logic can
 * kick in. If LS's config format gets verified later, real automatic filter-writing can
 * be added behind an opt-in "advanced" setting.
 */

const LS_STEAM_APPID = "993090";

export function getLosslessSettingsPath(): string {
  return path.join(process.env.LOCALAPPDATA ?? "", "Lossless Scaling", "Settings.xml");
}

export function isLosslessScalingConfigPresent(): boolean {
  return fs.existsSync(getLosslessSettingsPath());
}

/** Launches Lossless Scaling (via its Steam AppID) if it isn't already running. Fire-and-forget. */
export function ensureLosslessScalingRunning(): void {
  try {
    shell.openExternal(`steam://rungameid/${LS_STEAM_APPID}`);
  } catch (err) {
    console.error("[A-X-M] failed to launch Lossless Scaling:", err);
  }
}
