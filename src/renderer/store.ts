import type { StoreItem, RetroPlatform } from "./types";

/**
 * The Store, laid out the way a console store page is: a tab strip along the
 * top, a page for the selected thing - its name, what runs it, a row of facts,
 * one big button - over its wide art, and a strip of tiles underneath to move
 * through. No account, no prices: this is your own shelf on drive N and the
 * emulators that play it, with A-X-M's own mark in the corner.
 *
 * Input: left / right walk the tiles (or the tabs when they have focus), up /
 * down move between the tab strip, the button and the tiles, confirm presses
 * the button, triangle asks for the item's information, back leaves.
 */

export type StoreAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context";

export interface StoreHooks {
  onClose(): void;
  onInstall(item: StoreItem, store: StoreApp): void;
  onPlay(item: StoreItem, store: StoreApp): void;
  onInfo(item: StoreItem, store: StoreApp): void;
  onPrepare(item: StoreItem, store: StoreApp): void;
}

const PLATFORM_NAMES: Record<RetroPlatform, string> = { ps5: "PlayStation 5", ps4: "PlayStation 4", ps3: "PlayStation 3", ps2: "PlayStation 2", ps1: "PlayStation", psp: "PSP", switch: "Nintendo Switch" };
const TABS: { id: string; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "emulators", label: "Emulators" },
  { id: "ps5", label: "PS5" },
  { id: "ps4", label: "PS4" },
  { id: "ps3", label: "PS3" },
  { id: "ps2", label: "PS2" },
  { id: "ps1", label: "PS1" },
  { id: "psp", label: "PSP" },
  { id: "switch", label: "Switch" },
];

const fmtSize = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${Math.round(b / 1048576)} MB` : b > 0 ? `${Math.round(b / 1024)} KB` : "");

export class StoreApp {
  private root: HTMLElement;
  private items: StoreItem[] = [];
  private tab = 0;
  private index = 0;
  private zone: "tabs" | "action" | "tiles" = "tiles";
  private opened = false;
  private busy = new Set<string>();

  constructor(parent: HTMLElement, private hooks: StoreHooks) {
    this.root = document.createElement("div");
    this.root.id = "store-app";
    this.root.className = "hidden";
    this.root.innerHTML = `
      <div class="store-top">
        <div class="store-brand"><img src="assets/icons/app.png" alt="" /><span>Store</span></div>
        <div class="store-tabs"></div>
        <div class="store-clock"></div>
      </div>
      <div class="store-hero">
        <div class="store-hero-art"></div>
        <div class="store-hero-fade"></div>
        <div class="store-card">
          <div class="store-card-title"></div>
          <div class="store-card-by"></div>
          <div class="store-card-tags"></div>
          <div class="store-card-meta"></div>
          <div class="store-card-price"></div>
          <div class="store-card-actions"><button class="store-btn"></button><span class="store-heart"><img src="assets/store/icon-heart.png" alt="" /></span></div>
        </div>
        <div class="store-facts"></div>
      </div>
      <div class="store-row-title"></div>
      <div class="store-tiles"></div>
      <div class="store-empty hidden"></div>`;
    parent.appendChild(this.root);
    window.axm.onStoreArt((u) => {
      const it = this.items.find((i) => i.id === u.id);
      if (!it) return;
      if (u.iconPath) it.iconPath = u.iconPath;
      if (u.heroPath) it.heroPath = u.heroPath;
      if (this.opened) this.render();
    });
  }

  isOpen(): boolean {
    return this.opened;
  }

  async open(tab = "explore"): Promise<void> {
    this.opened = true;
    this.tab = Math.max(0, TABS.findIndex((t) => t.id === tab));
    this.index = 0;
    this.zone = "tiles";
    this.root.classList.remove("hidden");
    await this.reload();
  }

  async reload(): Promise<void> {
    this.items = await window.axm.storeCatalogue().catch(() => [] as StoreItem[]);
    if (this.index >= this.visible().length) this.index = 0;
    this.render();
  }

  close(): void {
    this.opened = false;
    this.root.classList.add("hidden");
  }

  setBusy(id: string, on: boolean): void {
    if (on) this.busy.add(id);
    else this.busy.delete(id);
    this.render();
  }

  selected(): StoreItem | null {
    return this.visible()[this.index] ?? null;
  }

  private visible(): StoreItem[] {
    const t = TABS[this.tab].id;
    if (t === "explore") {
      // The shelf's games first (newest folders first is not knowable; keep the platform order), then the emulators that are missing.
      return [...this.items.filter((i) => i.kind === "game"), ...this.items.filter((i) => i.kind === "emulator" && !i.installed)];
    }
    if (t === "emulators") return this.items.filter((i) => i.kind === "emulator");
    return this.items.filter((i) => i.kind === "game" && i.platform === t);
  }

  private buttonLabel(item: StoreItem): string {
    if (this.busy.has(item.id)) return item.kind === "emulator" ? "Installing…" : "Adding…";
    if (item.kind === "emulator") return item.installed ? "Installed" : "Install";
    if (!item.installed) return "Add to Library";
    if (item.needsPrep) return "Get Ready to Play";
    return "Play";
  }

  private render(): void {
    const tabs = this.root.querySelector(".store-tabs")!;
    tabs.innerHTML = "";
    TABS.forEach((t, i) => {
      const el = document.createElement("span");
      el.className = `store-tab${i === this.tab ? " active" : ""}${this.zone === "tabs" && i === this.tab ? " focus" : ""}`;
      el.textContent = t.label;
      tabs.appendChild(el);
    });
    (this.root.querySelector(".store-clock") as HTMLElement).textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const list = this.visible();
    const item = list[this.index] ?? null;
    const hero = this.root.querySelector(".store-hero") as HTMLElement;
    const empty = this.root.querySelector(".store-empty") as HTMLElement;
    hero.classList.toggle("hidden", !item);
    empty.classList.toggle("hidden", !!item);
    if (!item) {
      const t = TABS[this.tab];
      empty.textContent = t.id === "explore" || t.id === "emulators" ? "Nothing here yet" : `Nothing on the shelf for ${t.label} - put games in N:\\GAME\\ROMS\\${t.label === "Switch" ? "Switch" : t.label}`;
    } else {
      const art = this.root.querySelector(".store-hero-art") as HTMLElement;
      const src = item.heroPath ?? item.iconPath ?? `assets/icons/retro-${item.platform}.png`;
      art.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
      art.classList.toggle("icon", !item.heroPath && (!item.iconPath || item.iconPath.startsWith("assets/")));
      (this.root.querySelector(".store-card-title") as HTMLElement).textContent = item.name;
      (this.root.querySelector(".store-card-by") as HTMLElement).textContent = item.kind === "emulator" ? `${PLATFORM_NAMES[item.platform]} emulator` : `${PLATFORM_NAMES[item.platform]} · runs in ${item.emulatorName}`;
      const tags = this.root.querySelector(".store-card-tags") as HTMLElement;
      tags.innerHTML = "";
      for (const t of [PLATFORM_NAMES[item.platform].replace("PlayStation", "PS").replace("Nintendo ", ""), item.kind === "emulator" ? "App" : item.needsPrep ? "Disc image" : "Ready", item.installed ? "In library" : "On the shelf"]) {
        const s = document.createElement("span");
        s.textContent = t;
        tags.appendChild(s);
      }
      (this.root.querySelector(".store-card-meta") as HTMLElement).textContent = item.kind === "emulator" ? (item.installed ? item.path ?? "" : "Not installed") : [fmtSize(item.sizeBytes), item.installed ? `in ${item.libraryDir}` : "N: shelf"].filter(Boolean).join(" · ");
      (this.root.querySelector(".store-card-price") as HTMLElement).textContent = item.kind === "emulator" ? "Free · open source" : "Your collection";
      const btn = this.root.querySelector(".store-btn") as HTMLElement;
      btn.textContent = this.buttonLabel(item);
      btn.classList.toggle("focus", this.zone === "action");
      btn.classList.toggle("done", item.kind === "emulator" && item.installed);
      const facts = this.root.querySelector(".store-facts") as HTMLElement;
      facts.innerHTML = "";
      const fact = (icon: string, text: string) => {
        const f = document.createElement("div");
        f.className = "store-fact";
        f.innerHTML = `<img src="assets/store/icon-${icon}.png" alt="" /><span></span>`;
        (f.querySelector("span") as HTMLElement).textContent = text;
        facts.appendChild(f);
      };
      if (item.kind === "game") {
        fact("library", item.emulatorInstalled ? `${item.emulatorName} is installed` : `${item.emulatorName} needed - it's in the Emulators tab`);
        fact("download", item.installed ? "In your library" : `Adds to ${item.libraryDir}`);
        fact("user", "Controller supported");
        if (item.needsPrep) fact("gear", item.needsPrep);
        if (item.note) fact("bell", item.note);
      } else {
        fact("gear", item.installed ? "Ready" : "One press installs it");
        fact("library", `Plays ${PLATFORM_NAMES[item.platform]} games from the Retro column`);
        if (item.note) fact("bell", item.note);
      }
    }

    (this.root.querySelector(".store-row-title") as HTMLElement).textContent = TABS[this.tab].id === "explore" ? "On your shelf" : TABS[this.tab].id === "emulators" ? "Emulators" : `${PLATFORM_NAMES[TABS[this.tab].id as RetroPlatform]} on the shelf`;
    const tiles = this.root.querySelector(".store-tiles") as HTMLElement;
    tiles.innerHTML = "";
    list.forEach((it, i) => {
      const tile = document.createElement("div");
      tile.className = `store-tile${i === this.index ? " selected" : ""}${this.zone === "tiles" && i === this.index ? " focus" : ""}`;
      const img = document.createElement("img");
      img.src = it.iconPath ?? `assets/icons/retro-${it.platform}.png`;
      img.className = !it.iconPath || it.iconPath.startsWith("assets/") ? "placeholder" : "";
      img.draggable = false;
      const cap = document.createElement("div");
      cap.className = "store-tile-cap";
      cap.innerHTML = `<b></b><small></small>`;
      (cap.querySelector("b") as HTMLElement).textContent = it.name;
      (cap.querySelector("small") as HTMLElement).textContent = it.kind === "emulator" ? (it.installed ? "Installed" : "Install") : it.installed ? "In library" : fmtSize(it.sizeBytes) || "On the shelf";
      const badge = document.createElement("span");
      badge.className = "store-tile-badge";
      badge.textContent = PLATFORM_NAMES[it.platform].replace("PlayStation", "PS").replace("Nintendo ", "");
      tile.append(img, badge, cap);
      tiles.appendChild(tile);
    });
    const sel = tiles.children[this.index] as HTMLElement | undefined;
    sel?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  handle(action: StoreAction): boolean {
    if (!this.opened) return false;
    const list = this.visible();
    const item = list[this.index] ?? null;
    switch (action) {
      case "left":
      case "right": {
        const d = action === "left" ? -1 : 1;
        if (this.zone === "tabs") {
          this.tab = (this.tab + d + TABS.length) % TABS.length;
          this.index = 0;
        } else if (list.length) this.index = (this.index + d + list.length) % list.length;
        this.render();
        return true;
      }
      case "up":
        this.zone = this.zone === "tiles" ? (item ? "action" : "tabs") : "tabs";
        this.render();
        return true;
      case "down":
        this.zone = this.zone === "tabs" ? (item ? "action" : "tiles") : "tiles";
        this.render();
        return true;
      case "confirm":
        if (this.zone === "tabs") {
          this.zone = "tiles";
          this.render();
          return true;
        }
        if (!item) return true;
        if (this.busy.has(item.id)) return true;
        if (item.kind === "emulator") {
          if (!item.installed) this.hooks.onInstall(item, this);
          return true;
        }
        if (!item.installed) this.hooks.onInstall(item, this);
        else if (item.needsPrep) this.hooks.onPrepare(item, this);
        else this.hooks.onPlay(item, this);
        return true;
      case "context":
        if (item) this.hooks.onInfo(item, this);
        return true;
      case "back":
        if (this.zone !== "tiles") {
          this.zone = "tiles";
          this.render();
          return true;
        }
        this.close();
        this.hooks.onClose();
        return true;
    }
    return false;
  }
}

export { PLATFORM_NAMES as STORE_PLATFORM_NAMES };
