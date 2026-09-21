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

import { GhostSprite, GhostSounds } from "./ghostSprite";

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

/**
 * A card in Ghost's bubble: a picture, a name, a line of text and choices the
 * user can pick with the d-pad or by voice. Toybox detections are the first
 * user; anything else (an update, a trophy, a controller) can show one too.
 */
export interface GhostCardChoice {
  id: string;
  label: string;
  hint?: string;
  image?: string;
}

export interface GhostCard {
  id: string;
  title?: string;
  subtitle?: string;
  message: string;
  image?: { src: string; fit: "contain" | "cover"; fallbacks?: string[] };
  choices?: GhostCardChoice[];
  /** The choice a plain "yes" / "play it" means, when there is one. */
  primary?: string;
  /** What the menu wants to remember about this card (the Toybox figure, say). */
  context?: unknown;
  onChoice?: (choiceId: string, via: "controller" | "voice") => void;
  onDismiss?: (reason: "back" | "voice" | "timeout" | "replaced" | "closed") => void;
  /** Closes itself after this long with no interaction. */
  autoDismissMs?: number;
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
  private cardEl: HTMLElement;
  private card: GhostCard | null = null;
  private cardIndex = 0;
  private cardTimer = 0;
  private pendingCard: { card: GhostCard; line?: string } | null = null;
  private onCardOpen: (open: boolean) => void = () => {};
  private speechQueue: string[] = [];
  private spokeUntil = 0;

  constructor(parent: HTMLElement, sounds?: GhostSounds) {
    this.root = document.createElement("div");
    this.root.id = "ghost";
    this.root.className = "hidden";
    this.sprite = new GhostSprite(sounds);
    this.root.appendChild(this.sprite.el);
    this.bubble = document.createElement("div");
    this.bubble.className = "ghost-bubble";
    this.heardEl = document.createElement("div");
    this.heardEl.className = "ghost-heard";
    this.replyEl = document.createElement("div");
    this.replyEl.className = "ghost-reply";
    this.stateEl = document.createElement("div");
    this.stateEl.className = "ghost-state";
    this.cardEl = document.createElement("div");
    this.cardEl.className = "ghost-card hidden";
    this.bubble.append(this.cardEl, this.stateEl, this.heardEl, this.replyEl);
    this.root.appendChild(this.bubble);
    parent.appendChild(this.root);
  }

  setCommands(provider: () => Command[]): void {
    this.commands = provider;
  }

  setOnStatus(cb: (text: string) => void): void {
    this.onStatus = cb;
  }

  /** Fires when a card with choices opens (the menu routes the d-pad here) and when it closes. */
  setOnCardOpen(cb: (open: boolean) => void): void {
    this.onCardOpen = cb;
  }

  currentCard(): GhostCard | null {
    return this.card;
  }

  /**
   * Shows a card, saying `line` in Ghost's voice. If Ghost is mid-sentence the
   * card waits its turn rather than stacking on top of what is being said.
   */
  showCard(card: GhostCard, line?: string): void {
    // The card itself shows straight away - there is one bubble, so nothing stacks;
    // only the spoken line waits its turn behind whatever Ghost is saying.
    const replacing = !!this.card && this.card.id !== card.id;
    if (replacing) this.card?.onDismiss?.("replaced");
    const sameFigure = !!this.card && this.card.id === card.id;
    this.card = card;
    this.cardIndex = 0;
    clearTimeout(this.cardTimer);
    clearTimeout(this.hideTimer);
    this.root.classList.remove("hidden");
    this.root.classList.add("card");
    this.sprite.start();
    this.sprite.setMood("happy");
    this.heardEl.textContent = "";
    this.replyEl.textContent = "";
    this.stateEl.textContent = "";
    this.renderCard(!sameFigure);
    if (line) this.say(line);
    this.onCardOpen(true);
    if (card.autoDismissMs) this.cardTimer = window.setTimeout(() => this.closeCard("timeout"), card.autoDismissMs);
  }

  /** Changes what the open card says without rebuilding it (a figure removed, a new one placed). */
  updateCard(patch: Partial<GhostCard>, line?: string): void {
    if (!this.card) return;
    const imageChanged = !!patch.image && patch.image.src !== this.card.image?.src;
    this.card = { ...this.card, ...patch };
    if (patch.choices) this.cardIndex = Math.min(this.cardIndex, Math.max(0, patch.choices.length - 1));
    this.renderCard(imageChanged);
    if (line) this.say(line);
    if (this.card.autoDismissMs) {
      clearTimeout(this.cardTimer);
      this.cardTimer = window.setTimeout(() => this.closeCard("timeout"), this.card.autoDismissMs);
    }
  }

  /** A quiet status line under the card ("Spyro removed."). */
  setCardState(text: string): void {
    if (this.card) this.stateEl.textContent = text;
  }

  closeCard(reason: "back" | "voice" | "timeout" | "replaced" | "closed" = "closed"): void {
    if (!this.card) return;
    const card = this.card;
    this.card = null;
    clearTimeout(this.cardTimer);
    this.cardEl.classList.add("hidden");
    this.cardEl.innerHTML = "";
    this.root.classList.remove("card");
    this.onCardOpen(false);
    card.onDismiss?.(reason);
    if (!this.awake && !this.speaking) this.sleep(400);
    this.showPendingCard();
  }

  /** The d-pad on an open card: up / down choose, confirm picks, back dismisses. */
  handleCardAction(action: string): boolean {
    const card = this.card;
    if (!card) return false;
    const n = card.choices?.length ?? 0;
    if (action === "up" || action === "down") {
      if (n === 0) return true;
      this.cardIndex = (this.cardIndex + (action === "up" ? -1 : 1) + n) % n;
      this.renderCard(false);
      return true;
    }
    if (action === "confirm") {
      const choice = card.choices?.[this.cardIndex] ?? (card.primary ? { id: card.primary } : null);
      if (choice) this.pick(choice.id, "controller");
      return true;
    }
    if (action === "back") {
      this.closeCard("back");
      return true;
    }
    if (action === "context") {
      card.onChoice?.("__more__", "controller");
      return true;
    }
    return false;
  }

  private pick(id: string, via: "controller" | "voice"): void {
    const card = this.card;
    if (!card) return;
    this.sprite.setMood("happy");
    card.onChoice?.(id, via);
  }

  private showPendingCard(): void {
    const next = this.pendingCard;
    if (!next) return;
    this.pendingCard = null;
    this.showCard(next.card, next.line);
  }

  private renderCard(animateImage: boolean): void {
    const card = this.card;
    if (!card) return;
    this.cardEl.classList.remove("hidden");
    const wasEmpty = !this.cardEl.firstChild;
    if (wasEmpty) this.cardEl.classList.add("enter");
    this.cardEl.innerHTML = "";
    if (card.image) {
      const wrap = document.createElement("div");
      wrap.className = `ghost-card-art ${card.image.fit}${animateImage ? " swap" : ""}`;
      const img = document.createElement("img");
      img.draggable = false;
      const chain = [card.image.src, ...(card.image.fallbacks ?? [])];
      let i = 0;
      img.onerror = () => {
        i++;
        if (i < chain.length) img.src = chain[i];
        else img.remove();
      };
      img.src = chain[0];
      wrap.appendChild(img);
      this.cardEl.appendChild(wrap);
    }
    if (card.title) {
      const t = document.createElement("div");
      t.className = "ghost-card-title";
      t.textContent = card.title;
      this.cardEl.appendChild(t);
    }
    if (card.subtitle) {
      const st = document.createElement("div");
      st.className = "ghost-card-subtitle";
      st.textContent = card.subtitle;
      this.cardEl.appendChild(st);
    }
    const m = document.createElement("div");
    m.className = "ghost-card-message";
    m.textContent = card.message;
    this.cardEl.appendChild(m);
    if (card.choices?.length) {
      const list = document.createElement("div");
      list.className = "ghost-card-choices";
      card.choices.forEach((c, i) => {
        const row = document.createElement("div");
        row.className = `ghost-card-choice${i === this.cardIndex ? " selected" : ""}`;
        if (c.image) {
          const ci = document.createElement("img");
          ci.src = c.image;
          ci.draggable = false;
          ci.onerror = () => ci.remove();
          row.appendChild(ci);
        }
        const label = document.createElement("span");
        label.textContent = c.label;
        row.appendChild(label);
        if (c.hint) {
          const h = document.createElement("small");
          h.textContent = c.hint;
          row.appendChild(h);
        }
        list.appendChild(row);
      });
      this.cardEl.appendChild(list);
    }
    if (wasEmpty) requestAnimationFrame(() => this.cardEl.classList.remove("enter"));
  }

  /**
   * What a sentence means while a card is up: "yes" / "play it" is the primary
   * choice, "not now" dismisses, "the second one" is an ordinal, and "play giants"
   * matches a choice by its words. Null means: not about the card, try the
   * global commands.
   */
  private matchCard(text: string): { id: string } | "dismiss" | null {
    const card = this.card;
    if (!card) return null;
    const t = normalise(text);
    const choices = card.choices ?? [];
    if (/^(no|nope|not now|no thanks|dismiss|cancel|never mind|nevermind|later|go away|close)\b/.test(t) || /\b(not now|never mind|no thanks)\b/.test(t)) return "dismiss";
    const ordinals: [RegExp, number][] = [
      [/\b(first|1st|one|number one|top)\b/, 0],
      [/\b(second|2nd|two|number two)\b/, 1],
      [/\b(third|3rd|three|number three)\b/, 2],
      [/\b(fourth|4th|four|number four)\b/, 3],
      [/\b(fifth|5th|five)\b/, 4],
    ];
    // "not that one, the first one": the last ordinal said wins.
    let ordinal: number | null = null;
    let lastPos = -1;
    for (const [re, i] of ordinals) {
      const m = t.match(re);
      if (m && m.index !== undefined && m.index > lastPos && i < choices.length) {
        lastPos = m.index;
        ordinal = i;
      }
    }
    if (/\blast\b/.test(t) && choices.length) ordinal = choices.length - 1;
    if (ordinal !== null) return { id: choices[ordinal].id };
    // A choice by name: the words said (minus verbs / filler) should all belong to one label.
    const said = t.replace(/\b(play|launch|start|open|run|go|to|the|it|that|one|yes|please|ghost|lets|let s|game)\b/g, " ").split(/\s+/).filter((w) => w.length > 1);
    if (said.length) {
      let best: { id: string; score: number } | null = null;
      for (const c of choices) {
        const words = normalise(c.label).split(" ").filter((w) => w.length > 1);
        const hits = said.filter((w) => words.some((x) => similar(w, x))).length;
        if (hits === 0) continue;
        const precision = hits / said.length;
        const coverage = hits / Math.max(1, words.length);
        const score = precision + coverage * 0.5;
        if (precision >= 0.99 || coverage >= 0.6) if (!best || score > best.score) best = { id: c.id, score };
      }
      if (best) return { id: best.id };
    }
    if (/^(yes|yeah|yep|yup|sure|ok|okay|play it|do it|launch it|go ahead|resume|start it|go for it|please)\b/.test(t) || /\b(play it|launch it|do it|go ahead)\b/.test(t)) {
      if (card.primary) return { id: card.primary };
      if (choices.length === 1) return { id: choices[0].id };
      if (choices.length) return { id: choices[this.cardIndex].id };
    }
    return null;
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
    } else if (event === "partial" || event === "final") {
      // Ghost must not answer himself: while his voice is playing (and for a moment
      // after) whatever the microphone hears is him, not the user.
      if (this.speaking || Date.now() < this.spokeUntil) return;
    }
    if (event === "partial") {
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
      if (this.card) return; // a card keeps Ghost on screen until it is answered
      this.root.classList.add("hidden");
      // Off screen, so stop animating rather than burning a frame budget on it.
      this.sprite.setMood("idle");
      this.sprite.stop();
    }, delay);
  }

  private onUtterance(text: string): void {
    const lower = text.toLowerCase();
    // With a card asking a question, the answer doesn't need "hey ghost" first.
    if (!this.awake && this.card) {
      const stripped = lower.replace(/\b(hey|okay|hi) (ghost|goes)\b/g, "").trim();
      const hit = this.matchCard(stripped);
      if (hit === "dismiss") {
        this.heardEl.textContent = stripped;
        this.closeCard("voice");
        return;
      }
      if (hit) {
        this.heardEl.textContent = stripped;
        this.pick(hit.id, "voice");
        return;
      }
      // Not about the card: the usual wake-word rule applies.
    }
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
    if (this.card) {
      const hit = this.matchCard(text);
      if (hit === "dismiss") {
        this.say("Okay.");
        this.closeCard("voice");
        this.sleep(1500);
        return;
      }
      if (hit) {
        this.awake = false;
        this.pick(hit.id, "voice");
        return;
      }
    }
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

  /** Says a line without waking the command window: announcements ("Spyro detected."). */
  announce(text: string): void {
    clearTimeout(this.hideTimer);
    this.root.classList.remove("hidden");
    this.sprite.start();
    this.say(text);
    if (!this.speaker || !this.prefs.voiceReplies) this.hideTimer = window.setTimeout(() => { if (!this.card && !this.awake) this.root.classList.add("hidden"); }, 3500);
  }

  private say(reply: string): void {
    this.sprite.start();
    this.stateEl.textContent = "";
    this.replyEl.textContent = reply;
    if (!this.prefs.voiceReplies || !this.speaker) return;
    if (this.speaking) {
      this.speechQueue.push(reply);
      return;
    }
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
        this.spokeUntil = Date.now() + 900;
        this.root.classList.remove("speaking");
        if (this.sprite.currentMood() === "speaking") this.sprite.setMood("idle");
        const next = this.speechQueue.shift();
        if (next) {
          this.say(next);
          return;
        }
        if (this.pendingCard) {
          this.showPendingCard();
          return;
        }
        if (!this.awake && !this.card) {
          this.onAwake(false);
          clearTimeout(this.hideTimer);
          this.hideTimer = window.setTimeout(() => this.root.classList.add("hidden"), 1800);
        } else if (!this.awake) this.onAwake(false);
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
