import { GameEntry, Settings } from "./types";
import { AudioManager } from "./audio";

export interface MenuItem {
  id: string;
  title: string;
  subtitle?: string;
  iconUrl?: string;
  iconGlyph?: string;
  badge?: string;
  onConfirm?: () => void | Promise<void>;
  contextGame?: GameEntry;
}

export interface Category {
  id: string;
  label: string;
  iconUrl: string;
  getItems: () => MenuItem[];
}

const SOURCE_GLYPH: Record<GameEntry["source"], string> = {
  steam: "S",
  epic: "E",
  xbox: "X",
  generic: "G",
};

const VISIBLE_RADIUS = 3; // how many items above/below the selection to render

export class Xmb {
  private activeCategory = 0;
  private selectedIndex = new Map<string, number>();
  private modalGame: GameEntry | null = null;
  private modalSelection: 0 | 1 | 2 | 3 = 0;

  private categoryBarEl = document.getElementById("category-bar")!;
  private itemRailEl = document.getElementById("item-rail")!;
  private modalEl = document.getElementById("context-modal")!;
  private modalTitleEl = document.getElementById("context-title")!;
  private modalOptionsEl = document.getElementById("context-options")!;
  private footerEl = document.getElementById("footer-hints")!;

  constructor(private categories: Category[], private audio: AudioManager) {}

  init(): void {
    this.render();
    document.addEventListener("keydown", (e) => this.handleKey(e));
    window.addEventListener("resize", () => this.render());
  }

  currentItems(): MenuItem[] {
    return this.categories[this.activeCategory].getItems();
  }

  currentSelectedIndex(): number {
    const cat = this.categories[this.activeCategory];
    return Math.min(this.selectedIndex.get(cat.id) ?? 0, Math.max(0, this.currentItems().length - 1));
  }

  private setSelectedIndex(i: number): void {
    const cat = this.categories[this.activeCategory];
    const items = this.currentItems();
    const clamped = Math.max(0, Math.min(items.length - 1, i));
    this.selectedIndex.set(cat.id, clamped);
  }

  handleAction(action: "up" | "down" | "left" | "right" | "confirm" | "back" | "context"): void {
    if (this.modalGame) {
      this.handleModalAction(action);
      return;
    }

    switch (action) {
      case "left":
        this.activeCategory = (this.activeCategory - 1 + this.categories.length) % this.categories.length;
        this.audio.playMoveUp();
        this.render();
        break;
      case "right":
        this.activeCategory = (this.activeCategory + 1) % this.categories.length;
        this.audio.playMoveDown();
        this.render();
        break;
      case "up":
        this.setSelectedIndex(this.currentSelectedIndex() - 1);
        this.audio.playMoveUp();
        this.render();
        break;
      case "down":
        this.setSelectedIndex(this.currentSelectedIndex() + 1);
        this.audio.playMoveDown();
        this.render();
        break;
      case "confirm": {
        const item = this.currentItems()[this.currentSelectedIndex()];
        if (item?.onConfirm) {
          this.audio.playConfirm();
          item.onConfirm();
        }
        break;
      }
      case "back":
        this.audio.playBack();
        break;
      case "context": {
        const item = this.currentItems()[this.currentSelectedIndex()];
        if (item?.contextGame) {
          this.audio.playContextOpen();
          this.openModal(item.contextGame);
        }
        break;
      }
    }
  }

  private openModal(game: GameEntry): void {
    this.modalGame = game;
    this.modalSelection = (game.losslessProfile ?? 0) as 0 | 1 | 2 | 3;
    this.render();
  }

  private closeModal(): void {
    this.modalGame = null;
    this.render();
  }

  private handleModalAction(action: string): void {
    if (action === "left") {
      this.modalSelection = ((this.modalSelection + 3) % 4) as 0 | 1 | 2 | 3;
      this.audio.playMoveUp();
      this.render();
    } else if (action === "right") {
      this.modalSelection = ((this.modalSelection + 1) % 4) as 0 | 1 | 2 | 3;
      this.audio.playMoveDown();
      this.render();
    } else if (action === "confirm") {
      if (this.modalGame) {
        const profile = this.modalSelection === 0 ? null : this.modalSelection;
        this.modalGame.losslessProfile = profile;
        window.axm.setLosslessProfile(this.modalGame.id, profile);
      }
      this.audio.playConfirm();
      this.closeModal();
    } else if (action === "back" || action === "context") {
      this.audio.playContextClose();
      this.closeModal();
    }
  }

  private handleKey(e: KeyboardEvent): void {
    const map: Record<string, Parameters<Xmb["handleAction"]>[0]> = {
      ArrowUp: "up",
      w: "up",
      ArrowDown: "down",
      s: "down",
      ArrowLeft: "left",
      a: "left",
      ArrowRight: "right",
      d: "right",
      Enter: "confirm",
      " ": "confirm",
      Escape: "back",
      Backspace: "back",
      y: "context",
      Y: "context",
    };
    const action = map[e.key];
    if (action) {
      e.preventDefault();
      this.handleAction(action);
    }
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    this.renderCategoryBar();
    this.renderItemRail();
    this.renderModal();
    this.renderFooter();
  }

  private renderCategoryBar(): void {
    this.categoryBarEl.innerHTML = "";
    let activeEl: HTMLElement | null = null;
    this.categories.forEach((cat, i) => {
      const el = document.createElement("div");
      el.className = "category" + (i === this.activeCategory ? " active" : "");
      el.innerHTML = `<div class="category-label">${cat.label}</div><div class="category-icon"><img src="${cat.iconUrl}" alt="" /></div>`;
      this.categoryBarEl.appendChild(el);
      if (i === this.activeCategory) activeEl = el;
    });

    // The item list is anchored on the *selected* category icon's own position -
    // both x (so a wide item never bleeds into neighboring icons) and y (so the
    // "crossing" lines up with the icon itself, not the icon+label block, which
    // would push the item text down into the label) - matching how the real XMB
    // scrolls items through the icon row rather than a screen-centered block.
    const iconEl = (activeEl as HTMLElement | null)?.querySelector(".category-icon");
    if (iconEl) {
      const rect = iconEl.getBoundingClientRect();
      this.itemRailEl.style.left = `${rect.left + rect.width / 2}px`;
      this.itemRailEl.style.top = `${rect.top + rect.height / 2}px`;
    }
  }

  private renderItemRail(): void {
    this.itemRailEl.innerHTML = "";
    const items = this.currentItems();
    const selected = this.currentSelectedIndex();

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "item-row selected";
      empty.innerHTML = `<div class="item-title">Nothing here yet</div>`;
      this.itemRailEl.appendChild(empty);
      return;
    }

    // Render a fixed number of slots with the selected item always pinned to the
    // center slot (like the real XMB, where the current item sits on the category
    // row and the list scrolls past it) - a blank placeholder fills any slot that
    // falls off the start/end of the list, so the selection never jumps position.
    for (let offset = -VISIBLE_RADIUS; offset <= VISIBLE_RADIUS; offset++) {
      const i = selected + offset;
      const item = items[i];
      const row = document.createElement("div");

      if (!item) {
        row.className = "item-row item-row-empty";
        this.itemRailEl.appendChild(row);
        continue;
      }

      const distance = Math.abs(offset);
      row.className = "item-row" + (offset === 0 ? " selected" : "");
      row.style.opacity = offset === 0 ? "1" : String(Math.max(0.12, 0.5 - distance * 0.12));

      row.innerHTML = `
        <div class="item-title">${item.title}</div>
        ${item.subtitle ? `<div class="item-subtitle">${item.subtitle}</div>` : ""}
        ${item.badge ? `<div class="item-badge">${item.badge}</div>` : ""}
      `;

      const iconEl = this.buildIcon(item);
      row.prepend(iconEl);
      this.itemRailEl.appendChild(row);
    }
  }

  private buildIcon(item: MenuItem): HTMLElement {
    if (item.iconUrl) {
      const img = document.createElement("img");
      img.className = "item-icon";
      img.src = item.iconUrl;
      img.addEventListener("error", () => {
        const fallback = document.createElement("div");
        fallback.className = "item-icon";
        fallback.textContent = item.iconGlyph ?? "?";
        img.replaceWith(fallback);
      });
      return img;
    }
    const div = document.createElement("div");
    div.className = "item-icon";
    div.textContent = item.iconGlyph ?? "?";
    return div;
  }

  private renderModal(): void {
    if (!this.modalGame) {
      this.modalEl.classList.add("hidden");
      return;
    }
    this.modalEl.classList.remove("hidden");
    this.modalTitleEl.textContent = `${this.modalGame.name} — Lossless Scaling Profile`;
    this.modalOptionsEl.innerHTML = "";
    ["None", "Profile 1", "Profile 2", "Profile 3"].forEach((label, i) => {
      const opt = document.createElement("div");
      opt.className = "context-option" + (i === this.modalSelection ? " selected" : "");
      opt.textContent = label;
      this.modalOptionsEl.appendChild(opt);
    });
  }

  private renderFooter(): void {
    if (this.modalGame) {
      this.footerEl.innerHTML = `<span>◀ ▶ change profile</span><span>A apply &middot; B cancel</span>`;
      return;
    }
    const item = this.currentItems()[this.currentSelectedIndex()];
    const hasContext = !!item?.contextGame;
    this.footerEl.innerHTML = `<span>◀ ▶ category &middot; ▲ ▼ select</span><span>A select${
      hasContext ? " &middot; Y scaling profile" : ""
    }</span>`;
  }
}

export function sourceGlyph(source: GameEntry["source"]): string {
  return SOURCE_GLYPH[source];
}

export type { GameEntry, Settings };
