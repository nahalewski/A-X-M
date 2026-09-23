import { btn } from "./xmb";
import type { DeviceEvent, PhoneCall, PhoneCallState, PhoneContact, PhoneShareState, PhoneSms, PhoneThread } from "./types";

/**
 * Experimental: the Device column's apps - Phone, Messages and Contacts - drawn
 * inside the menu rather than handed to anything outside it.
 *
 * The data is the paired phone's (A-X-M Companion › Device Sharing). This side
 * keeps it in memory only while the menu runs, asks for it when an app opens, and
 * forgets it when the phone goes away or the feature is switched off.
 *
 * Two layouts, picked from the window's shape: on a wide screen (a handheld, a
 * tablet in landscape, a TV) the list and its detail sit side by side; on a narrow
 * or portrait one (a phone) they are separate pages you drill into and back out of.
 * Input is the same d-pad / A / B / Y everywhere.
 */

export type DeviceAppId = "phone" | "messages" | "contacts";
export type DeviceAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "context";

export interface DeviceOption {
  label: string;
  hint?: string;
  run?: () => void | Promise<void>;
}

export interface DeviceHooks {
  onClose(): void;
  askText(title: string, fields: { label: string; value?: string }[]): Promise<string[] | null>;
  choose(title: string, options: DeviceOption[]): void;
  notify(text: string): void;
  sound(kind: "move" | "confirm" | "back"): void;
  /** Which apps Settings › Experimental leaves switched on. */
  apps(): Record<DeviceAppId, boolean>;
}

export const DEVICE_APP_NAMES: Record<DeviceAppId, string> = { phone: "Phone", messages: "Messages", contacts: "Contacts" };
export const DEVICE_APP_ICONS: Record<DeviceAppId, string> = {
  phone: "assets/icons/device-phone.svg",
  messages: "assets/icons/device-messages.svg",
  contacts: "assets/icons/device-contacts.svg",
};

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The last nine digits: enough to match +1 555… against 555… without a phone-number library. */
const numberKey = (n: string): string => n.replace(/\D/g, "").slice(-9);

function fmtWhen(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (now.getTime() - ms < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** A contact's picture, or their initial on a colour picked from their name. */
function avatar(name: string, photo: string | undefined, cls = ""): string {
  if (photo) return `<div class="dev-avatar ${cls}"><img src="${esc(photo)}" alt="" /></div>`;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initial = (name.trim()[0] ?? "#").toUpperCase();
  return `<div class="dev-avatar ${cls}" style="--hue:${h % 360}">${esc(/[A-Z0-9]/i.test(initial) ? initial : "#")}</div>`;
}

// ------------------------------------------------------------------ data --

/** Everything the phone has told us, held for the apps and the Device column's subtitles. */
export class DeviceData {
  share: PhoneShareState | null = null;
  phoneName: string | null = null;
  contacts: PhoneContact[] | null = null;
  threads: PhoneThread[] | null = null;
  calls: PhoneCall[] | null = null;
  messages = new Map<string, { address: string; list: PhoneSms[] }>();
  call: { state: PhoneCallState; number?: string; name?: string; since: number } = { state: "idle", since: 0 };
  /** Texts sent from here that the phone hasn't confirmed yet, by the ref it will answer with. */
  pending = new Map<string, { threadKey: string; to: string; sms: PhoneSms; failed?: string }>();
  private listeners = new Set<(e: DeviceEvent | null) => void>();
  private byNumber = new Map<string, PhoneContact>();

  /** `apps` says which Device apps are switched on, so nothing is fetched for one that's off. */
  constructor(private apps: () => Record<DeviceAppId, boolean>) {}

  onChange(fn: (e: DeviceEvent | null) => void): void {
    this.listeners.add(fn);
  }

  private emit(e: DeviceEvent | null): void {
    for (const fn of this.listeners) fn(e);
  }

  /** Drops everything: the phone left, or Experimental was switched off. */
  clear(): void {
    this.contacts = this.threads = this.calls = null;
    this.messages.clear();
    this.pending.clear();
    this.byNumber.clear();
    this.call = { state: "idle", since: 0 };
    this.emit(null);
  }

  apply(e: DeviceEvent): void {
    switch (e.kind) {
      case "state": {
        const was = this.share;
        this.share = e.share;
        this.phoneName = e.name;
        if (!e.share) {
          this.clear();
          return;
        }
        // Something newly shared is worth fetching now, so the column's subtitles fill in.
        // Contacts serve every app (the names on calls and texts), so any app wants them.
        const apps = this.apps();
        if (e.share.messages && !was?.messages && apps.messages) void this.request("threads");
        if (e.share.calls && !was?.calls && apps.phone) void this.request("calls");
        if (e.share.contacts && !was?.contacts && (apps.phone || apps.messages || apps.contacts)) void this.request("contacts");
        if (!e.share.contacts) { this.contacts = null; this.byNumber.clear(); }
        if (!e.share.messages) { this.threads = null; this.messages.clear(); }
        if (!e.share.calls) this.calls = null;
        break;
      }
      case "contacts":
        this.contacts = [...e.contacts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        this.byNumber.clear();
        for (const c of this.contacts) for (const n of c.numbers) this.byNumber.set(numberKey(n.number), c);
        break;
      case "threads":
        this.threads = [...e.threads].sort((a, b) => b.date - a.date);
        break;
      case "calls":
        this.calls = [...e.calls].sort((a, b) => b.date - a.date);
        break;
      case "messages":
        this.messages.set(e.threadId, { address: e.address, list: [...e.messages].sort((a, b) => a.date - b.date) });
        break;
      case "callState":
        if (e.state !== this.call.state) this.call = { state: e.state, number: e.number, name: e.name, since: Date.now() };
        else this.call = { ...this.call, number: e.number ?? this.call.number, name: e.name ?? this.call.name };
        // A call ending changes the call log; ask for the new one.
        if (e.state === "idle" && this.share?.calls) setTimeout(() => void this.request("calls"), 1500);
        break;
      case "smsResult": {
        const p = this.pending.get(e.ref);
        if (!p) break;
        if (e.ok) {
          this.pending.delete(e.ref);
          void this.request("threads");
        } else p.failed = e.error ?? "Not sent";
        break;
      }
      case "incomingSms": {
        const list = this.threads ?? [];
        const t = list.find((x) => x.id === e.threadId);
        if (t) {
          t.snippet = e.body;
          t.date = e.date;
          t.unread += 1;
        } else list.push({ id: e.threadId, address: e.address, name: e.name, snippet: e.body, date: e.date, unread: 1 });
        this.threads = list.sort((a, b) => b.date - a.date);
        const conv = this.messages.get(e.threadId);
        if (conv) conv.list.push({ id: `in-${e.date}`, body: e.body, date: e.date, outgoing: false });
        break;
      }
    }
    this.emit(e);
  }

  request(what: "contacts" | "threads" | "calls" | "messages", threadId?: string): Promise<boolean> {
    return window.axm.deviceRequest(what, threadId).catch(() => false);
  }

  contactFor(number: string | undefined): PhoneContact | null {
    if (!number) return null;
    const key = numberKey(number);
    return key.length >= 5 ? this.byNumber.get(key) ?? null : null;
  }

  nameFor(number: string | undefined, fallback?: string): string {
    return this.contactFor(number)?.name ?? fallback ?? number ?? "Unknown";
  }

  unreadCount(): number {
    return (this.threads ?? []).reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0);
  }

  missedCount(): number {
    // Missed since the last call answered or made: what a phone's badge shows.
    let n = 0;
    for (const c of this.calls ?? []) {
      if (c.kind !== "missed") break;
      n++;
    }
    return n;
  }
}

// ------------------------------------------------------------------- app --

const KEYS: string[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
  ["+", "CALL", "DEL"],
];
const KEY_LETTERS: Record<string, string> = { "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL", "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ", "0": "+" };

type PhoneTab = "keypad" | "recents" | "favorites";

const SEARCH_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><circle cx="10" cy="10" r="6.5"/><path d="M15 15l6 6"/></svg>`;

export class DeviceApp {
  private root: HTMLElement;
  private opened = false;
  private app: DeviceAppId = "phone";
  private clockTimer = 0;

  // Phone
  private dial = "";
  private kr = 0;
  private kc = 0;
  private phoneZone: "tabs" | "keypad" | "list" = "keypad";
  private phoneTab: PhoneTab = "keypad";
  private listIndex = 0;
  private callButton = 0;
  /** The call (by its start time) whose screen was put away with B. */
  private callDismissed = -1;

  // Messages
  private msgZone: "threads" | "conv" = "threads";
  private threadIndex = 0;
  private conv: { threadId: string | null; address: string; name: string } | null = null;
  private bubbleIndex = -1;

  // Contacts
  private conZone: "list" | "detail" = "list";
  private conIndex = 0;
  private query = "";
  private actionIndex = 0;

  constructor(parent: HTMLElement, private data: DeviceData, private hooks: DeviceHooks) {
    this.root = document.createElement("div");
    this.root.id = "device-app";
    this.root.className = "hidden";
    parent.appendChild(this.root);
    data.onChange((e) => this.onData(e));
    window.addEventListener("resize", () => this.opened && this.render());
  }

  isOpen(): boolean {
    return this.opened;
  }

  current(): DeviceAppId | null {
    return this.opened ? this.app : null;
  }

  open(app: DeviceAppId): void {
    this.opened = true;
    this.switchTo(app);
    this.root.classList.remove("hidden");
    clearInterval(this.clockTimer);
    // The header clock and a running call's timer - just their text, so nothing
    // else on screen is rebuilt (or re-animated) every second.
    this.clockTimer = window.setInterval(() => this.opened && this.tick(), 1000);
  }

  close(): void {
    this.opened = false;
    clearInterval(this.clockTimer);
    this.root.classList.add("hidden");
  }

  /** Puts a number on the keypad (from a call log row, a contact) and shows it. */
  prefillDial(number: string): void {
    this.dial = number.replace(/[^0-9+*#]/g, "");
  }

  /** Opens a conversation with someone, found by number, or a blank one to start. */
  openConversation(address: string, name?: string): void {
    const key = numberKey(address);
    const t = (this.data.threads ?? []).find((x) => numberKey(x.address) === key && key.length >= 5);
    this.switchTo("messages");
    this.showThread(t ?? null, address, name ?? this.data.nameFor(address));
  }

  private switchTo(app: DeviceAppId): void {
    this.app = app;
    const share = this.data.share;
    if (app === "phone") {
      this.phoneZone = "keypad";
      this.phoneTab = "keypad";
      this.listIndex = 0;
      if (share?.calls) void this.data.request("calls");
      if (share?.contacts && !this.data.contacts) void this.data.request("contacts");
    } else if (app === "messages") {
      this.msgZone = "threads";
      this.conv = null;
      this.threadIndex = 0;
      if (share?.messages) void this.data.request("threads");
      if (share?.contacts && !this.data.contacts) void this.data.request("contacts");
    } else {
      this.conZone = "list";
      this.conIndex = 0;
      this.query = "";
      if (share?.contacts) void this.data.request("contacts");
    }
    this.render();
  }

  private narrow(): boolean {
    return window.innerWidth < 900 || window.innerHeight > window.innerWidth * 1.05;
  }

  private onData(e: DeviceEvent | null): void {
    if (e?.kind === "threads" && this.conv && !this.conv.threadId) {
      // A first text to someone new: its thread exists now.
      const key = numberKey(this.conv.address);
      const t = (this.data.threads ?? []).find((x) => numberKey(x.address) === key);
      if (t) {
        this.conv.threadId = t.id;
        void this.data.request("messages", t.id);
      }
    } else if (e?.kind === "threads" && this.conv?.threadId) {
      // The open conversation moved on (a reply, a text sent from the phone): fetch it again.
      const t = (this.data.threads ?? []).find((x) => x.id === this.conv!.threadId);
      const last = this.data.messages.get(this.conv.threadId)?.list.at(-1);
      if (t && (!last || t.date > last.date)) void this.data.request("messages", this.conv.threadId);
    }
    if (e?.kind === "messages" && this.conv?.threadId === e.threadId) this.bubbleIndex = this.data.messages.get(e.threadId)!.list.length - 1;
    if (e?.kind === "callState" && e.state !== "idle") this.callButton = 0;
    if (this.opened) this.render();
  }

  // ------------------------------------------------------------- render --

  private clockText(): string {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  private callTimer(): string {
    return fmtDuration(Math.floor((Date.now() - this.data.call.since) / 1000));
  }

  private tick(): void {
    const clock = this.root.querySelector(".dev-clock");
    if (clock) clock.textContent = this.clockText();
    if (this.data.call.state === "offhook") for (const el of Array.from(this.root.querySelectorAll(".dev-call-timer"))) el.textContent = this.callTimer();
  }

  private render(): void {
    const narrow = this.narrow();
    this.root.classList.toggle("dev-narrow", narrow);
    this.root.classList.toggle("dev-wide", !narrow);
    const share = this.data.share;
    const clock = this.clockText();
    const call = this.data.call;
    const callBar =
      call.state !== "idle" && this.callDismissed === call.since
        ? `<div class="dev-callbar">${call.state === "ringing" ? "Incoming call" : "On a call"} · ${esc(this.data.nameFor(call.number, call.name))}${call.state === "offhook" ? ` · <span class="dev-call-timer">${this.callTimer()}</span>` : ""}</div>`
        : "";
    const tabs = (["phone", "messages", "contacts"] as DeviceAppId[])
      .filter((a) => this.hooks.apps()[a])
      .map((a) => `<span class="dev-apptab${a === this.app ? " active" : ""}"><img src="${DEVICE_APP_ICONS[a]}" alt="" />${DEVICE_APP_NAMES[a]}</span>`)
      .join("");
    const status = share ? `${esc(this.data.phoneName ?? "Phone")}${share.formFactor === "tablet" ? " · tablet" : ""}` : "No phone sharing";

    let body: string;
    let hints: string;
    const blocked = this.blockedReason();
    if (blocked) {
      body = `<div class="dev-empty"><img src="${DEVICE_APP_ICONS[this.app]}" alt="" /><div class="dev-empty-title">${esc(blocked.title)}</div>${blocked.lines.map((l) => `<div class="dev-empty-line">${esc(l)}</div>`).join("")}</div>`;
      hints = `<span>${btn("b")} close</span>`;
    } else if (this.app === "phone") [body, hints] = this.renderPhone(narrow);
    else if (this.app === "messages") [body, hints] = this.renderMessages(narrow);
    else [body, hints] = this.renderContacts(narrow);

    const callScreen = this.callScreenVisible() ? this.renderCallScreen() : "";
    if (callScreen) hints = `<span>◀ ▶ choose · ${btn("a")} select · ${btn("b")} hide</span>`;

    this.root.innerHTML = `
      <div class="dev-top">
        <div class="dev-brand"><img src="assets/icons/device.svg" alt="" /><span>Device</span></div>
        <div class="dev-apptabs">${tabs}</div>
        <div class="dev-status">${status}</div>
        <div class="dev-clock">${clock}</div>
      </div>
      <div class="dev-callbar-slot">${callBar}</div>
      <div class="dev-body dev-${this.app}">${body}</div>
      <div class="dev-footer">${hints}</div>
      ${callScreen}`;
    for (const el of Array.from(this.root.querySelectorAll(".dev-sel"))) (el as HTMLElement).scrollIntoView({ block: "nearest" });
    const thread = this.root.querySelector(".dev-bubbles") as HTMLElement | null;
    if (thread && !thread.querySelector(".dev-sel")) thread.scrollTop = thread.scrollHeight;
  }

  /** Why the open app can't work right now, in words for the user - or null if it can. */
  private blockedReason(): { title: string; lines: string[] } | null {
    const share = this.data.share;
    const name = DEVICE_APP_NAMES[this.app];
    const howTo = ["On your phone, open A-X-M Companion › Device Sharing", `and switch on ${name}.`];
    if (!share) return { title: "No phone is sharing", lines: ["Pair your phone in Settings › Companion Devices, then", ...howTo] };
    if (this.app === "phone" && !share.telephony) return { title: "This device can't make calls", lines: [`${this.data.phoneName ?? "The paired device"} has no mobile service (a Wi-Fi tablet).`, "Contacts still work."] };
    if (this.app === "messages" && !share.telephony) return { title: "This device can't send texts", lines: [`${this.data.phoneName ?? "The paired device"} has no mobile service (a Wi-Fi tablet).`, "Contacts still work."] };
    const on = this.app === "phone" ? share.calls : this.app === "messages" ? share.messages : share.contacts;
    if (!on) return { title: `${name} isn't shared`, lines: howTo };
    return null;
  }

  // ---- Phone

  private phoneTabs(narrow: boolean): PhoneTab[] {
    const favs: PhoneTab[] = this.data.share?.contacts ? ["favorites"] : [];
    return narrow ? ["keypad", "recents", ...favs] : ["recents", ...favs];
  }

  private phoneList(): { title: string; sub: string; right: string; kind?: string; number: string; photo?: string }[] {
    if (this.phoneTab === "favorites") {
      return (this.data.contacts ?? [])
        .filter((c) => c.starred && c.numbers.length)
        .map((c) => ({ title: c.name, sub: `${c.numbers[0].label || "Phone"} · ${c.numbers[0].number}`, right: "", number: c.numbers[0].number, photo: c.photo }));
    }
    return (this.data.calls ?? []).map((c) => {
      const contact = this.data.contactFor(c.number);
      const kind = c.kind === "outgoing" ? "Outgoing" : c.kind === "missed" ? "Missed" : c.kind === "rejected" ? "Declined" : "Incoming";
      return {
        title: contact?.name ?? c.name ?? (c.number || "Private number"),
        sub: `${kind}${c.durationSeconds ? ` · ${fmtDuration(c.durationSeconds)}` : ""}${contact || c.name ? ` · ${c.number}` : ""}`,
        right: fmtWhen(c.date),
        kind: c.kind,
        number: c.number,
        photo: contact?.photo,
      };
    });
  }

  private renderPhone(narrow: boolean): [string, string] {
    const tabs = this.phoneTabs(narrow);
    if (!tabs.includes(this.phoneTab)) this.phoneTab = tabs[0];
    const tabStrip = `<div class="dev-tabs">${tabs
      .map((t) => `<span class="dev-tab${t === this.phoneTab ? " active" : ""}${this.phoneZone === "tabs" && t === this.phoneTab ? " dev-focus" : ""}">${t === "keypad" ? "Keypad" : t === "recents" ? "Recents" : "Favorites"}</span>`)
      .join("")}</div>`;

    const match = this.dial.length >= 3 ? this.data.contactFor(this.dial) : null;
    const keypad = `
      <div class="dev-keypad-pane">
        <div class="dev-dial">${esc(this.dial) || '<span class="dev-dim">Enter a number</span>'}</div>
        <div class="dev-dial-match">${match ? esc(match.name) : "&nbsp;"}</div>
        <div class="dev-keys">${KEYS.map((row, r) =>
          row
            .map((k, c) => {
              const focus = this.phoneZone === "keypad" && r === this.kr && c === this.kc ? " dev-focus dev-sel" : "";
              if (k === "CALL") return `<div class="dev-key dev-key-call${focus}"><img src="${DEVICE_APP_ICONS.phone}" alt="Call" /></div>`;
              if (k === "DEL") return `<div class="dev-key dev-key-fn${focus}">⌫</div>`;
              return `<div class="dev-key${focus}"><b>${k}</b><small>${KEY_LETTERS[k] ?? "&nbsp;"}</small></div>`;
            })
            .join("")
        ).join("")}</div>
      </div>`;

    const rows = this.phoneList();
    const loading = this.phoneTab === "favorites" ? !this.data.contacts : !this.data.calls;
    const list = `
      <div class="dev-list-pane">
        ${tabStrip}
        <div class="dev-list">${
          loading
            ? `<div class="dev-note">Asking the phone…</div>`
            : rows.length === 0
              ? `<div class="dev-note">${this.phoneTab === "favorites" ? "No favourites - star contacts on the phone" : "No calls yet"}</div>`
              : this.windowed(rows, this.listIndex)
                  .map(({ item, i }) => {
                    const sel = this.phoneZone === "list" && i === this.listIndex ? " dev-focus dev-sel" : "";
                    return `<div class="dev-row${sel}${item.kind === "missed" ? " dev-missed" : ""}">${avatar(item.title, item.photo)}<div class="dev-row-text"><div class="dev-row-title">${esc(item.title)}</div><div class="dev-row-sub">${item.kind ? `<span class="dev-callkind dev-callkind-${item.kind}"></span>` : ""}${esc(item.sub)}</div></div><div class="dev-row-right">${esc(item.right)}</div></div>`;
                  })
                  .join("")
        }</div>
      </div>`;

    let body: string;
    if (narrow) body = this.phoneTab === "keypad" ? `<div class="dev-list-pane dev-tabs-only">${tabStrip}</div>${keypad}` : list;
    else body = `<div class="dev-split">${keypad}${list}</div>`;

    const hints =
      this.phoneZone === "keypad"
        ? `<span>${btn("a")} press · ${btn("y")} call · ${btn("b")} ${this.dial ? "delete" : "close"}</span>`
        : this.phoneZone === "tabs"
          ? `<span>◀ ▶ tab · ▼ into the list · ${btn("b")} close</span>`
          : `<span>${btn("a")} call options · ${btn("y")} options · ${btn("b")} ${narrow ? "close" : "keypad"}</span>`;
    return [body, hints];
  }

  // ---- Call screen

  private callScreenVisible(): boolean {
    const call = this.data.call;
    return this.opened && call.state !== "idle" && this.callDismissed !== call.since;
  }

  private callButtons(): { id: "answer" | "decline" | "hangup"; label: string }[] {
    return this.data.call.state === "ringing"
      ? [{ id: "answer", label: "Answer" }, { id: "decline", label: "Decline" }]
      : [{ id: "hangup", label: "End Call" }];
  }

  private renderCallScreen(): string {
    const call = this.data.call;
    const contact = this.data.contactFor(call.number);
    const name = contact?.name ?? call.name ?? call.number ?? "Unknown caller";
    const status = call.state === "ringing" ? "Incoming call" : `On a call · <span class="dev-call-timer">${this.callTimer()}</span>`;
    const buttons = this.callButtons()
      .map((b, i) => `<div class="dev-callbtn dev-callbtn-${b.id}${i === this.callButton ? " dev-focus" : ""}"><span>${b.label}</span></div>`)
      .join("");
    return `
      <div class="dev-callscreen${call.state === "ringing" ? " ringing" : ""}">
        ${avatar(name, contact?.photo, "dev-avatar-big")}
        <div class="dev-call-name">${esc(name)}</div>
        <div class="dev-call-number">${contact || call.name ? esc(call.number ?? "") : "&nbsp;"}</div>
        <div class="dev-call-status">${status}</div>
        <div class="dev-call-note">The call's audio is on ${esc(this.data.phoneName ?? "the phone")}</div>
        <div class="dev-callbtns">${buttons}</div>
      </div>`;
  }

  private handleCallScreen(action: DeviceAction): boolean {
    const buttons = this.callButtons();
    switch (action) {
      case "left":
      case "right":
        this.callButton = (this.callButton + (action === "left" ? -1 : 1) + buttons.length) % buttons.length;
        this.hooks.sound("move");
        break;
      case "confirm": {
        const b = buttons[this.callButton] ?? buttons[0];
        this.hooks.sound("confirm");
        void window.axm.deviceCall(b.id === "answer" ? "answer" : "hangup").then((ok) => { if (!ok) this.hooks.notify("The phone didn't respond"); });
        break;
      }
      case "back":
        this.callDismissed = this.data.call.since;
        this.hooks.sound("back");
        break;
      default:
        break;
    }
    this.render();
    return true;
  }

  /** The call screen, up again after B put it away (the Device column's Phone row does this). */
  showCall(): void {
    this.callDismissed = -1;
    if (this.opened) this.render();
  }

  // ---- Messages

  private showThread(t: PhoneThread | null, address: string, name: string): void {
    this.conv = { threadId: t?.id ?? null, address: t?.address ?? address, name: t ? t.name ?? this.data.nameFor(t.address) : name };
    this.msgZone = "conv";
    this.bubbleIndex = -1;
    if (t) {
      t.unread = 0;
      void this.data.request("messages", t.id);
    }
    this.render();
  }

  private convMessages(): (PhoneSms & { failed?: string; pending?: boolean })[] {
    if (!this.conv) return [];
    const list: (PhoneSms & { failed?: string; pending?: boolean })[] = this.conv.threadId ? [...(this.data.messages.get(this.conv.threadId)?.list ?? [])] : [];
    const key = this.conv.threadId ?? `to:${numberKey(this.conv.address)}`;
    for (const p of this.data.pending.values()) if (p.threadKey === key) list.push({ ...p.sms, failed: p.failed, pending: !p.failed });
    return list;
  }

  private renderMessages(narrow: boolean): [string, string] {
    const threads = this.data.threads;
    const rows = [{ id: "__new", title: "New Message", sub: "Text a contact or a number", right: "", unread: 0, name: "+" }, ...(threads ?? []).map((t) => {
      const name = t.name ?? this.data.nameFor(t.address);
      return { id: t.id, title: name, sub: t.snippet, right: fmtWhen(t.date), unread: t.unread, name };
    })];
    const threadPane = `
      <div class="dev-list-pane">
        <div class="dev-pane-title">Conversations</div>
        <div class="dev-list">${
          this.windowed(rows, this.threadIndex)
            .map(({ item, i }) => {
              const sel = i === this.threadIndex ? (this.msgZone === "threads" ? " dev-focus dev-sel" : " dev-current") : "";
              const pic = item.id === "__new" ? `<div class="dev-avatar dev-avatar-new">+</div>` : avatar(item.name, this.data.contactFor(threads?.find((t) => t.id === item.id)?.address)?.photo);
              return `<div class="dev-row${sel}${item.unread ? " dev-unread" : ""}">${pic}<div class="dev-row-text"><div class="dev-row-title">${esc(item.title)}</div><div class="dev-row-sub">${esc(item.sub)}</div></div><div class="dev-row-right">${esc(item.right)}${item.unread ? `<span class="dev-badge">${item.unread}</span>` : ""}</div></div>`;
            })
            .join("") + (threads ? "" : `<div class="dev-note">Asking the phone…</div>`)
        }</div>
      </div>`;

    let convPane: string;
    if (!this.conv) convPane = `<div class="dev-conv-pane dev-conv-empty"><img src="${DEVICE_APP_ICONS.messages}" alt="" /><div>Pick a conversation</div></div>`;
    else {
      const msgs = this.convMessages();
      const loaded = !this.conv.threadId || this.data.messages.has(this.conv.threadId);
      let lastDay = "";
      const bubbles = msgs
        .map((m, i) => {
          const day = new Date(m.date).toDateString();
          const sep = day !== lastDay ? `<div class="dev-day">${esc(day === new Date().toDateString() ? "Today" : new Date(m.date).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }))}</div>` : "";
          lastDay = day;
          const sel = this.msgZone === "conv" && i === this.bubbleIndex ? " dev-focus dev-sel" : "";
          const meta = m.failed ? `Not sent · ${m.failed}` : m.pending ? "Sending…" : new Date(m.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          return `${sep}<div class="dev-bubble ${m.outgoing ? "out" : "in"}${m.failed ? " failed" : ""}${sel}"><div class="dev-bubble-text">${esc(m.body)}</div><div class="dev-bubble-meta">${esc(meta)}</div></div>`;
        })
        .join("");
      const compose = this.msgZone === "conv" && this.bubbleIndex === msgs.length ? " dev-focus dev-sel" : "";
      convPane = `
        <div class="dev-conv-pane">
          <div class="dev-conv-head">${avatar(this.conv.name, this.data.contactFor(this.conv.address)?.photo)}<div><div class="dev-row-title">${esc(this.conv.name)}</div><div class="dev-row-sub">${esc(this.conv.address)}</div></div></div>
          <div class="dev-bubbles">${loaded ? bubbles || `<div class="dev-note">No messages yet - say hello</div>` : `<div class="dev-note">Asking the phone…</div>`}</div>
          <div class="dev-compose${compose}">${btn("a")} Write a message…</div>
        </div>`;
    }

    const body = narrow ? (this.msgZone === "conv" ? convPane : threadPane) : `<div class="dev-split dev-split-messages">${threadPane}${convPane}</div>`;
    const hints =
      this.msgZone === "threads"
        ? `<span>${btn("a")} open · ${btn("y")} options · ${btn("b")} close</span>`
        : `<span>▲ ▼ scroll · ${btn("a")} reply · ${btn("y")} options · ${btn("b")} conversations</span>`;
    return [body, hints];
  }

  private async compose(): Promise<void> {
    const conv = this.conv;
    if (!conv) return;
    const values = await this.hooks.askText(`Message to ${conv.name}`, [{ label: "Message" }]);
    const body = values?.[0]?.trim();
    if (!body) return;
    await this.send(conv.address, body, conv.threadId ?? `to:${numberKey(conv.address)}`);
  }

  private async send(to: string, body: string, threadKey: string): Promise<void> {
    const ref = await window.axm.deviceSendSms(to, body).catch(() => null);
    if (!ref) {
      this.hooks.notify("No phone to send the text from");
      return;
    }
    this.data.pending.set(ref, { threadKey, to, sms: { id: ref, body, date: Date.now(), outgoing: true } });
    this.bubbleIndex = this.convMessages().length;
    this.render();
  }

  private async newMessage(): Promise<void> {
    const values = await this.hooks.askText("New Message", [{ label: "To: a name or a number" }]);
    const to = values?.[0]?.trim();
    if (!to) return;
    const pick = await this.resolveRecipient(to);
    if (pick) this.openConversation(pick.number, pick.name);
  }

  /** A typed name or number, as one number: a contact with several asks which. */
  private resolveRecipient(typed: string): Promise<{ number: string; name: string } | null> {
    return new Promise((resolve) => {
      if (/^[+\d][\d\s\-().]*$/.test(typed)) return resolve({ number: typed.replace(/[^\d+]/g, ""), name: this.data.nameFor(typed) });
      const q = typed.toLowerCase();
      const hits = (this.data.contacts ?? []).filter((c) => c.name.toLowerCase().includes(q) && c.numbers.length).slice(0, 12);
      if (!hits.length) {
        this.hooks.notify(`No contact called "${typed}"`);
        return resolve(null);
      }
      const options = hits.flatMap((c) => c.numbers.map((n) => ({ label: c.name, hint: `${n.label || "Phone"} · ${n.number}`, run: () => resolve({ number: n.number, name: c.name }) })));
      if (options.length === 1) return options[0].run();
      this.hooks.choose("Send to", [...options, { label: "Cancel", run: () => resolve(null) }]);
    });
  }

  // ---- Contacts

  private filteredContacts(): PhoneContact[] {
    const all = this.data.contacts ?? [];
    const q = this.query.trim().toLowerCase();
    if (!q) return all;
    const digits = q.replace(/\D/g, "");
    return all.filter((c) => c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.numbers.some((n) => n.number.replace(/\D/g, "").includes(digits))));
  }

  private contactActions(c: PhoneContact): { label: string; sub: string; run: () => void }[] {
    const share = this.data.share;
    const apps = this.hooks.apps();
    const out: { label: string; sub: string; run: () => void }[] = [];
    for (const n of c.numbers) {
      if (apps.phone && share?.calls && share.telephony) out.push({ label: `Call ${n.label || "phone"}`, sub: n.number, run: () => this.callNumber(n.number) });
      if (apps.messages && share?.messages && share.telephony) out.push({ label: `Message ${n.label || "phone"}`, sub: n.number, run: () => this.openConversation(n.number, c.name) });
    }
    if (!out.length) {
      for (const n of c.numbers) out.push({ label: n.label || "Phone", sub: n.number, run: () => {} });
    }
    return out;
  }

  private renderContacts(narrow: boolean): [string, string] {
    const list = this.filteredContacts();
    const rows = [{ id: "__search", name: this.query ? `Search: “${this.query}”` : "Search", sub: this.query ? `${list.length} found · ${btn("a")} to change` : "Find by name or number", photo: undefined as string | undefined, starred: false }, ...list.map((c) => ({ id: c.id, name: c.name, sub: c.numbers[0] ? `${c.numbers[0].label || "Phone"} · ${c.numbers[0].number}${c.numbers.length > 1 ? ` · +${c.numbers.length - 1} more` : ""}` : "No number", photo: c.photo, starred: c.starred }))];
    let lastLetter = "";
    const listPane = `
      <div class="dev-list-pane">
        <div class="dev-pane-title">${this.data.contacts ? `${this.data.contacts.length} contacts` : "Contacts"}</div>
        <div class="dev-list">${
          this.windowed(rows, this.conIndex)
            .map(({ item, i }) => {
              const sel = i === this.conIndex ? (this.conZone === "list" ? " dev-focus dev-sel" : " dev-current") : "";
              const letter = i === 0 ? "" : (item.name[0] ?? "#").toUpperCase();
              const head = i > 0 && letter !== lastLetter ? `<div class="dev-letter">${esc(/[A-Z]/.test(letter) ? letter : "#")}</div>` : "";
              if (i > 0) lastLetter = letter;
              const pic = i === 0 ? `<div class="dev-avatar dev-avatar-new">${SEARCH_GLYPH}</div>` : avatar(item.name, item.photo);
              return `${head}<div class="dev-row${sel}">${pic}<div class="dev-row-text"><div class="dev-row-title">${esc(item.name)}${item.starred ? ' <span class="dev-star">★</span>' : ""}</div><div class="dev-row-sub">${i === 0 ? item.sub : esc(item.sub)}</div></div></div>`;
            })
            .join("") + (this.data.contacts ? "" : `<div class="dev-note">Asking the phone…</div>`)
        }</div>
      </div>`;

    const c = this.conIndex > 0 ? list[this.conIndex - 1] : null;
    let detail: string;
    if (!c) detail = `<div class="dev-detail-pane dev-conv-empty"><img src="${DEVICE_APP_ICONS.contacts}" alt="" /><div>Pick a contact</div></div>`;
    else {
      const actions = this.contactActions(c);
      detail = `
        <div class="dev-detail-pane">
          ${avatar(c.name, c.photo, "dev-avatar-big")}
          <div class="dev-call-name">${esc(c.name)}${c.starred ? ' <span class="dev-star">★</span>' : ""}</div>
          <div class="dev-actions">${actions
            .map((a, i) => `<div class="dev-action${this.conZone === "detail" && i === this.actionIndex ? " dev-focus dev-sel" : ""}"><div class="dev-row-title">${esc(a.label)}</div><div class="dev-row-sub">${esc(a.sub)}</div></div>`)
            .join("")}</div>
        </div>`;
    }
    const body = narrow ? (this.conZone === "detail" ? detail : listPane) : `<div class="dev-split dev-split-contacts">${listPane}${detail}</div>`;
    const hints =
      this.conZone === "list"
        ? `<span>◀ ▶ letter · ${btn("a")} open · ${btn("y")} search · ${btn("b")} ${this.query ? "clear search" : "close"}</span>`
        : `<span>${btn("a")} select · ${btn("b")} contacts</span>`;
    return [body, hints];
  }

  /** Only the rows near the cursor are drawn: a phone can hold thousands of contacts. */
  private windowed<T>(rows: T[], index: number): { item: T; i: number }[] {
    const start = Math.max(0, index - 30);
    return rows.slice(start, index + 40).map((item, k) => ({ item, i: start + k }));
  }

  // -------------------------------------------------------------- input --

  private callNumber(number: string): void {
    void window.axm.deviceDial(number).then((ok) => {
      if (!ok) this.hooks.notify("No phone to call from");
      else this.hooks.notify(`Calling ${this.data.nameFor(number)} on ${this.data.phoneName ?? "the phone"}`);
    });
  }

  private numberOptions(number: string, name: string): void {
    const apps = this.hooks.apps();
    const share = this.data.share;
    const options: DeviceOption[] = [];
    if (apps.phone && share?.calls && share.telephony) options.push({ label: "Call", hint: number, run: () => this.callNumber(number) });
    if (apps.messages && share?.messages && share.telephony) options.push({ label: "Send a Message", run: () => this.openConversation(number, name) });
    if (apps.phone) options.push({ label: "Edit Number Before Calling", run: () => { this.switchTo("phone"); this.prefillDial(number); this.render(); } });
    this.hooks.choose(name, options);
  }

  /** Cycles to the next app that is switched on (from a screen that can't do anything else). */
  private cycleApp(d: 1 | -1): void {
    const on = (["phone", "messages", "contacts"] as DeviceAppId[]).filter((a) => this.hooks.apps()[a]);
    const i = on.indexOf(this.app);
    if (on.length < 2) return;
    this.switchTo(on[(i + d + on.length) % on.length]);
    this.hooks.sound("move");
  }

  private closeApp(): true {
    this.hooks.sound("back");
    this.close();
    this.hooks.onClose();
    return true;
  }

  handle(action: DeviceAction): boolean {
    if (!this.opened) return false;
    if (this.callScreenVisible()) return this.handleCallScreen(action);
    if (this.blockedReason()) {
      if (action === "back") return this.closeApp();
      if (action === "left" || action === "right") this.cycleApp(action === "left" ? -1 : 1);
      return true;
    }
    const result = this.app === "phone" ? this.handlePhone(action) : this.app === "messages" ? this.handleMessages(action) : this.handleContacts(action);
    if (this.opened) this.render();
    return result;
  }

  private handlePhone(action: DeviceAction): boolean {
    const narrow = this.narrow();
    const tabs = this.phoneTabs(narrow);
    const rows = this.phoneList();
    if (this.phoneZone === "tabs") {
      if (action === "left" || action === "right") {
        const i = tabs.indexOf(this.phoneTab);
        const next = tabs[i + (action === "left" ? -1 : 1)];
        if (!next) return true;
        this.phoneTab = next;
        this.listIndex = 0;
        this.hooks.sound("move");
      } else if (action === "down" || action === "confirm") {
        this.phoneZone = this.phoneTab === "keypad" ? "keypad" : "list";
        this.kr = 0;
        this.hooks.sound("move");
      } else if (action === "back") return this.closeApp();
      return true;
    }
    if (this.phoneZone === "keypad") {
      switch (action) {
        case "up":
          if (this.kr === 0) { if (narrow) this.phoneZone = "tabs"; }
          else this.kr--;
          this.hooks.sound("move");
          break;
        case "down":
          this.kr = Math.min(KEYS.length - 1, this.kr + 1);
          this.hooks.sound("move");
          break;
        case "left":
          if (this.kc > 0) this.kc--;
          this.hooks.sound("move");
          break;
        case "right":
          if (this.kc < 2) this.kc++;
          else if (!narrow) { this.phoneZone = "list"; this.listIndex = Math.min(this.listIndex, Math.max(0, rows.length - 1)); }
          this.hooks.sound("move");
          break;
        case "confirm": {
          const key = KEYS[this.kr][this.kc];
          this.hooks.sound("confirm");
          if (key === "CALL") this.dialNow();
          else if (key === "DEL") this.dial = this.dial.slice(0, -1);
          else if (this.dial.length < 32) this.dial += key;
          break;
        }
        case "context":
          this.dialNow();
          break;
        case "back":
          if (!this.dial) return this.closeApp();
          this.dial = this.dial.slice(0, -1);
          this.hooks.sound("back");
          break;
      }
      return true;
    }
    // The list: recents or favourites.
    switch (action) {
      case "up":
        if (this.listIndex === 0) this.phoneZone = "tabs";
        else this.listIndex--;
        this.hooks.sound("move");
        break;
      case "down":
        this.listIndex = Math.min(Math.max(0, rows.length - 1), this.listIndex + 1);
        this.hooks.sound("move");
        break;
      case "left":
        if (!narrow) { this.phoneZone = "keypad"; this.kc = 2; this.hooks.sound("move"); }
        break;
      case "confirm":
      case "context": {
        const row = rows[this.listIndex];
        if (row?.number) { this.hooks.sound("confirm"); this.numberOptions(row.number, row.title); }
        break;
      }
      case "back":
        if (narrow) return this.closeApp();
        this.phoneZone = "keypad";
        this.hooks.sound("back");
        break;
    }
    return true;
  }

  private dialNow(): void {
    if (!this.dial) {
      // An empty keypad redials the last number, as phones do.
      const last = this.data.calls?.find((c) => c.kind === "outgoing")?.number;
      if (last) this.dial = last;
      return;
    }
    this.hooks.sound("confirm");
    this.callNumber(this.dial);
  }

  private handleMessages(action: DeviceAction): boolean {
    const narrow = this.narrow();
    const count = (this.data.threads?.length ?? 0) + 1;
    if (this.msgZone === "threads") {
      switch (action) {
        case "up":
          this.threadIndex = Math.max(0, this.threadIndex - 1);
          this.hooks.sound("move");
          break;
        case "down":
          this.threadIndex = Math.min(count - 1, this.threadIndex + 1);
          this.hooks.sound("move");
          break;
        case "right":
          if (!narrow && this.conv) { this.msgZone = "conv"; this.hooks.sound("move"); }
          break;
        case "confirm": {
          this.hooks.sound("confirm");
          if (this.threadIndex === 0) { void this.newMessage(); break; }
          const t = this.data.threads?.[this.threadIndex - 1];
          if (t) this.showThread(t, t.address, t.name ?? this.data.nameFor(t.address));
          break;
        }
        case "context": {
          const t = this.threadIndex > 0 ? this.data.threads?.[this.threadIndex - 1] : undefined;
          const options: DeviceOption[] = [{ label: "New Message", run: () => void this.newMessage() }];
          if (t) {
            const name = t.name ?? this.data.nameFor(t.address);
            options.unshift({ label: `Open ${name}`, run: () => this.showThread(t, t.address, name) });
            if (this.hooks.apps().phone && this.data.share?.calls && this.data.share.telephony) options.push({ label: `Call ${name}`, hint: t.address, run: () => this.callNumber(t.address) });
          }
          options.push({ label: "Refresh", run: () => void this.data.request("threads") });
          this.hooks.choose("Messages", options);
          break;
        }
        case "back":
          return this.closeApp();
      }
      return true;
    }
    const msgs = this.convMessages();
    if (this.bubbleIndex < 0 || this.bubbleIndex > msgs.length) this.bubbleIndex = msgs.length;
    switch (action) {
      case "up":
        this.bubbleIndex = Math.max(0, this.bubbleIndex - 1);
        this.hooks.sound("move");
        break;
      case "down":
        // Past the last bubble is the compose row.
        this.bubbleIndex = Math.min(msgs.length, this.bubbleIndex + 1);
        this.hooks.sound("move");
        break;
      case "confirm": {
        const m = msgs[this.bubbleIndex];
        this.hooks.sound("confirm");
        if (m?.failed && this.conv) {
          // A failed text: offer it again.
          const conv = this.conv;
          this.hooks.choose("Not sent", [
            { label: "Try Again", run: () => { for (const [ref, p] of this.data.pending) if (p.sms.id === m.id) this.data.pending.delete(ref); void this.send(conv.address, m.body, conv.threadId ?? `to:${numberKey(conv.address)}`); } },
            { label: "Delete", run: () => { for (const [ref, p] of this.data.pending) if (p.sms.id === m.id) this.data.pending.delete(ref); this.render(); } },
          ]);
        } else void this.compose();
        break;
      }
      case "context": {
        const conv = this.conv;
        if (!conv) break;
        const options: DeviceOption[] = [{ label: "Reply", run: () => void this.compose() }];
        if (this.hooks.apps().phone && this.data.share?.calls && this.data.share.telephony) options.push({ label: `Call ${conv.name}`, hint: conv.address, run: () => this.callNumber(conv.address) });
        if (conv.threadId) options.push({ label: "Refresh", run: () => void this.data.request("messages", conv.threadId!) });
        this.hooks.choose(conv.name, options);
        break;
      }
      case "left":
        if (!narrow) { this.msgZone = "threads"; this.hooks.sound("move"); }
        break;
      case "back":
        this.msgZone = "threads";
        if (narrow) this.conv = null;
        this.hooks.sound("back");
        break;
    }
    return true;
  }

  private handleContacts(action: DeviceAction): boolean {
    const narrow = this.narrow();
    const list = this.filteredContacts();
    const count = list.length + 1;
    if (this.conZone === "list") {
      switch (action) {
        case "up":
          this.conIndex = Math.max(0, this.conIndex - 1);
          this.actionIndex = 0;
          this.hooks.sound("move");
          break;
        case "down":
          this.conIndex = Math.min(count - 1, this.conIndex + 1);
          this.actionIndex = 0;
          this.hooks.sound("move");
          break;
        case "left":
        case "right": {
          // Jump to the next / previous initial letter - quick through a long list on a pad.
          if (this.conIndex === 0) {
            if (action === "right") { this.conIndex = Math.min(1, count - 1); this.hooks.sound("move"); }
            break;
          }
          const letterAt = (i: number) => (list[i - 1]?.name[0] ?? "").toUpperCase();
          const here = letterAt(this.conIndex);
          let i = this.conIndex;
          if (action === "right") {
            while (i < count - 1 && letterAt(i) === here) i++;
          } else {
            // To the start of this letter, or of the one before if already there.
            if (i > 1 && letterAt(i - 1) === here) { while (i > 1 && letterAt(i - 1) === here) i--; }
            else if (i > 1) { const prev = letterAt(i - 1); i--; while (i > 1 && letterAt(i - 1) === prev) i--; }
          }
          this.conIndex = i;
          this.actionIndex = 0;
          this.hooks.sound("move");
          break;
        }
        case "confirm":
          this.hooks.sound("confirm");
          if (this.conIndex === 0) void this.search();
          else { this.conZone = "detail"; this.actionIndex = 0; }
          break;
        case "context":
          this.hooks.sound("confirm");
          void this.search();
          break;
        case "back":
          if (this.query) { this.query = ""; this.conIndex = 0; this.hooks.sound("back"); break; }
          return this.closeApp();
      }
      return true;
    }
    const c = list[this.conIndex - 1];
    const actions = c ? this.contactActions(c) : [];
    switch (action) {
      case "up":
        this.actionIndex = Math.max(0, this.actionIndex - 1);
        this.hooks.sound("move");
        break;
      case "down":
        this.actionIndex = Math.min(Math.max(0, actions.length - 1), this.actionIndex + 1);
        this.hooks.sound("move");
        break;
      case "confirm":
        if (actions[this.actionIndex]) { this.hooks.sound("confirm"); actions[this.actionIndex].run(); }
        break;
      case "left":
        if (narrow) break;
        this.conZone = "list";
        this.hooks.sound("move");
        break;
      case "back":
        this.conZone = "list";
        this.hooks.sound("back");
        break;
    }
    return true;
  }

  private async search(): Promise<void> {
    const values = await this.hooks.askText("Search Contacts", [{ label: "Name or number", value: this.query }]);
    if (values === null) return;
    this.query = values[0]?.trim() ?? "";
    this.conIndex = this.filteredContacts().length ? 1 : 0;
    this.conZone = "list";
    this.render();
  }
}
