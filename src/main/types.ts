export type GameSource = "steam" | "epic" | "xbox" | "generic";
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
  losslessProfile: 1 | 2 | 3 | null;
  hidden: boolean;
}
