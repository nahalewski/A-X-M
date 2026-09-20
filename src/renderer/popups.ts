import { btn } from "./xmb";

/**
 * The overlays the Y / triangle button brings up, drawn the way the PS3 drew them.
 *
 * OptionsPopup: the sidebar on the right edge - plain rows (Play, Copy, Delete,
 * Information…), the current one lit. A row can open a nested list (Lossless
 * Scaling ▸ Off / 1 / 2 / 3) or be a colour swatch (Theme › Colour). Moving over a
 * row can preview it (the swatch column tints the background as you go). ▲ ▼ move,
 * A picks, B backs out one level.
 *
 * InfoCard: the PS3's Information screen - the picture centred at the top, then a
 * label / value list (Title, Sub-Title, Updated, Size, Details…), "○ Back" at the
 * bottom. The caller fills the rows; nothing here knows what a game or song is.
 *
 * TextPanel: a scrollable page of text, for About.
 */

export type PopupAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context";

export interface PopupOption {
  label: string;
  hint?: string;
  /** Nested list opened instead of running. */
  children?: PopupOption[];
  /** Colour swatch drawn beside the label. */
  swatch?: string;
  /** Called when the row is merely highlighted, e.g. to preview a colour. */
  preview?: () => void;
  /** Marked as the current value. */
  selected?: boolean;
  run?: () => void | Promise<void>;
}

export class OptionsPopup {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private listEl: HTMLElement;
  private stack: { options: PopupOption[]; index: number; title: string }[] = [];
  private open = false;
  private onClose: (cancelled: boolean) => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.titleEl = document.createElement("div");
    this.titleEl.className = "popup-title";
    this.listEl = document.createElement("div");
    this.listEl.className = "popup-list";
    const hint = document.createElement("div");
    hint.className = "popup-hint";
    hint.innerHTML = `▲ ▼ choose · ${btn("a")} select · ${btn("b")} back`;
    root.append(this.titleEl, this.listEl, hint);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(title: string, options: PopupOption[], onClose: (cancelled: boolean) => void): void {
    this.stack = [{ options, index: Math.max(0, options.findIndex((o) => o.selected)), title }];
    this.open = true;
    this.onClose = onClose;
    this.root.classList.remove("hidden");
    this.render();
  }

  close(cancelled = true): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add("hidden");
    this.onClose(cancelled);
  }

  private level() {
    return this.stack[this.stack.length - 1];
  }

  handle(action: PopupAction): boolean {
    if (!this.open) return false;
    const lvl = this.level();
    const n = lvl.options.length;
    if (action === "up" || action === "down") {
      lvl.index = (lvl.index + (action === "up" ? n - 1 : 1)) % n;
      lvl.options[lvl.index]?.preview?.();
    } else if (action === "confirm") {
      const chosen = lvl.options[lvl.index];
      if (chosen?.children?.length) {
        this.stack.push({ options: chosen.children, index: Math.max(0, chosen.children.findIndex((o) => o.selected)), title: chosen.label });
        this.level().options[this.level().index]?.preview?.();
      } else {
        this.close(false);
        if (chosen?.run) void chosen.run();
        return true;
      }
    } else if (action === "back" || action === "context") {
      if (this.stack.length > 1) this.stack.pop();
      else {
        this.close(true);
        return true;
      }
    }
    this.render();
    return true;
  }

  private render(): void {
    const lvl = this.level();
    this.titleEl.textContent = lvl.title;
    this.listEl.innerHTML = "";
    lvl.options.forEach((o, i) => {
      const row = document.createElement("div");
      row.className = "popup-option" + (i === lvl.index ? " selected" : "") + (o.selected ? " current" : "");
      row.innerHTML =
        (o.swatch ? `<span class="popup-swatch" style="background:${o.swatch}"></span>` : "") +
        `<span class="popup-option-label">${esc(o.label)}${o.children?.length ? '<span class="popup-arrow">▸</span>' : ""}</span>` +
        (o.hint ? `<span class="popup-option-hint">${esc(o.hint)}</span>` : "");
      this.listEl.appendChild(row);
      if (i === lvl.index) row.scrollIntoView({ block: "nearest" });
    });
  }
}

/** One label / value line on the Information screen. */
export interface InfoRow {
  label: string;
  value: string;
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
    hint.className = "popup-hint info-back";
    hint.innerHTML = `${btn("b")} Back`;
    root.append(this.artEl, this.bodyEl, hint);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Opens straight away with what's known; `rows()` fills in the rest as lookups land. */
  show(title: string, artUrl: string | undefined, rows: InfoRow[], onClose: () => void): void {
    this.open = true;
    this.onClose = onClose;
    this.setArt(artUrl);
    this.rows([{ label: "Title", value: title }, ...rows]);
    this.root.classList.remove("hidden");
  }

  setArt(url?: string | null): void {
    if (url) {
      this.artEl.classList.remove("hidden");
      this.artEl.src = url;
    } else {
      this.artEl.classList.add("hidden");
      this.artEl.removeAttribute("src");
    }
  }

  rows(rows: InfoRow[]): void {
    if (!this.open) return;
    this.bodyEl.innerHTML = rows
      .filter((r) => r.value)
      .map((r) => `<div class="info-k">${esc(r.label)}</div><div class="info-v">${esc(r.value).replace(/\n/g, "<br>")}</div>`)
      .join("");
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

/** A page of text that scrolls with ▲ ▼. */
export class TextPanel {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private open = false;
  private onClose: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.titleEl = document.createElement("div");
    this.titleEl.className = "text-panel-title";
    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "text-panel-body";
    const hint = document.createElement("div");
    hint.className = "popup-hint";
    hint.innerHTML = `▲ ▼ scroll · ${btn("b")} Back`;
    root.append(this.titleEl, this.bodyEl, hint);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(title: string, paragraphs: string[], onClose: () => void): void {
    this.open = true;
    this.onClose = onClose;
    this.titleEl.textContent = title;
    this.bodyEl.innerHTML = paragraphs.map((p) => `<p>${esc(p)}</p>`).join("");
    this.bodyEl.scrollTop = 0;
    this.root.classList.remove("hidden");
  }

  handle(action: PopupAction): boolean {
    if (!this.open) return false;
    if (action === "up") this.bodyEl.scrollBy({ top: -120, behavior: "smooth" });
    else if (action === "down") this.bodyEl.scrollBy({ top: 120, behavior: "smooth" });
    else if (action === "back" || action === "context") this.close();
    return true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add("hidden");
    this.onClose();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
