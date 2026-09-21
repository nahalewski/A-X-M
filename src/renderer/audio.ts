// Handles the ambient menu loop (fade in/out), the boot stinger, and UI feedback blips.
// All clips are original PS3-XMB-inspired assets (see assets/THIRD_PARTY_LICENSES.md) -
// if a file is ever missing this all no-ops gracefully instead of throwing.

import { AmbientTrackId } from "./types";

/** The loops selectable as menu music. `xmb` is the original A-X-M bed. */
export const AMBIENT_TRACKS: Record<AmbientTrackId, { label: string; src: string }> = {
  xmb: { label: "XMB Ambience", src: "assets/sounds/ambient.ogg" },
  luminous: { label: "Luminous Ambience", src: "assets/sounds/luminous.mp3" },
  moonlit: { label: "Moonlit Piano", src: "assets/sounds/moonlit.ogg" },
  dreamy: { label: "Dreamy E-Piano", src: "assets/sounds/dreamy.ogg" },
  midtown: { label: "Midtown Keys", src: "assets/sounds/midtown.ogg" },
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
  private ghostHover: HTMLAudioElement | null = null;
  private sfxEnabled = true;
  private ambientEnabled = true;
  private sinkId = "";

  /** Where the menu's own sounds play; "" is the system default. */
  setOutputDevice(sinkId: string): void {
    this.sinkId = sinkId;
    const el = this.ambient as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    void el?.setSinkId?.(sinkId).catch(() => {});
  }

  /** Menu navigation/confirm/back blips on or off. The ambient loop is separate. */
  setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
  }

  /**
   * Menu music on or off. Turning it off fades the loop out; turning it on brings
   * it straight back. While off, every fade-in request is ignored so the loop stays
   * silent after videos and games as well.
   */
  setAmbientEnabled(enabled: boolean): void {
    if (enabled === this.ambientEnabled) return;
    this.ambientEnabled = enabled;
    if (enabled) this.fadeInAmbient(900);
    else void this.fadeOutAmbient(600);
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
    if (this.ambient && !this.ambientFadeRaf) this.ambient.volume = this.musicVolume * this.duckFactor;
  }

  private duckFactor = 1;

  /** Pulls the menu loop down (0.2 of its level) while Ghost listens or speaks, and back up after. */
  duck(on: boolean): void {
    const target = on ? 0.2 : 1;
    if (target === this.duckFactor) return;
    this.duckFactor = target;
    if (!this.ambient || this.ambientFadeRaf) return;
    const el = this.ambient;
    const from = el.volume;
    const to = this.musicVolume * target;
    const start = performance.now();
    const step = (now: number) => {
      const t = clamp01((now - start) / 350);
      el.volume = clamp01(from + (to - from) * t);
      if (t < 1 && this.duckFactor === target) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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
    if (!this.ambientEnabled) return;
    if (!this.ambient) {
      this.ambient = new Audio(AMBIENT_TRACKS[this.ambientTrack].src);
      this.ambient.loop = true;
      if (this.sinkId) void (this.ambient as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(this.sinkId).catch(() => {});
    }
    const el = this.ambient;
    el.volume = 0;
    el.play().catch(() => {
      /* asset missing or blocked - stay silent */
    });

    cancelAnimationFrame(this.ambientFadeRaf);
    const start = performance.now();
    const target = this.musicVolume * this.duckFactor;
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

  /** The Toybox chime: a toy landed on a reader. */
  playNfcScan(): void {
    this.sfx("assets/sounds/nfc-scan.ogg");
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

  /** One-shot, for Ghost unfolding into battle mode. */
  playGhostTransform(): void {
    this.sfx("assets/sounds/ghost-transform.mp3");
  }

  /**
   * Ghost's hover loop, running only while he is actually on screen. Faded in and
   * out rather than cut, and it rides the menu-sound volume like every other cue.
   */
  setGhostHover(on: boolean): void {
    if (on) {
      if (!this.sfxEnabled) return;
      if (!this.ghostHover) {
        this.ghostHover = new Audio("assets/sounds/ghost-hover.mp3");
        this.ghostHover.loop = true;
      }
      // Quieter than a one-shot cue: it sits under everything else continuously.
      this.ghostHover.volume = clamp01(this.sfxVolume * 0.45);
      this.ghostHover.play().catch(() => {
        /* asset missing or blocked - stay silent */
      });
      return;
    }
    if (!this.ghostHover) return;
    this.ghostHover.pause();
    this.ghostHover.currentTime = 0;
  }

  playContextClose(): void {
    this.sfx("assets/sounds/context-close.ogg");
  }
}
