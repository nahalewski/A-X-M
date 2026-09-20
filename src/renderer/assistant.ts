/**
 * Ghost - the voice assistant.
 *
 * Speech arrives as text from the hidden voice window (Vosk, offline - see
 * src/main/assistant.ts). Idle, it only watches for the wake phrase ("hey ghost"); once it
 * hears it, the Ghost floats in with its chat bubble, the next sentence is taken as
 * a command, shown as text in the bubble, and the reply is written beneath it (and
 * spoken, if voice replies are on). Commands are matched against what the menu
 * registers - games, playlists, columns, settings - with forgiving matching, so
 * "launch batman arkham city" finds "Batman™ Arkham City GOTY".
 *
 * Nothing here knows how to launch anything: the menu hands in a list of
 * `Command`s and the assistant picks the best one.
 *
 * His body is a sprite (see ghostSprite.ts) and his mood is part of the reply: the
 * eye runs the colour wheel while he is listening, he spins a full turn when a
 * command lands, and the eye ramps to red when he can't place what was said.
 */

import { GhostSprite } from "./ghostSprite";

export interface Command {
  /** What the user might say, e.g. "launch", "play", "open", "go to". */
  verbs: string[];
  /** The thing's name as the user might say it. */
  name: string;
  /** Spoken back on success, e.g. "Launching Batman Arkham City". */
  reply: string;
  run: () => void | Promise<void>;
  /** Higher wins ties, e.g. games over settings when both match a verb. */
  weight?: number;
}

export interface AssistantPrefs {
  enabled: boolean;
  wakeWord: boolean;
  voiceReplies: boolean;
  bubbleSize: "small" | "medium" | "large";
  micId: string;
}

const WAKE = [/\bhey ghost\b/, /\bhey goes\b/, /\bhey ghosts\b/, /\ba ghost\b/, /\bokay ghost\b/, /\bhi ghost\b/];
const COMMAND_WINDOW_MS = 9000;

export class Assistant {
  private root: HTMLElement;
  private sprite: GhostSprite;
  private bubble: HTMLElement;
  private heardEl: HTMLElement;
  private replyEl: HTMLElement;
  private stateEl: HTMLElement;
  private listening = false;
  private commands: () => Command[] = () => [];
  private prefs: AssistantPrefs = { enabled: false, wakeWord: true, voiceReplies: true, bubbleSize: "medium", micId: "" };
  private awake = false;
  private awakeTimer = 0;
  private hideTimer = 0;
  private lastPartial = "";
  private onStatus: (text: string) => void = () => {};
  /** Plays a reply in Ghost's cloned voice; resolves when it has finished (or couldn't). */
  private speaker: ((text: string) => Promise<void>) | null = null;
  private onAwake: (awake: boolean) => void = () => {};
  private speaking = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "ghost";
    this.root.className = "hidden";
    this.sprite = new GhostSprite();
    this.root.appendChild(this.sprite.el);
    this.bubble = document.createElement("div");
    this.bubble.className = "ghost-bubble";
    this.heardEl = document.createElement("div");
    this.heardEl.className = "ghost-heard";
    this.replyEl = document.createElement("div");
    this.replyEl.className = "ghost-reply";
    this.stateEl = document.createElement("div");
    this.stateEl.className = "ghost-state";
    this.bubble.append(this.stateEl, this.heardEl, this.replyEl);
    this.root.appendChild(this.bubble);
    parent.appendChild(this.root);
  }

  setCommands(provider: () => Command[]): void {
    this.commands = provider;
  }

  setOnStatus(cb: (text: string) => void): void {
    this.onStatus = cb;
  }

  setSpeaker(fn: ((text: string) => Promise<void>) | null): void {
    this.speaker = fn;
  }

  /** Fires with true while Ghost is awake or speaking (music ducks), false when done. */
  setOnAwake(cb: (awake: boolean) => void): void {
    this.onAwake = cb;
  }

  isAwake(): boolean {
    return this.awake || this.speaking;
  }

  /** Says a line right now (the settings "Hear it" row), showing the bubble for it. */
  sayNow(text: string): void {
    clearTimeout(this.hideTimer);
    this.root.classList.remove("hidden");
    this.sprite.start();
    this.heardEl.textContent = "";
    this.say(text);
    if (!this.speaker || !this.prefs.voiceReplies) this.hideTimer = window.setTimeout(() => this.root.classList.add("hidden"), 4000);
  }

  isListening(): boolean {
    return this.listening;
  }

  setPrefs(prefs: AssistantPrefs): void {
    this.prefs = prefs;
    this.root.dataset.size = prefs.bubbleSize;
    if (!prefs.enabled) this.stop();
  }

  /** Wired to the voice window's messages: status / ready / partial / final / error. */
  onVoice(event: string, payload: unknown): void {
    if (event === "status") this.onStatus(String(payload));
    else if (event === "ready") {
      this.listening = true;
      this.onStatus(this.prefs.wakeWord ? 'Ghost is listening for "hey ghost"' : "Ghost is ready");
    } else if (event === "error") {
      this.listening = false;
      this.onStatus(`Ghost couldn't start: ${String(payload)}`);
    } else if (event === "partial") {
      const partial = String(payload);
      if (partial && partial !== this.lastPartial) {
        this.lastPartial = partial;
        if (!this.awake && this.prefs.wakeWord && WAKE.some((w) => w.test(partial))) this.wake();
        else if (this.awake) this.heardEl.textContent = partial;
      }
    } else if (event === "final") this.onUtterance(String(payload));
  }

  stop(): void {
    this.listening = false;
    this.sleep();
  }

  /** Wakes without the wake word (a button, say). */
  wake(): void {
    if (!this.listening) return;
    this.awake = true;
    this.lastPartial = "";
    clearTimeout(this.hideTimer);
    this.root.classList.remove("hidden");
    this.root.classList.add("awake");
    this.sprite.start();
    this.sprite.setMood("listening");
    this.onAwake(true);
    this.stateEl.textContent = "Listening…";
    this.heardEl.textContent = "";
    this.replyEl.textContent = "";
    clearTimeout(this.awakeTimer);
    this.awakeTimer = window.setTimeout(() => {
      if (this.awake) {
        this.sprite.setMood("error");
        this.say("I didn't catch that.");
        this.sleep(2500);
      }
    }, COMMAND_WINDOW_MS);
  }

  private sleep(delay = 0): void {
    this.awake = false;
    if (!this.speaking) this.onAwake(false);
    clearTimeout(this.awakeTimer);
    this.root.classList.remove("awake");
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.root.classList.add("hidden");
      // Off screen, so stop animating rather than burning a frame budget on it.
      this.sprite.setMood("idle");
      this.sprite.stop();
    }, delay);
  }

  private onUtterance(text: string): void {
    const lower = text.toLowerCase();
    if (!this.awake) {
      if (this.prefs.wakeWord && WAKE.some((w) => w.test(lower))) {
        this.wake();
        // "hey ghost launch batman" in one breath: run the rest straight away.
        const rest = lower.replace(/.*\b(hey|okay|hi|a) (ghost|goes|ghosts)\b/, "").trim();
        if (rest.length > 2) this.handleCommand(rest);
      }
      return;
    }
    this.handleCommand(lower.replace(/\b(hey|okay|hi) (ghost|goes)\b/g, "").trim());
  }

  private handleCommand(text: string): void {
    if (!text) return;
    this.heardEl.textContent = text;
    clearTimeout(this.awakeTimer);
    this.sprite.setMood("thinking");
    const best = this.match(text);
    if (!best) {
      // Nothing matched. Ghost unfolds into battle mode and says his line; the
      // milder red-eye shake stays for "I didn't catch that", which is a different
      // failure - not hearing, rather than being asked for something impossible.
      this.sprite.setMood("battle");
      this.say("Error. You have given an unlawful command. Battle mode engaged.");
      // Long enough for the transform to unfold, hold and fold back down.
      this.sleep(4600);
      return;
    }
    // A command that landed is worth a full turn.
    this.sprite.setMood("happy");
    this.say(best.reply);
    this.sleep(2600);
    void best.run();
  }

  private say(reply: string): void {
    this.sprite.start();
    this.stateEl.textContent = "";
    this.replyEl.textContent = reply;
    if (!this.prefs.voiceReplies || !this.speaker) return;
    // Ghost has one voice - the cloned one. Without the engine it answers in text only.
    this.speaking = true;
    this.onAwake(true);
    clearTimeout(this.hideTimer);
    this.root.classList.add("speaking");
    // Only take over the mood if nothing louder is playing out.
    const busy = this.sprite.currentMood();
    if (busy !== "happy" && busy !== "error" && busy !== "battle") {
      this.sprite.setMood("speaking");
    }
    this.speaker(reply)
      .catch(() => {})
      .finally(() => {
        this.speaking = false;
        this.root.classList.remove("speaking");
        if (this.sprite.currentMood() === "speaking") this.sprite.setMood("idle");
        if (!this.awake) {
          this.onAwake(false);
          clearTimeout(this.hideTimer);
          this.hideTimer = window.setTimeout(() => this.root.classList.add("hidden"), 1800);
        }
      });
  }


  /**
   * Verb + fuzzy name match. Speech drops words and mishears a few, so a command
   * scores on how much of its name was said (coverage) and on how much of what was
   * said belongs to its name (precision): "launch the batman game" should pick
   * Batman: Arkham City over the Game column, and "help" alone is a whole command.
   */
  private match(text: string): Command | null {
    const spoken = normalise(text);
    const words = spoken.split(" ").filter(Boolean);
    let best: { cmd: Command; score: number } | null = null;
    for (const cmd of this.commands()) {
      const verb = cmd.verbs.find((v) => spoken === v || spoken.startsWith(v + " ") || spoken.includes(" " + v + " ") || spoken.endsWith(" " + v));
      const nameWords = normalise(cmd.name).split(" ").filter((w) => w.length > 1);
      if (nameWords.length === 0) continue;
      // What was said besides the verb; filler like "game" / "playlist" only counts
      // when it is all that is left ("go to game" means the Game column).
      let rest = verb ? spoken.replace(verb, " ").split(" ").filter(Boolean) : words;
      const content = rest.filter((w) => !FILLER.has(w));
      if (content.length > 0) rest = content;
      let hits = 0;
      for (const w of nameWords) if (words.some((x) => similar(x, w))) hits++;
      const coverage = hits / nameWords.length;
      const precision = rest.length ? rest.filter((x) => nameWords.some((w) => similar(x, w))).length / rest.length : 0;
      const verbOnly = !!verb && rest.length === 0;
      const ok =
        verbOnly ||
        (verb && coverage >= 0.5) ||
        (verb && hits > 0 && precision >= 0.99) ||
        coverage >= 0.9 ||
        (hits > 0 && precision >= 0.99 && rest.some((x) => x.length >= 5));
      if (!ok) continue;
      const score = (verb ? 1 : 0) + (verbOnly ? 1 : coverage) + precision * 0.5 + (cmd.weight ?? 0);
      if (!best || score > best.score) best = { cmd, score };
    }
    return best?.cmd ?? null;
  }
}

const FILLER = new Set(["game", "games", "playlist", "song", "track", "music", "setting", "settings", "please", "ghost", "my", "to", "in", "on", "up", "now", "column", "menu", "page", "screen", "disc", "storage"]);

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[™®©:'’\-_.]/g, " ")
    .replace(/\b(the|of|a|an|edition|goty|remastered|definitive|complete|enhanced)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  // Levenshtein within 1 for short words, 2 for longer.
  const limit = Math.max(a.length, b.length) > 6 ? 2 : 1;
  return levenshtein(a, b) <= limit;
}

function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
