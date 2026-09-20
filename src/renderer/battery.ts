import { AnkerStatus } from "./types";

/**
 * Battery indicators in the top-right corner.
 *
 * The sprite sheet is a 4x4 grid: rows 0-1 are eight discharge frames from full to
 * empty, rows 2-3 are eight charging frames with a bolt, filling up. It's white on
 * transparent, so it's used as a CSS mask and tinted - white for the Ally's own
 * battery, blue for the Anker power bank - rather than shipping two sheets.
 *
 * The Anker indicator only appears when all three of these hold: the bank is
 * connected over Bluetooth, its level has been falling (it's supplying power), and
 * the Ally reports it's being charged. Otherwise only the white one shows.
 */

const COLS = 4;
const FRAME_MS = 420;
const ANKER_POLL_MS = 20_000;

/**
 * The sheet is re-tiled from the supplied art into an exact 4x4 grid (see the
 * commit that added it), so each cell is a quarter of the sheet and a frame is
 * simply its cell. mask-size 400% makes one cell fill the box.
 */
export const MASK_SCALE = 4;

/** Sprite frame index (0-15) -> mask-position that centres the box on that cell. */
export function framePosition(frame: number): string {
  const col = frame % COLS;
  const row = Math.floor(frame / COLS);
  // CSS percentage positioning aligns the mask's p% point with the box's p% point;
  // solve for p so a cell's centre lands on the box's centre.
  const p = (centre: number) => ((0.5 - MASK_SCALE * centre) / (1 - MASK_SCALE)) * 100;
  return `${p((col + 0.5) / COLS).toFixed(3)}% ${p((row + 0.5) / COLS).toFixed(3)}%`;
}

/** Discharge frame for a 0..1 level: 0 is four bars, 6 is empty. */
function dischargeFrame(level: number): number {
  if (level >= 0.87) return 0;
  if (level >= 0.7) return 1;
  if (level >= 0.5) return 2;
  if (level >= 0.3) return 3;
  if (level >= 0.15) return 4;
  if (level >= 0.05) return 5;
  return 6;
}

/** Charging frame for a 0..1 level: 8 is bolt on empty, 15 is bolt on full. */
function chargeFrame(level: number): number {
  return 8 + Math.min(7, Math.floor(level * 8));
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
}

class Indicator {
  el: HTMLElement;
  private label: HTMLElement;
  private timer = 0;
  private animFrame = 0;

  constructor(parent: HTMLElement, tintClass: string) {
    this.el = document.createElement("div");
    this.el.className = `battery ${tintClass} hidden`;
    const icon = document.createElement("div");
    icon.className = "battery-icon";
    this.label = document.createElement("div");
    this.label.className = "battery-label";
    this.el.append(icon, this.label);
    parent.appendChild(this.el);
  }

  private icon(): HTMLElement {
    return this.el.firstElementChild as HTMLElement;
  }

  show(): void {
    this.el.classList.remove("hidden");
  }

  hide(): void {
    this.el.classList.add("hidden");
    this.stopAnimation();
  }

  private setFrame(frame: number): void {
    this.icon().style.maskPosition = framePosition(frame);
    this.icon().style.webkitMaskPosition = framePosition(frame);
  }

  private stopAnimation(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  /** Static level, the way a phone shows it when unplugged. */
  showLevel(level: number, text: string): void {
    this.stopAnimation();
    this.setFrame(dischargeFrame(level));
    this.label.textContent = text;
    this.el.classList.toggle("low", level < 0.15);
    this.el.classList.remove("charging");
  }

  /**
   * Filling animation from the current level up to full, then back to the current
   * level, over and over - the familiar "it's charging" cue. Once full, holds the
   * final frame rather than looping.
   */
  showCharging(level: number, full: boolean, text: string): void {
    this.label.textContent = text;
    this.el.classList.add("charging");
    this.el.classList.remove("low");
    if (full) {
      this.stopAnimation();
      this.setFrame(15);
      return;
    }
    const start = chargeFrame(level);
    if (!this.timer) {
      this.animFrame = start;
      this.setFrame(this.animFrame);
      this.timer = window.setInterval(() => {
        this.animFrame = this.animFrame >= 15 ? chargeFrame(level) : this.animFrame + 1;
        this.setFrame(this.animFrame);
      }, FRAME_MS);
    }
  }
}

export class BatteryIndicators {
  private ally: Indicator;
  private anker: Indicator;
  private allyCharging = false;
  private allyLevel = 1;

  constructor(parent: HTMLElement) {
    this.anker = new Indicator(parent, "anker");
    this.ally = new Indicator(parent, "ally");
  }

  async start(): Promise<void> {
    await this.watchAlly();
    void this.pollAnker();
    window.setInterval(() => void this.pollAnker(), ANKER_POLL_MS);
  }

  private async watchAlly(): Promise<void> {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (!nav.getBattery) {
      // No Battery Status API (unusual in Chromium) - nothing sensible to show.
      this.ally.hide();
      return;
    }
    let battery: BatteryManagerLike;
    try {
      battery = await nav.getBattery();
    } catch {
      this.ally.hide();
      return;
    }
    const update = () => {
      this.allyCharging = battery.charging;
      this.allyLevel = battery.level;
      const pct = `${Math.round(battery.level * 100)}%`;
      this.ally.show();
      if (battery.charging) {
        // chargingTime of 0 while charging means it's already full.
        this.ally.showCharging(battery.level, battery.chargingTime === 0 || battery.level >= 0.995, pct);
      } else {
        this.ally.showLevel(battery.level, pct);
      }
    };
    battery.addEventListener("levelchange", update);
    battery.addEventListener("chargingchange", update);
    battery.addEventListener("chargingtimechange", update);
    update();
  }

  private async pollAnker(): Promise<void> {
    let status: AnkerStatus;
    try {
      status = await window.axm.getAnkerStatus();
    } catch {
      this.anker.hide();
      return;
    }
    // All three, or nothing: connected, draining, and the Ally is taking a charge.
    const show = status.connected && status.depleting && this.allyCharging && status.level !== null;
    if (!show) {
      this.anker.hide();
      return;
    }
    this.anker.show();
    this.anker.showLevel((status.level ?? 0) / 100, `${status.level}%`);
    this.anker.el.title = status.deviceName ?? "Power bank";
  }
}
