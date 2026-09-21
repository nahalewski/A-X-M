import type { Assistant, GhostCard, GhostCardChoice } from "./assistant";
import type { GameEntry, ToyboxDetectionEvent, ToyboxRemovalEvent, ToyboxSettings, ToyPlatform } from "./types";

/**
 * What happens between "a toy landed on a reader" and "a game is running".
 *
 * The hub in the main process turns every reader into ToyboxDetectionEvents;
 * this is the only subscriber. It resolves the figure's compatible games against
 * what A-X-M actually has installed, asks Ghost to say what it saw and to show a
 * card with the choices, and hands the pick to the menu's ordinary launch path.
 * Removal gets a grace period, a swapped figure updates the card in place, and a
 * scan while a game is running follows the in-game setting.
 */

export interface ToyboxDetectHooks {
  assistant: Assistant;
  games: () => GameEntry[];
  settings: () => ToyboxSettings;
  ghostMuted: () => boolean;
  runningGame: () => Promise<{ name: string } | null>;
  launch: (game: GameEntry) => void;
  navigateTo: (game: GameEntry) => void;
  openShelf: (figureId: string | null) => void;
  showCompatible: (event: ToyboxDetectionEvent, games: GameEntry[]) => void;
  notify: (text: string, image?: string) => void;
  /** The scan chime. */
  chime: () => void;
  lastGame: (figureId: string) => Promise<string | null>;
  setLastGame: (figureId: string, gameId: string) => void;
  identifyUnknown: (event: ToyboxDetectionEvent) => void;
  ask: (question: string, options: { label: string; run: () => void }[]) => void;
}

const PLATFORM_NAMES: Record<string, string> = {
  amiibo: "Amiibo",
  skylanders: "Skylanders",
  "disney-infinity": "Disney Infinity",
  "lego-dimensions": "LEGO Dimensions",
  generic: "Toy",
  custom: "Toy",
};

/** The toy box for each ecosystem (assets/toybox/box-*.png, from the sprite sheet), then a plain silhouette. */
export const TOY_BOXES: Record<string, string> = {
  amiibo: "assets/toybox/box-amiibo.png",
  skylanders: "assets/toybox/box-skylanders.png",
  "disney-infinity": "assets/toybox/box-disney.png",
  "lego-dimensions": "assets/toybox/box-lego.png",
};
const SILHOUETTES: Record<string, string> = {
  amiibo: "assets/toybox/silhouette-amiibo.svg",
  skylanders: "assets/toybox/silhouette-skylanders.svg",
  "disney-infinity": "assets/toybox/silhouette-infinity.svg",
  "lego-dimensions": "assets/toybox/silhouette-lego.svg",
};
const GENERIC_SILHOUETTE = "assets/toybox/silhouette-toy.svg";

const REMOVAL_GRACE_MS = 2500;

const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[™®©']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The figure's compatible games, but only the ones installed here. Records name
 * games by slug ("skylanders-giants"); when a record carries none, the ecosystem
 * and franchise decide: every Skylander works in every Skylanders game, an amiibo
 * works in Smash and in its own series' games.
 */
export function resolveInstalledGames(event: ToyboxDetectionEvent, games: GameEntry[]): GameEntry[] {
  const installed = games.filter((g) => !g.hidden);
  const bySlug = installed.map((g) => ({ g, slug: slug(g.name) }));
  const out: GameEntry[] = [];
  const add = (g: GameEntry) => {
    if (!out.includes(g)) out.push(g);
  };
  for (const id of event.compatibleGameIds) {
    const want = slug(id);
    for (const { g, slug: s } of bySlug) if (s === want || s.startsWith(want + "-") || s.includes(want)) add(g);
  }
  const contains = (...words: string[]) => bySlug.filter(({ slug: s }) => words.some((w) => s.includes(slug(w)))).map((x) => x.g);
  const version = (event.series ?? "").match(/(\d)\.0/)?.[1];
  switch (event.ecosystem) {
    case "skylanders":
      contains("skylanders", "skylander").forEach(add);
      break;
    case "disney-infinity": {
      const all = contains("disney-infinity", "infinity");
      const same = version ? all.filter((g) => slug(g.name).includes(`${version}-0`) || slug(g.name).includes(`infinity-${version}`)) : [];
      // A 2.0 figure works in 2.0 and 3.0, not in 1.0; without a version, offer them all.
      (same.length ? all.filter((g) => !/1-0|infinity-1\b/.test(slug(g.name)) || version === "1") : all).forEach(add);
      break;
    }
    case "lego-dimensions":
      contains("lego-dimensions", "dimensions").forEach(add);
      break;
    case "amiibo": {
      contains("smash-bros", "super-smash").forEach(add);
      const series = [event.series, event.franchise, event.character].filter(Boolean) as string[];
      for (const s of series) {
        const key = slug(s.replace(/^(the|super) /i, ""));
        const first = key.split("-").find((w) => w.length > 3) ?? key;
        if (first) contains(first).forEach(add);
      }
      break;
    }
  }
  return out;
}

export class ToyboxDetections {
  private current: ToyboxDetectionEvent | null = null;
  private removalTimer = 0;
  private offered: GameEntry[] = [];

  constructor(private hooks: ToyboxDetectHooks) {}

  /** Everything the card can show for this figure, in the fallback order. */
  private artChain(event: ToyboxDetectionEvent): string[] {
    const chain: string[] = [];
    if (event.artwork?.png) chain.push(event.artwork.png);
    if (event.artwork?.thumbnail && event.artwork.thumbnail !== event.artwork.png) chain.push(event.artwork.thumbnail);
    if (TOY_BOXES[event.ecosystem]) chain.push(TOY_BOXES[event.ecosystem]);
    chain.push(SILHOUETTES[event.ecosystem] ?? GENERIC_SILHOUETTE, GENERIC_SILHOUETTE);
    return chain;
  }

  private spokenName(event: ToyboxDetectionEvent): string {
    const name = event.character && event.character !== event.name ? event.character : event.name;
    const variant = event.variant && !/^(figure|character|standard|card)$/i.test(event.variant) && !name.toLowerCase().includes(event.variant.toLowerCase()) ? `${event.variant} ` : "";
    switch (event.ecosystem) {
      case "amiibo":
        return `${variant}${name} Amiibo`;
      case "lego-dimensions":
        return `${name} LEGO Dimensions tag`;
      default:
        return `${variant}${name}`;
    }
  }

  private speak(line: string): void {
    const s = this.hooks.settings();
    if (!s.speak || this.hooks.ghostMuted()) return;
    this.hooks.assistant.announce(line);
  }

  async onDetected(event: ToyboxDetectionEvent): Promise<void> {
    const s = this.hooks.settings();
    clearTimeout(this.removalTimer);
    this.hooks.chime();
    const previous = this.current;
    this.current = event;

    // A game is running: the in-game setting decides how much of this happens.
    const running = await this.hooks.runningGame().catch(() => null);
    if (running) {
      if (s.inGame === "off") return;
      const line = `${this.spokenName(event)} detected.`;
      if (s.inGame === "voice") {
        this.speak(line);
        return;
      }
      if (s.inGame === "small") {
        this.hooks.notify(`${event.name} detected`, this.artChain(event)[0]);
        if (s.speak) this.speak(line);
        return;
      }
      // "full": fall through to the card, over the game.
    }

    if (!event.figureId) {
      this.showUnknown(event);
      return;
    }

    const games = s.suggestGames ? resolveInstalledGames(event, this.hooks.games()) : [];
    this.offered = games;
    const last = s.suggestLast && games.length > 1 ? await this.hooks.lastGame(event.figureId) : null;
    const lastGame = last ? games.find((g) => g.id === last) ?? null : null;
    const who = this.spokenName(event);

    let line: string;
    let message: string;
    let choices: GhostCardChoice[];
    let primary: string | undefined;
    if (games.length === 0) {
      line = `${who} detected. I don't see any compatible games installed.`;
      message = "No compatible games found.";
      choices = [
        { id: "toybox", label: "Open Toybox" },
        { id: "compatible", label: "View Compatible Games" },
      ];
    } else if (lastGame) {
      line = `${who} detected. Resume with ${lastGame.name}?`;
      message = "Resume:";
      choices = [
        { id: `game:${lastGame.id}`, label: lastGame.name, image: lastGame.iconPath },
        { id: "other", label: "Other Games" },
      ];
      primary = `game:${lastGame.id}`;
    } else if (games.length === 1) {
      line = `${who} detected. Would you like to play ${games[0].name}?`;
      message = "Ready to play:";
      choices = [
        { id: `game:${games[0].id}`, label: games[0].name, image: games[0].iconPath },
        { id: "toybox", label: "Toybox" },
        { id: "dismiss", label: "Not Now" },
      ];
      primary = `game:${games[0].id}`;
    } else {
      const count = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][games.length] ?? String(games.length);
      line = `${who} detected. I found ${count} games you can play.`;
      message = "Choose a game:";
      choices = [...games.map((g) => ({ id: `game:${g.id}`, label: g.name, image: g.iconPath })), { id: "toybox", label: "Open Toybox" }];
    }

    const card: GhostCard = {
      id: `toybox:${event.uid}`,
      title: event.name,
      subtitle: [PLATFORM_NAMES[event.ecosystem] ?? event.ecosystem, event.variant && !/^(figure|character|standard)$/i.test(event.variant) ? event.variant : "", event.series && event.series !== event.franchise ? "" : ""].filter(Boolean).join(" · "),
      message,
      image: s.artwork ? { src: this.artChain(event)[0], fit: "contain", fallbacks: this.artChain(event).slice(1) } : undefined,
      choices,
      primary,
      context: { type: "toybox-detection", figureId: event.figureId, offeredGames: games.map((g) => g.id) },
      onChoice: (id, via) => this.onChoice(event, games, id, via),
      onDismiss: (reason) => {
        if (reason !== "replaced" && this.current?.uid === event.uid) this.current = null;
      },
    };

    if (!s.showCards) {
      this.speak(line);
      return;
    }
    // Same reader, new figure: the card changes in place rather than flashing away.
    if (previous && this.hooks.assistant.currentCard()?.id === `toybox:${previous.uid}` && previous.uid !== event.uid) {
      this.hooks.assistant.updateCard({ ...card }, s.speak && !this.hooks.ghostMuted() ? line : undefined);
      // The id changes with the figure, so a later removal matches the right card.
      this.hooks.assistant.updateCard({ id: card.id });
      return;
    }
    this.hooks.assistant.showCard(card, s.speak && !this.hooks.ghostMuted() ? line : undefined);
  }

  private showUnknown(event: ToyboxDetectionEvent): void {
    const s = this.hooks.settings();
    const line = "I found an NFC figure, but I don't recognize it yet.";
    if (!s.showCards) {
      this.speak(line);
      return;
    }
    this.hooks.assistant.showCard(
      {
        id: `toybox:${event.uid}`,
        title: "Unknown Toy",
        subtitle: PLATFORM_NAMES[event.ecosystem] ?? "",
        message: "This tag isn't in the database.",
        image: { src: "assets/toybox/silhouette-unknown.svg", fit: "contain", fallbacks: [GENERIC_SILHOUETTE] },
        choices: [
          { id: "identify", label: "Identify" },
          { id: "map", label: "Save Custom Mapping" },
          { id: "dismiss", label: "Dismiss" },
        ],
        context: { type: "toybox-detection", figureId: null, offeredGames: [] },
        onChoice: (id) => {
          if (id === "identify" || id === "map") this.hooks.identifyUnknown(event);
          this.hooks.assistant.closeCard();
        },
      },
      s.speak && !this.hooks.ghostMuted() ? line : undefined
    );
  }

  private onChoice(event: ToyboxDetectionEvent, games: GameEntry[], id: string, via: "controller" | "voice"): void {
    const a = this.hooks.assistant;
    if (id === "dismiss") {
      a.closeCard("closed");
      return;
    }
    if (id === "toybox") {
      a.closeCard("closed");
      this.hooks.openShelf(event.figureId);
      return;
    }
    if (id === "compatible") {
      a.closeCard("closed");
      this.hooks.showCompatible(event, games);
      return;
    }
    if (id === "other" || id === "__more__") {
      a.updateCard({
        message: "Choose a game:",
        choices: [...games.map((g) => ({ id: `game:${g.id}`, label: g.name, image: g.iconPath })), { id: "toybox", label: "Open Toybox" }],
        primary: undefined,
      });
      return;
    }
    if (id.startsWith("game:")) {
      const game = games.find((g) => `game:${g.id}` === id) ?? this.hooks.games().find((g) => `game:${g.id}` === id);
      if (!game) return;
      const mode = this.hooks.settings().onSelect;
      const go = (how: "launch" | "navigate") => {
        if (event.figureId) this.hooks.setLastGame(event.figureId, game.id);
        a.closeCard("closed");
        if (how === "launch") {
          a.announce(`Launching ${game.name}.`);
          this.hooks.launch(game);
        } else this.hooks.navigateTo(game);
      };
      if (mode === "launch") go("launch");
      else if (mode === "navigate") go("navigate");
      else {
        a.updateCard({
          message: `${game.name} - launch it, or go to it?`,
          choices: [
            { id: `launch:${game.id}`, label: "Launch it" },
            { id: `navigate:${game.id}`, label: "Take me to it" },
          ],
          primary: `launch:${game.id}`,
        });
        if (via === "voice") a.announce("Would you like me to launch it or take you to it?");
      }
      return;
    }
    if (id.startsWith("launch:") || id.startsWith("navigate:")) {
      const gid = id.slice(id.indexOf(":") + 1);
      const game = this.hooks.games().find((g) => g.id === gid);
      if (!game) return;
      if (event.figureId) this.hooks.setLastGame(event.figureId, game.id);
      a.closeCard("closed");
      if (id.startsWith("launch:")) {
        a.announce(`Launching ${game.name}.`);
        this.hooks.launch(game);
      } else this.hooks.navigateTo(game);
    }
  }

  /** The toy left the reader: a quiet note, then the card goes unless it comes straight back. */
  onRemoved(event: ToyboxRemovalEvent): void {
    if (!this.current || this.current.uid !== event.uid) return;
    const a = this.hooks.assistant;
    const name = this.current.name;
    if (a.currentCard()?.id === `toybox:${event.uid}`) a.setCardState(`${name} removed.`);
    clearTimeout(this.removalTimer);
    this.removalTimer = window.setTimeout(() => {
      if (this.current?.uid !== event.uid) return; // it came back, or another took its place
      if (a.currentCard()?.id === `toybox:${event.uid}`) a.closeCard("closed");
      this.current = null;
    }, REMOVAL_GRACE_MS);
  }

  /** Something bigger took over (a launch, the shelf): drop the context. */
  clear(): void {
    clearTimeout(this.removalTimer);
    if (this.current && this.hooks.assistant.currentCard()?.id === `toybox:${this.current.uid}`) this.hooks.assistant.closeCard("closed");
    this.current = null;
    this.offered = [];
  }

  currentFigure(): ToyboxDetectionEvent | null {
    return this.current;
  }

  offeredGames(): GameEntry[] {
    return this.offered;
  }
}

export { PLATFORM_NAMES as TOYBOX_ECOSYSTEM_NAMES };
export type { ToyPlatform };
