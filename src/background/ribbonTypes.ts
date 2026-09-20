/**
 * Shared types, presets and per-layer tuning for the ribbon background.
 *
 * Everything the effect's look depends on lives here, so tuning the ribbon means
 * editing constants in this file rather than hunting through renderer code. See the
 * "Tuning" section of README.md for what each knob does.
 */

export type QualityLevel = "low" | "medium" | "high";

/** "auto" starts at `high` and steps down on its own if frames get expensive. */
export type Quality = QualityLevel | "auto";

/** How the area behind the ribbons is painted. */
export type BackdropMode = "cycle" | "static" | "none";

export interface InteractivityOptions {
  /** Master switch. Everything below is ignored unless this is true. */
  enabled: boolean;
  /** Brief horizontal acceleration when the menu selection moves. */
  navigationBoost: boolean;
  /** Ribbons lean slightly toward the pointer. */
  pointerParallax: boolean;
  /** One-off swell when a game is chosen. */
  selectionPulse: boolean;
}

export interface RibbonOptions {
  /** Ribbon tint, any CSS color string. Soft white reads best. */
  color: string;
  /** Master opacity multiplier applied on top of each layer's own opacity. */
  opacity: number;
  /** Global time scale. 1 is the tuned default; 0.5 is half speed. */
  speed: number;
  /** Requested layer count. Clamped by the active quality profile. */
  layers: number;
  quality: Quality;
  /** Adds a soft bloom in the ribbon core. Forced off by the low profile. */
  glow: boolean;
  /** Multiplies every layer's amplitude. Above ~1.6 the bands start to collide. */
  waveStrength: number;
  /** False freezes the ribbons without tearing down the GL context. */
  animate: boolean;
  backdrop: BackdropMode;
  /** Seconds per palette step when `backdrop` is "cycle". */
  backdropCycleSeconds: number;
  /** Gradient used when `backdrop` is "static", as [top, bottom] CSS colors. */
  backdropColors: [string, string];
  interactivity: InteractivityOptions;
}

export const DEFAULT_OPTIONS: RibbonOptions = {
  color: "#ffffff",
  opacity: 0.22,
  speed: 0.25,
  layers: 4,
  quality: "auto",
  glow: true,
  waveStrength: 1,
  animate: true,
  backdrop: "cycle",
  backdropCycleSeconds: 18,
  backdropColors: ["#0b1430", "#05070f"],
  interactivity: {
    enabled: false,
    navigationBoost: true,
    pointerParallax: true,
    selectionPulse: true,
  },
};

export interface QualityProfile {
  /** Hard ceiling on layers, whatever the caller asked for. */
  maxLayers: number;
  /** Subdivisions along the ribbon. This is what the wave's smoothness costs. */
  segmentsX: number;
  /** Subdivisions across the band. 2-4 is plenty; the twist needs more than 1. */
  segmentsY: number;
  maxPixelRatio: number;
  /** Low-end hardware drops the bloom term entirely. */
  allowGlow: boolean;
  antialias: boolean;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: { maxLayers: 2, segmentsX: 48, segmentsY: 2, maxPixelRatio: 1, allowGlow: false, antialias: false },
  medium: { maxLayers: 3, segmentsX: 96, segmentsY: 3, maxPixelRatio: 1.5, allowGlow: true, antialias: true },
  high: { maxLayers: 5, segmentsX: 176, segmentsY: 4, maxPixelRatio: 2, allowGlow: true, antialias: true },
};

/** Ordered worst to best, so the auto-quality monitor can step down by index. */
export const QUALITY_ORDER: QualityLevel[] = ["low", "medium", "high"];

/**
 * Per-layer character. Each entry is one ribbon; the first `n` are used, so the
 * order matters - layer 0 should be the calmest, since low quality only draws two.
 *
 * `depth` is a world-space Z offset. Layers further from the camera cover more of
 * the screen for the same geometry and therefore appear to drift more slowly,
 * which is where the parallax comes from.
 */
export interface LayerSpec {
  speed: number;
  opacity: number;
  amplitude: number;
  /** Wave cycles across the ribbon's own length. */
  frequency: number;
  /** Keeps layers from starting in lockstep. */
  phase: number;
  /** World-space vertical placement of the band's centre. */
  yOffset: number;
  depth: number;
  /** Band thickness in world units before the taper is applied. */
  thickness: number;
}

export const LAYER_SPECS: LayerSpec[] = [
  { speed: 0.10, opacity: 0.08, amplitude: 0.15, frequency: 5.6, phase: 0.0, yOffset: 0.18, depth: -1.5, thickness: 0.62 },
  { speed: 0.16, opacity: 0.12, amplitude: 0.22, frequency: 7.1, phase: 1.7, yOffset: -0.10, depth: -0.9, thickness: 0.50 },
  { speed: 0.22, opacity: 0.18, amplitude: 0.30, frequency: 8.8, phase: 3.4, yOffset: 0.05, depth: -0.35, thickness: 0.40 },
  { speed: 0.28, opacity: 0.10, amplitude: 0.18, frequency: 11.2, phase: 5.1, yOffset: -0.28, depth: 0.15, thickness: 0.30 },
  { speed: 0.34, opacity: 0.07, amplitude: 0.24, frequency: 13.5, phase: 2.3, yOffset: 0.32, depth: 0.45, thickness: 0.24 },
];

/**
 * Backdrop palette, cycled when `backdrop` is "cycle". These are the deep,
 * desaturated tones a console menu sits on - the ribbons supply the brightness,
 * so anything lighter than this washes them out.
 */
export const BACKDROP_PALETTE: [string, string][] = [
  ["#16386e", "#050a18"],
  ["#12503f", "#050f10"],
  ["#4d1a5e", "#0f0616"],
  ["#5c3208", "#150b04"],
  ["#0d4a52", "#041013"],
  ["#54101f", "#16060a"],
  ["#361461", "#0c0618"],
  ["#0b3c6b", "#040c18"],
];

/** Modulo that stays non-negative, so a negative time can't index off the palette. */
export function wrapIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((Math.floor(value) % length) + length) % length;
}

/** Parsed once at module load so the render loop never touches string parsing. */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) return [1, 1, 1];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
