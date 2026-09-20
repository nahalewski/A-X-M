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

export class Notifier {
  private root: HTMLElement;
  private textEl: HTMLElement;
  private queue: { text: string; kind: NotifyKind }[] = [];
  private showing = false;
  private prefs: NotifySettings = { enabled: true, kinds: { general: true, transfer: true, controller: true, battery: true, install: true } };
  /** Everything shown this session, newest first, for the Notifications view. */
  readonly history: { at: number; text: string; kind: NotifyKind }[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "notify";
    this.root.className = "hidden";
    const badge = document.createElement("span");
    badge.className = "notify-badge";
    badge.innerHTML = "<i>△</i><i>○</i><i>✕</i><i>□</i>";
    this.textEl = document.createElement("span");
    this.textEl.className = "notify-text";
    this.root.append(badge, this.textEl);
    parent.appendChild(this.root);
  }

  setPrefs(prefs: NotifySettings): void {
    this.prefs = prefs;
  }

  push(text: string, kind: NotifyKind = "general"): void {
    this.history.unshift({ at: Date.now(), text, kind });
    if (this.history.length > 50) this.history.length = 50;
    if (!this.prefs.enabled || !this.prefs.kinds[kind]) return;
    this.queue.push({ text, kind });
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
    this.root.classList.remove("hidden");
    // Long lines scroll like the PS3's ticker rather than being cut.
    requestAnimationFrame(() => {
      if (this.textEl.scrollWidth > this.textEl.clientWidth + 4) {
        this.textEl.style.setProperty("--tick", `${this.textEl.scrollWidth - this.textEl.clientWidth + 12}px`);
        this.textEl.classList.add("ticker");
      }
    });
    setTimeout(() => {
      this.root.classList.add("hidden");
      setTimeout(() => this.next(), 350);
    }, SHOW_MS);
  }
}
