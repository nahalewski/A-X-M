// Handles the ambient menu loop (fade in/out), the boot stinger, and UI feedback blips.
// All clips are original PS3-XMB-inspired assets (see assets/THIRD_PARTY_LICENSES.md) -
// if a file is ever missing this all no-ops gracefully instead of throwing.

import { AmbientTrackId } from "./types";

/** The loops selectable as menu music. `xmb` is the original A-X-M bed. */
export const AMBIENT_TRACKS: Record<AmbientTrackId, { label: string; src: string }> = {
  xmb: { label: "XMB Ambience", src: "assets/sounds/ambient.ogg" },
  luminous: { label: "Luminous Ambience", src: "assets/sounds/luminous.mp3" },
};

/** One blip for every direction, as the XMB uses - supplied for this project. */
const NAV_SOUND = "assets/sounds/nav.mp3";

export const AMBIENT_TRACK_IDS = Object.keys(AMBIENT_TRACKS) as AmbientTrackId[];

/** HTMLMediaElement.volume throws outside [0,1], and rAF timing can overshoot a fade by a hair. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function safePlay(path: string, volume: number): HTMLAudioElement {
  const el = new Audio(path);
  el.volume = clamp01(volume);
  el.play().catch(() => {
    /* asset missing or autoplay blocked - stay silent */
  });
  return el;
}

export class AudioManager {
  private ambient: HTMLAudioElement | null = null;
  private ambientFadeRaf = 0;
  private ambientTrack: AmbientTrackId = "xmb";
  private musicVolume = 0.6;
  private sfxVolume = 0.8;
  private sfxEnabled = true;

  /** Menu navigation/confirm/back blips on or off. The ambient loop is separate. */
  setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
  }

  private sfx(path: string): void {
    if (this.sfxEnabled) safePlay(path, this.sfxVolume);
  }

  /**
   * Switches the menu loop. If a loop is already playing it's faded out and the new
   * one faded in, so changing the setting is audible immediately rather than at the
   * next launch. Before the first play it just records the choice.
   */
  setAmbientTrack(track: AmbientTrackId): void {
    if (!AMBIENT_TRACKS[track] || track === this.ambientTrack) return;
    this.ambientTrack = track;
    if (!this.ambient) return;

    const wasPlaying = !this.ambient.paused;
    void this.fadeOutAmbient(450).then(() => {
      // Drop the element so the next fade-in builds one on the new source.
      this.ambient = null;
      if (wasPlaying) this.fadeInAmbient(900);
    });
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = clamp01(music);
    this.sfxVolume = clamp01(sfx);
    if (this.ambient && !this.ambientFadeRaf) this.ambient.volume = this.musicVolume;
  }

  /** Plays boot.ogg once, then fades the ambient loop in once it actually finishes. */
  playBootThenAmbient(): void {
    const boot = new Audio("assets/sounds/boot.ogg");
    boot.volume = this.sfxVolume;

    const startAmbient = () => this.fadeInAmbient();
    let started = false;
    const startOnce = () => {
      if (started) return;
      started = true;
      startAmbient();
    };

    boot.addEventListener("loadedmetadata", () => {
      // Safety net sized to the real clip length, in case 'ended' never fires.
      const ms = isFinite(boot.duration) ? boot.duration * 1000 + 300 : 2500;
      setTimeout(startOnce, ms);
    });
    boot.addEventListener("ended", startOnce, { once: true });
    boot.addEventListener("error", startOnce, { once: true });
    // If metadata never loads (missing file), don't wait forever.
    setTimeout(startOnce, 2500);

    boot.play().catch(startOnce);
  }

  fadeInAmbient(durationMs = 2500): void {
    if (!this.ambient) {
      this.ambient = new Audio(AMBIENT_TRACKS[this.ambientTrack].src);
      this.ambient.loop = true;
    }
    const el = this.ambient;
    el.volume = 0;
    el.play().catch(() => {
      /* asset missing or blocked - stay silent */
    });

    cancelAnimationFrame(this.ambientFadeRaf);
    const start = performance.now();
    const target = this.musicVolume;
    const step = (now: number) => {
      // rAF hands back the frame's start time, which can predate `start` - clamp both ends.
      const t = clamp01((now - start) / durationMs);
      el.volume = clamp01(target * t);
      if (t < 1) {
        this.ambientFadeRaf = requestAnimationFrame(step);
      } else {
        this.ambientFadeRaf = 0;
      }
    };
    this.ambientFadeRaf = requestAnimationFrame(step);
  }

  fadeOutAmbient(durationMs = 1500): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ambient) return resolve();
      const el = this.ambient;
      cancelAnimationFrame(this.ambientFadeRaf);
      const start = performance.now();
      const startVol = el.volume;
      const step = (now: number) => {
        const t = clamp01((now - start) / durationMs);
        el.volume = clamp01(startVol * (1 - t));
        if (t < 1) {
          this.ambientFadeRaf = requestAnimationFrame(step);
        } else {
          el.pause();
          this.ambientFadeRaf = 0;
          resolve();
        }
      };
      this.ambientFadeRaf = requestAnimationFrame(step);
    });
  }

  playMoveUp(): void {
    this.sfx(NAV_SOUND);
  }

  playMoveDown(): void {
    this.sfx(NAV_SOUND);
  }

  playConfirm(): void {
    this.sfx("assets/sounds/confirm.ogg");
  }

  playBack(): void {
    this.sfx("assets/sounds/back.ogg");
  }

  playContextOpen(): void {
    this.sfx("assets/sounds/context-open.ogg");
  }

  playContextClose(): void {
    this.sfx("assets/sounds/context-close.ogg");
  }
}
