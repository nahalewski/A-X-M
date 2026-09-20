/**
 * Full-screen image grid, nine across, for picking an avatar or a piece of artwork.
 * Rows scroll so any number of choices fits; the cursor moves with the D-pad, A
 * picks, B cancels. Drives through the same external-handler hook as the other
 * overlays, so the menu underneath never sees the input.
 */

export interface GridChoice {
  id: string;
  imageUrl: string;
  label?: string;
}

export type GridAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context";

const COLUMNS = 9;

export class GridPicker {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private gridEl: HTMLElement;
  private statusEl: HTMLElement;
  private choices: GridChoice[] = [];
  private cursor = 0;
  private open = false;
  private onPick: (choice: GridChoice) => void = () => {};
  private onCancel: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.titleEl = document.createElement("div");
    this.titleEl.className = "grid-title";
    this.gridEl = document.createElement("div");
    this.gridEl.className = "grid-cells";
    this.statusEl = document.createElement("div");
    this.statusEl.className = "grid-status";
    root.append(this.titleEl, this.gridEl, this.statusEl);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(title: string, choices: GridChoice[], onPick: (c: GridChoice) => void, onCancel: () => void): void {
    this.choices = choices;
    this.cursor = 0;
    this.onPick = onPick;
    this.onCancel = onCancel;
    this.open = true;
    this.titleEl.textContent = title;
    this.root.classList.remove("hidden");
    this.render();
  }

  /** Swap in more choices while open - used as lookups land one by one. */
  setChoices(choices: GridChoice[], status?: string): void {
    this.choices = choices;
    if (this.cursor >= choices.length) this.cursor = Math.max(0, choices.length - 1);
    if (status !== undefined) this.statusEl.textContent = status;
    this.render();
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  close(): void {
    this.open = false;
    this.root.classList.add("hidden");
    this.gridEl.innerHTML = "";
    this.statusEl.textContent = "";
  }

  handle(action: GridAction): boolean {
    if (!this.open) return false;
    const n = this.choices.length;
    switch (action) {
      case "left":
        if (n) this.cursor = (this.cursor + n - 1) % n;
        break;
      case "right":
        if (n) this.cursor = (this.cursor + 1) % n;
        break;
      case "up":
        if (this.cursor - COLUMNS >= 0) this.cursor -= COLUMNS;
        break;
      case "down":
        if (this.cursor + COLUMNS < n) this.cursor += COLUMNS;
        break;
      case "confirm": {
        const choice = this.choices[this.cursor];
        if (choice) {
          this.close();
          this.onPick(choice);
        }
        return true;
      }
      case "back":
        this.close();
        this.onCancel();
        return true;
      default:
        return true;
    }
    this.render();
    return true;
  }

  private render(): void {
    this.gridEl.innerHTML = "";
    this.choices.forEach((choice, i) => {
      const cell = document.createElement("div");
      cell.className = "grid-cell" + (i === this.cursor ? " selected" : "");
      const img = document.createElement("img");
      img.src = choice.imageUrl;
      img.loading = "lazy";
      img.alt = choice.label ?? "";
      img.addEventListener("error", () => cell.classList.add("broken"));
      cell.appendChild(img);
      if (choice.label) {
        const label = document.createElement("div");
        label.className = "grid-label";
        label.textContent = choice.label;
        cell.appendChild(label);
      }
      this.gridEl.appendChild(cell);
      if (i === this.cursor) cell.scrollIntoView({ block: "nearest" });
    });
    if (this.choices.length === 0 && !this.statusEl.textContent) this.statusEl.textContent = "Nothing to choose from";
  }
}
