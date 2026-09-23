import * as crypto from "node:crypto";
import type { CompanionServer } from "./companion/server";
import type { PhoneCall, PhoneContact, PhoneInboundType, PhoneShareState, PhoneSms, PhoneThread } from "./companion/protocol";
import { loadSettings } from "./settingsStore";

/**
 * Experimental: the Device column's Phone, Messages and Contacts.
 *
 * The data belongs to the paired phone and never lands on this machine's disk -
 * it is asked for when an app opens and held only by the renderer while the menu
 * runs. Everything the phone sends is reshaped here into plain, bounded values
 * before the menu sees it, because it arrived off the network. Nothing is
 * forwarded, and nothing is asked for, while Settings › Experimental is off.
 */

export type DeviceEvent =
  | { kind: "state"; share: PhoneShareState | null; name: string | null }
  | { kind: "contacts"; contacts: PhoneContact[] }
  | { kind: "threads"; threads: PhoneThread[] }
  | { kind: "messages"; threadId: string; address: string; messages: PhoneSms[] }
  | { kind: "calls"; calls: PhoneCall[] }
  | { kind: "callState"; state: "idle" | "ringing" | "offhook"; number?: string; name?: string }
  | { kind: "smsResult"; ref: string; ok: boolean; error?: string }
  | { kind: "incomingSms"; threadId: string; address: string; name?: string; body: string; date: number };

const MAX_CONTACTS = 5000;
const MAX_THREADS = 500;
const MAX_MESSAGES = 500;
const MAX_CALLS = 500;
/** A contact picture is a thumbnail; anything bigger is dropped rather than drawn. */
const MAX_PHOTO_CHARS = 60_000;

const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Digits, +, *, # and the pause characters: all a dialer needs, nothing else. */
export function cleanNumber(raw: string): string {
  return raw.replace(/[^0-9+*#,;]/g, "").slice(0, 40);
}

function enabled(): boolean {
  return loadSettings().experimental?.enabled === true;
}

function contact(v: unknown): PhoneContact | null {
  const o = obj(v);
  const name = str(o.name).trim();
  const numbers = arr(o.numbers, 12)
    .map((n) => ({ number: str(obj(n).number, 60), label: str(obj(n).label, 40) }))
    .filter((n) => n.number);
  if (!name && !numbers.length) return null;
  const photo = str(o.photo, MAX_PHOTO_CHARS + 1);
  return {
    id: str(o.id, 80),
    name: name || numbers[0].number,
    numbers,
    starred: o.starred === true,
    ...(photo.startsWith("data:image/") && photo.length <= MAX_PHOTO_CHARS ? { photo } : {}),
  };
}

function thread(v: unknown): PhoneThread | null {
  const o = obj(v);
  const id = str(o.id, 80);
  if (!id) return null;
  const name = str(o.name);
  return { id, address: str(o.address, 60), ...(name ? { name } : {}), snippet: str(o.snippet, 300), date: num(o.date), unread: Math.max(0, Math.floor(num(o.unread))) };
}

function sms(v: unknown): PhoneSms {
  const o = obj(v);
  return { id: str(o.id, 80), body: str(o.body, 5000), date: num(o.date), outgoing: o.outgoing === true };
}

const CALL_KINDS = ["incoming", "outgoing", "missed", "rejected"] as const;
function call(v: unknown): PhoneCall {
  const o = obj(v);
  const name = str(o.name);
  const kind = CALL_KINDS.includes(o.kind as PhoneCall["kind"]) ? (o.kind as PhoneCall["kind"]) : "incoming";
  return { number: str(o.number, 60), ...(name ? { name } : {}), date: num(o.date), durationSeconds: Math.max(0, Math.floor(num(o.durationSeconds))), kind };
}

/** The phone's frame, reshaped for the menu - or null when it should not reach it. */
export function toDeviceEvent(type: PhoneInboundType, payload: unknown, server: CompanionServer): DeviceEvent | null {
  if (!enabled()) return null;
  const p = obj(payload);
  switch (type) {
    case "phone.state": {
      const info = server.phoneInfo();
      return { kind: "state", share: info?.share ?? null, name: info?.name ?? null };
    }
    case "phone.contacts":
      return { kind: "contacts", contacts: arr(p.contacts, MAX_CONTACTS).map(contact).filter((c): c is PhoneContact => !!c) };
    case "phone.threads":
      return { kind: "threads", threads: arr(p.threads, MAX_THREADS).map(thread).filter((t): t is PhoneThread => !!t) };
    case "phone.messages":
      return { kind: "messages", threadId: str(p.threadId, 80), address: str(p.address, 60), messages: arr(p.messages, MAX_MESSAGES).map(sms) };
    case "phone.calls":
      return { kind: "calls", calls: arr(p.calls, MAX_CALLS).map(call) };
    case "phone.callState": {
      const state = p.state === "ringing" || p.state === "offhook" ? p.state : "idle";
      const number = str(p.number, 60);
      const name = str(p.name);
      return { kind: "callState", state, ...(number ? { number } : {}), ...(name ? { name } : {}) };
    }
    case "phone.smsResult": {
      const error = str(p.error, 300);
      return { kind: "smsResult", ref: str(p.ref, 80), ok: p.ok === true, ...(error ? { error } : {}) };
    }
    case "phone.incomingSms": {
      const name = str(p.name);
      return { kind: "incomingSms", threadId: str(p.threadId, 80), address: str(p.address, 60), ...(name ? { name } : {}), body: str(p.body, 5000), date: num(p.date) };
    }
  }
  return null;
}

/** What the menu asks of the phone. Each returns false when no phone is sharing. */
export function deviceRequest(server: CompanionServer, what: "contacts" | "threads" | "calls" | "messages", threadId?: string): boolean {
  if (!enabled() || !["contacts", "threads", "calls", "messages"].includes(what)) return false;
  return server.sendToPhone("phone.request", { what, ...(threadId ? { threadId: str(threadId, 80) } : {}) });
}

export function deviceDial(server: CompanionServer, raw: string): boolean {
  const number = cleanNumber(String(raw ?? ""));
  if (!enabled() || !number) return false;
  return server.sendToPhone("phone.dial", { number });
}

export function deviceCallControl(server: CompanionServer, action: "answer" | "hangup"): boolean {
  if (!enabled()) return false;
  return server.sendToPhone(action === "answer" ? "phone.answer" : "phone.hangup", { at: Date.now() });
}

/** Sends a text; the ref comes back on the smsResult event. Null when no phone took it. */
export function deviceSendSms(server: CompanionServer, rawTo: string, rawBody: string): string | null {
  const to = cleanNumber(String(rawTo ?? ""));
  const body = String(rawBody ?? "").slice(0, 2000);
  if (!enabled() || !to || !body.trim()) return null;
  const ref = crypto.randomUUID();
  return server.sendToPhone("phone.sendSms", { to, body, ref }) ? ref : null;
}
