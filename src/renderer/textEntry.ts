/**
 * One or more text fields with an on-screen keyboard, for a handheld with no
 * physical keys. The D-pad moves around the keyboard, A types, B backspaces, Y
 * toggles shift; the keyboard's "Next"/"Done" key advances fields and submits.
 * A real keyboard works too: keydown goes straight into the focused field.
 */

import { btn } from "./xmb";

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

/** Words offered above the keys; learnt from what's typed plus the user's own terms. */
let dictionary: string[] = [];
let learned: string[] = [];
let onLearn: (words: string[]) => void = () => {};

export function setDictionary(terms: string[], learnedWords: string[], learnCallback: (words: string[]) => void): void {
  dictionary = terms;
  learned = learnedWords;
  onLearn = learnCallback;
}

export class TextEntry {
  private root: HTMLElement;
  private suggestEl: HTMLElement;
  private suggestions: string[] = [];
  /** -1 = keyboard rows; 0.. = a suggestion is highlighted. */
  private suggestIndex = -1;
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
  /** Told whenever a field is being asked for (or none, on close) - the companion keyboard follows it. */
  private onPrompt: (prompt: { title: string; label: string; value: string; secret: boolean } | null) => void = () => {};

  setOnPrompt(callback: (prompt: { title: string; label: string; value: string; secret: boolean } | null) => void): void {
    this.onPrompt = callback;
  }

  private announce(): void {
    const f = this.fields[this.field];
    if (!this.open || !f) return this.onPrompt(null);
    this.onPrompt({ title: this.titleEl.textContent ?? "", label: f.label, value: this.values[this.field] ?? "", secret: !!f.secret });
  }

  /** Text typed elsewhere (the phone) replaces the current field; done moves on. */
  setValue(text: string, done: boolean): void {
    if (!this.open) return;
    this.values[this.field] = text;
    this.render();
    if (done) this.next();
  }

  constructor(root: HTMLElement) {
    this.root = root;
    this.titleEl = document.createElement("div");
    this.titleEl.className = "entry-title";
    this.fieldsEl = document.createElement("div");
    this.fieldsEl.className = "entry-fields";
    this.suggestEl = document.createElement("div");
    this.suggestEl.className = "entry-suggest";
    this.keysEl = document.createElement("div");
    this.keysEl.className = "entry-keys";
    this.hintEl = document.createElement("div");
    this.hintEl.className = "entry-hint";
    this.hintEl.innerHTML = `${btn("a")} type · ${btn("b")} backspace · ${btn("y")} shift · Next/Done to continue`;
    root.append(this.titleEl, this.fieldsEl, this.suggestEl, this.keysEl, this.hintEl);

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
    this.announce();
  }

  close(): void {
    this.open = false;
    this.root.classList.add("hidden");
    this.onPrompt(null);
  }

  handle(action: EntryAction): boolean {
    if (!this.open) return false;
    const rowKeys = ROWS[this.row];
    // The suggestion strip sits above the top row: Up from row 0 reaches it, Down
    // returns to the keys, ◀ ▶ move along it, A inserts the word.
    if (this.suggestIndex >= 0) {
      if (action === "down") this.suggestIndex = -1;
      else if (action === "left") this.suggestIndex = (this.suggestIndex + this.suggestions.length - 1) % this.suggestions.length;
      else if (action === "right") this.suggestIndex = (this.suggestIndex + 1) % this.suggestions.length;
      else if (action === "confirm") this.acceptSuggestion(this.suggestions[this.suggestIndex]);
      else if (action === "back") this.suggestIndex = -1;
      else if (action === "up") { /* nothing above */ }
      this.render();
      return true;
    }
    switch (action) {
      case "up":
        if (this.row === 0 && this.suggestions.length > 0) this.suggestIndex = 0;
        else this.row = Math.max(0, this.row - 1);
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

  private currentWord(): string {
    return this.values[this.field].split(/\s+/).pop() ?? "";
  }

  private acceptSuggestion(word: string): void {
    const parts = this.values[this.field].split(/(\s+)/);
    parts[parts.length - 1] = word;
    this.values[this.field] = parts.join("") + " ";
    this.suggestIndex = -1;
    this.render();
  }

  private computeSuggestions(): void {
    const word = this.currentWord().toLowerCase();
    if (this.fields[this.field]?.secret || word.length < 2) {
      this.suggestions = [];
      return;
    }
    const pool = [...dictionary, ...learned];
    const seen = new Set<string>();
    this.suggestions = pool.filter((w) => {
      const k = w.toLowerCase();
      if (seen.has(k) || k === word || !k.startsWith(word)) return false;
      seen.add(k);
      return true;
    }).slice(0, 5);
    if (this.suggestIndex >= this.suggestions.length) this.suggestIndex = -1;
  }

  private learnWords(): void {
    const words = this.values.flatMap((v, i) => (this.fields[i]?.secret ? [] : v.split(/\s+/))).filter((w) => w.length >= 3);
    const fresh = words.filter((w) => !learned.includes(w) && !dictionary.includes(w));
    if (fresh.length) {
      learned = [...learned, ...fresh].slice(-300);
      onLearn(learned);
    }
  }

  private next(): void {
    if (this.field < this.fields.length - 1) {
      this.field++;
      this.render();
      this.announce();
      return;
    }
    this.close();
    this.learnWords();
    this.onSubmit(this.values.map((v) => v.trim()));
  }

  private render(): void {
    this.computeSuggestions();
    this.suggestEl.innerHTML = this.suggestions
      .map((w, i) => `<span class="entry-suggestion${i === this.suggestIndex ? " selected" : ""}">${w}</span>`)
      .join("");
    this.suggestEl.classList.toggle("hidden", this.suggestions.length === 0);
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
        keyEl.className = "entry-key" + (r === this.row && c === this.col && this.suggestIndex < 0 ? " selected" : "") + (k.length > 1 ? " wide" : "");
        if (k === "SHIFT" && this.shift) keyEl.classList.add("on");
        keyEl.textContent = label;
        rowEl.appendChild(keyEl);
      });
      this.keysEl.appendChild(rowEl);
    });
  }
}
