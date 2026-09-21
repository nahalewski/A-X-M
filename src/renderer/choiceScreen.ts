/**
 * The PS3's plain choice screen: a line of instruction at the top, a short list
 * centred on the screen, a note along the bottom, and "Enter / Back" hints. Used
 * where the console used it - picking which memory card to create - rather than
 * the sidebar, which is for actions on a row.
 */

export type ChoiceAction = "up" | "down" | "confirm" | "back";

export interface ScreenChoice {
  id: string;
  label: string;
  /** Shown along the bottom while this choice is highlighted. */
  note?: string;
}

export class ChoiceScreen {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private listEl: HTMLElement;
  private noteEl: HTMLElement;
  private choices: ScreenChoice[] = [];
  private cursor = 0;
  private open = false;
  private onPick: (c: ScreenChoice) => void = () => {};
  private onCancel: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.titleEl = document.createElement("div");
    this.titleEl.className = "choice-title";
    this.listEl = document.createElement("div");
    this.listEl.className = "choice-list";
    this.noteEl = document.createElement("div");
    this.noteEl.className = "choice-note";
    const hints = document.createElement("div");
    hints.className = "choice-hints";
    hints.innerHTML = '<span><b class="btn-a">A</b> Enter</span><span><b class="btn-b">B</b> Back</span>';
    root.append(this.titleEl, this.listEl, this.noteEl, hints);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(title: string, choices: ScreenChoice[], onPick: (c: ScreenChoice) => void, onCancel: () => void): void {
    this.choices = choices;
    this.cursor = 0;
    this.onPick = onPick;
    this.onCancel = onCancel;
    this.open = true;
    this.titleEl.textContent = title;
    this.root.classList.remove("hidden");
    this.render();
  }

  close(): void {
    this.open = false;
    this.root.classList.add("hidden");
  }

  handle(action: ChoiceAction): boolean {
    if (!this.open) return false;
    if (action === "up" || action === "down") {
      const n = this.choices.length;
      this.cursor = (this.cursor + (action === "up" ? n - 1 : 1)) % n;
      this.render();
    } else if (action === "confirm") {
      const c = this.choices[this.cursor];
      this.close();
      if (c) this.onPick(c);
    } else if (action === "back") {
      this.close();
      this.onCancel();
    }
    return true;
  }

  private render(): void {
    this.listEl.innerHTML = "";
    this.choices.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = `choice-row${i === this.cursor ? " selected" : ""}`;
      row.textContent = c.label;
      this.listEl.appendChild(row);
    });
    this.noteEl.textContent = this.choices[this.cursor]?.note ?? "";
  }
}
