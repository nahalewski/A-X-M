/**
 * PS3-style notification pills: a rounded dark bar in the top-right with the
 * four-button badge, sliding in with a line of text, ticking sideways if it's too
 * long, gone after a few seconds. One at a time, queued.
 *
 * What gets announced is decided by the caller with a category, so Settings can turn
 * kinds off individually (transfers, controllers, battery, installs, general).
 */

export type NotifyKind = "general" | "transfer" | "controller" | "battery" | "install";

export interface NotifySettings {
  enabled: boolean;
  kinds: Record<NotifyKind, boolean>;
}

const SHOW_MS = 4200;

/** The picture a system notification carries when the caller gave none: one per kind. */
const KIND_ICONS: Record<NotifyKind, string> = {
  general: "assets/icons/settings-about.webp",
  transfer: "assets/icons/hdd.webp",
  controller: "assets/icons/games.svg",
  battery: "assets/icons/power.png",
  install: "assets/icons/system-update.webp",
};

export class Notifier {
  private root: HTMLElement;
  private textEl: HTMLElement;
  private queue: { text: string; kind: NotifyKind; iconUrl?: string }[] = [];
  private imgEl: HTMLImageElement;
  private showing = false;
  private prefs: NotifySettings = { enabled: true, kinds: { general: true, transfer: true, controller: true, battery: true, install: true } };
  /** Everything shown this session, newest first, for the Notifications view. */
  readonly history: { at: number; text: string; kind: NotifyKind }[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "notify";
    this.root.className = "hidden";
    this.textEl = document.createElement("span");
    this.textEl.className = "notify-text";
    // The clip is what stays put; the text inside it is what ticks sideways.
    const clip = document.createElement("span");
    clip.className = "notify-clip";
    clip.appendChild(this.textEl);
    this.imgEl = document.createElement("img");
    this.imgEl.className = "notify-img";
    this.imgEl.addEventListener("error", () => this.imgEl.classList.add("broken"));
    this.root.append(this.imgEl, clip);
    parent.appendChild(this.root);
  }

  setPrefs(prefs: NotifySettings): void {
    this.prefs = prefs;
  }

  /**
   * `iconUrl` turns the pill into the media style - the framed rectangle with the
   * game's, film's or trophy's picture in it; without one it's the system pill.
   */
  push(text: string, kind: NotifyKind = "general", iconUrl?: string): void {
    this.history.unshift({ at: Date.now(), text, kind });
    if (this.history.length > 50) this.history.length = 50;
    if (!this.prefs.enabled || !this.prefs.kinds[kind]) return;
    this.queue.push({ text, kind, iconUrl });
    if (!this.showing) this.next();
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) {
      this.showing = false;
      return;
    }
    this.showing = true;
    this.textEl.textContent = item.text;
    this.textEl.classList.remove("ticker");
    // Media pills carry the thing's own picture; system pills carry their kind's icon.
    this.root.classList.toggle("media", !!item.iconUrl);
    this.imgEl.classList.remove("broken");
    this.imgEl.src = item.iconUrl ?? KIND_ICONS[item.kind];
    this.root.classList.remove("hidden");
    // Long lines scroll like the PS3's ticker rather than being cut.
    requestAnimationFrame(() => {
      const clipEl = this.textEl.parentElement!;
      if (this.textEl.scrollWidth > clipEl.clientWidth + 4) {
        this.textEl.style.setProperty("--tick", `${this.textEl.scrollWidth - clipEl.clientWidth + 12}px`);
        this.textEl.classList.add("ticker");
      }
    });
    setTimeout(() => {
      this.root.classList.add("hidden");
      setTimeout(() => this.next(), 350);
    }, SHOW_MS);
  }
}
