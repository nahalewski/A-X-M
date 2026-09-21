// Polls the Gamepad API each frame and emits edge-triggered (just-pressed) actions,
// with dpad/stick repeat-on-hold for navigation.

export type PadAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context" | "guide";

const REPEAT_DELAY_MS = 380;
const REPEAT_RATE_MS = 110;
const DEFAULT_DEADZONE = 0.5;

export interface PadSnapshot {
  index: number;
  id: string;
  name: string;
  type: ControllerType;
  model: string;
  buttons: number;
  axes: number;
  vibration: boolean;
}

// Standard Xbox-layout mapping (also matches ROG Xbox Ally's controls).
const BUTTON_A = 0;
const BUTTON_B = 1;
const BUTTON_Y = 3;
// Xbox / PS button. Only delivered while this window is focused, so it can close
// the overlay; opening it from a game is the main process's XInput poll.
const BUTTON_GUIDE = 16;
const BUTTON_DPAD_UP = 12;
const BUTTON_DPAD_DOWN = 13;
const BUTTON_DPAD_LEFT = 14;
const BUTTON_DPAD_RIGHT = 15;

interface DirState {
  held: boolean;
  nextRepeat: number;
}

/** The glyph family: which face-button pictures the footer draws. */
export type ControllerType = "xbox" | "ps" | "switch" | "kishi";

/** Vendor / product ids Chromium embeds in a pad's id string. */
function usbIds(id: string): { vendor: string; product: string } {
  const m = id.match(/vendor:\s*([0-9a-f]{4}).*product:\s*([0-9a-f]{4})/i);
  return { vendor: (m?.[1] ?? "").toLowerCase(), product: (m?.[2] ?? "").toLowerCase() };
}

/**
 * Which family a pad belongs to - by the USB vendor id first (Sony 054c,
 * Nintendo 057e, Razer 1532), then by name. Everything else is Xbox layout, which
 * the Ally's own controls, GameSir, 8BitDo and CRKD pads all use. "Wireless
 * Controller" alone is not Sony: half the market calls itself that.
 */
export function controllerTypeOf(id: string): ControllerType {
  const { vendor } = usbIds(id);
  if (vendor === "054c" || /dualsense|dualshock|playstation|\bsony\b/i.test(id)) return "ps";
  if (vendor === "057e" || /nintendo|switch pro|joy-con|joycon/i.test(id)) return "switch";
  if (vendor === "1532" || /kishi|razer/i.test(id)) return "kishi";
  return "xbox";
}

/**
 * The pad's actual model, for the toast and the Controller settings: "DualSense
 * Edge", "Xbox Series", "GameSir (Xbox layout)", "CRKD guitar"...
 */
export function controllerModelOf(id: string): string {
  const { vendor, product } = usbIds(id);
  const name = id.replace(/\s*\(.*$/, "").trim();
  const sony: Record<string, string> = { "0ce6": "DualSense (PS5)", "0df2": "DualSense Edge (PS5)", "09cc": "DualShock 4 (PS4)", "05c4": "DualShock 4 (PS4)", "0268": "DualShock 3 (PS3)", "0e5f": "PlayStation Access" };
  const ms: Record<string, string> = { "0b12": "Xbox Series X|S", "0b13": "Xbox Series X|S", "0b20": "Xbox Elite Series 2", "0b22": "Xbox Elite Series 2", "0b00": "Xbox Elite", "02ea": "Xbox One S", "02fd": "Xbox One S", "02e0": "Xbox One S", "02dd": "Xbox One", "02d1": "Xbox One", "028e": "Xbox 360", "0b0a": "Xbox Adaptive", "0b0c": "Xbox Adaptive" };
  const nin: Record<string, string> = { "2009": "Switch Pro Controller", "2006": "Joy-Con (L)", "2007": "Joy-Con (R)", "200e": "Joy-Con grip", "2017": "Switch NES controller", "2019": "Switch SNES controller" };
  if (vendor === "054c") return sony[product] ?? (/edge/i.test(name) ? "DualSense Edge (PS5)" : /dualsense/i.test(name) ? "DualSense (PS5)" : "PlayStation controller");
  if (vendor === "045e") return ms[product] ?? "Xbox controller";
  if (vendor === "057e") return nin[product] ?? "Nintendo Switch controller";
  if (vendor === "1532" || /kishi/i.test(name)) return /v2|ultra/i.test(name) ? "Razer Kishi V2" : "Razer Kishi";
  if (vendor === "0b05" || /rog ally|ally/i.test(name)) return "ROG Ally controls";
  if (vendor === "3537" || /gamesir/i.test(name)) return `GameSir${name.match(/gamesir[-\s]*([a-z0-9]+)/i)?.[1] ? " " + name.match(/gamesir[-\s]*([a-z0-9]+)/i)![1] : ""} (Xbox layout)`;
  if (vendor === "2dc8" || /8bitdo/i.test(name)) return "8BitDo (Xbox layout)";
  if (/crkd/i.test(name)) return /guitar|gibson|les paul/i.test(name) ? "CRKD guitar" : /nitro/i.test(name) ? "CRKD Nitro Deck" : "CRKD (Xbox layout)";
  if (/guitar/i.test(name)) return "Guitar controller";
  if (/dualsense|dualshock/i.test(name)) return "PlayStation controller";
  return name || "Controller";
}

export class GamepadNav {
  private deadZone = DEFAULT_DEADZONE;
  private swapConfirm = false;
  private vibration = true;

  setDeadZone(value: number): void {
    this.deadZone = Math.min(0.9, Math.max(0.1, value));
  }

  /** Nintendo-style: the right-hand button confirms and the bottom one backs out. */
  setSwapConfirm(on: boolean): void {
    this.swapConfirm = on;
  }

  setVibration(on: boolean): void {
    this.vibration = on;
  }

  /** A short rumble on every pad that can, if vibration is on. */
  rumble(ms = 200): void {
    if (!this.vibration) return;
    for (const pad of navigator.getGamepads?.() ?? []) {
      const actuator = (pad as (Gamepad & { vibrationActuator?: { playEffect: (type: string, params: object) => Promise<string> } }) | null)?.vibrationActuator;
      actuator?.playEffect("dual-rumble", { startDelay: 0, duration: ms, weakMagnitude: 0.6, strongMagnitude: 0.8 }).catch(() => {});
    }
  }

  /** What's connected right now, for the Controller settings view. */
  snapshot(): PadSnapshot[] {
    const out: PadSnapshot[] = [];
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      out.push({
        index: pad.index,
        id: pad.id,
        name: pad.id.replace(/\s*\(.*$/, "").trim() || pad.id,
        type: controllerTypeOf(pad.id),
        model: controllerModelOf(pad.id),
        buttons: pad.buttons.length,
        axes: pad.axes.length,
        vibration: !!(pad as Gamepad & { vibrationActuator?: unknown }).vibrationActuator,
      });
    }
    return out;
  }

  private lastType: ControllerType | null = null;
  private lastModel = "";
  private onType: ((type: ControllerType, model: string) => void) | null = null;

  /** Called whenever the connected controller's family changes (Xbox vs PlayStation). */
  setOnControllerType(callback: (type: ControllerType, model: string) => void): void {
    this.onType = callback;
  }
  private prevButtons = new Map<number, boolean[]>();
  private dirState: Record<"up" | "down" | "left" | "right", DirState> = {
    up: { held: false, nextRepeat: 0 },
    down: { held: false, nextRepeat: 0 },
    left: { held: false, nextRepeat: 0 },
    right: { held: false, nextRepeat: 0 },
  };

  constructor(private onAction: (action: PadAction) => void) {}

  poll(now: number): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    // Directions are merged across every connected pad and handled once per frame.
    // The Ally (and many pads) show up twice - XInput and a HID twin - and per-pad
    // handling with one shared hold state made the idle twin release the hold each
    // frame, so one press fired again and again and skipped two or three columns.
    const want = { up: false, down: false, left: false, right: false };
    let typed = false;
    for (const pad of pads) {
      if (!pad) continue;
      // The glyph set follows the first pad only; a second pad of another family
      // would otherwise flip the glyphs (and the toast) every frame.
      if (!typed) {
        typed = true;
        const type = controllerTypeOf(pad.id);
        const model = controllerModelOf(pad.id);
        if (type !== this.lastType || model !== this.lastModel) {
          this.lastType = type;
          this.lastModel = model;
          this.onType?.(type, model);
        }
      }
      const prev = this.prevButtons.get(pad.index) ?? [];
      const cur = pad.buttons.map((b) => b.pressed);

      const confirmBtn = this.swapConfirm ? BUTTON_B : BUTTON_A;
      const backBtn = this.swapConfirm ? BUTTON_A : BUTTON_B;
      if (cur[confirmBtn] && !prev[confirmBtn]) this.onAction("confirm");
      if (cur[backBtn] && !prev[backBtn]) this.onAction("back");
      if (cur[BUTTON_Y] && !prev[BUTTON_Y]) this.onAction("context");
      if (cur[BUTTON_GUIDE] && !prev[BUTTON_GUIDE]) this.onAction("guide");

      const axisX = pad.axes[0] ?? 0;
      const axisY = pad.axes[1] ?? 0;

      want.up ||= !!cur[BUTTON_DPAD_UP] || axisY < -this.deadZone;
      want.down ||= !!cur[BUTTON_DPAD_DOWN] || axisY > this.deadZone;
      want.left ||= !!cur[BUTTON_DPAD_LEFT] || axisX < -this.deadZone;
      want.right ||= !!cur[BUTTON_DPAD_RIGHT] || axisX > this.deadZone;

      this.prevButtons.set(pad.index, cur);
    }
    this.handleDirection("up", want.up, now);
    this.handleDirection("down", want.down, now);
    this.handleDirection("left", want.left, now);
    this.handleDirection("right", want.right, now);
  }

  private handleDirection(dir: "up" | "down" | "left" | "right", want: boolean, now: number): void {
    const state = this.dirState[dir];
    if (want && !state.held) {
      state.held = true;
      state.nextRepeat = now + REPEAT_DELAY_MS;
      this.onAction(dir);
    } else if (want && state.held && now >= state.nextRepeat) {
      state.nextRepeat = now + REPEAT_RATE_MS;
      this.onAction(dir);
    } else if (!want && state.held) {
      state.held = false;
    }
  }
}
