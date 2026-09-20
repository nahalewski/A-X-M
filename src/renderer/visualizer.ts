/**
 * Spectrum visualizer for the music player.
 *
 * Two presentations, driven by one analyser:
 * - "stage"      fills the screen over the menu, with the track's name on it.
 * - "background" sits where the ribbon background would be, so the menu stays usable
 *                while the music keeps playing.
 *
 * The lifecycle the menu wants is: Y on a track opens the stage; B drops back to the
 * menu and demotes the visualizer to the background; it stays there across track
 * changes and only clears when playback actually stops. Nothing here knows about
 * that - `setMode` is called by the menu - but the analyser survives track changes
 * on its own, because it is wired to the player's single <audio> element rather than
 * to any particular file.
 */

export type VisualizerMode = "off" | "stage" | "background";

/** Bars drawn across the screen. Kept modest so it stays cheap on a handheld. */
const BAR_COUNT = 72;

/** Analyser resolution. 512 bins is plenty to fill BAR_COUNT buckets. */
const FFT_SIZE = 1024;

/** How quickly a bar can fall, in fraction of full height per second. */
const FALL_RATE = 1.6;

export class MusicVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private root: HTMLElement;
  private titleEl: HTMLElement;

  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bins = new Uint8Array(new ArrayBuffer(0));

  /** Smoothed bar heights, 0..1. Reused so the draw loop allocates nothing. */
  private levels = new Float32Array(BAR_COUNT);
  private peaks = new Float32Array(BAR_COUNT);

  private mode: VisualizerMode = "off";
  private raf = 0;
  private lastFrame = 0;
  private hue = 0;

  constructor(root: HTMLElement) {
    this.root = root;

    const canvas = document.createElement("canvas");
    canvas.className = "visualizer-canvas";
    root.appendChild(canvas);
    this.canvas = canvas;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas 2D is unavailable");
    this.ctx = ctx;

    const title = document.createElement("div");
    title.className = "visualizer-title";
    root.appendChild(title);
    this.titleEl = title;

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  /**
   * Taps the player's audio element. Must be called once, and only once, per
   * element: createMediaElementSource takes ownership of the element's output, and
   * calling it twice on the same element throws.
   */
  attach(element: HTMLAudioElement): void {
    if (this.context) return;
    try {
      const context = new AudioContext();
      const source = context.createMediaElementSource(element);
      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      // Some smoothing in the analyser itself, the rest in the fall-off below.
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      // Still has to reach the speakers - the analyser alone is a dead end.
      analyser.connect(context.destination);

      this.context = context;
      this.analyser = analyser;
      this.bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch (err) {
      console.error("[A-X-M] could not attach the visualizer to the player:", err);
    }
  }

  isAvailable(): boolean {
    return this.analyser !== null;
  }

  currentMode(): VisualizerMode {
    return this.mode;
  }

  setTrackName(name: string | null): void {
    this.titleEl.textContent = name ?? "";
  }

  setMode(mode: VisualizerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;

    this.root.classList.toggle("stage", mode === "stage");
    this.root.classList.toggle("background", mode === "background");
    this.root.classList.toggle("hidden", mode === "off");

    if (mode === "off") {
      this.stop();
      this.levels.fill(0);
      this.peaks.fill(0);
      return;
    }

    // An AudioContext created before any user gesture starts suspended; showing the
    // visualizer is always downstream of a button press, so this is the right spot.
    void this.context?.resume().catch(() => {});
    this.resize();
    this.start();
  }

  private start(): void {
    if (this.raf) return;
    this.lastFrame = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      this.draw(Math.max(0, Math.min(0.1, (now - this.lastFrame) / 1000)));
      this.lastFrame = now;
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.root.clientWidth || window.innerWidth;
    const height = this.root.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private draw(delta: number): void {
    const { ctx } = this;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, width, height);

    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.bins);
    }

    // Buckets are spaced logarithmically: an even split puts almost everything in
    // the bottom two bars, because that's where music's energy actually lives.
    const usable = Math.floor(this.bins.length * 0.72);
    for (let i = 0; i < BAR_COUNT; i++) {
      const from = Math.floor(Math.pow(i / BAR_COUNT, 1.7) * usable);
      const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / BAR_COUNT, 1.7) * usable));

      let sum = 0;
      for (let b = from; b < to && b < this.bins.length; b++) sum += this.bins[b];
      const target = to > from ? sum / (to - from) / 255 : 0;

      // Rise instantly, fall gradually: the shape people read as "responsive".
      this.levels[i] = target > this.levels[i] ? target : Math.max(target, this.levels[i] - FALL_RATE * delta);
      this.peaks[i] =
        this.levels[i] > this.peaks[i] ? this.levels[i] : Math.max(0, this.peaks[i] - FALL_RATE * 0.35 * delta);
    }

    // Slow hue drift, so a long album doesn't sit on one colour.
    this.hue = (this.hue + delta * 6) % 360;

    const background = this.mode === "background";
    const alpha = background ? 0.4 : 0.92;
    const maxBarHeight = height * (background ? 0.34 : 0.52);
    const gap = 3;
    const barWidth = Math.max(2, width / BAR_COUNT - gap);
    const baseline = background ? height * 0.78 : height * 0.68;

    for (let i = 0; i < BAR_COUNT; i++) {
      const x = (i / BAR_COUNT) * width + gap / 2;
      const barHeight = Math.max(2, this.levels[i] * maxBarHeight);
      const hue = (this.hue + (i / BAR_COUNT) * 90) % 360;

      // Mirrored about the baseline, so it reads as a waveform rather than a chart.
      const gradient = ctx.createLinearGradient(0, baseline - barHeight, 0, baseline + barHeight * 0.6);
      gradient.addColorStop(0, `hsla(${hue}, 85%, 74%, ${alpha})`);
      gradient.addColorStop(0.5, `hsla(${hue}, 80%, 62%, ${alpha * 0.85})`);
      gradient.addColorStop(1, `hsla(${hue}, 75%, 50%, 0)`);
      ctx.fillStyle = gradient;

      ctx.fillRect(x, baseline - barHeight, barWidth, barHeight);
      ctx.fillRect(x, baseline, barWidth, barHeight * 0.45);

      // Peak cap, only worth drawing on the full-screen presentation.
      if (!background && this.peaks[i] > 0.02) {
        ctx.fillStyle = `hsla(${hue}, 90%, 86%, ${alpha})`;
        ctx.fillRect(x, baseline - this.peaks[i] * maxBarHeight - 2, barWidth, 2);
      }
    }
  }

  destroy(): void {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.analyser = null;
    this.root.remove();
  }
}
