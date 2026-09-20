/**
 * Wi-Fi and Bluetooth indicators for the status bar, from the supplied sprite sheet
 * (re-tiled into an exact 4x4 grid, same treatment as the battery sheet). Frames:
 *
 *   0-3  Wi-Fi 4/3/2/1 bars     4 weak   5 no signal   6 off   7 hotspot
 *   8    BT on     9 BT active    10 BT (alt)   11 BT off
 *   12   BT paired 13 BT search   14 BT lost    15 BT device connected
 *
 * Only the useful ones are used. Same mask-and-tint technique as the battery.
 */

const COLS = 4;

function framePosition(frame: number): string {
  const col = frame % COLS;
  const row = Math.floor(frame / COLS);
  return `${(col * 100) / (COLS - 1)}% ${(row * 100) / (COLS - 1)}%`;
}

const POLL_MS = 15_000;

export class StatusIcons {
  private wifiEl: HTMLElement;
  private btEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.btEl = this.make(parent, "bt");
    this.wifiEl = this.make(parent, "wifi");
  }

  private make(parent: HTMLElement, kind: string): HTMLElement {
    const el = document.createElement("div");
    el.className = `status-icon ${kind} hidden`;
    parent.appendChild(el);
    return el;
  }

  private setFrame(el: HTMLElement, frame: number, title: string, dim: boolean): void {
    el.classList.remove("hidden");
    el.style.maskPosition = framePosition(frame);
    el.style.webkitMaskPosition = framePosition(frame);
    el.title = title;
    el.classList.toggle("dim", dim);
  }

  start(): void {
    void this.poll();
    window.setInterval(() => void this.poll(), POLL_MS);
  }

  private async poll(): Promise<void> {
    const [wifi, bt] = await Promise.all([
      window.axm.getWifiStatus().catch(() => null),
      window.axm.getBluetoothStatus().catch(() => null),
    ]);

    if (!wifi || !wifi.present) {
      this.wifiEl.classList.add("hidden");
    } else if (!wifi.connected) {
      this.setFrame(this.wifiEl, 6, "Wi-Fi not connected", true);
    } else {
      const s = wifi.signal ?? 0;
      const frame = s >= 80 ? 0 : s >= 60 ? 1 : s >= 40 ? 2 : s >= 20 ? 3 : 4;
      this.setFrame(this.wifiEl, frame, `${wifi.ssid ?? "Wi-Fi"} · ${s}%`, false);
    }

    if (!bt || !bt.present) {
      this.btEl.classList.add("hidden");
    } else if (!bt.enabled) {
      this.setFrame(this.btEl, 11, "Bluetooth off", true);
    } else if (bt.connectedCount > 0) {
      this.setFrame(this.btEl, 15, `Bluetooth · ${bt.connectedCount} connected`, false);
    } else {
      this.setFrame(this.btEl, 8, "Bluetooth on", true);
    }
  }
}
