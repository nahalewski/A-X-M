import * as crypto from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { CompanionDiscovery, localAddresses } from "./discovery";
import { CompanionPermissions, DeviceRegistry, TrustedDevice } from "./registry";
import {
  COMPANION_CONTROL_PORT,
  COMPANION_PROTOCOL_VERSION,
  CompanionDevice,
  CompanionMessage,
  CompanionMode,
  GhostState,
  MediaCommand,
  PRE_PAIR_TYPES,
  PointerMessage,
  ToyScanMessage,
  XmbAction,
  frame,
  parseFrame,
} from "./protocol";

/**
 * The companion control server.
 *
 * A-X-M has to keep working exactly as it does now whether a phone is connected,
 * absent, or halfway through pairing, so nothing here is on a path the menu needs.
 * Everything is a callback the rest of the app supplies; if it supplies none, a
 * connected phone simply does nothing.
 *
 * The security model, in order:
 *
 * 1. An unpaired socket may send four message types and nothing else. It cannot
 *    navigate, control media or move the pointer until a human has read a code off
 *    the A-X-M screen and typed it into the phone.
 * 2. Pairing attempts are counted per socket and the socket is dropped after a few
 *    wrong codes, so a four-digit code cannot be walked through.
 * 3. A paired device still only gets the features switched on in settings.
 * 4. Nothing on the wire can name a file or a command. The phone picks from fixed
 *    enums; this side decides what they mean.
 *
 * Revoking a device takes effect on its next frame, not at some later sweep.
 */

/** Wrong codes allowed on one socket before it is closed. */
const MAX_PAIR_ATTEMPTS = 5;
/** A pairing code is only good for this long. */
const PAIR_WINDOW_MS = 120_000;
/** Silence longer than this and the socket is assumed dead. */
const HEARTBEAT_TIMEOUT_MS = 30_000;
/** Ceiling on frames per second from one device, to bound a misbehaving client. */
const MAX_FRAMES_PER_SECOND = 240;

export interface CompanionHandlers {
  onXmbInput?(action: XmbAction, device: TrustedDevice): void;
  onMediaCommand?(command: MediaCommand, value: number | undefined, device: TrustedDevice): void;
  onPointer?(input: PointerMessage["payload"], device: TrustedDevice): void;
  onToyScan?(scan: ToyScanMessage["payload"], device: TrustedDevice): void;
  onGhostText?(text: string, device: TrustedDevice): void;
  /** Connected, disconnected, or paired - for the menu's device list and notices. */
  onSessionsChanged?(sessions: CompanionSessionInfo[]): void;
  /** A code the user must be shown on the A-X-M screen. Null clears it. */
  onPairingCode?(code: string | null, deviceName: string): void;
  onStatus?(message: string): void;
}

export interface CompanionSessionInfo {
  deviceId: string;
  name: string;
  address: string;
  mode: CompanionMode;
  paired: boolean;
  since: number;
}

interface Session {
  socket: WebSocket;
  address: string;
  device: CompanionDevice | null;
  trusted: TrustedDevice | null;
  mode: CompanionMode;
  since: number;
  pairCode: string | null;
  pairExpires: number;
  pairAttempts: number;
  lastSeen: number;
  /** Rolling frame counter, reset each second, for the rate limit. */
  frames: number;
  frameWindow: number;
}

export class CompanionServer {
  private wss: WebSocketServer | null = null;
  private discovery: CompanionDiscovery | null = null;
  private sessions = new Set<Session>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private registry: DeviceRegistry,
    private hostName: string,
    private hostVersion: string,
    private handlers: CompanionHandlers = {}
  ) {}

  setHandlers(handlers: CompanionHandlers): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  addresses(): string[] {
    return localAddresses();
  }

  isRunning(): boolean {
    return this.wss !== null;
  }

  start(): void {
    if (this.wss) return;
    if (!this.registry.isEnabled()) return;

    let wss: WebSocketServer;
    try {
      // Bound on every interface on purpose: the phone is on the LAN, not here.
      // Nothing is reachable without pairing, which is what makes that acceptable.
      wss = new WebSocketServer({ port: COMPANION_CONTROL_PORT });
    } catch (err) {
      this.handlers.onStatus?.(`Companion server could not start: ${String(err)}`);
      return;
    }
    this.wss = wss;

    wss.on("error", (err) => {
      this.handlers.onStatus?.(`Companion server error: ${err.message}`);
      this.stop();
    });

    wss.on("connection", (socket, request) => {
      const session: Session = {
        socket,
        address: request.socket.remoteAddress ?? "unknown",
        device: null,
        trusted: null,
        mode: "idle",
        since: Date.now(),
        pairCode: null,
        pairExpires: 0,
        pairAttempts: 0,
        lastSeen: Date.now(),
        frames: 0,
        frameWindow: Date.now(),
      };
      this.sessions.add(session);

      socket.on("message", (data) => this.onMessage(session, String(data)));
      socket.on("close", () => this.drop(session));
      socket.on("error", () => this.drop(session));
    });

    this.discovery = new CompanionDiscovery(
      { hostName: this.hostName, hostVersion: this.hostVersion, controlPort: COMPANION_CONTROL_PORT },
      (message) => this.handlers.onStatus?.(message)
    );
    this.discovery.start();

    this.heartbeat = setInterval(() => this.sweep(), 10_000);
    this.handlers.onStatus?.(`Companion ready on ${this.addresses()[0] ?? "this machine"}`);
  }

  stop(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.discovery?.stop();
    this.discovery = null;

    for (const session of [...this.sessions]) {
      try {
        session.socket.close();
      } catch {
        // Already gone.
      }
    }
    this.sessions.clear();

    try {
      this.wss?.close();
    } catch {
      // Already closed.
    }
    this.wss = null;
    this.handlers.onSessionsChanged?.([]);
  }

  // ----------------------------------------------------------- outbound --

  /** Sends to every paired device, or just one. Unpaired sockets never receive. */
  broadcast(type: CompanionMessage["type"], payload: unknown, deviceId?: string): void {
    const data = frame(type as never, payload as never);
    for (const session of this.sessions) {
      if (!session.trusted) continue;
      if (deviceId && session.trusted.deviceId !== deviceId) continue;
      if (session.socket.readyState !== WebSocket.OPEN) continue;
      try {
        session.socket.send(data);
      } catch {
        this.drop(session);
      }
    }
  }

  setMode(mode: CompanionMode, platform?: string, deviceId?: string): void {
    for (const session of this.sessions) {
      if (!session.trusted) continue;
      if (deviceId && session.trusted.deviceId !== deviceId) continue;
      session.mode = mode;
    }
    this.broadcast("companion.mode", { mode, platform }, deviceId);
    this.publishSessions();
  }

  setGhostState(state: GhostState): void {
    this.broadcast("ghost.state", { state });
  }

  sessionList(): CompanionSessionInfo[] {
    return [...this.sessions].map((s) => ({
      deviceId: s.trusted?.deviceId ?? s.device?.deviceId ?? "",
      name: s.trusted?.name ?? s.device?.name ?? "Unknown device",
      address: s.address,
      mode: s.mode,
      paired: !!s.trusted,
      since: s.since,
    }));
  }

  // ----------------------------------------------------------- inbound --

  private onMessage(session: Session, raw: string): void {
    session.lastSeen = Date.now();

    // Rate limit before parsing: a flood should cost us as little as possible.
    const now = Date.now();
    if (now - session.frameWindow >= 1000) {
      session.frameWindow = now;
      session.frames = 0;
    }
    if (++session.frames > MAX_FRAMES_PER_SECOND) return;

    const message = parseFrame(raw);
    if (!message) return;

    if (message.protocol !== COMPANION_PROTOCOL_VERSION) {
      this.send(session, "link.error", {
        message: `This A-X-M speaks companion protocol ${COMPANION_PROTOCOL_VERSION}. Update the phone app.`,
        fatal: true,
      });
      session.socket.close();
      return;
    }

    // The gate: everything except the four introduction types needs a paired,
    // still-trusted device. Revoking takes effect here, on the next frame.
    if (!PRE_PAIR_TYPES.includes(message.type)) {
      if (!session.trusted || !this.registry.list().some((d) => d.deviceId === session.trusted?.deviceId)) {
        this.send(session, "link.error", { message: "This device is not paired with A-X-M.", fatal: true });
        session.socket.close();
        return;
      }
    }

    switch (message.type) {
      case "device.hello":
        return this.onHello(session, message.payload);
      case "pair.submit":
        return this.onPairSubmit(session, message.payload.code);
      case "link.ping":
        return this.send(session, "link.pong", { at: Date.now() });
      case "device.goodbye":
        session.socket.close();
        return;
      case "companion.mode":
        session.mode = message.payload.mode;
        this.publishSessions();
        return;
      case "xmb.input":
        if (this.allowed("xmbNavigation")) this.handlers.onXmbInput?.(message.payload.action, session.trusted!);
        return;
      case "media.command":
        if (this.allowed("mediaControl")) {
          this.handlers.onMediaCommand?.(message.payload.command, message.payload.value, session.trusted!);
        }
        return;
      case "pointer.input":
        if (this.allowed("touchpad")) this.handlers.onPointer?.(message.payload, session.trusted!);
        return;
      case "toybox.scan":
        if (this.allowed("toyBox")) this.handlers.onToyScan?.(message.payload, session.trusted!);
        return;
      case "ghost.message":
        if (this.allowed("ghost")) this.handlers.onGhostText?.(message.payload.text, session.trusted!);
        return;
      default:
        // Unknown but well-formed: ignored, so a newer phone talking about a
        // feature this build lacks degrades instead of being disconnected.
        return;
    }
  }

  private onHello(session: Session, payload: CompanionDevice & { token?: string }): void {
    if (!payload.deviceId || !payload.name) {
      this.send(session, "link.error", { message: "The phone did not identify itself.", fatal: true });
      session.socket.close();
      return;
    }
    session.device = payload;

    if (payload.token) {
      const trusted = this.registry.verify(payload.deviceId, payload.token);
      if (trusted) {
        session.trusted = trusted;
        this.send(session, "device.welcome", {
          hostName: this.hostName,
          hostVersion: this.hostVersion,
          paired: true,
          protocol: COMPANION_PROTOCOL_VERSION,
        });
        this.publishSessions();
        this.handlers.onStatus?.(`${trusted.name} connected`);
        return;
      }
    }

    // Not known, or a stale token: start pairing. The code is shown by A-X-M, so
    // whoever pairs has to be able to see this screen.
    session.pairCode = String(crypto.randomInt(0, 10_000)).padStart(4, "0");
    session.pairExpires = Date.now() + PAIR_WINDOW_MS;
    session.pairAttempts = 0;

    this.send(session, "device.welcome", {
      hostName: this.hostName,
      hostVersion: this.hostVersion,
      paired: false,
      protocol: COMPANION_PROTOCOL_VERSION,
    });
    this.handlers.onPairingCode?.(session.pairCode, payload.name);
    this.publishSessions();
  }

  private onPairSubmit(session: Session, code: string): void {
    if (!session.device || !session.pairCode) {
      this.send(session, "pair.result", { ok: false, reason: "Say hello first." });
      return;
    }
    if (Date.now() > session.pairExpires) {
      this.send(session, "pair.result", { ok: false, reason: "That code expired. Try again." });
      this.handlers.onPairingCode?.(null, session.device.name);
      session.socket.close();
      return;
    }

    // Constant-time compare so the code cannot be recovered a digit at a time.
    const given = Buffer.from(String(code ?? "").padStart(4, "0").slice(0, 4), "utf-8");
    const known = Buffer.from(session.pairCode, "utf-8");
    const ok = given.length === known.length && crypto.timingSafeEqual(given, known);

    if (!ok) {
      session.pairAttempts++;
      const left = MAX_PAIR_ATTEMPTS - session.pairAttempts;
      this.send(session, "pair.result", { ok: false, reason: "That code is not right.", attemptsLeft: Math.max(0, left) });
      if (left <= 0) {
        this.handlers.onPairingCode?.(null, session.device.name);
        session.socket.close();
      }
      return;
    }

    const token = this.registry.trust({
      deviceId: session.device.deviceId,
      name: session.device.name,
      platform: session.device.platform,
      capabilities: session.device.capabilities,
    });
    session.trusted = this.registry.verify(session.device.deviceId, token);
    session.pairCode = null;

    this.send(session, "pair.result", { ok: true, token });
    this.handlers.onPairingCode?.(null, session.device.name);
    this.handlers.onStatus?.(`${session.device.name} paired`);
    this.publishSessions();
  }

  // ------------------------------------------------------------ plumbing --

  private allowed(feature: keyof CompanionPermissions): boolean {
    return this.registry.permissions()[feature];
  }

  private send(session: Session, type: CompanionMessage["type"], payload: unknown): void {
    if (session.socket.readyState !== WebSocket.OPEN) return;
    try {
      session.socket.send(frame(type as never, payload as never));
    } catch {
      this.drop(session);
    }
  }

  private drop(session: Session): void {
    if (!this.sessions.delete(session)) return;
    try {
      session.socket.terminate();
    } catch {
      // Already gone.
    }
    if (session.pairCode) this.handlers.onPairingCode?.(null, session.device?.name ?? "");
    if (session.trusted) this.handlers.onStatus?.(`${session.trusted.name} disconnected`);
    this.publishSessions();
  }

  /** Closes sockets that have gone quiet, and pings the ones that are still here. */
  private sweep(): void {
    const now = Date.now();
    for (const session of [...this.sessions]) {
      if (now - session.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        this.drop(session);
        continue;
      }
      this.send(session, "link.ping", { at: now });
    }
  }

  private publishSessions(): void {
    this.handlers.onSessionsChanged?.(this.sessionList());
  }
}
