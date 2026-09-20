import { HardwareInfo } from "./types";

/**
 * Two optional readouts: a frame-rate counter top-left and a hardware summary
 * bottom-left. Both off by default; toggled from Settings.
 *
 * The counter measures the menu's own paint rate from requestAnimationFrame, which
 * is what the user actually sees - not the ribbon's internal cap.
 */
export class Hud {
  private fpsEl: HTMLElement;
  private hwEl: HTMLElement;
  private raf = 0;
  private frames = 0;
  private windowStart = 0;

  constructor(parent: HTMLElement) {
    this.fpsEl = document.createElement("div");
    this.fpsEl.id = "fps-counter";
    this.fpsEl.className = "hidden";
    this.hwEl = document.createElement("div");
    this.hwEl.id = "hardware-info";
    this.hwEl.className = "hidden";
    parent.append(this.fpsEl, this.hwEl);
  }

  setFpsVisible(visible: boolean): void {
    this.fpsEl.classList.toggle("hidden", !visible);
    if (visible && !this.raf) {
      this.frames = 0;
      this.windowStart = performance.now();
      const tick = (now: number) => {
        this.raf = requestAnimationFrame(tick);
        this.frames++;
        const elapsed = now - this.windowStart;
        if (elapsed >= 500) {
          this.fpsEl.textContent = `${Math.round((this.frames * 1000) / elapsed)} FPS`;
          this.frames = 0;
          this.windowStart = now;
        }
      };
      this.raf = requestAnimationFrame(tick);
    } else if (!visible && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  async setHardwareVisible(visible: boolean): Promise<void> {
    this.hwEl.classList.toggle("hidden", !visible);
    if (!visible || this.hwEl.childElementCount > 0) return;
    let info: HardwareInfo;
    try {
      info = await window.axm.getHardwareInfo();
    } catch {
      return;
    }
    const rows: [string, string][] = [
      ["Device", info.model ? `${info.model} · ${info.deviceName}` : info.deviceName],
      ["CPU", `${info.cpu} · ${info.cpuGhz} GHz`],
      ["RAM", `${info.ramGb} GB`],
      ["GPU", info.gpuGb ? `${info.gpu} · ${info.gpuGb} GB` : info.gpu],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "hw-row";
      const l = document.createElement("span");
      l.className = "hw-label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "hw-value";
      v.textContent = value;
      row.append(l, v);
      this.hwEl.appendChild(row);
    }
  }
}
