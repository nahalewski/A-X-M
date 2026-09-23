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
  | "seek"
  /** Absolute position in seconds - the phone dragging the progress bar. */
  | "position"
  /** value 1: the phone plays the audio from here on (the menu pauses); 0: back to the menu. */
  | "route";
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
    /** The file itself, streamed from the menu, for playing on the phone. */
    streamUrl?: string;
    /** "host" or "phone". */
    output?: string;
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

// ---------------------------------------------------------- settings --

/**
 * A menu setting the phone may change. The list is the host's: it says what each
 * one is called, what it can be, and what it is now. The phone only ever sends
 * back an id and one of the values it was given.
 */
export interface CompanionSetting {
  id: string;
  title: string;
  /** "Audio", "Display", "TV Streaming"... - the phone groups by this. */
  group: string;
  kind: "toggle" | "choice";
  /** "on" / "off" for a toggle; an option id for a choice. */
  value: string;
  options?: { id: string; label: string }[];
  /** One line under the title, as the menu shows it. */
  detail?: string;
}
export type SettingsStateMessage = Frame<"settings.state", { items: CompanionSetting[] }>;
export type SettingsSetMessage = Frame<"settings.set", { id: string; value: string }>;

// ---------------------------------------------------------- keyboard --

/** The menu is asking for text; the phone can type it with its own keyboard. */
export type KeyboardShowMessage = Frame<"keyboard.show", { title: string; label: string; value: string; secret: boolean }>;
export type KeyboardHideMessage = Frame<"keyboard.hide", { at: number }>;
/** What the phone typed so far; done = the user pressed enter / next. */
export type KeyboardInputMessage = Frame<"keyboard.input", { text: string; done: boolean }>;

// ------------------------------------------------------------- music --

/**
 * Browsing the music library from the phone. Folders and files are named by
 * opaque keys the host hands out in a listing; the phone never sends a path.
 * No key means the top level: every drive's MUSIC folder and the user's own.
 */
export type MusicBrowseMessage = Frame<"music.browse", { key?: string }>;
export type MusicListingMessage = Frame<
  "music.listing",
  { key: string; name: string; parent?: string; entries: { key: string; name: string; kind: "folder" | "file" }[] }
>;
export type MusicPlayMessage = Frame<"music.play", { key: string }>;

// --------------------------------------------------------------- saves ----

/**
 * Memory card saves on the phone: a copy of each save the menu manages, kept
 * offline, and Apollo's cheats run on the host at the phone's request. The
 * phone names saves by the card id and save name the host listed; the bytes
 * travel base64 in both directions. The host is the only thing that touches a
 * card, so an edit from the phone and one from the TV are the same code path.
 */
export interface SaveListing {
  cards: { id: string; name: string; kind: "ps1" | "ps2"; saves: { name: string; title: string; size: number; sha1: string }[] }[];
  /** True while the host will push copies on its own (Settings › Companion). */
  autoSync: boolean;
}
export type SavesListMessage = Frame<"saves.list", SaveListing>;
/** A copy of one save: .mcs blocks (PS1) or .psu (PS2), base64. */
export type SavesFileMessage = Frame<"saves.file", { cardId: string; save: string; title: string; kind: "ps1" | "ps2"; fileName: string; base64: string; sha1: string; at: string }>;
export type SavesRequestMessage = Frame<"saves.request", { cardId: string; save: string }>;
/** The phone's copy back onto the card, replacing what's there (the card is backed up first). */
export type SavesPushMessage = Frame<"saves.push", { cardId: string; save: string; base64: string }>;
export type SavesCheatsMessage = Frame<"saves.cheats", { cardId: string; save: string }>;
export type SavesPatchesMessage = Frame<
  "saves.patches",
  {
    cardId: string;
    save: string;
    gameName: string | null;
    productCode: string;
    region: string;
    attribution: string[];
    error?: string;
    codes: { key: string; name: string; group: string | null; isInfo: boolean; isRequired: boolean; isDefault: boolean; type: string; targets: string[]; options: { tag: string; choices: { value: string; label: string }[] }[] }[];
  }
>;
export type SavesApplyMessage = Frame<"saves.apply", { cardId: string; save: string; selections: { key: string; options: Record<string, string> }[]; preview?: boolean }>;
export type SavesRestoreMessage = Frame<"saves.restore", { cardId: string; save: string }>;
/** What came of an apply / push / restore, in words, plus a preview when one was asked for. */
export type SavesResultMessage = Frame<"saves.result", { cardId: string; save: string; ok: boolean; message: string; preview?: { name: string; changed: number; first: { offset: number; from: string; to: string }[] }[] }>;

// --------------------------------------------------------------- phone ----

/**
 * Experimental: the phone's own Phone, Messages and Contacts, used from the menu's
 * Device column. The phone is the one that owns the data and the SIM, so the
 * direction flips here: the host asks, and the phone decides - it answers only
 * while the user has switched sharing on in the phone app and granted Android's
 * permissions, and it refuses anything else. Numbers and message text are the
 * only free-form values, and they only ever go to the phone's own dialer and SMS.
 */
export interface PhoneShareState {
  /** The user switched each on in the phone app, and Android granted it. */
  calls: boolean;
  messages: boolean;
  contacts: boolean;
  /** False on a Wi-Fi-only tablet: contacts work, calls and texts cannot. */
  telephony: boolean;
  /** "phone" or "tablet" - the phone app's own idea of what it is. */
  formFactor: "phone" | "tablet";
}
export type PhoneStateMessage = Frame<"phone.state", PhoneShareState>;

export interface PhoneContact {
  id: string;
  name: string;
  numbers: { number: string; label: string }[];
  starred: boolean;
  /** A small JPEG as a data: URL, when the contact has a picture. */
  photo?: string;
}
export interface PhoneThread {
  id: string;
  address: string;
  name?: string;
  snippet: string;
  /** Epoch milliseconds. */
  date: number;
  unread: number;
}
export interface PhoneSms {
  id: string;
  body: string;
  date: number;
  outgoing: boolean;
}
export interface PhoneCall {
  number: string;
  name?: string;
  date: number;
  durationSeconds: number;
  kind: "incoming" | "outgoing" | "missed" | "rejected";
}

/** Host asks for a list; the phone answers with the matching message below. */
export type PhoneRequestMessage = Frame<"phone.request", { what: "contacts" | "threads" | "calls" | "messages"; threadId?: string }>;
export type PhoneContactsMessage = Frame<"phone.contacts", { contacts: PhoneContact[] }>;
export type PhoneThreadsMessage = Frame<"phone.threads", { threads: PhoneThread[] }>;
export type PhoneMessagesMessage = Frame<"phone.messages", { threadId: string; address: string; messages: PhoneSms[] }>;
export type PhoneCallsMessage = Frame<"phone.calls", { calls: PhoneCall[] }>;

/** Place a call, answer the ringing one, or end the current one. */
export type PhoneDialMessage = Frame<"phone.dial", { number: string }>;
export type PhoneAnswerMessage = Frame<"phone.answer", { at: number }>;
export type PhoneHangupMessage = Frame<"phone.hangup", { at: number }>;
/** The phone's call, as it changes: ringing (with who), offhook (a call is up), idle. */
export type PhoneCallStateMessage = Frame<"phone.callState", { state: "idle" | "ringing" | "offhook"; number?: string; name?: string }>;

/** Send a text. The phone replies with phone.smsResult carrying the same ref. */
export type PhoneSendSmsMessage = Frame<"phone.sendSms", { to: string; body: string; ref: string }>;
export type PhoneSmsResultMessage = Frame<"phone.smsResult", { ref: string; ok: boolean; error?: string }>;
/** A text arrived on the phone. */
export type PhoneIncomingSmsMessage = Frame<"phone.incomingSms", { threadId: string; address: string; name?: string; body: string; date: number }>;

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
  | SettingsStateMessage
  | SettingsSetMessage
  | KeyboardShowMessage
  | KeyboardHideMessage
  | KeyboardInputMessage
  | MusicBrowseMessage
  | MusicListingMessage
  | MusicPlayMessage
  | SavesListMessage
  | SavesFileMessage
  | SavesRequestMessage
  | SavesPushMessage
  | SavesCheatsMessage
  | SavesPatchesMessage
  | SavesApplyMessage
  | SavesRestoreMessage
  | SavesResultMessage
  | PhoneStateMessage
  | PhoneRequestMessage
  | PhoneContactsMessage
  | PhoneThreadsMessage
  | PhoneMessagesMessage
  | PhoneCallsMessage
  | PhoneDialMessage
  | PhoneAnswerMessage
  | PhoneHangupMessage
  | PhoneCallStateMessage
  | PhoneSendSmsMessage
  | PhoneSmsResultMessage
  | PhoneIncomingSmsMessage
  | ErrorMessage;

/** What the phone sends about its Phone, Messages and Contacts, forwarded to the menu. */
export const PHONE_INBOUND_TYPES = [
  "phone.state",
  "phone.contacts",
  "phone.threads",
  "phone.messages",
  "phone.calls",
  "phone.callState",
  "phone.smsResult",
  "phone.incomingSms",
] as const;
export type PhoneInboundType = (typeof PHONE_INBOUND_TYPES)[number];

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
