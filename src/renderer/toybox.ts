import type { ToyShelfFigure, ToyShelfFilter, ToyPlatform } from "./types";

/**
 * The Toybox shelf: the full-screen view of a toys-to-life collection. Figures
 * stand in the cubbies of a bookshelf drawn from the sprite sheet in
 * assets/toybox; the shelf picks the size that fits how many figures are on
 * the page, so three figures get a narrow three-cubby unit and a big collection
 * pages through 4x4 units.
 *
 * Input is the XMB's own vocabulary: the d-pad walks the cubbies (and pages at
 * the row ends), confirm opens the figure, triangle opens the filters, back
 * leaves. The menu supplies the popups, so the shelf only draws and moves.
 */

export type ShelfAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context";

interface ShelfSpec {
  file: string;
  cols: number;
  rows: number;
  width: number;
  height: number;
  cells: { x: number; y: number; w: number; h: number }[];
}

const PLATFORM_NAMES: Record<ToyPlatform, string> = {
  amiibo: "Amiibo",
  skylanders: "Skylanders",
  "disney-infinity": "Disney Infinity",
  "lego-dimensions": "LEGO Dimensions",
  generic: "Other",
};

export interface ShelfHooks {
  onClose(): void;
  onFigure(figure: ToyShelfFigure, shelf: ToyShelf): void;
  onFilters(shelf: ToyShelf): void;
}

export class ToyShelf {
  private root: HTMLElement;
  private shelfEl: HTMLElement;
  private titleEl: HTMLElement;
  private countEl: HTMLElement;
  private pageEl: HTMLElement;
  private cardEl: HTMLElement;
  private specs: ShelfSpec[] = [];
  private figures: ToyShelfFigure[] = [];
  private filter: ToyShelfFilter = { view: "all", platform: "" };
  private title = "Toybox";
  private page = 0;
  private index = 0;
  private spec: ShelfSpec | null = null;
  private opened = false;

  constructor(parent: HTMLElement, private hooks: ShelfHooks) {
    this.root = document.createElement("div");
    this.root.id = "toybox-app";
    this.root.className = "hidden";
    this.root.innerHTML = `
      <div class="toybox-head">
        <div class="toybox-title"></div>
        <div class="toybox-count"></div>
      </div>
      <div class="toybox-stage"><div class="toybox-shelf"></div></div>
      <div class="toybox-card hidden"></div>
      <div class="toybox-page"></div>`;
    parent.appendChild(this.root);
    this.shelfEl = this.root.querySelector(".toybox-shelf")!;
    this.titleEl = this.root.querySelector(".toybox-title")!;
    this.countEl = this.root.querySelector(".toybox-count")!;
    this.pageEl = this.root.querySelector(".toybox-page")!;
    this.cardEl = this.root.querySelector(".toybox-card")!;
    void fetch("assets/toybox/shelves.json")
      .then((r) => r.json())
      .then((j: ShelfSpec[]) => {
        this.specs = j;
        if (this.opened) this.render();
      })
      .catch(() => {});
  }

  isOpen(): boolean {
    return this.opened;
  }

  currentFilter(): ToyShelfFilter {
    return { ...this.filter };
  }

  /** Shows the shelf for a filter; the figures come from the main process each time. */
  async open(filter: ToyShelfFilter, title: string): Promise<void> {
    this.filter = { ...filter };
    this.title = title;
    this.page = 0;
    this.index = 0;
    this.opened = true;
    this.root.classList.remove("hidden");
    await this.reload();
  }

  async reload(keepPlace = false): Promise<void> {
    const figures = await window.axm.toyboxShelf(this.filter).catch(() => [] as ToyShelfFigure[]);
    this.figures = figures;
    if (!keepPlace) {
      this.page = 0;
      this.index = 0;
    }
    this.render();
  }

  close(): void {
    this.opened = false;
    this.root.classList.add("hidden");
    this.shelfEl.innerHTML = "";
  }

  selected(): ToyShelfFigure | null {
    return this.pageFigures()[this.index] ?? null;
  }

  /** The shelf that fits `n` figures: the smallest unit with at least that many cubbies. */
  private pickSpec(n: number): ShelfSpec | null {
    if (!this.specs.length) return null;
    const order = ["shelf-1x3", "shelf-2x2", "shelf-2x3", "shelf-3x3", "shelf-4x3", "shelf-4x4"];
    const by = (name: string) => this.specs.find((s) => s.file.endsWith(`${name}.png`)) ?? null;
    for (const name of order) {
      const s = by(name);
      if (s && s.cells.length >= n) return s;
    }
    return by("shelf-4x4");
  }

  private perPage(): number {
    return this.figures.length <= 16 ? Math.max(1, this.figures.length) : 16;
  }

  private pageCount(): number {
    return Math.max(1, Math.ceil(this.figures.length / this.perPage()));
  }

  private pageFigures(): ToyShelfFigure[] {
    const per = this.perPage();
    return this.figures.slice(this.page * per, this.page * per + per);
  }

  private render(): void {
    const figs = this.pageFigures();
    this.spec = this.pickSpec(Math.max(figs.length, this.figures.length > 16 ? 16 : figs.length));
    const platform = this.filter.platform ? PLATFORM_NAMES[this.filter.platform] : "";
    const view = { all: "Collection", owned: "Owned", favorites: "Favorites", recent: "Recently scanned" }[this.filter.view];
    this.titleEl.textContent = this.title;
    this.countEl.textContent = `${view}${platform ? ` · ${platform}` : ""} · ${this.figures.length} figure${this.figures.length === 1 ? "" : "s"}${this.filter.query ? ` · "${this.filter.query}"` : ""}`;
    this.pageEl.textContent = this.pageCount() > 1 ? `Shelf ${this.page + 1} of ${this.pageCount()}` : "";
    this.shelfEl.innerHTML = "";
    if (!this.spec) return;
    const spec = this.spec;
    // The shelf keeps its aspect and fills the stage's height; cells are placed in
    // percentages of the sprite so any scale works.
    this.shelfEl.style.aspectRatio = `${spec.width} / ${spec.height}`;
    this.shelfEl.style.setProperty("--shelf-aspect", String(spec.width / spec.height));
    const img = document.createElement("img");
    img.className = "toybox-shelf-img";
    img.src = spec.file;
    img.draggable = false;
    this.shelfEl.appendChild(img);
    if (!figs.length) {
      const empty = document.createElement("div");
      empty.className = "toybox-empty";
      empty.textContent = this.filter.view === "owned" ? "Nothing marked as owned yet - press X on a figure" : this.filter.view === "favorites" ? "No favourites yet - press Y on a figure" : this.filter.view === "recent" ? "Nothing scanned yet" : "No figures";
      this.shelfEl.appendChild(empty);
    }
    figs.forEach((f, i) => {
      const c = spec.cells[i];
      if (!c) return;
      const cell = document.createElement("div");
      cell.className = `toybox-cell${i === this.index ? " selected" : ""}${f.owned ? " owned" : ""}${f.favorite ? " fav" : ""}`;
      cell.style.left = `${(c.x / spec.width) * 100}%`;
      cell.style.top = `${(c.y / spec.height) * 100}%`;
      cell.style.width = `${(c.w / spec.width) * 100}%`;
      cell.style.height = `${(c.h / spec.height) * 100}%`;
      if (f.artUrl) {
        const fi = document.createElement("img");
        fi.className = "toybox-figure";
        fi.src = f.artUrl;
        fi.alt = f.name;
        fi.draggable = false;
        fi.onerror = () => {
          fi.remove();
          cell.appendChild(this.placeholder(f));
        };
        cell.appendChild(fi);
      } else cell.appendChild(this.placeholder(f));
      if (f.favorite) {
        const star = document.createElement("span");
        star.className = "toybox-star";
        star.textContent = "★";
        cell.appendChild(star);
      }
      this.shelfEl.appendChild(cell);
    });
    this.renderCard();
  }

  private placeholder(f: ToyShelfFigure): HTMLElement {
    const el = document.createElement("div");
    el.className = "toybox-placeholder";
    el.textContent = f.name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    return el;
  }

  private renderCard(): void {
    const f = this.selected();
    this.cardEl.classList.toggle("hidden", !f);
    if (!f) return;
    const facts = [
      f.franchise && f.franchise !== f.name ? f.franchise : "",
      f.series && f.series !== f.franchise ? f.series : "",
      f.variant ?? "",
      f.attributes?.element ? `Element: ${f.attributes.element}` : "",
    ].filter(Boolean);
    this.cardEl.innerHTML = `
      <div class="toybox-card-name"></div>
      <div class="toybox-card-platform"></div>
      <div class="toybox-card-facts"></div>
      <div class="toybox-card-state"></div>`;
    (this.cardEl.querySelector(".toybox-card-name") as HTMLElement).textContent = f.name;
    (this.cardEl.querySelector(".toybox-card-platform") as HTMLElement).textContent = PLATFORM_NAMES[f.platform] ?? f.platform;
    (this.cardEl.querySelector(".toybox-card-facts") as HTMLElement).textContent = facts.join(" · ");
    (this.cardEl.querySelector(".toybox-card-state") as HTMLElement).textContent = [f.owned ? "Owned" : "Not owned", f.favorite ? "Favourite" : "", f.wanted ? "Wanted" : ""].filter(Boolean).join(" · ");
  }

  handle(action: ShelfAction): boolean {
    if (!this.opened) return false;
    const spec = this.spec;
    const figs = this.pageFigures();
    const cols = spec?.cols ?? 1;
    const move = (delta: number) => {
      const next = this.index + delta;
      if (next >= 0 && next < figs.length) {
        this.index = next;
        this.render();
      }
    };
    switch (action) {
      case "up":
        move(-cols);
        return true;
      case "down":
        move(cols);
        return true;
      case "left":
        if (this.index % cols === 0) {
          if (this.page > 0) {
            this.page--;
            this.index = Math.min(this.pageFigures().length - 1, this.index + cols - 1);
            this.render();
          }
        } else move(-1);
        return true;
      case "right":
        if (this.index % cols === cols - 1 || this.index === figs.length - 1) {
          if (this.page < this.pageCount() - 1) {
            this.page++;
            this.index = Math.min(this.pageFigures().length - 1, this.index - (this.index % cols));
            this.render();
          }
        } else move(1);
        return true;
      case "confirm": {
        const f = this.selected();
        if (f) this.hooks.onFigure(f, this);
        return true;
      }
      case "context":
        this.hooks.onFilters(this);
        return true;
      case "back":
        this.close();
        this.hooks.onClose();
        return true;
    }
    return false;
  }

  /** After the menu changes a figure's state, redraw without losing the place. */
  async refresh(): Promise<void> {
    await this.reload(true);
    if (this.index >= this.pageFigures().length) this.index = Math.max(0, this.pageFigures().length - 1);
    this.render();
  }

  async setFilter(filter: ToyShelfFilter): Promise<void> {
    this.filter = { ...filter };
    await this.reload();
  }
}

export { PLATFORM_NAMES as TOY_PLATFORM_NAMES };
