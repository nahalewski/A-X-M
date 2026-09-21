import Hls from "hls.js";
import { BrowseEntry } from "./types";
import { spriteEl, spriteHtml } from "./sprites";
import { btn } from "./xmb";

/**
 * Full-screen in-app viewer for the Photo and Video columns, so a file opens over
 * the menu instead of handing off to whatever Windows has associated with it.
 *
 * Photos: ◀ ▶ step through the folder, ▲ ▼ zoom, Y rotates, A starts a slideshow,
 *         B closes.
 * Video:  A play/pause, ◀ ▶ seek ten seconds, B closes. MP4 only, by construction
 *         of the browser that feeds it (Jellyfin adds HLS on top).
 *
 * Both draw a control strip along the bottom from the supplied gallery and player
 * sheets, so what the buttons do is visible without reading the footer.
 *
 * Input arrives through the same external-handler hook the visualizer uses, so the
 * menu never scrolls underneath an open viewer.
 */

export type ViewerAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context";

const SEEK_SECONDS = 10;
const SLIDESHOW_SECONDS = 5;
const ZOOM_STEPS = [1, 1.5, 2, 3];

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function btnEl(name: "a" | "b" | "x" | "y"): HTMLElement {
  const wrap = document.createElement("span");
  wrap.innerHTML = btn(name);
  return wrap.firstElementChild as HTMLElement;
}

export class MediaViewer {
  private root: HTMLElement;
  private imageEl: HTMLImageElement;
  private videoEl: HTMLVideoElement;
  private captionEl: HTMLElement;
  private progressEl: HTMLElement;
  private progressFill: HTMLElement;
  private timeEl: HTMLElement;
  private photoBar: HTMLElement;
  private videoBar: HTMLElement;
  private playIcon: ReturnType<typeof spriteEl>;
  private slideIcon: ReturnType<typeof spriteEl>;

  private zoom = 0;
  private rotation = 0;
  private slideshow = 0;

  private items: BrowseEntry[] = [];
  /** Live only while an HLS stream (a Jellyfin transcode) is playing. */
  private hls: Hls | null = null;
  private index = -1;
  private kind: "photo" | "video" | null = null;
  private onClose: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;

    this.imageEl = document.createElement("img");
    this.imageEl.className = "viewer-image";
    root.appendChild(this.imageEl);

    this.videoEl = document.createElement("video");
    this.videoEl.className = "viewer-video";
    this.videoEl.playsInline = true;
    root.appendChild(this.videoEl);

    this.captionEl = document.createElement("div");
    this.captionEl.className = "viewer-caption";
    root.appendChild(this.captionEl);

    this.progressEl = document.createElement("div");
    this.progressEl.className = "viewer-progress";
    this.progressFill = document.createElement("div");
    this.progressFill.className = "viewer-progress-fill";
    this.progressEl.appendChild(this.progressFill);
    root.appendChild(this.progressEl);

    this.timeEl = document.createElement("div");
    this.timeEl.className = "viewer-time";
    root.appendChild(this.timeEl);

    // Photo controls: prev / next, slideshow, zoom, rotate, close.
    this.photoBar = document.createElement("div");
    this.photoBar.className = "viewer-bar photo-bar";
    this.slideIcon = spriteEl("gallery", "play");
    this.photoBar.innerHTML = `<span class="viewer-key">◀</span>${spriteHtml("gallery", "prev")}<span class="viewer-key">▶</span>${spriteHtml("gallery", "next")}<span class="viewer-sep"></span>`;
    this.photoBar.append(btnEl("a"), this.slideIcon);
    this.photoBar.insertAdjacentHTML("beforeend", `<span class="viewer-sep"></span><span class="viewer-key">▲▼</span>${spriteHtml("gallery", "zoomin")}${spriteHtml("gallery", "zoomout")}<span class="viewer-sep"></span>`);
    this.photoBar.append(btnEl("y"));
    this.photoBar.insertAdjacentHTML("beforeend", `${spriteHtml("gallery", "rotcw")}<span class="viewer-sep"></span>`);
    this.photoBar.append(btnEl("b"));
    this.photoBar.insertAdjacentHTML("beforeend", spriteHtml("gallery", "collapse"));
    root.appendChild(this.photoBar);

    // Video controls: the play state as an icon, seek hints, close.
    this.videoBar = document.createElement("div");
    this.videoBar.className = "viewer-bar video-bar";
    this.playIcon = spriteEl("player", "play", "big");
    this.videoBar.append(btnEl("a"), this.playIcon);
    this.videoBar.insertAdjacentHTML("beforeend", `<span class="viewer-sep"></span><span class="viewer-key">◀</span>${spriteHtml("player", "rew")}<span class="viewer-key">▶</span>${spriteHtml("player", "ff")}<span class="viewer-sep"></span>`);
    this.videoBar.append(btnEl("b"));
    this.videoBar.insertAdjacentHTML("beforeend", spriteHtml("player", "stop"));
    root.appendChild(this.videoBar);

    this.videoEl.addEventListener("timeupdate", () => this.updateVideoChrome());
    this.videoEl.addEventListener("loadedmetadata", () => this.pickAudioTrack());
    this.videoEl.addEventListener("play", () => this.updateVideoChrome());
    this.videoEl.addEventListener("pause", () => this.updateVideoChrome());
    this.videoEl.addEventListener("ended", () => this.updateVideoChrome());
    this.videoEl.addEventListener("error", () => {
      this.captionEl.textContent = `Couldn't play ${this.current()?.name ?? "this file"}`;
      const cur = this.current();
      if (cur) this.onVideoError?.(cur);
    });
  }

  setOnClose(callback: () => void): void {
    this.onClose = callback;
  }

  private onVideoError: ((entry: BrowseEntry) => void) | null = null;

  /** The video element gave up on this entry (codec, refused stream...). */
  setOnVideoError(callback: (entry: BrowseEntry) => void): void {
    this.onVideoError = callback;
  }

  private trackUrl: string | null = null;
  /** ISO 639-1 code the user wants to hear when a video has more than one audio track. */
  private audioLanguage = "en";

  setAudioLanguage(code: string): void {
    this.audioLanguage = (code || "en").toLowerCase();
    this.pickAudioTrack();
  }

  /** Whether a track's language tag (eng, en-US, fre...) is the wanted language. */
  private wantsLang(lang: string | undefined): boolean {
    const l = (lang ?? "").toLowerCase();
    if (!l) return false;
    const alts: Record<string, string[]> = { en: ["eng"], es: ["spa"], fr: ["fre", "fra"], de: ["ger", "deu"], it: ["ita"], pt: ["por"], nl: ["dut", "nld"], ja: ["jpn"], ko: ["kor"], zh: ["chi", "zho"], ru: ["rus"], ar: ["ara"] };
    return l === this.audioLanguage || l.startsWith(this.audioLanguage + "-") || (alts[this.audioLanguage] ?? []).includes(l);
  }

  private pickAudioTrack(): void {
    // hls.js: the playlist's alternate audio renditions.
    if (this.hls && this.hls.audioTracks.length > 1) {
      const i = this.hls.audioTracks.findIndex((t) => this.wantsLang(t.lang));
      if (i >= 0 && this.hls.audioTrack !== i) this.hls.audioTrack = i;
    }
    // Native: <video>.audioTracks (Chromium, with the AudioVideoTracks blink feature).
    const tracks = (this.videoEl as HTMLVideoElement & { audioTracks?: { length: number; [i: number]: { language: string; enabled: boolean } } }).audioTracks;
    if (tracks && tracks.length > 1) {
      let want = -1;
      for (let i = 0; i < tracks.length; i++) if (this.wantsLang(tracks[i].language)) { want = i; break; }
      if (want >= 0) for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === want;
    }
  }

  /** Shows subtitles (WebVTT text) over the playing video; null clears them. */
  setSubtitles(vtt: string | null): void {
    for (const t of Array.from(this.videoEl.querySelectorAll("track"))) t.remove();
    if (this.trackUrl) URL.revokeObjectURL(this.trackUrl);
    this.trackUrl = null;
    if (!vtt) return;
    this.trackUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = "Subtitles";
    track.srclang = "en";
    track.src = this.trackUrl;
    track.default = true;
    this.videoEl.appendChild(track);
    track.addEventListener("load", () => {
      if (track.track) track.track.mode = "showing";
    });
    if (track.track) track.track.mode = "showing";
  }

  /** Swaps the playing entry's source in place, e.g. for a relayed copy of the same stream. */
  replaceSource(url: string): void {
    const cur = this.current();
    if (!cur) return;
    cur.url = url;
    this.captionEl.textContent = cur.name;
    this.videoEl.src = url;
    void this.videoEl.play().catch(() => {});
  }

  isOpen(): boolean {
    return this.kind !== null;
  }

  current(): BrowseEntry | null {
    return this.items[this.index] ?? null;
  }

  /** Opens `entry`, with the rest of `folderEntries`' files available to step through. */
  open(kind: "photo" | "video", entry: BrowseEntry, folderEntries: BrowseEntry[]): void {
    this.items = folderEntries.filter((e) => e.kind === "file" && e.url);
    // A stream opened on its own (TV Streaming, Jellyfin) has no folder around it.
    if (!this.items.some((e) => e.filePath === entry.filePath)) this.items = [entry];
    this.index = Math.max(0, this.items.findIndex((e) => e.filePath === entry.filePath));
    this.kind = kind;

    this.root.classList.remove("hidden");
    this.root.classList.toggle("photo", kind === "photo");
    this.root.classList.toggle("video", kind === "video");
    this.zoom = 0;
    this.rotation = 0;
    this.stopSlideshow();
    this.show();
  }

  private applyPhotoTransform(): void {
    this.imageEl.style.transform = `rotate(${this.rotation}deg) scale(${ZOOM_STEPS[this.zoom]})`;
  }

  private stopSlideshow(): void {
    if (this.slideshow) clearInterval(this.slideshow);
    this.slideshow = 0;
    this.slideIcon.setFrame("play");
  }

  private toggleSlideshow(): void {
    if (this.slideshow) return this.stopSlideshow();
    this.slideshow = window.setInterval(() => this.step(1), SLIDESHOW_SECONDS * 1000);
    this.slideIcon.setFrame("pause");
  }

  private show(): void {
    const entry = this.current();
    if (!entry?.url) return;

    if (this.kind === "photo") {
      this.videoEl.pause();
      this.videoEl.removeAttribute("src");
      this.imageEl.src = entry.url;
      this.applyPhotoTransform();
      this.captionEl.textContent =
        this.items.length > 1 ? `${entry.name}  ·  ${this.index + 1} / ${this.items.length}` : entry.name;
    } else {
      this.imageEl.removeAttribute("src");
      this.detachHls();
      this.setSubtitles(null);
      if (entry.hls && Hls.isSupported()) {
        // Chromium has no native HLS; hls.js feeds the playlist's segments through
        // Media Source Extensions. Used for anything Jellyfin has to transcode.
        this.hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        this.hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) this.captionEl.textContent = `Couldn't play ${entry.name} (${data.type})`;
        });
        this.hls.loadSource(entry.url);
        this.hls.attachMedia(this.videoEl);
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => this.videoEl.play().catch(() => {}));
        this.hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this.pickAudioTrack());
      } else {
        this.videoEl.src = entry.url;
        this.videoEl.play().catch(() => {});
      }
      this.captionEl.textContent = entry.name;
      this.updateVideoChrome();
    }
  }

  private updateVideoChrome(): void {
    const v = this.videoEl;
    const progress = isFinite(v.duration) && v.duration > 0 ? v.currentTime / v.duration : 0;
    this.progressFill.style.width = `${Math.min(100, progress * 100)}%`;
    this.timeEl.textContent = `${formatTime(v.currentTime)} / ${formatTime(v.duration)}`;
    // The strip shows what A will do next, like a transport control does.
    this.playIcon.setFrame(v.paused ? "play" : "pause");
  }

  /** Returns true when the action was consumed by the viewer. */
  handle(action: ViewerAction): boolean {
    if (!this.kind) return false;

    if (action === "back") {
      this.close();
      return true;
    }

    if (this.kind === "photo") {
      if (action === "left") this.step(-1);
      else if (action === "right") this.step(1);
      else if (action === "up") {
        this.zoom = Math.min(ZOOM_STEPS.length - 1, this.zoom + 1);
        this.applyPhotoTransform();
      } else if (action === "down") {
        this.zoom = Math.max(0, this.zoom - 1);
        this.applyPhotoTransform();
      } else if (action === "context") {
        this.rotation = (this.rotation + 90) % 360;
        this.applyPhotoTransform();
      } else if (action === "confirm") this.toggleSlideshow();
      return true;
    }

    // video
    const v = this.videoEl;
    if (action === "confirm" || action === "context") {
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    } else if (action === "left") {
      v.currentTime = Math.max(0, v.currentTime - SEEK_SECONDS);
    } else if (action === "right") {
      if (isFinite(v.duration)) v.currentTime = Math.min(v.duration, v.currentTime + SEEK_SECONDS);
    }
    return true;
  }

  private step(delta: number): void {
    if (this.items.length === 0) return;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    // A fresh picture starts square and unzoomed, whatever the last one was.
    this.zoom = 0;
    this.rotation = 0;
    this.show();
  }

  private detachHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  close(): void {
    if (!this.kind) return;
    this.kind = null;
    this.stopSlideshow();
    this.detachHls();
    this.setSubtitles(null);
    this.videoEl.pause();
    this.videoEl.removeAttribute("src");
    this.videoEl.load();
    this.imageEl.removeAttribute("src");
    this.root.classList.add("hidden");
    this.root.classList.remove("photo", "video");
    this.onClose();
  }
}
