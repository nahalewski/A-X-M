// Polls the Gamepad API each frame and emits edge-triggered (just-pressed) actions,
// with dpad/stick repeat-on-hold for navigation.

export type PadAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context" | "guide";

const REPEAT_DELAY_MS = 380;
const REPEAT_RATE_MS = 110;
const STICK_DEADZONE = 0.5;

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

export type ControllerType = "xbox" | "ps" | "switch" | "kishi";

/**
 * Which family a pad belongs to, from its Gamepad id: by name, or by the USB
 * vendor id Chromium embeds (Sony 054c, Nintendo 057e, Razer 1532). Anything else
 * is treated as Xbox-layout, which the Ally's own controls are.
 */
export function controllerTypeOf(id: string): ControllerType {
  if (/dualsense|dualshock|playstation|sony|054c|wireless controller/i.test(id)) return "ps";
  if (/nintendo|switch|joy-con|057e/i.test(id)) return "switch";
  if (/kishi|razer|1532/i.test(id)) return "kishi";
  return "xbox";
}

export class GamepadNav {
  private lastType: ControllerType | null = null;
  private onType: ((type: ControllerType) => void) | null = null;

  /** Called whenever the connected controller's family changes (Xbox vs PlayStation). */
  setOnControllerType(callback: (type: ControllerType) => void): void {
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
    for (const pad of pads) {
      if (!pad) continue;
      const type = controllerTypeOf(pad.id);
      if (type !== this.lastType) {
        this.lastType = type;
        this.onType?.(type);
      }
      const prev = this.prevButtons.get(pad.index) ?? [];
      const cur = pad.buttons.map((b) => b.pressed);

      if (cur[BUTTON_A] && !prev[BUTTON_A]) this.onAction("confirm");
      if (cur[BUTTON_B] && !prev[BUTTON_B]) this.onAction("back");
      if (cur[BUTTON_Y] && !prev[BUTTON_Y]) this.onAction("context");
      if (cur[BUTTON_GUIDE] && !prev[BUTTON_GUIDE]) this.onAction("guide");

      const axisX = pad.axes[0] ?? 0;
      const axisY = pad.axes[1] ?? 0;

      const wantUp = cur[BUTTON_DPAD_UP] || axisY < -STICK_DEADZONE;
      const wantDown = cur[BUTTON_DPAD_DOWN] || axisY > STICK_DEADZONE;
      const wantLeft = cur[BUTTON_DPAD_LEFT] || axisX < -STICK_DEADZONE;
      const wantRight = cur[BUTTON_DPAD_RIGHT] || axisX > STICK_DEADZONE;

      this.handleDirection("up", wantUp, now);
      this.handleDirection("down", wantDown, now);
      this.handleDirection("left", wantLeft, now);
      this.handleDirection("right", wantRight, now);

      this.prevButtons.set(pad.index, cur);
    }
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
