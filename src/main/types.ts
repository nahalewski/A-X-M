export type GameSource = "steam" | "epic" | "xbox" | "generic" | "retro";
export type LaunchType = "exe" | "uri" | "shell";

export interface GameEntry {
  id: string;
  name: string;
  source: GameSource;
  launchType: LaunchType;
  /** exe: absolute path to executable. uri: protocol URI (steam://, com.epicgames.launcher://). shell: shell:AppsFolder\... */
  launchTarget: string;
  launchArgs?: string[];
  installDir: string;
  drive: string;
  iconPath?: string;
  /** Wide banner shown as the menu background while this game is selected. */
  heroPath?: string;
  losslessProfile: 1 | 2 | 3 | null;
  hidden: boolean;
  /** Retro (emulated) games only. */
  platform?: RetroPlatform;
  romPath?: string;
  /** The emulator's exe, or null when it isn't installed. */
  emulator?: string | null;
  emulatorName?: string;
  /** Why it can't be launched yet (a PS3 disc image that needs decrypting). */
  needsPrep?: string;
  /** PS3 disc image: true when its data region is encrypted. */
  isoEncrypted?: boolean;
  /** PS3 disc image that has already been extracted: where the folder game is. */
  extractedDir?: string;
}

export type RetroPlatform = "ps3" | "ps2" | "ps1" | "psp" | "switch";
