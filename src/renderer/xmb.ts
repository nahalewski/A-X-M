import { GameEntry, Settings } from "./types";
import { AudioManager } from "./audio";

export interface MenuItem {
  id: string;
  title: string;
  /** Wide image to show as the menu background while this item is focused. */
  backgroundUrl?: string;
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
  /** Handle B within the category (e.g. go up a folder). Return true if consumed. */
  onBack?: () => boolean;
  /** Handle Y within the category (e.g. play/pause). Return true if consumed. */
  onContext?: () => boolean;
  /** Extra hint text for the footer, e.g. the current folder. */
  footerHint?: () => string | undefined;
}

const SOURCE_GLYPH: Record<GameEntry["source"], string> = {
  steam: "S",
  epic: "E",
  xbox: "X",
  generic: "G",
};

// How many items to render on each side of the focus. More below than above,
// since the list grows downward from the category row.
const VISIBLE_ABOVE = 2;
const VISIBLE_BELOW = 4;

// Slot geometry, in px, all measured from the category icon's centre. The focused
// item sits directly *below* the category icon; items already scrolled past move
// above it. The icon itself (and its label) occupy a dead zone that no slot enters,
// so a selection can never overlap the category row.
const SELECTED_SLOT_HEIGHT = 150;
const NEIGHBOUR_SLOT_HEIGHT = 86;
const SLOT_GAP = 12;

/**
 * Extra room between the category row and the item column, on top of the measured
 * icon half-height. Game box art is the tallest thing the rail draws, and without
 * this the focused tile creeps up under the category icon and the two collide.
 */
const CATEGORY_CLEARANCE = 44;

interface IconClearance {
  above: number; // from icon centre up to the top of the label
  below: number; // from icon centre down to the bottom of the icon
}

// Where the focused category icon is pinned horizontally, as a fraction of the
// window width. The whole bar slides so the focused icon lands here, which is what
// makes the XMB appear to scroll left as you move right; icons that run past the
// left edge simply clip. Matches the ~29% the real XMB uses.
const CATEGORY_ANCHOR_X = 0.29;

function slotTop(offset: number, clearance: IconClearance): number {
  // Focused item hangs directly under the category icon.
  if (offset === 0) return clearance.below;

  if (offset > 0) {
    // Below the focused item, stacked downward.
    const below = clearance.below + SELECTED_SLOT_HEIGHT + SLOT_GAP;
    return below + (offset - 1) * (NEIGHBOUR_SLOT_HEIGHT + SLOT_GAP);
  }

  // Items already scrolled past sit above the category icon, growing upward.
  const stepsAbove = Math.abs(offset) - 1;
  const bottomEdge = -clearance.above - stepsAbove * (NEIGHBOUR_SLOT_HEIGHT + SLOT_GAP);
  return bottomEdge - NEIGHBOUR_SLOT_HEIGHT;
}

export class Xmb {
  private activeCategory = 0;
  private selectedIndex = new Map<string, number>();
  private modalGame: GameEntry | null = null;
  private modalSelection: 0 | 1 | 2 | 3 = 0;
  private clearance: IconClearance = { above: 60, below: 44 };

  private onSelectionChange: (item: MenuItem | null) => void = () => {};

  private categoryBarEl = document.getElementById("category-bar")!;
  private itemRailEl = document.getElementById("item-rail")!;
  private modalEl = document.getElementById("context-modal")!;
  private modalTitleEl = document.getElementById("context-title")!;
  private modalOptionsEl = document.getElementById("context-options")!;
  private footerEl = document.getElementById("footer-hints")!;

  constructor(private categories: Category[], private audio: AudioManager) {}

  /** Fired after every render with whatever is currently focused, or null if nothing is. */
  setOnSelectionChange(callback: (item: MenuItem | null) => void): void {
    this.onSelectionChange = callback;
  }

  activeCategoryId(): string {
    return this.categories[this.activeCategory].id;
  }

  setActiveCategory(categoryId: string): void {
    const index = this.categories.findIndex((c) => c.id === categoryId);
    if (index >= 0) this.activeCategory = index;
  }

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
      case "back": {
        const category = this.categories[this.activeCategory];
        if (category.onBack?.()) {
          this.audio.playBack();
          this.render();
          break;
        }
        this.audio.playBack();
        break;
      }
      case "context": {
        const item = this.currentItems()[this.currentSelectedIndex()];
        if (item?.contextGame) {
          this.audio.playContextOpen();
          this.openModal(item.contextGame);
          break;
        }
        if (this.categories[this.activeCategory].onContext?.()) {
          this.audio.playContextOpen();
          this.render();
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

  /** Puts the cursor back at the top, e.g. after descending into a new folder. */
  resetSelection(categoryId: string): void {
    this.selectedIndex.set(categoryId, 0);
  }

  private render(): void {
    this.renderCategoryBar();
    this.renderItemRail();
    this.renderModal();
    this.renderFooter();
    this.onSelectionChange(this.currentItems()[this.currentSelectedIndex()] ?? null);
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
    const active = activeEl as HTMLElement | null;
    const iconEl = active?.querySelector(".category-icon") as HTMLElement | null;
    if (active && iconEl) {
      // Horizontal uses offsetLeft, which ignores transforms - reading a transformed
      // rect here would force the bar back to 0 mid-transition and make it snap.
      const iconCentreInBar = active.offsetLeft + iconEl.offsetLeft + iconEl.offsetWidth / 2;
      const anchorX = window.innerWidth * CATEGORY_ANCHOR_X;

      // Slide the whole bar so the focused icon lands on the anchor - the row moves,
      // the focus stays put, exactly like the real XMB.
      this.categoryBarEl.style.transform = `translate(${anchorX - iconCentreInBar}px, -50%)`;

      const rect = iconEl.getBoundingClientRect();
      const centreY = rect.top + rect.height / 2;
      this.itemRailEl.style.left = `${anchorX}px`;
      this.itemRailEl.style.top = `${centreY}px`;

      // Measure the real dead zone rather than assuming icon sizes, so the items
      // stay clear of the category row even as icon sizes or scaling change.
      const labelEl = active?.querySelector(".category-label");
      const labelTop = labelEl ? labelEl.getBoundingClientRect().top : rect.top;
      this.clearance = {
        above: centreY - labelTop + SLOT_GAP + CATEGORY_CLEARANCE * 0.5,
        below: rect.height / 2 + SLOT_GAP + CATEGORY_CLEARANCE,
      };
    }
  }

  private renderItemRail(): void {
    this.itemRailEl.innerHTML = "";
    const items = this.currentItems();
    const selected = this.currentSelectedIndex();

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "item-row selected";
      empty.style.top = `${slotTop(0, this.clearance)}px`;
      empty.innerHTML =
        `<div class="item-icon-slot"></div>` +
        `<div class="item-text"><div class="item-title">Nothing here yet</div></div>`;
      this.itemRailEl.appendChild(empty);
      return;
    }

    // Each slot is positioned absolutely at an exact offset from the category icon.
    // The focused item hangs directly below the icon and items scrolled past move
    // above it, so nothing ever lands on the category row itself.
    for (let offset = -VISIBLE_ABOVE; offset <= VISIBLE_BELOW; offset++) {
      const item = items[selected + offset];
      if (!item) continue;

      const distance = Math.abs(offset);
      const row = document.createElement("div");
      row.className = "item-row" + (offset === 0 ? " selected" : "");
      row.style.top = `${slotTop(offset, this.clearance)}px`;
      row.style.opacity = offset === 0 ? "1" : String(Math.max(0.15, 0.55 - distance * 0.13));

      // Icon in its own fixed-width column on the left, then a text block holding
      // the title with the subtitle and badge stacked beneath it.
      const slot = document.createElement("div");
      slot.className = "item-icon-slot";
      slot.appendChild(this.buildIcon(item));

      const text = document.createElement("div");
      text.className = "item-text";
      text.innerHTML = `
        <div class="item-title">${item.title}</div>
        ${item.subtitle ? `<div class="item-subtitle">${item.subtitle}</div>` : ""}
        ${item.badge ? `<div class="item-badge">${item.badge}</div>` : ""}
      `;

      row.append(slot, text);
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
    const category = this.categories[this.activeCategory];
    const item = this.currentItems()[this.currentSelectedIndex()];
    const extra = category.footerHint?.();
    const left = extra
      ? `<span>${extra}</span>`
      : `<span>◀ ▶ category &middot; ▲ ▼ select</span>`;
    const hints = ["A select"];
    if (item?.contextGame) hints.push("Y scaling profile");
    if (category.onBack) hints.push("B back");
    if (category.onContext) hints.push("Y play/pause");
    this.footerEl.innerHTML = `${left}<span>${hints.join(" &middot; ")}</span>`;
  }
}

export function sourceGlyph(source: GameEntry["source"]): string {
  return SOURCE_GLYPH[source];
}

export type { GameEntry, Settings };
