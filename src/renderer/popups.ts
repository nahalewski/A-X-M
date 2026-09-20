import { ScreenInfo, SongInfo } from "./types";
import { btn } from "./xmb";

/**
 * Two small overlays the Y button brings up on media rows.
 *
 * OptionsPopup: a short list of actions for the focused row (Information, Copy
 * to…, Download, Visualizer), the way the PS3's triangle menu worked. ▲ ▼ pick,
 * A runs, B closes.
 *
 * InfoCard: a card of what the row is - cover or poster on the left, the facts on
 * the right. Fed by the main process's lookups (tags + MusicBrainz + Cover Art
 * Archive for songs, TMDB for films and shows). B closes.
 */

export type PopupAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context";

export interface PopupOption {
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

export class OptionsPopup {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private listEl: HTMLElement;
  private options: PopupOption[] = [];
  private index = 0;
  private open = false;
  private onClose: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.titleEl = document.createElement("div");
    this.titleEl.className = "popup-title";
    this.listEl = document.createElement("div");
    this.listEl.className = "popup-list";
    const hint = document.createElement("div");
    hint.className = "popup-hint";
    hint.innerHTML = `▲ ▼ choose · ${btn("a")} select · ${btn("b")} close`;
    root.append(this.titleEl, this.listEl, hint);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(title: string, options: PopupOption[], onClose: () => void): void {
    this.options = options;
    this.index = 0;
    this.open = true;
    this.onClose = onClose;
    this.titleEl.textContent = title;
    this.root.classList.remove("hidden");
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add("hidden");
    this.onClose();
  }

  handle(action: PopupAction): boolean {
    if (!this.open) return false;
    if (action === "up") this.index = (this.index + this.options.length - 1) % this.options.length;
    else if (action === "down") this.index = (this.index + 1) % this.options.length;
    else if (action === "confirm") {
      const chosen = this.options[this.index];
      this.close();
      if (chosen) void chosen.run();
      return true;
    } else if (action === "back" || action === "context") {
      this.close();
      return true;
    }
    this.render();
    return true;
  }

  private render(): void {
    this.listEl.innerHTML = "";
    this.options.forEach((o, i) => {
      const row = document.createElement("div");
      row.className = "popup-option" + (i === this.index ? " selected" : "");
      row.innerHTML = `<span class="popup-option-label">${o.label}</span>${o.hint ? `<span class="popup-option-hint">${o.hint}</span>` : ""}`;
      this.listEl.appendChild(row);
    });
  }
}

function fmtDuration(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export class InfoCard {
  private root: HTMLElement;
  private artEl: HTMLImageElement;
  private bodyEl: HTMLElement;
  private open = false;
  private onClose: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.artEl = document.createElement("img");
    this.artEl.className = "info-art";
    this.artEl.addEventListener("error", () => this.artEl.classList.add("hidden"));
    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "info-body";
    const hint = document.createElement("div");
    hint.className = "popup-hint";
    hint.innerHTML = `${btn("b")} close`;
    root.append(this.artEl, this.bodyEl, hint);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Opens immediately with a "Looking up…" state; call `song` / `screen` when the data lands. */
  loading(title: string, artUrl?: string, onClose?: () => void): void {
    this.open = true;
    this.onClose = onClose ?? (() => {});
    this.setArt(artUrl);
    this.bodyEl.innerHTML = `<div class="info-title">${esc(title)}</div><div class="info-line dim">Looking up…</div>`;
    this.root.classList.remove("hidden");
  }

  private setArt(url?: string | null): void {
    if (url) {
      this.artEl.classList.remove("hidden");
      this.artEl.src = url;
    } else {
      this.artEl.classList.add("hidden");
      this.artEl.removeAttribute("src");
    }
  }

  song(info: SongInfo | null, fallbackTitle: string): void {
    if (!this.open) return;
    if (!info) {
      this.bodyEl.innerHTML = `<div class="info-title">${esc(fallbackTitle)}</div><div class="info-line dim">No information found</div>`;
      return;
    }
    this.setArt(info.coverUrl);
    const a = info.artistInfo;
    const artistBits = a
      ? [a.type, a.area, a.began ? `${a.began.slice(0, 4)}${a.ended ? ` – ${a.ended.slice(0, 4)}` : " –"}` : "", a.disambiguation]
          .filter(Boolean)
          .join(" · ")
      : "";
    this.bodyEl.innerHTML = `
      <div class="info-title">${esc(info.title)}</div>
      <div class="info-sub">${esc(info.artist)}${info.album ? ` · ${esc(info.album)}` : ""}${info.year ? ` · ${esc(info.year)}` : ""}</div>
      <div class="info-grid">
        ${line("Length", fmtDuration(info.durationSec))}
        ${line("Genre", info.genre)}
        ${line("Bitrate", info.bitrateKbps ? `${info.bitrateKbps} kbps` : "")}
        ${line("Artist", artistBits)}
        ${line("Tags", a?.tags.join(", ") ?? "")}
      </div>
      <div class="info-source">${esc(info.source)}${a ? " · Cover Art Archive" : ""}</div>`;
  }

  screen(info: ScreenInfo | null, fallbackTitle: string): void {
    if (!this.open) return;
    if (!info) {
      this.bodyEl.innerHTML = `<div class="info-title">${esc(fallbackTitle)}</div><div class="info-line dim">No information found${
        "" /* TMDB key missing or no match */
      }</div>`;
      return;
    }
    this.setArt(info.posterUrl);
    const runtime = info.runtimeMin ? `${Math.floor(info.runtimeMin / 60)}h ${info.runtimeMin % 60}m` : "";
    this.bodyEl.innerHTML = `
      <div class="info-title">${esc(info.title)}${info.year ? ` <span class="dim">(${esc(info.year)})</span>` : ""}</div>
      ${info.tagline ? `<div class="info-sub">${esc(info.tagline)}</div>` : ""}
      <div class="info-grid">
        ${line("Rating", info.rating !== null ? `★ ${info.rating} / 10 · ${info.votes.toLocaleString()} votes` : "")}
        ${line("Genre", info.genres.join(", "))}
        ${line(info.kind === "tv" ? "Episode" : "Runtime", runtime)}
        ${line("Seasons", info.seasons ? `${info.seasons} · ${info.episodes ?? "?"} episodes` : "")}
        ${line("Status", info.status ?? "")}
      </div>
      <div class="info-overview">${esc(info.overview)}</div>
      <div class="info-source">${esc(info.source)}</div>`;
  }

  handle(action: PopupAction): boolean {
    if (!this.open) return false;
    if (action === "back" || action === "confirm" || action === "context") this.close();
    return true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add("hidden");
    this.setArt(null);
    this.onClose();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

function line(label: string, value: string): string {
  return value ? `<div class="info-k">${label}</div><div class="info-v">${esc(value)}</div>` : "";
}
