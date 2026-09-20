/**
 * Music visualizer, driven by one analyser on the player's <audio> element.
 *
 * Two presentations:
 * - "stage"      fills the screen over the menu, with the track's name on it.
 * - "background" sits where the ribbon background would be, so the menu stays usable
 *                while the music keeps playing.
 *
 * And several styles, after the ones the PS3 and PSP shipped with. The PS3 set:
 * the spectrum analyser (the original here), Earth, Line and Waveform. The PSP set:
 * Rain, Circle and Sparkle. Four more of our own - Tunnel, Terrain, Scope, Pulse -
 * after the neon reference art. All share one palette (cyan through violet to
 * magenta, additive glow, mirrored floors), so switching feels like one player.
 * `setStyle` switches between them at any time.
 *
 * The lifecycle the menu wants is: Y on a track opens the stage; B drops back to the
 * menu and demotes the visualizer to the background; it stays there across track
 * changes and only clears when playback actually stops. Nothing here knows about
 * that - `setMode` is called by the menu - but the analyser survives track changes
 * on its own, because it is wired to the player's single <audio> element rather than
 * to any particular file.
 */

export type VisualizerMode = "off" | "stage" | "background";

export const VISUALIZER_STYLES = [
  { id: "bars", label: "Spectrum Analyzer", origin: "PS3" },
  { id: "earth", label: "Earth", origin: "PS3" },
  { id: "line", label: "Line", origin: "PS3" },
  { id: "wave", label: "Waveform", origin: "PS3" },
  { id: "rain", label: "Rain", origin: "PSP" },
  { id: "circle", label: "Circle", origin: "PSP" },
  { id: "sparkle", label: "Sparkle", origin: "PSP" },
  { id: "tunnel", label: "Tunnel", origin: "A-X-M" },
  { id: "terrain", label: "Terrain", origin: "A-X-M" },
  { id: "scope", label: "Scope", origin: "A-X-M" },
  { id: "pulse", label: "Pulse", origin: "A-X-M" },
] as const;

export type VisualizerStyle = (typeof VISUALIZER_STYLES)[number]["id"];

export const VISUALIZER_STYLE_IDS = VISUALIZER_STYLES.map((s) => s.id) as VisualizerStyle[];

/** Bars drawn across the screen. Kept modest so it stays cheap on a handheld. */
const BAR_COUNT = 72;

/** Analyser resolution. 512 bins is plenty to fill BAR_COUNT buckets. */
const FFT_SIZE = 1024;

/** How quickly a bar can fall, in fraction of full height per second. */
const FALL_RATE = 1.6;

/** Points on the Earth globe, and particles in flight for Rain / Sparkle. */
const GLOBE_POINTS = 900;
const MAX_PARTICLES = 420;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue: number;
}

export class MusicVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private styleEl: HTMLElement;

  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bins = new Uint8Array(new ArrayBuffer(0));
  private wave = new Uint8Array(new ArrayBuffer(0));

  /** Smoothed bar heights, 0..1. Reused so the draw loop allocates nothing. */
  private levels = new Float32Array(BAR_COUNT);
  private peaks = new Float32Array(BAR_COUNT);
  /** Coarse bands: bass, mids, highs, and the overall level - smoothed. */
  private bass = 0;
  private mids = 0;
  private highs = 0;
  private energy = 0;

  private mode: VisualizerMode = "off";
  private style: VisualizerStyle = "bars";
  private raf = 0;
  private lastFrame = 0;
  private hue = 0;
  private time = 0;
  private styleLabelTimer = 0;

  private renderScale = 1;
  private globe: Float32Array | null = null;

  /** Fraction of the physical resolution to draw at (1 = native). */
  setRenderScale(scale: number): void {
    this.renderScale = Math.min(1, Math.max(0.25, scale));
    this.resize();
  }
  private particles: Particle[] = [];

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

    const styleLabel = document.createElement("div");
    styleLabel.className = "visualizer-style hidden";
    root.appendChild(styleLabel);
    this.styleEl = styleLabel;

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
      this.wave = new Uint8Array(new ArrayBuffer(analyser.fftSize));
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

  currentStyle(): VisualizerStyle {
    return this.style;
  }

  setTrackName(name: string | null): void {
    this.titleEl.textContent = name ?? "";
  }

  /** Switches style; on the stage the name is flashed up briefly so ◀ ▶ feels responsive. */
  setStyle(style: VisualizerStyle, announce = false): void {
    if (!VISUALIZER_STYLE_IDS.includes(style)) return;
    this.style = style;
    this.particles.length = 0;
    if (announce) {
      const info = VISUALIZER_STYLES.find((s) => s.id === style)!;
      this.styleEl.textContent = `${info.label} · ${info.origin}`;
      this.styleEl.classList.remove("hidden");
      clearTimeout(this.styleLabelTimer);
      this.styleLabelTimer = window.setTimeout(() => this.styleEl.classList.add("hidden"), 1600);
    }
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
      this.particles.length = 0;
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    const width = this.root.clientWidth || window.innerWidth;
    const height = this.root.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Reads the analyser and updates the smoothed levels every style draws from. */
  private analyse(delta: number): void {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.bins);
      this.analyser.getByteTimeDomainData(this.wave);
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

    const band = (from: number, to: number): number => {
      let s = 0;
      for (let i = from; i < to; i++) s += this.levels[i];
      return s / (to - from);
    };
    const smooth = (prev: number, next: number) => prev + (next - prev) * Math.min(1, delta * 10);
    this.bass = smooth(this.bass, band(0, 10));
    this.mids = smooth(this.mids, band(10, 40));
    this.highs = smooth(this.highs, band(40, BAR_COUNT));
    this.energy = smooth(this.energy, band(0, BAR_COUNT));

    // Slow hue drift, so a long album doesn't sit on one colour.
    this.hue = (this.hue + delta * 6) % 360;
    this.time += delta;
  }

  private draw(delta: number): void {
    const { ctx } = this;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, width, height);
    this.analyse(delta);

    const background = this.mode === "background";
    switch (this.style) {
      case "earth":
        this.drawEarth(width, height, background, delta);
        break;
      case "line":
        this.drawLine(width, height, background, delta);
        break;
      case "tunnel":
        this.drawTunnel(width, height, background);
        break;
      case "terrain":
        this.drawTerrain(width, height, background);
        break;
      case "scope":
        this.drawScope(width, height, background);
        break;
      case "pulse":
        this.drawPulse(width, height, background);
        break;
      case "wave":
        this.drawWave(width, height, background);
        break;
      case "rain":
        this.drawRain(width, height, background, delta);
        break;
      case "circle":
        this.drawCircle(width, height, background);
        break;
      case "sparkle":
        this.drawSparkle(width, height, background, delta);
        break;
      default:
        this.drawBars(width, height, background);
    }
  }

  // ---- Shared neon palette --------------------------------------------------------
  //
  // Every style draws in the same family: cyan, through violet, to magenta - the
  // classic neon look from the reference art - with additive glow so overlaps burn
  // brighter, and a mirrored reflection where there's a floor.

  private neon(t: number, light = 62, alpha = 1): string {
    // 0 = cyan (190°), 0.5 = violet (265°), 1 = magenta (320°)
    const hue = 190 + t * 130;
    return `hsla(${hue}, 100%, ${light}%, ${alpha})`;
  }

  private floorGrid(width: number, height: number, floor: number, alpha: number): void {
    const { ctx } = this;
    // Perspective grid on the floor: converging verticals and receding horizontals.
    const vanishX = width / 2;
    const vanishY = floor - height * 0.35;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(120, 170, 255, ${alpha * 0.28})`;
    ctx.beginPath();
    for (let i = -8; i <= 8; i++) {
      const x = width / 2 + i * width * 0.09;
      ctx.moveTo(x, height);
      ctx.lineTo(vanishX + (x - vanishX) * 0.15, floor);
    }
    for (let j = 1; j <= 7; j++) {
      const t = j / 7;
      const y = floor + (height - floor) * t * t;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    void vanishY;
  }

  // ---- PS3: Spectrum Analyzer (neon bars over a mirrored grid floor) --------------

  private drawBars(width: number, height: number, background: boolean): void {
    const { ctx } = this;
    const alpha = background ? 0.45 : 1;
    const floor = background ? height * 0.8 : height * 0.68;
    const maxBarHeight = floor * (background ? 0.55 : 0.82);
    const gap = 4;
    const barWidth = Math.max(3, width / BAR_COUNT - gap);
    const segment = 7;

    if (!background) this.floorGrid(width, height, floor, alpha);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = (i / BAR_COUNT) * width + gap / 2;
      const t = i / BAR_COUNT;
      const barHeight = Math.max(3, this.levels[i] * maxBarHeight);
      const colour = this.neon(t, 62, alpha);

      // Segmented column, brighter towards the top.
      const gradient = ctx.createLinearGradient(0, floor - barHeight, 0, floor);
      gradient.addColorStop(0, this.neon(t, 80, alpha));
      gradient.addColorStop(1, this.neon(t, 48, alpha * 0.75));
      ctx.fillStyle = gradient;
      ctx.shadowBlur = background ? 6 : 16;
      ctx.shadowColor = colour;
      for (let y = floor; y > floor - barHeight; y -= segment) {
        ctx.fillRect(x, y - segment + 1.5, barWidth, segment - 1.5);
      }
      ctx.shadowBlur = 0;

      // Peak dot, drifting down, with a faint light column above it.
      if (this.peaks[i] > 0.02) {
        const py = floor - this.peaks[i] * maxBarHeight;
        ctx.fillStyle = this.neon(t, 88, alpha);
        ctx.fillRect(x + barWidth / 2 - 1.5, py - 3, 3, 3);
        ctx.fillStyle = this.neon(t, 80, alpha * 0.18);
        ctx.fillRect(x + barWidth / 2 - 0.5, py - 60 * this.peaks[i], 1, 60 * this.peaks[i]);
      }

      // Reflection in the floor.
      const mirror = ctx.createLinearGradient(0, floor, 0, floor + barHeight * 0.6);
      mirror.addColorStop(0, this.neon(t, 60, alpha * 0.35));
      mirror.addColorStop(1, this.neon(t, 50, 0));
      ctx.fillStyle = mirror;
      ctx.fillRect(x, floor + 2, barWidth, barHeight * 0.6);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(200, 230, 255, ${alpha * 0.5})`;
    ctx.fillRect(0, floor, width, 1);
  }

  // ---- PS3: Earth (a neon globe of points with an orbiting spectrum) ---------------

  private drawEarth(width: number, height: number, background: boolean, delta: number): void {
    const { ctx } = this;
    if (!this.globe) {
      this.globe = new Float32Array(GLOBE_POINTS * 3);
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < GLOBE_POINTS; i++) {
        const y = 1 - (i / (GLOBE_POINTS - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const theta = golden * i;
        this.globe[i * 3] = Math.cos(theta) * r;
        this.globe[i * 3 + 1] = y;
        this.globe[i * 3 + 2] = Math.sin(theta) * r;
      }
    }
    const cx = width / 2;
    const cy = background ? height * 0.58 : height * 0.5;
    const radius = Math.min(width, height) * (background ? 0.2 : 0.27) * (1 + this.bass * 0.12);
    const spin = this.time * 0.25;
    const tilt = 0.4;
    const alpha = background ? 0.45 : 1;

    const glow = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius * 1.7);
    glow.addColorStop(0, `rgba(40, 140, 255, ${0.3 * alpha + this.bass * 0.25})`);
    glow.addColorStop(1, "rgba(40, 140, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius * 1.8, cy - radius * 1.8, radius * 3.6, radius * 3.6);

    ctx.globalCompositeOperation = "lighter";
    const cosS = Math.cos(spin), sinS = Math.sin(spin);
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    for (let i = 0; i < GLOBE_POINTS; i++) {
      const x0 = this.globe[i * 3], y0 = this.globe[i * 3 + 1], z0 = this.globe[i * 3 + 2];
      const x1 = x0 * cosS - z0 * sinS;
      const z1 = x0 * sinS + z0 * cosS;
      const y2 = y0 * cosT - z1 * sinT;
      const z2 = y0 * sinT + z1 * cosT;
      if (z2 < -0.15) continue;
      const depth = (z2 + 1) / 2;
      const band = Math.floor(((y2 + 1) / 2) * (BAR_COUNT - 1));
      const lift = this.levels[band] * radius * 0.1;
      const px = cx + x1 * (radius + lift);
      const py = cy + y2 * (radius + lift);
      const size = 0.8 + depth * 2 + this.levels[band] * 1.5;
      ctx.fillStyle = this.neon(this.levels[band] * 0.8, 50 + depth * 40, alpha * (0.2 + depth * 0.8));
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }

    // Two orbiting spectrum rings, one tilted the other way.
    for (const dir of [1, -1]) {
      ctx.lineWidth = background ? 1.5 : 2.5;
      ctx.shadowBlur = background ? 4 : 12;
      ctx.shadowColor = this.neon(dir > 0 ? 0.1 : 0.9, 70, alpha);
      ctx.strokeStyle = this.neon(dir > 0 ? 0.1 : 0.9, 78, alpha * 0.85);
      ctx.beginPath();
      const orbit = radius * 1.32;
      for (let i = 0; i <= BAR_COUNT; i++) {
        const level = this.levels[i % BAR_COUNT];
        const angle = (i / BAR_COUNT) * Math.PI * 2 - spin * 0.6 * dir;
        const r = orbit + level * radius * 0.45;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r * 0.42 * dir + (dir < 0 ? radius * 0.1 : 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
    void delta;
  }

  // ---- PS3: Line (liquid ribbons with bubbles over a reflecting pool) --------------

  private drawLine(width: number, height: number, background: boolean, delta: number): void {
    const { ctx } = this;
    const lines = 5;
    const alpha = background ? 0.4 : 1;
    const water = background ? height * 0.78 : height * 0.66;
    const amp = height * (background ? 0.12 : 0.2);

    // Bubbles drift up from the water, more of them on the beat.
    const spawn = Math.floor(this.bass * 3 + this.energy * 2);
    for (let s = 0; s < spawn && this.particles.length < 90; s++) {
      this.particles.push({ x: Math.random() * width, y: water, vx: (Math.random() - 0.5) * 12, vy: -(20 + Math.random() * 40), life: 0, max: 3 + Math.random() * 4, size: 3 + Math.random() * 14, hue: Math.random() });
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += delta;
      if (p.life >= p.max) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      const a = alpha * (1 - p.life / p.max) * 0.8;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = this.neon(p.hue, 75, a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = this.neon(p.hue, 85, a * 0.5);
      ctx.beginPath();
      ctx.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ribbons: stacked sine curves bent by the bands, drawn thick and glowing, then
    // upside down and faded into the pool.
    const ribbon = (mirror: boolean) => {
      for (let l = 0; l < lines; l++) {
        const phase = this.time * (0.6 + l * 0.15) + l * 1.1;
        const bandFrom = Math.floor((l / lines) * BAR_COUNT);
        ctx.beginPath();
        const steps = 110;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const band = (bandFrom + Math.floor(t * (BAR_COUNT / lines))) % BAR_COUNT;
          const level = this.levels[band];
          let y =
            water -
            amp * 0.35 -
            Math.abs(Math.sin(t * Math.PI * (2.5 + l * 0.4) + phase)) * amp * (0.4 + level * 1.1) -
            Math.sin(t * Math.PI * 9 + phase * 1.6) * amp * 0.08 * level;
          if (mirror) y = water + (water - y) * 0.55;
          const x = t * width;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const c = l / (lines - 1);
        ctx.lineWidth = mirror ? 2 : background ? 2.2 : 3.2;
        ctx.strokeStyle = this.neon(c, 72, alpha * (mirror ? 0.25 : 0.75));
        ctx.shadowBlur = mirror ? 0 : background ? 8 : 18;
        ctx.shadowColor = this.neon(c, 70, alpha);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    };
    ribbon(false);
    ribbon(true);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(160, 230, 255, ${alpha * 0.35})`;
    ctx.fillRect(0, water, width, 1);
  }

  // ---- PS3: Waveform (the signal, glowing, mirrored, with a comb of fine lines) ----

  private drawWave(width: number, height: number, background: boolean): void {
    const { ctx } = this;
    const alpha = background ? 0.45 : 1;
    const cy = background ? height * 0.62 : height * 0.5;
    const amp = height * (background ? 0.16 : 0.3);
    const n = this.wave.length || 2;

    ctx.globalCompositeOperation = "lighter";
    // Fine vertical comb from the spectrum, symmetric about the centre line.
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = (i + 0.5) * (width / BAR_COUNT);
      const h = this.levels[i] * amp * 1.4;
      ctx.fillStyle = this.neon(i / BAR_COUNT, 70, alpha * 0.22);
      ctx.fillRect(x - 0.5, cy - h, 1, h * 2);
    }
    // The trace: a wide soft glow pass, then the sharp line, then its mirror.
    const trace = (scale: number, a: number, lineWidth: number, blur: number, hueT: number) => {
      ctx.beginPath();
      for (let i = 0; i < n; i += 2) {
        const v = ((this.wave[i] ?? 128) - 128) / 128;
        const x = (i / (n - 1)) * width;
        const y = cy + v * amp * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = this.neon(hueT, 75, a);
      ctx.shadowBlur = blur;
      ctx.shadowColor = this.neon(hueT, 70, a);
      ctx.stroke();
    };
    trace(1, alpha * 0.35, background ? 6 : 10, 0, 0.55);
    trace(1, alpha, background ? 2 : 2.6, background ? 8 : 22, 0.05);
    trace(-0.6, alpha * 0.35, 1.5, 0, 0.7);
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = this.neon(0.1, 85, alpha * (0.25 + this.energy * 0.5));
    ctx.fillRect(0, cy, width, 1);
  }

  // ---- PSP: Rain (neon drops falling onto a mirror floor) ----------------------------

  private drawRain(width: number, height: number, background: boolean, delta: number): void {
    const { ctx } = this;
    const alpha = background ? 0.45 : 1;
    const floor = background ? height * 0.8 : height * 0.72;
    const spawn = Math.min(40, Math.floor(this.energy * 60 + this.bass * 40));
    for (let s = 0; s < spawn && this.particles.length < MAX_PARTICLES; s++) {
      const band = Math.floor(Math.random() * BAR_COUNT);
      if (Math.random() > this.levels[band] * 1.3) continue;
      this.particles.push({
        x: (band + Math.random()) * (width / BAR_COUNT),
        y: -10,
        vx: 0,
        vy: height * (0.5 + Math.random() * 0.4 + this.levels[band] * 0.4),
        life: 0,
        max: 10,
        size: 1.5 + this.levels[band] * 2,
        hue: band / BAR_COUNT,
      });
    }
    if (!background) this.floorGrid(width, height, floor, alpha * 0.6);
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.y += p.vy * delta;
      if (p.y >= floor) {
        p.life += delta;
        const t = p.life / 0.3;
        if (t >= 1) {
          this.particles.splice(i, 1);
          continue;
        }
        ctx.fillStyle = this.neon(p.hue, 85, alpha * (1 - t));
        ctx.fillRect(p.x - 8 * t - 1, floor - 1, 16 * t + 2, 2);
        continue;
      }
      const len = Math.min(48, p.vy * 0.06) * (background ? 0.6 : 1);
      const grad = ctx.createLinearGradient(p.x, p.y - len, p.x, p.y);
      grad.addColorStop(0, this.neon(p.hue, 75, 0));
      grad.addColorStop(1, this.neon(p.hue, 82, alpha));
      ctx.fillStyle = grad;
      ctx.shadowBlur = 6;
      ctx.shadowColor = this.neon(p.hue, 70, alpha);
      ctx.fillRect(p.x, p.y - len, p.size, len);
      ctx.shadowBlur = 0;
      ctx.fillStyle = this.neon(p.hue, 70, alpha * 0.15);
      ctx.fillRect(p.x, floor + (floor - p.y) * 0.3, p.size, len * 0.3);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(200, 230, 255, ${alpha * 0.4})`;
    ctx.fillRect(0, floor, width, 1);
  }

  // ---- PSP: Circle (radial neon bars with dotted rings and a glowing core) --------

  private drawCircle(width: number, height: number, background: boolean): void {
    const { ctx } = this;
    const alpha = background ? 0.45 : 1;
    const cx = width / 2;
    const cy = background ? height * 0.6 : height * 0.5;
    const inner = Math.min(width, height) * (background ? 0.12 : 0.17) * (1 + this.bass * 0.15);
    const reach = Math.min(width, height) * (background ? 0.16 : 0.26);
    const spin = this.time * 0.12;

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    // Bars: one per bucket on each side, from the ring outwards.
    ctx.lineWidth = background ? 2.2 : 3.5;
    for (let i = 0; i < BAR_COUNT; i++) {
      const level = this.levels[i];
      const t = i / BAR_COUNT;
      for (const side of [1, -1]) {
        const angle = spin + side * (t * Math.PI) - Math.PI / 2;
        const r0 = inner + 6;
        const r1 = inner + 8 + level * reach;
        ctx.strokeStyle = this.neon(t, 70, alpha);
        ctx.shadowBlur = background ? 4 : 12;
        ctx.shadowColor = this.neon(t, 65, alpha);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
        ctx.lineTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
    // Dotted rings, turning slowly in opposite directions.
    for (const [mult, count, dir] of [[1.55, 90, 1], [1.95, 130, -1], [2.35, 60, 1]] as const) {
      const r = inner * mult + this.mids * 10;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + spin * dir * 0.5;
        const pulse = 0.5 + 0.5 * Math.sin(i * 0.7 + this.time * 3);
        const size = 1.2 + pulse * 1.6 + this.highs * 2;
        ctx.fillStyle = this.neon((i / count) * 0.8 + 0.1, 78, alpha * (0.35 + pulse * 0.5));
        ctx.fillRect(cx + Math.cos(a) * r - size / 2, cy + Math.sin(a) * r - size / 2, size, size);
      }
    }
    // The core ring.
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = this.neon(0.45, 80, alpha);
    ctx.shadowBlur = background ? 8 : 20;
    ctx.shadowColor = this.neon(0.5, 70, alpha);
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- PSP: Sparkle (glints bursting from the centre) --------------------------------

  private drawSparkle(width: number, height: number, background: boolean, delta: number): void {
    const { ctx } = this;
    const alpha = background ? 0.5 : 1;
    const cx = width / 2;
    const cy = background ? height * 0.62 : height * 0.55;
    // Bursts come from anywhere across the middle band of the screen, and fly far
    // enough to reach its edges, so the whole display sparkles rather than a spot.
    const spawn = Math.floor(8 + this.energy * 40 + this.bass * 48);
    for (let s = 0; s < spawn && this.particles.length < MAX_PARTICLES * 2; s++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (120 + Math.random() * 420) * (0.5 + this.energy) * (background ? 0.6 : 1);
      this.particles.push({
        x: cx + (Math.random() - 0.5) * width * 0.7,
        y: cy + (Math.random() - 0.5) * height * 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 0,
        max: 1.2 + Math.random() * 1.8,
        size: 2 + Math.random() * 5 + this.highs * 4,
        hue: Math.random(),
      });
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += delta;
      if (p.life >= p.max) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.vy -= 20 * delta;
      const t = p.life / p.max;
      const twinkle = 0.6 + 0.4 * Math.sin(p.life * 25 + p.x);
      const a = alpha * (1 - t) * twinkle;
      const size = p.size * (1 - t * 0.5);
      ctx.fillStyle = this.neon(p.hue, 85, a);
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      if (size > 2.4) {
        ctx.fillStyle = this.neon(p.hue, 92, a * 0.6);
        ctx.fillRect(p.x - size * 1.6, p.y - 0.5, size * 3.2, 1);
        ctx.fillRect(p.x - 0.5, p.y - size * 1.6, 1, size * 3.2);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- Tunnel (rainbow spectrum rings rushing past, perspective floor) ------------

  private drawTunnel(width: number, height: number, background: boolean): void {
    const { ctx } = this;
    const alpha = background ? 0.4 : 1;
    const cx = width / 2;
    const cy = background ? height * 0.55 : height * 0.5;
    const rings = 16;
    const maxR = Math.hypot(width, height) * 0.55;
    ctx.globalCompositeOperation = "lighter";
    for (let k = rings - 1; k >= 0; k--) {
      // Rings advance towards the viewer; wrap keeps them flowing.
      const phase = ((k / rings) + (this.time * 0.18) % 1) % 1;
      const r = 8 + Math.pow(phase, 2.2) * maxR;
      const fade = phase * (1 - Math.pow(1 - phase, 3)) * alpha;
      const segs = 48;
      for (let i = 0; i < segs; i++) {
        const band = Math.floor((i / segs) * BAR_COUNT);
        const level = this.levels[band];
        const a0 = (i / segs) * Math.PI * 2 + this.time * 0.1 * (k % 2 ? 1 : -1);
        const a1 = a0 + ((Math.PI * 2) / segs) * 0.85;
        const thick = 3 + level * 34 * phase;
        const hue = (i / segs) * 360 + k * 20;
        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${fade * (0.35 + level * 0.65)})`;
        ctx.lineWidth = thick;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a1);
        ctx.stroke();
      }
    }
    // Floor lights streaking past.
    for (let i = 0; i < 40; i++) {
      const phase = ((i / 40) + (this.time * 0.35) % 1) % 1;
      const y = cy + Math.pow(phase, 2) * (height - cy) + 10;
      const spread = 40 + phase * width * 0.5;
      const lane = ((i % 5) - 2) * spread * 0.4;
      const w = 6 + phase * 40;
      ctx.fillStyle = `hsla(${(i * 47) % 360}, 100%, 62%, ${alpha * phase * 0.7})`;
      ctx.fillRect(cx + lane - w / 2, y, w, 2 + phase * 4);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- Terrain (particle mountains that rise with the music, mirrored in water) --

  private drawTerrain(width: number, height: number, background: boolean): void {
    const { ctx } = this;
    const alpha = background ? 0.45 : 1;
    const water = background ? height * 0.8 : height * 0.7;
    const rows = background ? 8 : 14;
    const cols = 96;
    ctx.globalCompositeOperation = "lighter";
    for (let r = rows - 1; r >= 0; r--) {
      const depth = r / (rows - 1); // 0 = front
      const base = water - depth * height * 0.18;
      const scale = 1 - depth * 0.55;
      const hueT = depth; // green-blue front, violet back
      for (let c = 0; c <= cols; c++) {
        const t = c / cols;
        const band = Math.floor(Math.abs(t - 0.5) * 2 * (BAR_COUNT - 1));
        const ridge =
          Math.sin(t * 9 + r * 1.3 + this.time * 0.3) * 0.5 +
          Math.sin(t * 23 - r * 0.7 + this.time * 0.5) * 0.25 +
          0.75;
        const h = (ridge * 0.35 + this.levels[band] * 1.1) * height * 0.28 * scale;
        const x = width * 0.5 + (t - 0.5) * width * (0.7 + depth * 0.6);
        const y = base - h;
        const size = 1.6 + (1 - depth) * 2.2;
        const hue = 130 + hueT * 150; // green -> cyan -> blue -> violet
        ctx.fillStyle = `hsla(${hue}, 100%, ${60 + (1 - depth) * 25}%, ${alpha * (0.55 + (1 - depth) * 0.45)})`;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        // Dotted column beneath the ridge, sparser further back.
        if (c % 2 === 0) {
          for (let d = 10; d < h; d += 12 + depth * 10) {
            ctx.fillStyle = `hsla(${hue}, 100%, 65%, ${alpha * 0.35 * (1 - depth)})`;
            ctx.fillRect(x - 0.75, y + d, 1.5, 2);
          }
        }
        // Reflection.
        ctx.fillStyle = `hsla(${hue}, 95%, 60%, ${alpha * 0.12 * (1 - depth)})`;
        ctx.fillRect(x - size / 2, water + (water - y) * 0.35, size, size);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(150, 220, 255, ${alpha * 0.25})`;
    ctx.fillRect(0, water, width, 1);
  }

  // ---- Scope (retro oscilloscope: grid, two traces, and a striped sun) ------------

  private drawScope(width: number, height: number, background: boolean): void {
    const { ctx } = this;
    const alpha = background ? 0.45 : 1;
    const cy = background ? height * 0.55 : height * 0.46;
    const amp = height * (background ? 0.12 : 0.22);
    const n = this.wave.length || 2;
    const magenta = `hsla(300, 100%, 65%, ${alpha})`;
    const cyan = `hsla(185, 100%, 65%, ${alpha})`;

    // Grid.
    ctx.strokeStyle = `hsla(220, 90%, 70%, ${alpha * 0.16})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += width / 16) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += height / 10) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Striped sun on the horizon, pulsing with the bass.
    const horizon = background ? height * 0.9 : height * 0.82;
    const sunR = Math.min(width, height) * 0.12 * (1 + this.bass * 0.15);
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, horizon, sunR, Math.PI, 0);
    ctx.clip();
    for (let y = horizon - sunR; y < horizon; y += 6) {
      ctx.fillStyle = `hsla(300, 100%, 60%, ${alpha * 0.55})`;
      ctx.fillRect(width / 2 - sunR, y, sunR * 2, 3.5);
    }
    ctx.restore();

    ctx.globalCompositeOperation = "lighter";
    // Magenta: the smoothed low end (envelope of the wave); cyan: the raw signal.
    const trace = (colour: string, lineWidth: number, blur: number, map: (i: number) => number) => {
      ctx.beginPath();
      for (let i = 0; i < n; i += 2) {
        const x = (i / (n - 1)) * width;
        const y = cy + map(i) * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = colour;
      ctx.shadowBlur = blur;
      ctx.shadowColor = colour;
      ctx.stroke();
    };
    trace(magenta, background ? 2 : 3, background ? 6 : 16, (i) => Math.sin((i / n) * Math.PI * 8 + this.time * 3) * (0.4 + this.bass * 1.2));
    trace(cyan, background ? 1.5 : 2, background ? 4 : 10, (i) => (((this.wave[i] ?? 128) - 128) / 128) * 0.9);
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- Pulse (concentric red-orange rings with a fine radial waveform) ------------

  private drawPulse(width: number, height: number, background: boolean): void {
    const { ctx } = this;
    const alpha = background ? 0.45 : 1;
    const cx = width / 2;
    const cy = background ? height * 0.58 : height * 0.5;
    const base = Math.min(width, height) * (background ? 0.1 : 0.15);
    const n = this.wave.length || 2;
    const warm = (t: number, light: number, a: number) => `hsla(${5 + t * 30}, 100%, ${light}%, ${a})`;

    ctx.globalCompositeOperation = "lighter";
    // Fine radial spikes from the spectrum, all the way round.
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 180; i++) {
      const band = Math.floor((Math.abs((i % 90) - 45) / 45) * (BAR_COUNT - 1));
      const level = this.levels[band];
      const a = (i / 180) * Math.PI * 2 - Math.PI / 2 + this.time * 0.05;
      const r0 = base * 2.1;
      const r1 = r0 + 6 + level * base * 1.6;
      ctx.strokeStyle = warm(level, 60, alpha * (0.3 + level * 0.7));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    // Waveform wrapped round a ring.
    ctx.beginPath();
    for (let i = 0; i <= n; i += 2) {
      const v = ((this.wave[i % n] ?? 128) - 128) / 128;
      const a = (i / n) * Math.PI * 2;
      const r = base * 1.7 + v * base * 0.35;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = warm(0.6, 70, alpha);
    ctx.shadowBlur = background ? 6 : 16;
    ctx.shadowColor = warm(0.5, 60, alpha);
    ctx.stroke();
    // Concentric rings, breathing with the bass, dotted in between.
    for (const [mult, w] of [[1, 3], [1.25, 1.5], [2.05, 1.2]] as const) {
      ctx.beginPath();
      ctx.arc(cx, cy, base * mult * (1 + this.bass * 0.12), 0, Math.PI * 2);
      ctx.lineWidth = w;
      ctx.strokeStyle = warm(mult > 1.5 ? 0.9 : 0.3, 65, alpha * 0.9);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2 - this.time * 0.2;
      const r = base * 1.45 + this.mids * 8;
      ctx.fillStyle = warm(0.4, 75, alpha * (0.4 + 0.5 * Math.sin(i + this.time * 4)));
      ctx.fillRect(cx + Math.cos(a) * r - 1, cy + Math.sin(a) * r - 1, 2, 2);
    }
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, base);
    core.addColorStop(0, warm(0.2, 55, alpha * (0.1 + this.bass * 0.5)));
    core.addColorStop(1, warm(0.2, 50, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, base, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  destroy(): void {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.analyser = null;
    this.root.remove();
  }
}
