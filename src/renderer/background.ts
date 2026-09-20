/**
 * The menu background. By default the animated wave shows through; when a game with
 * hero artwork is selected, that banner crossfades in over the wave, the way a PS3
 * theme replaces the XMB background.
 *
 * Two stacked layers are used so moving between two games dissolves from one banner
 * to the next instead of flashing through the wave in between. Images are preloaded
 * before they're shown, so a slow or missing file never leaves a half-painted
 * background on screen - it just stays on the wave.
 */
export class GameBackground {
  private root: HTMLElement;
  private layers: [HTMLElement, HTMLElement];
  private front = 0;
  private currentUrl: string | null = null;
  /** Guards against an earlier, slower image landing after a later one. */
  private requestId = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    const make = (): HTMLElement => {
      const el = document.createElement("div");
      el.className = "game-bg-layer";
      root.appendChild(el);
      return el;
    };
    this.layers = [make(), make()];
  }

  /** Shows `url` as the background, or falls back to the wave when null. */
  show(url: string | null | undefined): void {
    const next = url ?? null;
    if (next === this.currentUrl) return;
    this.currentUrl = next;
    const request = ++this.requestId;

    if (!next) {
      this.root.classList.remove("visible");
      return;
    }

    const probe = new Image();
    probe.addEventListener("load", () => {
      if (request !== this.requestId) return;
      const back = 1 - this.front;
      // JSON.stringify gives a correctly quoted and escaped CSS string literal, which
      // matters because file:// paths can contain quotes and backslashes.
      this.layers[back].style.backgroundImage = `url(${JSON.stringify(next)})`;
      this.layers[back].style.opacity = "1";
      this.layers[this.front].style.opacity = "0";
      this.front = back;
      this.root.classList.add("visible");
    });
    probe.addEventListener("error", () => {
      if (request !== this.requestId) return;
      // No usable art for this entry - drop back to the wave rather than holding the
      // previous game's banner, which would look like the selection hadn't moved.
      this.currentUrl = null;
      this.root.classList.remove("visible");
    });
    probe.src = next;
  }
}
