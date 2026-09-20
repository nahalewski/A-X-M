// Handles the ambient menu loop (fade in/out), the boot stinger, and UI feedback blips.
// All clips are original PS3-XMB-inspired assets (see assets/THIRD_PARTY_LICENSES.md) -
// if a file is ever missing this all no-ops gracefully instead of throwing.

function safePlay(path: string, volume: number): HTMLAudioElement {
  const el = new Audio(path);
  el.volume = volume;
  el.play().catch(() => {
    /* asset missing or autoplay blocked - stay silent */
  });
  return el;
}

export class AudioManager {
  private ambient: HTMLAudioElement | null = null;
  private ambientFadeRaf = 0;
  private musicVolume = 0.6;
  private sfxVolume = 0.8;

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (this.ambient && !this.ambientFadeRaf) this.ambient.volume = music;
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
      this.ambient = new Audio("assets/sounds/ambient.ogg");
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
      const t = Math.min(1, (now - start) / durationMs);
      el.volume = target * t;
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
        const t = Math.min(1, (now - start) / durationMs);
        el.volume = startVol * (1 - t);
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
    safePlay("assets/sounds/nav-up.ogg", this.sfxVolume);
  }

  playMoveDown(): void {
    safePlay("assets/sounds/nav-down.ogg", this.sfxVolume);
  }

  playConfirm(): void {
    safePlay("assets/sounds/confirm.ogg", this.sfxVolume);
  }

  playBack(): void {
    safePlay("assets/sounds/back.ogg", this.sfxVolume);
  }

  playContextOpen(): void {
    safePlay("assets/sounds/context-open.ogg", this.sfxVolume);
  }

  playContextClose(): void {
    safePlay("assets/sounds/context-close.ogg", this.sfxVolume);
  }
}
