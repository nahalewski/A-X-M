import { BrowseEntry } from "./types";

/**
 * Full-screen in-app viewer for the Photo and Video columns, so a file opens over
 * the menu instead of handing off to whatever Windows has associated with it.
 *
 * Photos: ◀ ▶ step through the folder, B closes.
 * Video:  A play/pause, ◀ ▶ seek ten seconds, B closes. MP4 only, by construction
 *         of the browser that feeds it.
 *
 * Input arrives through the same external-handler hook the visualizer uses, so the
 * menu never scrolls underneath an open viewer.
 */

export type ViewerAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context";

const SEEK_SECONDS = 10;

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export class MediaViewer {
  private root: HTMLElement;
  private imageEl: HTMLImageElement;
  private videoEl: HTMLVideoElement;
  private captionEl: HTMLElement;
  private progressEl: HTMLElement;
  private progressFill: HTMLElement;
  private timeEl: HTMLElement;

  private items: BrowseEntry[] = [];
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

    this.videoEl.addEventListener("timeupdate", () => this.updateVideoChrome());
    this.videoEl.addEventListener("play", () => this.updateVideoChrome());
    this.videoEl.addEventListener("pause", () => this.updateVideoChrome());
    this.videoEl.addEventListener("ended", () => this.updateVideoChrome());
    this.videoEl.addEventListener("error", () => {
      this.captionEl.textContent = `Couldn't play ${this.current()?.name ?? "this file"}`;
    });
  }

  setOnClose(callback: () => void): void {
    this.onClose = callback;
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
    this.index = Math.max(0, this.items.findIndex((e) => e.filePath === entry.filePath));
    this.kind = kind;

    this.root.classList.remove("hidden");
    this.root.classList.toggle("photo", kind === "photo");
    this.root.classList.toggle("video", kind === "video");
    this.show();
  }

  private show(): void {
    const entry = this.current();
    if (!entry?.url) return;

    if (this.kind === "photo") {
      this.videoEl.pause();
      this.videoEl.removeAttribute("src");
      this.imageEl.src = entry.url;
      this.captionEl.textContent =
        this.items.length > 1 ? `${entry.name}  ·  ${this.index + 1} / ${this.items.length}` : entry.name;
    } else {
      this.imageEl.removeAttribute("src");
      this.videoEl.src = entry.url;
      this.videoEl.play().catch(() => {});
      this.captionEl.textContent = entry.name;
      this.updateVideoChrome();
    }
  }

  private updateVideoChrome(): void {
    const v = this.videoEl;
    const progress = isFinite(v.duration) && v.duration > 0 ? v.currentTime / v.duration : 0;
    this.progressFill.style.width = `${Math.min(100, progress * 100)}%`;
    this.timeEl.textContent = `${v.paused ? "❚❚" : "▶"}  ${formatTime(v.currentTime)} / ${formatTime(v.duration)}`;
  }

  /** Returns true when the action was consumed by the viewer. */
  handle(action: ViewerAction): boolean {
    if (!this.kind) return false;

    if (action === "back") {
      this.close();
      return true;
    }

    if (this.kind === "photo") {
      if (action === "left" || action === "up") this.step(-1);
      else if (action === "right" || action === "down") this.step(1);
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
    this.show();
  }

  close(): void {
    if (!this.kind) return;
    this.kind = null;
    this.videoEl.pause();
    this.videoEl.removeAttribute("src");
    this.videoEl.load();
    this.imageEl.removeAttribute("src");
    this.root.classList.add("hidden");
    this.root.classList.remove("photo", "video");
    this.onClose();
  }
}
