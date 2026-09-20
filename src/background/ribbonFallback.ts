import {
  BACKDROP_PALETTE,
  LAYER_SPECS,
  QUALITY_PROFILES,
  QualityLevel,
  RibbonOptions,
  hexToRgb,
  wrapIndex,
} from "./ribbonTypes";

/**
 * Canvas 2D fallback, used only when a WebGL context can't be created - a remote
 * session, a blacklisted driver, or a machine with no usable GPU.
 *
 * It aims for the same silhouette as the WebGL version rather than the same
 * material: each ribbon is the same summed-sine centreline, stroked several times
 * at decreasing width and increasing alpha so the band has a soft edge and a bright
 * core without any per-pixel work. There's no twist and no real depth, because
 * neither is worth the CPU cost on hardware that already couldn't give us WebGL.
 */

/** Horizontal sample spacing in CSS pixels. Larger is cheaper and blockier. */
const SAMPLE_STEP = 14;

/** Width multipliers and alpha weights for the soft-edge stroke passes. */
const PASSES: [number, number][] = [
  [2.4, 0.20],
  [1.5, 0.34],
  [0.7, 1.0],
];

const REFERENCE_OPACITY = 0.22;

export class RibbonFallbackRenderer {
  readonly domElement: HTMLCanvasElement;

  private ctx: CanvasRenderingContext2D;
  private options: RibbonOptions;
  private profile = QUALITY_PROFILES.low;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  private ribbonTime = 0;
  private backdropTime = 0;
  private boost = 1;
  private pulseAmount = 0;

  private colorRgb: [number, number, number];

  constructor(container: HTMLElement, options: RibbonOptions, level: QualityLevel) {
    this.options = options;
    this.profile = QUALITY_PROFILES[level] ?? QUALITY_PROFILES.medium;
    this.colorRgb = hexToRgb(options.color);

    const canvas = document.createElement("canvas");
    canvas.className = "ribbon-canvas";
    container.appendChild(canvas);
    this.domElement = canvas;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas 2D is unavailable");
    this.ctx = ctx;

    this.resize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  }

  render(deltaSeconds: number, speed: number): void {
    const decay = Math.exp(-deltaSeconds * 2.2);
    this.boost = 1 + (this.boost - 1) * decay;
    this.pulseAmount *= decay;

    this.ribbonTime += deltaSeconds * speed * this.boost;
    this.backdropTime += deltaSeconds;

    const { ctx } = this;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawBackdrop();

    const count = Math.max(1, Math.min(this.options.layers, this.profile.maxLayers, LAYER_SPECS.length));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (let i = 0; i < count; i++) {
      this.drawRibbon(LAYER_SPECS[i]);
    }
  }

  private drawBackdrop(): void {
    if (this.options.backdrop === "none") return;
    const { ctx } = this;

    let top: string;
    let bottom: string;
    if (this.options.backdrop === "static") {
      [top, bottom] = this.options.backdropColors;
    } else {
      const cycle = Math.max(2, this.options.backdropCycleSeconds);
      const index = wrapIndex(this.backdropTime / cycle, BACKDROP_PALETTE.length);
      // No interpolation here: a gradient object per frame would allocate, and the
      // step is barely visible against the ribbons at this fidelity.
      [top, bottom] = BACKDROP_PALETTE[index];
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawRibbon(spec: (typeof LAYER_SPECS)[number]): void {
    const { ctx } = this;
    const t = this.ribbonTime * spec.speed + spec.phase;
    const amplitude = spec.amplitude * this.options.waveStrength * (1 + this.pulseAmount * 0.55);

    // World units in the WebGL version map to roughly half the viewport height.
    const scaleY = this.height * 0.5;
    const centreY = this.height * 0.5 - spec.yOffset * scaleY;
    const amplitudePx = amplitude * scaleY;
    const thicknessPx = spec.thickness * scaleY * 0.5;

    const alpha = spec.opacity * (this.options.opacity / REFERENCE_OPACITY);
    const [r, g, b] = this.colorRgb;
    const rgb = `${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}`;

    for (const [widthScale, alphaScale] of PASSES) {
      ctx.beginPath();
      for (let px = -SAMPLE_STEP; px <= this.width + SAMPLE_STEP; px += SAMPLE_STEP) {
        // Normalised to -0.5..0.5 so the frequencies match the WebGL shader.
        const x = px / this.width - 0.5;
        const y =
          Math.sin(x * spec.frequency + t * 1.0) * amplitudePx +
          Math.sin(x * spec.frequency * 1.93 - t * 0.63) * amplitudePx * 0.45 +
          Math.sin(x * spec.frequency * 0.47 + t * 0.35) * amplitudePx * 0.75;
        if (px < 0) ctx.moveTo(px, centreY + y);
        else ctx.lineTo(px, centreY + y);
      }

      // Fading both ends stops the stroke terminating on a visible flat cap.
      const stroke = ctx.createLinearGradient(0, 0, this.width, 0);
      const solid = `rgba(${rgb}, ${(alpha * alphaScale).toFixed(4)})`;
      const clear = `rgba(${rgb}, 0)`;
      stroke.addColorStop(0, clear);
      stroke.addColorStop(0.18, solid);
      stroke.addColorStop(0.82, solid);
      stroke.addColorStop(1, clear);

      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, thicknessPx * widthScale);
      ctx.stroke();
    }
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio);
    this.domElement.width = Math.floor(this.width * this.pixelRatio);
    this.domElement.height = Math.floor(this.height * this.pixelRatio);
    this.domElement.style.width = `${this.width}px`;
    this.domElement.style.height = `${this.height}px`;
  }

  setColor(color: string): void {
    this.options.color = color;
    this.colorRgb = hexToRgb(color);
  }

  setOpacity(opacity: number): void {
    this.options.opacity = opacity;
  }

  setWaveStrength(strength: number): void {
    this.options.waveStrength = strength;
  }

  /** The fallback has no bloom term; accepted and ignored so the API matches. */
  setGlow(_glow: boolean): void {}

  setLayerCount(count: number): void {
    this.options.layers = count;
  }

  setBackdropCycleSeconds(seconds: number): void {
    this.options.backdropCycleSeconds = seconds;
  }

  setQuality(level: QualityLevel): void {
    this.profile = QUALITY_PROFILES[level] ?? QUALITY_PROFILES.medium;
    this.resize(this.width, this.height);
  }

  /** No depth to parallax against; accepted and ignored so the API matches. */
  setParallax(_x: number): void {}

  nudge(strength = 0.6): void {
    this.boost = 1 + strength;
  }

  pulse(strength = 1): void {
    this.pulseAmount = strength;
  }

  destroy(): void {
    this.domElement.remove();
  }
}
