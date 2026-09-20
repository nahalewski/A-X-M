import { RibbonBackground } from "../background/RibbonBackground";
import { DEFAULT_MONTH_THEMES, MonthTheme, Settings } from "./types";

/**
 * Turns the theme settings into what the ribbon background actually draws.
 *
 * The PS3 XMB changed its colour with the calendar month; "monthly" mode does the
 * same, applying whichever of the twelve entries matches today. "fixed" pins one
 * look, "cycle" keeps the original drifting palette, and "image" puts a chosen
 * picture behind the ribbons.
 */

/** Presets the settings menu cycles through. Kept short so a press lands somewhere useful. */
export const RIBBON_SPEED_PRESETS = [0.1, 0.16, 0.22, 0.3, 0.4, 0.55];
export const RIBBON_WIDTH_PRESETS = [0.6, 0.8, 1.0, 1.2, 1.5];

/** Ribbon tints: white plus pale washes, since the bands are drawn translucent. */
export const RIBBON_COLOR_PRESETS: { label: string; value: string }[] = [
  { label: "White", value: "#ffffff" },
  { label: "Ice", value: "#dcebff" },
  { label: "Sky", value: "#b9dcff" },
  { label: "Mint", value: "#d4fff0" },
  { label: "Lime", value: "#e4ffc8" },
  { label: "Gold", value: "#ffe6a8" },
  { label: "Peach", value: "#ffd8b8" },
  { label: "Rose", value: "#ffc9d6" },
  { label: "Lavender", value: "#e2d2ff" },
  { label: "Cyan", value: "#bafcff" },
];

/** Backdrop colours: deep, so white text and ribbons read against them. */
export const BACKGROUND_COLOR_PRESETS: { label: string; value: string }[] = [
  { label: "Midnight", value: "#0d2a6b" },
  { label: "Navy", value: "#12325f" },
  { label: "Ocean", value: "#123f6d" },
  { label: "Teal", value: "#0b4f5e" },
  { label: "Forest", value: "#13503c" },
  { label: "Moss", value: "#255c1d" },
  { label: "Plum", value: "#3d1b52" },
  { label: "Magenta", value: "#5a2350" },
  { label: "Wine", value: "#54121c" },
  { label: "Rust", value: "#5e2a08" },
  { label: "Amber", value: "#6b3a0c" },
  { label: "Slate", value: "#1e2a3a" },
  { label: "Black", value: "#05070f" },
];

export function currentMonthIndex(now = new Date()): number {
  return now.getMonth();
}

/** Which theme is in force right now, given the mode. Null means "not theme-driven". */
export function activeTheme(settings: Settings, now = new Date()): MonthTheme | null {
  switch (settings.themeMode) {
    case "monthly":
      return settings.monthlyThemes[currentMonthIndex(now)] ?? DEFAULT_MONTH_THEMES[currentMonthIndex(now)];
    case "fixed":
      return settings.fixedTheme;
    case "image":
      // Ribbon look still comes from the fixed theme; only the backdrop is replaced.
      return settings.fixedTheme;
    case "cycle":
    default:
      return null;
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** "#rrggbb" scaled toward black by `factor` (0..1). Used to derive the gradient bottom. */
export function darken(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => clampByte(parseInt(h, 16) * (1 - factor)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function labelForColor(presets: { label: string; value: string }[], value: string): string {
  return presets.find((p) => p.value.toLowerCase() === value.toLowerCase())?.label ?? value.toUpperCase();
}

export class ThemeManager {
  private appliedMonth = -1;

  constructor(private ribbon: RibbonBackground, private backgroundLayer: HTMLElement) {}

  /** Pushes the current theme settings into the ribbon and the page. Cheap to call repeatedly. */
  apply(settings: Settings): void {
    const theme = activeTheme(settings);
    this.appliedMonth = currentMonthIndex();

    // The picture lives on the container behind the ribbon canvas; the canvas is
    // transparent, so with the backdrop off the image shows through the bands.
    const useImage = settings.themeMode === "image" && settings.customImageUrl.length > 0;
    this.backgroundLayer.classList.toggle("has-image", useImage);
    this.backgroundLayer.style.backgroundImage = useImage ? `url("${settings.customImageUrl}")` : "";

    if (!theme) {
      // "cycle": the original drifting palette, white ribbons at stock size.
      this.ribbon.setColor("#ffffff");
      this.ribbon.setSpeed(0.25);
      this.ribbon.setRibbonWidth(1);
      this.ribbon.setBackdrop("cycle");
    } else {
      this.ribbon.setColor(theme.ribbonColor);
      this.ribbon.setSpeed(theme.ribbonSpeed);
      this.ribbon.setRibbonWidth(theme.ribbonWidth);
      if (useImage) {
        this.ribbon.setBackdrop("none");
      } else {
        this.ribbon.setBackdrop("static", [theme.backgroundColor, darken(theme.backgroundColor, 0.72)]);
      }
    }

    this.ribbon.setRibbonsVisible(settings.ribbonEnabled);
  }

  /** True when the calendar has rolled into a new month since the last apply. */
  monthChanged(): boolean {
    return this.appliedMonth !== -1 && this.appliedMonth !== currentMonthIndex();
  }
}
