import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { rootDrive } from "./rootDrive";

/**
 * Optional boot, launch and menu sounds, kept by the user on the ROOT drive.
 *
 * None of this ships with A-X-M. The files live in BOOT at the root of the ROOT
 * drive, and every option here is offered only when the file backing it is
 * actually sitting there - a setting that points at a missing file would be a
 * silent no-op, which reads as a broken menu rather than an absent file.
 *
 * The folder is meant to be managed by hand, so the names are plain and the
 * catalogue below is the whole contract: drop in ps1-boot.wav and the PS boot
 * sound becomes selectable, take it out and the option disappears again.
 */

export type SoundRole = "boot" | "launch" | "menu";

export interface SoundSpec {
  /** Stable id used in settings, so a rename here would not orphan a choice. */
  id: string;
  file: string;
  label: string;
  role: SoundRole;
  /** For launch sounds, which platform they belong to. */
  platform?: "ps1" | "ps2" | "ps3" | "psp";
}

/**
 * Everything the menu knows how to use.
 *
 * Boot sounds are the ones offered in the picker and drawn from by shuffle.
 * Launch sounds play on the way from the menu into an emulator. The menu music
 * is the one long track, and is looped rather than played once.
 */
export const SOUND_CATALOGUE: SoundSpec[] = [
  { id: "ps1-boot", file: "ps1-boot.wav", label: "PlayStation", role: "boot" },
  { id: "ps1-anniversary-boot", file: "ps1-anniversary-boot.wav", label: "PlayStation (anniversary)", role: "boot" },
  { id: "ps2-boot", file: "ps2-boot.wav", label: "PlayStation 2", role: "boot" },
  { id: "ps2-anniversary-boot", file: "ps2-anniversary-boot.wav", label: "PlayStation 2 (anniversary)", role: "boot" },
  { id: "ps3-boot", file: "ps3-boot.wav", label: "PlayStation 3", role: "boot" },
  { id: "psp-boot", file: "psp-boot.wav", label: "PSP", role: "boot" },
  { id: "psvita-boot", file: "psvita-boot.wav", label: "PS Vita", role: "boot" },
  { id: "ps5-boot", file: "ps5-boot.wav", label: "PlayStation 5", role: "boot" },

  { id: "ps2-launch", file: "ps2-launch.wav", label: "PlayStation 2 game launch", role: "launch", platform: "ps2" },
  { id: "psp-launch", file: "psp-launch.wav", label: "PSP game launch", role: "launch", platform: "psp" },

  { id: "ps4-menu-music", file: "ps4-menu-music.wav", label: "PlayStation 4 menu music", role: "menu" },
];

/**
 * What a platform plays on the way into its emulator.
 *
 * Only PS2 and PSP have a launch sound of their own. PS1 and PS3 fall back to
 * their boot sound, which is the right noise for the moment anyway - it is what
 * those consoles play when a disc spins up. The fallback is listed here rather
 * than guessed at call time so the settings screen can say which file a toggle
 * will actually use.
 */
export const LAUNCH_SOUND_FOR: Record<"ps1" | "ps2" | "ps3" | "psp", string> = {
  ps1: "ps1-boot",
  ps2: "ps2-launch",
  ps3: "ps3-boot",
  psp: "psp-launch",
};

/** The BOOT folder on the ROOT drive, or null when there is no ROOT drive. */
export function soundsFolder(): string | null {
  const root = rootDrive();
  if (!root) return null;
  return path.join(`${root}${String.fromCharCode(92)}`, "BOOT");
}

export interface AvailableSound extends SoundSpec {
  filePath: string;
  url: string;
  sizeBytes: number;
}

/**
 * The sounds actually present, with playable URLs.
 *
 * A file:// URL is handed to the renderer because these sit outside the app
 * bundle, on a removable drive, and may be hundreds of kilobytes - streaming
 * them from disk beats reading them into memory to pass over IPC.
 */
export function availableSounds(): AvailableSound[] {
  const folder = soundsFolder();
  if (!folder) return [];

  const out: AvailableSound[] = [];
  for (const spec of SOUND_CATALOGUE) {
    const filePath = path.join(folder, spec.file);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size === 0) continue;
      out.push({ ...spec, filePath, url: pathToFileURL(filePath).href, sizeBytes: stat.size });
    } catch {
      // Not there; that option simply is not offered.
    }
  }
  return out;
}

export interface SoundAvailability {
  folder: string | null;
  folderExists: boolean;
  boot: AvailableSound[];
  launch: AvailableSound[];
  menu: AvailableSound | null;
  /** Which of the four launch toggles can be honoured, and by which file. */
  launchByPlatform: Record<string, AvailableSound | null>;
}

/** What the settings screen needs to decide which options to show. */
export function soundAvailability(): SoundAvailability {
  const folder = soundsFolder();
  const sounds = availableSounds();
  const byId = new Map(sounds.map((s) => [s.id, s]));

  const launchByPlatform: Record<string, AvailableSound | null> = {};
  for (const [platform, soundId] of Object.entries(LAUNCH_SOUND_FOR)) {
    launchByPlatform[platform] = byId.get(soundId) ?? null;
  }

  return {
    folder,
    folderExists: !!folder && fs.existsSync(folder),
    boot: sounds.filter((s) => s.role === "boot"),
    launch: sounds.filter((s) => s.role === "launch"),
    menu: sounds.find((s) => s.role === "menu") ?? null,
    launchByPlatform,
  };
}

/**
 * The boot sound to play this time.
 *
 * "shuffle" picks one at random from whatever is present, which is the point of
 * the option - a different console greeting each time the menu starts. A choice
 * whose file has since been removed falls back to silence rather than to some
 * other sound, so taking a file out of the folder does what it looks like it
 * should.
 */
export function resolveBootSound(choice: string): AvailableSound | null {
  if (!choice || choice === "off") return null;

  const boots = availableSounds().filter((s) => s.role === "boot");
  if (boots.length === 0) return null;

  if (choice === "shuffle") return boots[Math.floor(Math.random() * boots.length)];
  return boots.find((s) => s.id === choice) ?? null;
}

/** The sound for going from the menu into a platform's emulator, if enabled. */
export function resolveLaunchSound(platform: string, enabled: boolean): AvailableSound | null {
  if (!enabled) return null;
  const wanted = LAUNCH_SOUND_FOR[platform as keyof typeof LAUNCH_SOUND_FOR];
  if (!wanted) return null;
  return availableSounds().find((s) => s.id === wanted) ?? null;
}

/** The looping menu music, if the user has the file and has turned it on. */
export function resolveMenuMusic(enabled: boolean): AvailableSound | null {
  if (!enabled) return null;
  return availableSounds().find((s) => s.role === "menu") ?? null;
}

/**
 * The splash shown while a game loads.
 *
 * These do ship with A-X-M, unlike the sounds, so they are always available and
 * are referenced by a bundle-relative path the renderer can use directly.
 */
export const LAUNCH_IMAGE_FOR: Record<"ps1" | "ps2" | "ps3" | "psp", string> = {
  ps1: "assets/launch/ps1.webp",
  ps2: "assets/launch/ps2.webp",
  ps3: "assets/launch/ps3.webp",
  psp: "assets/launch/psp.webp",
};
