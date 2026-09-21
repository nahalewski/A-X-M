/**
 * The wire protocol between A-X-M and the Android companion.
 *
 * This file is the contract. It is deliberately free of Node, Electron and DOM
 * types so it can be copied verbatim into the Android project and kept in step by
 * diffing one file rather than two implementations.
 *
 * Rules that hold everywhere:
 *
 * - Every frame is one JSON object with a `protocol` number and a `type`. A peer
 *   that receives a version it does not know says so and closes, rather than
 *   guessing at a payload whose shape may have changed.
 * - `type` is a namespaced verb. The namespace is the subsystem it belongs to, so
 *   routing is a switch on the prefix and an unknown namespace is ignorable.
 * - The phone never names a file, a path or a command line. It asks for actions
 *   from a fixed list; the host decides what those mean. Nothing on this wire can
 *   express "run this program", which is the whole point.
 */

export const COMPANION_PROTOCOL_VERSION = 1;

/** Port the host listens on for discovery probes. */
export const COMPANION_DISCOVERY_PORT = 47820;
/** Default port for the control socket. The discovery reply carries the real one. */
export const COMPANION_CONTROL_PORT = 47821;
/** Magic string in a discovery probe, so we ignore unrelated broadcast traffic. */
export const COMPANION_DISCOVERY_MAGIC = "AXM-COMPANION-DISCOVER";

// ------------------------------------------------------------------ device --

/** What a phone can do. The host enables features from this, never assumes them. */
export interface CompanionCapabilities {
  touch: boolean;
  nfc: boolean;
  foldable: boolean;
  gyro: boolean;
  haptics: boolean;
  videoDecode: boolean;
  camera?: boolean;
  microphone?: boolean;
}

/** What the phone is currently showing. The host may ask it to change. */
export type CompanionMode =
  | "idle"
  | "media_remote"
  | "touchpad"
  | "xmb_controller"
  | "ds_second_screen"
  | "3ds_second_screen"
  | "toy_box"
  | "ghost";

export interface CompanionDevice {
  /** Stable per-install id the phone generates once and keeps. */
  deviceId: string;
  /** Shown in A-X-M's device list, e.g. "Pixel 9 Pro Fold". */
  name: string;
  platform: "android" | string;
  capabilities: CompanionCapabilities;
}

// ---------------------------------------------------------------- messages --

interface Frame<T extends string, P> {
  protocol: number;
  type: T;
  payload: P;
  /** Set by the sender on a request; echoed on the matching reply. */
  id?: string;
}

/** First frame on a new socket. A token means "we have paired before". */
export type HelloMessage = Frame<"device.hello", CompanionDevice & { token?: string }>;

/**
 * The host's answer to hello. `paired` false means the phone must now show the
 * code the host is displaying and send pair.submit.
 */
export type WelcomeMessage = Frame<
  "device.welcome",
  { hostName: string; hostVersion: string; paired: boolean; protocol: number }
>;

/** The phone sends back the code the user read off the A-X-M screen. */
export type PairSubmitMessage = Frame<"pair.submit", { code: string }>;

/** On success the phone stores the token and skips the code next time. */
export type PairResultMessage = Frame<
  "pair.result",
  { ok: boolean; token?: string; reason?: string; attemptsLeft?: number }
>;

export type GoodbyeMessage = Frame<"device.goodbye", { reason?: string }>;

/** Keeps NAT and sleepy Wi-Fi from quietly dropping an idle socket. */
export type PingMessage = Frame<"link.ping", { at: number }>;
export type PongMessage = Frame<"link.pong", { at: number }>;

/** Host tells the phone what screen to show; the phone may also request one. */
export type ModeMessage = Frame<"companion.mode", { mode: CompanionMode; platform?: string }>;

/** Menu navigation. Exactly the actions the menu already understands. */
export type XmbAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context" | "guide";
export type XmbMessage = Frame<"xmb.input", { action: XmbAction }>;

export type MediaCommand =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "previous"
  | "stop"
  | "volume"
  | "mute"
  | "shuffle"
  | "repeat"
  | "favorite"
  | "seek";
export type MediaCommandMessage = Frame<"media.command", { command: MediaCommand; value?: number }>;

/** Host is the authority on what is playing; the phone mirrors this. */
export type MediaStateMessage = Frame<
  "media.state",
  {
    playing: boolean;
    title?: string;
    artist?: string;
    album?: string;
    /** http URL on the host's own asset endpoint, never a local file path. */
    artworkUrl?: string;
    positionSeconds?: number;
    durationSeconds?: number;
    volume?: number;
    muted?: boolean;
  }
>;

/** Touchpad. Deltas, not absolute screen positions, so DPI never has to match. */
export type PointerMessage = Frame<
  "pointer.input",
  {
    kind: "move" | "click" | "scroll" | "down" | "up";
    dx?: number;
    dy?: number;
    button?: "left" | "right" | "middle";
  }
>;

/** A tag the phone read. Identification only - never tag contents or keys. */
export type ToyScanMessage = Frame<
  "toybox.scan",
  {
    uid: string;
    technology?: string;
    /** Amiibo head/tail, or a character/variant pair, whichever the tag gives. */
    head?: string;
    tail?: string;
    characterId?: string;
    variantId?: string;
  }
>;

/** What the host made of that tag, plus which installed games it fits. */
export type ToyMetadataMessage = Frame<
  "toybox.metadata",
  {
    figureId: string | null;
    name: string;
    franchise?: string;
    series?: string;
    variant?: string;
    artworkUrl?: string;
    compatibleGames: { id: string; name: string; installed: boolean }[];
  }
>;

export type GhostState = "idle" | "listening" | "thinking" | "speaking" | "scanning" | "error";
export type GhostStateMessage = Frame<"ghost.state", { state: GhostState }>;
export type GhostMessageFrame = Frame<"ghost.message", { text: string; spoken?: boolean }>;

/** Anything the host wants to say went wrong, in words fit to show a user. */
export type ErrorMessage = Frame<"link.error", { message: string; fatal?: boolean }>;

export type CompanionMessage =
  | HelloMessage
  | WelcomeMessage
  | PairSubmitMessage
  | PairResultMessage
  | GoodbyeMessage
  | PingMessage
  | PongMessage
  | ModeMessage
  | XmbMessage
  | MediaCommandMessage
  | MediaStateMessage
  | PointerMessage
  | ToyScanMessage
  | ToyMetadataMessage
  | GhostStateMessage
  | GhostMessageFrame
  | ErrorMessage;

export type CompanionMessageType = CompanionMessage["type"];

/**
 * Messages a phone is allowed to send *before* it has paired. Everything else is
 * refused until the code has been accepted, so an unpaired device on the network
 * can do nothing but introduce itself.
 */
export const PRE_PAIR_TYPES: CompanionMessageType[] = ["device.hello", "pair.submit", "link.ping", "device.goodbye"];

export function frame<T extends CompanionMessage>(type: T["type"], payload: T["payload"], id?: string): string {
  return JSON.stringify({ protocol: COMPANION_PROTOCOL_VERSION, type, payload, ...(id ? { id } : {}) });
}

/**
 * Parses a frame, returning null for anything malformed. Never throws: this runs on
 * bytes from the network, and a bad frame must not take the server down.
 */
export function parseFrame(raw: string): CompanionMessage | null {
  try {
    const value = JSON.parse(raw) as Partial<CompanionMessage>;
    if (!value || typeof value !== "object") return null;
    if (typeof value.type !== "string") return null;
    if (typeof value.protocol !== "number") return null;
    if (value.payload === undefined || value.payload === null) return null;
    return value as CompanionMessage;
  } catch {
    return null;
  }
}
