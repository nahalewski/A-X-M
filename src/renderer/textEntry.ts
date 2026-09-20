/**
 * One or more text fields with an on-screen keyboard, for a handheld with no
 * physical keys. The D-pad moves around the keyboard, A types, B backspaces, Y
 * toggles shift; the keyboard's "Next"/"Done" key advances fields and submits.
 * A real keyboard works too: keydown goes straight into the focused field.
 */

export interface TextField {
  label: string;
  value?: string;
  secret?: boolean;
}

export type EntryAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context";

const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "-"],
  ["z", "x", "c", "v", "b", "n", "m", ".", "_", "@"],
  ["SHIFT", "SPACE", "BACK", "NEXT"],
];

export class TextEntry {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private fieldsEl: HTMLElement;
  private keysEl: HTMLElement;
  private hintEl: HTMLElement;

  private fields: TextField[] = [];
  private values: string[] = [];
  private field = 0;
  private row = 1;
  private col = 0;
  private shift = false;
  private open = false;
  private onSubmit: (values: string[]) => void = () => {};
  private onCancel: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.titleEl = document.createElement("div");
    this.titleEl.className = "entry-title";
    this.fieldsEl = document.createElement("div");
    this.fieldsEl.className = "entry-fields";
    this.keysEl = document.createElement("div");
    this.keysEl.className = "entry-keys";
    this.hintEl = document.createElement("div");
    this.hintEl.className = "entry-hint";
    this.hintEl.textContent = "A type · B backspace · Y shift · Next/Done to continue";
    root.append(this.titleEl, this.fieldsEl, this.keysEl, this.hintEl);

    // Physical keyboard: characters go straight in; Enter advances; Escape is
    // handled by the menu's own key map as "back".
    document.addEventListener("keydown", (e) => {
      if (!this.open) return;
      let handled = false;
      if (e.key === "Backspace") {
        this.backspace();
        handled = true;
      } else if (e.key === "Enter") {
        this.next();
        handled = true;
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        this.type(e.key);
        handled = true;
      }
      // The menu maps letters like w/a/s/d/y to navigation; a typed character must
      // not also move the cursor. Arrows and Escape are left alone so they still
      // reach the menu and come back here as D-pad actions.
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  isOpen(): boolean {
    return this.open;
  }

  show(title: string, fields: TextField[], onSubmit: (values: string[]) => void, onCancel: () => void): void {
    this.fields = fields;
    this.values = fields.map((f) => f.value ?? "");
    this.field = 0;
    this.row = 1;
    this.col = 0;
    this.shift = false;
    this.onSubmit = onSubmit;
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

  handle(action: EntryAction): boolean {
    if (!this.open) return false;
    const rowKeys = ROWS[this.row];
    switch (action) {
      case "up":
        this.row = Math.max(0, this.row - 1);
        this.col = Math.min(this.col, ROWS[this.row].length - 1);
        break;
      case "down":
        this.row = Math.min(ROWS.length - 1, this.row + 1);
        this.col = Math.min(this.col, ROWS[this.row].length - 1);
        break;
      case "left":
        this.col = (this.col + rowKeys.length - 1) % rowKeys.length;
        break;
      case "right":
        this.col = (this.col + 1) % rowKeys.length;
        break;
      case "confirm":
        this.press(rowKeys[this.col]);
        break;
      case "back":
        if (this.values[this.field].length > 0) this.backspace();
        else {
          this.close();
          this.onCancel();
          return true;
        }
        break;
      case "context":
        this.shift = !this.shift;
        break;
    }
    this.render();
    return true;
  }

  private press(key: string): void {
    switch (key) {
      case "SHIFT":
        this.shift = !this.shift;
        break;
      case "SPACE":
        this.type(" ");
        break;
      case "BACK":
        this.backspace();
        break;
      case "NEXT":
        this.next();
        break;
      default:
        this.type(this.shift ? key.toUpperCase() : key);
        this.shift = false;
    }
  }

  private type(ch: string): void {
    this.values[this.field] += ch;
    this.render();
  }

  private backspace(): void {
    this.values[this.field] = this.values[this.field].slice(0, -1);
    this.render();
  }

  private next(): void {
    if (this.field < this.fields.length - 1) {
      this.field++;
      this.render();
      return;
    }
    this.close();
    this.onSubmit(this.values.map((v) => v.trim()));
  }

  private render(): void {
    this.fieldsEl.innerHTML = "";
    this.fields.forEach((f, i) => {
      const wrap = document.createElement("div");
      wrap.className = "entry-field" + (i === this.field ? " active" : "");
      const label = document.createElement("div");
      label.className = "entry-label";
      label.textContent = f.label;
      const value = document.createElement("div");
      value.className = "entry-value";
      const shown = f.secret ? "•".repeat(this.values[i].length) : this.values[i];
      value.textContent = shown || " ";
      if (i === this.field) value.classList.add("caret");
      wrap.append(label, value);
      this.fieldsEl.appendChild(wrap);
    });

    this.keysEl.innerHTML = "";
    ROWS.forEach((keys, r) => {
      const rowEl = document.createElement("div");
      rowEl.className = "entry-row";
      keys.forEach((k, c) => {
        const keyEl = document.createElement("div");
        const isLast = this.field === this.fields.length - 1;
        const label = k === "NEXT" ? (isLast ? "Done" : "Next") : k === "SHIFT" ? "Shift" : k === "SPACE" ? "Space" : k === "BACK" ? "⌫" : this.shift ? k.toUpperCase() : k;
        keyEl.className = "entry-key" + (r === this.row && c === this.col ? " selected" : "") + (k.length > 1 ? " wide" : "");
        if (k === "SHIFT" && this.shift) keyEl.classList.add("on");
        keyEl.textContent = label;
        rowEl.appendChild(keyEl);
      });
      this.keysEl.appendChild(rowEl);
    });
  }
}
