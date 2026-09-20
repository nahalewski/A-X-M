/**
 * Ghost's body, drawn from the supplied art rather than the placeholder SVG.
 *
 * Two sheets back it (built by scripts/build-ghost-sprites.py):
 * - ghost-eye-sprite.webp   one front-facing shell, twelve evenly spaced eye hues.
 *                           The shell is pixel-identical across all twelve, so
 *                           stepping through them reads as the eye changing colour
 *                           and never as the model flickering.
 * - ghost-spin-sprite.webp  the supplied eight-frame rotation, every frame scaled by
 *                           the same factor so he doesn't pulse as he turns.
 *
 * The moods the menu asks for:
 *   idle       a slow float, eye held on Ghost's own blue
 *   listening  the eye cycles the full colour wheel
 *   speaking   the eye brightens in time with the reply
 *   happy      a full rotation through the spin sheet, for something that worked
 *   error      the eye ramps to red and he shakes his head
 *
 * One rAF loop drives all of it, and it only runs while Ghost is on screen.
 */

export type GhostMood = "idle" | "listening" | "thinking" | "speaking" | "happy" | "error";

const EYE_FRAMES = 12;
const SPIN_FRAMES = 8;

/** Hue index Ghost sits on when nothing else is happening: his own blue. */
const IDLE_HUE = 7;
/** Hue index for anger. Frame 0 of the sheet is red. */
const ERROR_HUE = 0;

/** Seconds for one full pass of the listening rainbow. */
const RAINBOW_SECONDS = 2.4;
/** Seconds for one full rotation when celebrating. */
const SPIN_SECONDS = 0.85;
/** How long a one-shot mood (happy, error) lasts before falling back. */
const ONESHOT_SECONDS = { happy: 1.7, error: 1.5 };

function frameStyle(url: string, count: number, index: number): string {
  const clamped = ((Math.round(index) % count) + count) % count;
  return (
    `background-image:url("${url}");` +
    `background-size:${count * 100}% 100%;` +
    `background-position:${(clamped * 100) / (count - 1)}% 0;`
  );
}

export class GhostSprite {
  readonly el: HTMLElement;

  private eyeLayer: HTMLElement;
  private spinLayer: HTMLElement;

  private mood: GhostMood = "idle";
  /** What to return to once a one-shot mood finishes. */
  private restingMood: GhostMood = "idle";
  private oneShotLeft = 0;

  private time = 0;
  private raf = 0;
  private lastFrame = 0;
  private running = false;

  /** Last frame indices actually written, so we only touch style on a change. */
  private shownEye = -1;
  private shownSpin = -1;
  private spinning = false;

  constructor() {
    const root = document.createElement("div");
    root.className = "ghost-body";

    this.eyeLayer = document.createElement("div");
    this.eyeLayer.className = "ghost-layer ghost-layer-eye";

    this.spinLayer = document.createElement("div");
    this.spinLayer.className = "ghost-layer ghost-layer-spin";

    root.append(this.eyeLayer, this.spinLayer);
    this.el = root;

    this.applyEye(IDLE_HUE);
    this.applySpin(0);
  }

  setMood(mood: GhostMood): void {
    if (mood === this.mood) return;

    if (mood === "happy" || mood === "error") {
      // A celebration or a complaint plays out and then hands back to whatever
      // Ghost was doing, so a reply that follows one isn't cut off.
      this.restingMood = this.mood === "happy" || this.mood === "error" ? this.restingMood : this.mood;
      this.oneShotLeft = ONESHOT_SECONDS[mood];
    } else {
      this.restingMood = mood;
      this.oneShotLeft = 0;
    }

    this.mood = mood;
    this.el.dataset.mood = mood;
    this.spinning = mood === "happy";
    this.el.classList.toggle("spinning", this.spinning);

    // The spin sheet has its own shell, so the two layers swap rather than blend.
    this.spinLayer.classList.toggle("active", this.spinning);
    this.eyeLayer.classList.toggle("active", !this.spinning);
  }

  currentMood(): GhostMood {
    return this.mood;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    // Clamped at both ends: rAF hands back the frame's start time, which can predate
    // the clock taken in start(), and a backgrounded window can hand back seconds.
    const delta = Math.max(0, Math.min(0.1, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.time += delta;

    if (this.oneShotLeft > 0) {
      this.oneShotLeft -= delta;
      if (this.oneShotLeft <= 0) this.setMood(this.restingMood);
    }

    this.draw();
  };

  private draw(): void {
    if (this.spinning) {
      this.applySpin((this.time / SPIN_SECONDS) * SPIN_FRAMES);
      return;
    }

    switch (this.mood) {
      case "listening":
        // Straight round the wheel - the state the user asked to read as "RGB".
        this.applyEye((this.time / RAINBOW_SECONDS) * EYE_FRAMES);
        break;
      case "error":
        this.applyEye(ERROR_HUE);
        break;
      case "thinking":
        // A narrow sweep either side of his blue, so he looks busy but not upset.
        this.applyEye(IDLE_HUE + Math.round(Math.sin(this.time * 3) * 1.2));
        break;
      default:
        this.applyEye(IDLE_HUE);
        break;
    }
  }

  private applyEye(index: number): void {
    const frame = ((Math.round(index) % EYE_FRAMES) + EYE_FRAMES) % EYE_FRAMES;
    if (frame === this.shownEye) return;
    this.shownEye = frame;
    this.eyeLayer.style.cssText = frameStyle("assets/icons/ghost-eye-sprite.webp", EYE_FRAMES, frame);
  }

  private applySpin(index: number): void {
    const frame = ((Math.round(index) % SPIN_FRAMES) + SPIN_FRAMES) % SPIN_FRAMES;
    if (frame === this.shownSpin) return;
    this.shownSpin = frame;
    this.spinLayer.style.cssText = frameStyle("assets/icons/ghost-spin-sprite.webp", SPIN_FRAMES, frame);
  }

  destroy(): void {
    this.stop();
    this.el.remove();
  }
}
