import { RibbonRenderer } from "./RibbonRenderer";
import { RibbonFallbackRenderer } from "./ribbonFallback";
import {
  DEFAULT_OPTIONS,
  QUALITY_ORDER,
  Quality,
  QualityLevel,
  RibbonOptions,
} from "./ribbonTypes";

/**
 * Flowing ribbon background for the A-X-M menu.
 *
 * Renderer-process only - it touches WebGL, the DOM and requestAnimationFrame, none
 * of which exist in Electron's main process. It needs no Node APIs at all, so it
 * runs unchanged under contextIsolation: true / nodeIntegration: false.
 *
 *   const ribbon = new RibbonBackground(container, { opacity: 0.22, speed: 0.25 });
 *   ribbon.start();
 *
 * Picks Three.js/WebGL when a context is available and falls back to Canvas 2D when
 * it isn't. Both paths expose the same setters, so callers never branch on which one
 * is live; `usingFallback` is there for diagnostics only.
 */

/** Anything slower than this for `SLOW_SECONDS` triggers a quality step down. */
const SLOW_FPS = 55;
const SLOW_SECONDS = 3;

/**
 * Quality only ever steps down. Recovering would mean re-measuring at the higher
 * setting, which is exactly the oscillation the spec calls out - a display that
 * sits near the threshold would flip presets every few seconds and the change is
 * far more visible than the frame it saves.
 */
interface RendererLike {
  readonly domElement: HTMLCanvasElement;
  render(deltaSeconds: number, speed: number): void;
  resize(width: number, height: number): void;
  setColor(color: string): void;
  setOpacity(opacity: number): void;
  setWaveStrength(strength: number): void;
  setGlow(glow: boolean): void;
  setLayerCount(count: number): void;
  setBackdropCycleSeconds(seconds: number): void;
  setQuality(level: QualityLevel): void;
  setRibbonWidth(width: number): void;
  setRibbonsVisible(visible: boolean): void;
  setBackdrop(mode: RibbonOptions["backdrop"], colors?: [string, string]): void;
  setParallax(x: number): void;
  nudge(strength?: number): void;
  pulse(strength?: number): void;
  destroy(): void;
}

/**
 * Coerces whatever came out of the settings file into a usable preset. A value
 * written by an older build, or hand-edited, must not be able to leave the
 * renderer without a quality profile.
 */
function resolveLevel(quality: Quality | undefined): QualityLevel {
  if (quality && QUALITY_ORDER.includes(quality as QualityLevel)) return quality as QualityLevel;
  return "high";
}

export class RibbonBackground {
  /** True when WebGL was unavailable and the Canvas 2D path is running. */
  readonly usingFallback: boolean;

  private container: HTMLElement;
  private options: RibbonOptions;
  private renderer: RendererLike;

  private raf = 0;
  private running = false;
  private lastFrame = 0;

  /** Rolling window for the FPS monitor. */
  private frameCount = 0;
  /** Frames per second to render at, or 0 to follow the display. */
  private maxFps = 0;
  private lastRendered = 0;

  /**
   * Caps the render rate below the display's. rAF still fires every refresh, but
   * frames that arrive sooner than the cap allows are skipped rather than drawn,
   * which is how a 120Hz screen gets a 60fps ribbon without any tearing.
   */
  setMaxFps(fps: number): void {
    this.maxFps = Math.max(0, fps);
  }
  private windowStart = 0;
  private slowFor = 0;
  private level: QualityLevel;
  /** Set once the ladder bottoms out, so monitoring stops instead of re-reporting. */
  private gaveUp = false;

  private onVisibility = (): void => {
    // A hidden or minimised window still gets rAF callbacks in some Electron
    // builds, and burning GPU on a background the user can't see is the one thing
    // a handheld can least afford.
    if (document.hidden) this.pause();
    else this.resume();
  };

  private onResize = (): void => this.resize();

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.options.interactivity.enabled || !this.options.interactivity.pointerParallax) return;
    const x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    this.renderer.setParallax(x);
  };

  constructor(container: HTMLElement, options: Partial<RibbonOptions> = {}) {
    this.container = container;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      interactivity: { ...DEFAULT_OPTIONS.interactivity, ...(options.interactivity ?? {}) },
    };

    if (this.options.quality !== "auto" && !QUALITY_ORDER.includes(this.options.quality as QualityLevel)) {
      this.options.quality = "auto";
    }
    this.level = resolveLevel(this.options.quality === "auto" ? undefined : this.options.quality);

    let renderer: RendererLike;
    let fallback = false;
    try {
      renderer = new RibbonRenderer(container, this.options, this.level);
    } catch (err) {
      console.warn("[A-X-M] WebGL unavailable, using the Canvas 2D ribbon fallback:", err);
      renderer = new RibbonFallbackRenderer(container, this.options, this.level);
      fallback = true;
    }
    this.renderer = renderer;
    this.usingFallback = fallback;

    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
  }

  // ------------------------------------------------------------------- loop --

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.windowStart = this.lastFrame;
    this.frameCount = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private pause(): void {
    if (!this.running) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resume(): void {
    if (!this.running || this.raf) return;
    // Reset the clock, or the first frame back gets credited the whole time the
    // window was hidden and the ribbons snap forward.
    this.lastFrame = performance.now();
    this.windowStart = this.lastFrame;
    this.frameCount = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);

    // Clamped at both ends. The ceiling stops an alt-tab, a breakpoint or a dropped
    // frame handing the shader a half-second step; the floor matters because rAF
    // reports the frame's *start* time, which can predate the performance.now()
    // captured in start(), making the very first delta negative. Time-based
    // throughout, so 60, 90 and 120 Hz all produce identical motion.
    // Frame cap: skip this refresh if the previous draw was too recent. Delta
    // keeps accumulating across skipped frames, so motion speed is unaffected.
    if (this.maxFps > 0) {
      const minInterval = 1000 / this.maxFps;
      // Allow a small tolerance so 60 on a 120Hz display lands on every other frame
      // rather than every third.
      if (now - this.lastRendered < minInterval - 1.5) return;
      this.lastRendered = now;
    }

    const delta = Math.max(0, Math.min(0.1, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    if (this.options.animate) {
      this.renderer.render(delta, this.options.speed);
    }

    this.monitor(now);
  };

  /** Steps quality down if frames stay expensive. Never steps back up. */
  private monitor(now: number): void {
    if (this.options.quality !== "auto" || this.gaveUp) return;

    this.frameCount++;
    const elapsed = (now - this.windowStart) / 1000;
    if (elapsed < 1) return;

    const fps = this.frameCount / elapsed;
    this.frameCount = 0;
    this.windowStart = now;

    if (fps >= SLOW_FPS) {
      this.slowFor = 0;
      return;
    }

    this.slowFor += elapsed;
    if (this.slowFor < SLOW_SECONDS) return;
    this.slowFor = 0;

    const index = QUALITY_ORDER.indexOf(this.level);
    if (index <= 0) {
      // Already at the floor. Drop the animation rather than keep measuring - at
      // this point the background is costing more than it's worth.
      console.warn(`[A-X-M] ribbon still at ${fps.toFixed(0)} FPS on the low preset; freezing it`);
      this.options.animate = false;
      this.gaveUp = true;
      return;
    }

    const next = QUALITY_ORDER[index - 1];
    console.warn(`[A-X-M] ribbon averaged ${fps.toFixed(0)} FPS; dropping quality to ${next}`);
    this.level = next;
    this.renderer.setQuality(next);
  }

  // ---------------------------------------------------------------- setters --

  resize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.resize(width, height);
  }

  setColor(color: string): void {
    this.options.color = color;
    this.renderer.setColor(color);
  }

  setOpacity(opacity: number): void {
    this.options.opacity = Math.max(0, Math.min(1, opacity));
    this.renderer.setOpacity(this.options.opacity);
  }

  setSpeed(speed: number): void {
    this.options.speed = Math.max(0, speed);
  }

  setWaveStrength(strength: number): void {
    this.options.waveStrength = Math.max(0, strength);
    this.renderer.setWaveStrength(this.options.waveStrength);
  }

  setGlow(glow: boolean): void {
    this.options.glow = glow;
    this.renderer.setGlow(glow);
  }

  /** Scales band thickness; 1 is the tuned default. */
  setRibbonWidth(width: number): void {
    this.renderer.setRibbonWidth(Math.max(0.1, width));
  }

  /** Hides the bands but keeps the themed backdrop, for "ribbon off" themes. */
  setRibbonsVisible(visible: boolean): void {
    this.renderer.setRibbonsVisible(visible);
  }

  /** Switches the backdrop between the drifting palette, a fixed pair, or nothing. */
  setBackdrop(mode: RibbonOptions["backdrop"], colors?: [string, string]): void {
    this.options.backdrop = mode;
    if (colors) this.options.backdropColors = colors;
    this.renderer.setBackdrop(mode, colors);
  }

  setLayers(count: number): void {
    this.options.layers = Math.max(1, Math.round(count));
    this.renderer.setLayerCount(this.options.layers);
  }

  setAnimating(animate: boolean): void {
    this.options.animate = animate;
  }

  /** Seconds per palette step for the cycling backdrop. */
  setBackdropCycleSeconds(seconds: number): void {
    this.options.backdropCycleSeconds = Math.max(2, seconds);
    this.renderer.setBackdropCycleSeconds(this.options.backdropCycleSeconds);
  }

  setQuality(quality: Quality): void {
    this.options.quality = quality;
    this.slowFor = 0;
    // An explicit choice re-arms the monitor and undoes an earlier freeze.
    this.gaveUp = false;
    this.options.animate = true;
    const level = resolveLevel(quality === "auto" ? undefined : quality);
    if (level === this.level) return;
    this.level = level;
    this.renderer.setQuality(level);
  }

  /** The preset actually in use, which differs from `quality` once auto steps down. */
  activeQuality(): QualityLevel {
    return this.level;
  }

  setInteractivity(interactivity: Partial<RibbonOptions["interactivity"]>): void {
    this.options.interactivity = { ...this.options.interactivity, ...interactivity };
    if (!this.options.interactivity.enabled || !this.options.interactivity.pointerParallax) {
      this.renderer.setParallax(0);
    }
  }

  // ---------------------------------------------------------- interactivity --

  /** Call as the menu selection moves. No-op unless interactivity is enabled. */
  onNavigate(): void {
    const { enabled, navigationBoost } = this.options.interactivity;
    if (enabled && navigationBoost) this.renderer.nudge();
  }

  /** Call when a game is chosen. No-op unless interactivity is enabled. */
  onSelect(): void {
    const { enabled, selectionPulse } = this.options.interactivity;
    if (enabled && selectionPulse) this.renderer.pulse();
  }

  // --------------------------------------------------------------- teardown --

  destroy(): void {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pointermove", this.onPointerMove);
    this.renderer.destroy();
  }
}

export { DEFAULT_OPTIONS, QUALITY_PROFILES } from "./ribbonTypes";
export type { RibbonOptions, Quality, QualityLevel } from "./ribbonTypes";
