import { MusicEntry } from "./types";
import { AudioManager } from "./audio";

/**
 * Plays tracks from the music library. Only one thing should be audible at a time,
 * so starting a track fades the ambient menu loop out and stopping brings it back.
 */
export class MusicPlayer {
  private el = new Audio();
  private queue: MusicEntry[] = [];
  private index = -1;
  private shuffle = false;
  /** Queue positions already played this round, so shuffle visits each track once. */
  private played = new Set<number>();
  private onChange: () => void = () => {};

  setShuffle(on: boolean): void {
    this.shuffle = on;
  }

  isShuffle(): boolean {
    return this.shuffle;
  }

  constructor(private audio: AudioManager) {
    this.el.addEventListener("ended", () => this.next());
    this.el.addEventListener("timeupdate", () => this.onChange());
    this.el.addEventListener("play", () => this.onChange());
    this.el.addEventListener("pause", () => this.onChange());
    this.el.addEventListener("error", () => {
      console.error("[A-X-M] could not play track:", this.current()?.name);
      this.next();
    });
  }

  /**
   * The single <audio> element every track plays through. The visualizer taps this
   * once; because it's reused for the whole queue, the analyser survives track
   * changes without being rewired.
   */
  element(): HTMLAudioElement {
    return this.el;
  }

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  current(): MusicEntry | null {
    return this.queue[this.index] ?? null;
  }

  isPlaying(): boolean {
    return !this.el.paused && !this.el.ended && this.index >= 0;
  }

  position(): number {
    return this.el.currentTime || 0;
  }

  seekTo(seconds: number): void {
    if (!isFinite(seconds)) return;
    this.el.currentTime = Math.max(0, Math.min(this.duration() || seconds, seconds));
    this.onChange();
  }

  duration(): number {
    return isFinite(this.el.duration) ? this.el.duration : 0;
  }

  /** 0..1 through the current track, or 0 if its duration isn't known yet. */
  progress(): number {
    if (!isFinite(this.el.duration) || this.el.duration <= 0) return 0;
    return Math.min(1, Math.max(0, this.el.currentTime / this.el.duration));
  }

  private baseVolume = 1;
  private duckFactor = 1;

  setVolume(volume: number): void {
    this.baseVolume = Math.min(1, Math.max(0, volume));
    this.el.volume = this.baseVolume * this.duckFactor;
  }

  /** Music drops to a fifth while Ghost is awake or talking. */
  duck(on: boolean): void {
    this.duckFactor = on ? 0.2 : 1;
    this.el.volume = this.baseVolume * this.duckFactor;
  }

  /** Plays `track`, queueing the other tracks in the same folder so it can advance. */
  play(track: MusicEntry, folderTracks: MusicEntry[], volume: number): void {
    this.queue = folderTracks.filter((t) => t.kind === "track");
    this.index = this.queue.findIndex((t) => t.filePath === track.filePath);
    if (this.index < 0) {
      this.queue = [track];
      this.index = 0;
    }
    this.played = new Set([this.index]);
    this.audio.fadeOutAmbient(600);
    this.setVolume(volume);
    this.start();
  }

  private start(): void {
    const track = this.current();
    if (!track?.url) return;
    this.el.src = track.url;
    this.el.play().catch((err) => console.error("[A-X-M] playback failed:", err));
    this.onChange();
  }

  togglePause(): void {
    if (this.index < 0) return;
    if (this.el.paused) this.el.play().catch(() => {});
    else this.el.pause();
    this.onChange();
  }

  next(): void {
    if (this.index < 0) return;
    if (this.shuffle) {
      const left = this.queue.map((_, i) => i).filter((i) => !this.played.has(i));
      if (left.length === 0) {
        this.stop();
        return;
      }
      this.index = left[Math.floor(Math.random() * left.length)];
      this.played.add(this.index);
      this.start();
      return;
    }
    if (this.index >= this.queue.length - 1) {
      this.stop();
      return;
    }
    this.index++;
    this.played.add(this.index);
    this.start();
  }

  previous(): void {
    if (this.index <= 0) return;
    this.index--;
    this.start();
  }

  stop(): void {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
    this.index = -1;
    this.queue = [];
    this.audio.fadeInAmbient(1500);
    this.onChange();
  }
}
