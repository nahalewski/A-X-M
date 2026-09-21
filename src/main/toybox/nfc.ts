import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { spawn, ChildProcess } from "node:child_process";
import { app, BrowserWindow } from "electron";
import { isWindows } from "../platform";
import { toybox } from "./toyboxService";
import { artUrl } from "./artwork";
import { handOff } from "./bridge";
import { ToyboxDetectionEvent, ToyboxRemovalEvent, ToyFigure, ToyPlatform } from "./types";

/**
 * The NFC hub. Readers of every kind feed raw scans in; one standardised
 * ToyboxDetectionEvent comes out (and a ToyboxRemovalEvent when the toy leaves).
 * Ghost and the menu subscribe to those two events and never touch hardware.
 *
 * Sources:
 *   - PC/SC readers (ACR122U and the like) through assets/nfc/pcsc_reader.py in
 *     the app's Python environment; the script decodes the four ecosystems.
 *   - The companion endpoint: a small HTTP server on the LAN the Android app (or
 *     a portal adapter, or curl) posts scans to. Same event out.
 *   - A simulated scan from the menu, for tests and for "Identify" on a figure.
 *
 * Debounce lives here: a tag that stays on the reader is one detection, however
 * often the reader re-reports it; a new event needs removal + return, a
 * different tag, or the same tag after RESCAN_AFTER_MS.
 */

export interface RawScan {
  reader: { id: string; type: string };
  uid: string;
  tech?: string;
  ecosystem?: ToyPlatform;
  head?: string;
  tail?: string;
  characterId?: string;
  variantId?: string;
  /** A companion that already identified the figure can send its id directly. */
  figureId?: string;
  /** A read-only copy of the tag (base64) and its file extension, for the emulators. */
  dump?: string;
  dumpExt?: string;
}

/** Where tag copies go: the folder Eden / yuzu / RPCS3's portal dialogs are pointed at. */
export function dumpsDir(): string {
  return path.join(app.getPath("userData"), "toybox", "figures");
}

const RESCAN_AFTER_MS = 30_000;
const COMPANION_PORT = 47311;

interface ReaderState {
  uid: string;
  figureId: string | null;
  detectedAt: number;
  lastNotificationAt: number;
}

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

function venvPython(): string {
  const venv = path.join(app.getPath("userData"), "tts", "venv");
  return isWindows ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

function readerScript(): string {
  return path.join(__dirname, "..", "renderer", "assets", "nfc", "pcsc_reader.py");
}

export class NfcHub {
  private readers = new Map<string, ReaderState>();
  private pcsc: ChildProcess | null = null;
  private pcscNames: string[] = [];
  private server: http.Server | null = null;
  private lastError: string | null = null;
  private stopped = false;

  status(): { pcscRunning: boolean; readers: string[]; companionPort: number | null; pythonReady: boolean; lastError: string | null } {
    return { pcscRunning: !!this.pcsc, readers: this.pcscNames, companionPort: this.server ? COMPANION_PORT : null, pythonReady: fs.existsSync(venvPython()), lastError: this.lastError };
  }

  /** Starts whatever can start; missing pieces are reported, not fatal. */
  start(companion = true): void {
    this.stopped = false;
    this.startPcsc();
    if (companion) this.startCompanion();
  }

  stop(): void {
    this.stopped = true;
    this.pcsc?.kill();
    this.pcsc = null;
    this.server?.close();
    this.server = null;
  }

  private startPcsc(): void {
    if (this.pcsc) return;
    if (!fs.existsSync(venvPython()) || !fs.existsSync(readerScript())) {
      this.lastError = "PC/SC reader support needs the Python environment (Settings › System › Install Tools)";
      return;
    }
    const p = spawn(venvPython(), ["-u", readerScript()], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    this.pcsc = p;
    let buffer = "";
    p.stdout?.on("data", (d: Buffer) => {
      buffer += String(d);
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        try {
          this.onPcscLine(JSON.parse(line));
        } catch {
          /* not for us */
        }
      }
    });
    p.stderr?.on("data", (d: Buffer) => {
      const t = String(d);
      if (/error|traceback/i.test(t)) this.lastError = t.slice(0, 300);
    });
    p.on("exit", (code) => {
      if (this.pcsc !== p) return; // an older instance going away; the current one is fine
      this.pcsc = null;
      this.pcscNames = [];
      if (code === 2) this.lastError = "pyscard is not installed in the Python environment (Install Tools adds it)";
      // A reader unplugged mid-way can kill the loop; come back in a while.
      setTimeout(() => { if (!this.pcsc && !this.stopped) this.startPcsc(); }, 15_000);
    });
  }

  private onPcscLine(msg: { event: string; reader?: string; list?: string[]; uid?: string; error?: string; tech?: string; ecosystem?: string; head?: string; tail?: string; characterId?: string; variantId?: string; dump?: string; dumpExt?: string }): void {
    if (msg.event === "readers") {
      this.pcscNames = msg.list ?? [];
      send("axm:toyboxReaders", this.status());
    } else if (msg.event === "error") this.lastError = msg.error ?? null;
    else if (msg.event === "tag" && msg.uid) {
      this.scan({ reader: { id: msg.reader ?? "pcsc", type: "pcsc" }, uid: msg.uid, tech: msg.tech, ecosystem: msg.ecosystem as ToyPlatform | undefined, head: msg.head, tail: msg.tail, characterId: msg.characterId, variantId: msg.variantId, dump: msg.dump, dumpExt: msg.dumpExt });
    } else if (msg.event === "removed" && msg.uid) this.removed(msg.reader ?? "pcsc", msg.uid);
  }

  /**
   * The companion endpoint. POST /toybox/scan with the RawScan fields (uid and
   * either ecosystem + identifiers or a figureId); POST /toybox/remove with the
   * uid. GET /toybox/status answers what the hub knows. Plain JSON, no auth: it
   * is meant for the same Wi-Fi as the handheld, like Remote Play.
   */
  private startCompanion(): void {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      const url = (req.url ?? "/").split("?")[0];
      const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
      if (req.method === "GET" && url === "/toybox/status") {
        res.writeHead(200, headers);
        res.end(JSON.stringify({ ok: true, app: "A-X-M", ...this.status(), present: [...this.readers.entries()].map(([id, s]) => ({ reader: id, figureId: s.figureId })) }));
        return;
      }
      if (req.method !== "POST" || !url.startsWith("/toybox/")) {
        res.writeHead(404, headers);
        res.end("{}");
        return;
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let json: Partial<RawScan> & { reader?: string | { id: string; type: string } } = {};
        try {
          json = JSON.parse(body || "{}");
        } catch {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ ok: false, error: "bad json" }));
          return;
        }
        const reader = typeof json.reader === "string" ? { id: json.reader, type: "companion" } : json.reader ?? { id: req.socket.remoteAddress ?? "companion", type: "companion" };
        if (url === "/toybox/scan" && json.uid) {
          const ev = this.scan({ ...json, reader, uid: json.uid });
          res.writeHead(200, headers);
          res.end(JSON.stringify({ ok: true, event: ev }));
        } else if (url === "/toybox/remove" && json.uid) {
          this.removed(reader.id, json.uid);
          res.writeHead(200, headers);
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ ok: false, error: "uid required" }));
        }
      });
    });
    this.server.on("error", (e) => {
      this.lastError = `companion endpoint: ${e.message}`;
      this.server = null;
    });
    this.server.listen(COMPANION_PORT, "0.0.0.0");
  }

  /** Turns a raw scan into the event, debounced per reader. Returns the event when one went out. */
  scan(raw: RawScan): ToyboxDetectionEvent | null {
    const now = Date.now();
    const state = this.readers.get(raw.reader.id);
    if (state && state.uid === raw.uid && now - state.detectedAt < RESCAN_AFTER_MS) return null; // same toy, still there
    const figure = this.identify(raw);
    const event = this.toEvent(raw, figure, now);
    if (raw.dump && raw.dumpExt) {
      // The copy is named after the figure so an emulator's file picker reads well.
      try {
        fs.mkdirSync(dumpsDir(), { recursive: true });
        const base = (figure ? `${figure.name} (${figure.id})` : raw.uid).replace(/[<>:"/\|?*]/g, "");
        const file = path.join(dumpsDir(), `${base}.${raw.dumpExt}`);
        fs.writeFileSync(file, Buffer.from(raw.dump, "base64"));
        event.dumpPath = file;
        event.handedTo = handOff(event.ecosystem, file);
      } catch (err) {
        this.lastError = `couldn't keep the tag copy: ${(err as Error).message}`;
      }
    }
    this.readers.set(raw.reader.id, { uid: raw.uid, figureId: figure?.id ?? null, detectedAt: now, lastNotificationAt: now });
    if (figure) toybox.noteScanned(figure.id);
    send("axm:toyboxDetected", event);
    return event;
  }

  removed(readerId: string, uid: string): void {
    const state = this.readers.get(readerId);
    if (!state || state.uid !== uid) return;
    this.readers.delete(readerId);
    const ev: ToyboxRemovalEvent = { uid, figureId: state.figureId, reader: { id: readerId, type: "pcsc" }, removedAt: Date.now() };
    send("axm:toyboxRemoved", ev);
  }

  /** A scan the menu makes up (tests, "Identify" on a figure): same path as the hardware. */
  simulate(figureId: string, readerId = "simulated"): ToyboxDetectionEvent | null {
    const f = toybox.getFigureById(figureId);
    const uid = `sim-${figureId}`;
    const raw: RawScan = { reader: { id: readerId, type: "simulated" }, uid, figureId: f?.id, ecosystem: f?.platform };
    // A simulated scan always fires, even if the last one was the same figure.
    this.readers.delete(readerId);
    return this.scan(raw);
  }

  simulateUnknown(readerId = "simulated"): ToyboxDetectionEvent | null {
    this.readers.delete(readerId);
    return this.scan({ reader: { id: readerId, type: "simulated" }, uid: `sim-unknown-${Date.now()}`, tech: "ntag" });
  }

  simulateRemoval(readerId = "simulated"): void {
    const s = this.readers.get(readerId);
    if (s) this.removed(readerId, s.uid);
  }

  private identify(raw: RawScan): ToyFigure | null {
    if (raw.figureId) {
      const f = toybox.getFigureById(raw.figureId);
      if (f) return f;
    }
    if (raw.ecosystem) {
      const f = toybox.identifyTag(raw.ecosystem, { head: raw.head, tail: raw.tail, characterId: raw.characterId, variantId: raw.variantId, uid: raw.uid });
      if (f) return f;
    }
    // No ecosystem known: a custom mapping by UID is the only hope.
    for (const p of ["amiibo", "skylanders", "disney-infinity", "lego-dimensions", "generic"] as ToyPlatform[]) {
      const f = toybox.identifyTag(p, { uid: raw.uid });
      if (f) return f;
    }
    return null;
  }

  private toEvent(raw: RawScan, figure: ToyFigure | null, now: number): ToyboxDetectionEvent {
    if (!figure) {
      return { figureId: null, ecosystem: raw.ecosystem ?? "custom", name: "Unknown Toy", compatibleGameIds: [], reader: raw.reader, uid: raw.uid, detectedAt: now };
    }
    const art = artUrl(figure);
    return {
      figureId: figure.id,
      ecosystem: figure.platform,
      name: figure.name,
      character: figure.attributes?.character ?? figure.name,
      variant: figure.variant,
      series: figure.series,
      franchise: figure.franchise,
      artwork: art ? { png: art, thumbnail: art } : undefined,
      compatibleGameIds: figure.compatibleGames ?? [],
      reader: raw.reader,
      uid: raw.uid,
      detectedAt: now,
    };
  }
}

export const nfcHub = new NfcHub();
