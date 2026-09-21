import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Xtream Codes client, for the TV Streaming app in the Video column.
 *
 * Xtream Codes is the panel software a great many IPTV providers run, so one
 * client covers all of them: the same `player_api.php` endpoints, the same stream
 * URL shapes. Nothing here is specific to any one provider.
 *
 * Credentials live in userData, never in the repository - this project's git
 * remote is public, and a portal login is a credential like any other. They are
 * entered in the app and stay on the machine.
 *
 * The API is untrusted input: a portal can return anything, including HTML error
 * pages where JSON was promised. Every call is defensive, every list is filtered
 * to entries that actually have the fields we use, and a failure returns an empty
 * result with a message rather than throwing into the menu.
 */

export interface XtreamAccount {
  /** Portal base, e.g. http://example.com or http://example.com:8080 */
  url: string;
  username: string;
  password: string;
}

export interface XtreamStatus {
  configured: boolean;
  connected: boolean;
  message: string;
  /** From the portal's own user_info, when it gives them. */
  expiresAt?: string;
  activeConnections?: string;
  maxConnections?: string;
}

export interface XtreamCategory {
  id: string;
  name: string;
}

export type XtreamKind = "live" | "movie" | "series";

export interface XtreamItem {
  id: string;
  name: string;
  kind: XtreamKind;
  categoryId: string;
  /** The provider's own artwork URL. Fetched at runtime, never bundled. */
  icon?: string;
  /** Live only: the id an EPG lookup needs. */
  epgChannelId?: string;
  /** Movies only: the container the portal will serve, e.g. "mkv". */
  extension?: string;
}

export interface XtreamProgramme {
  title: string;
  description?: string;
  start: string;
  end: string;
}

function accountPath(): string {
  return path.join(app.getPath("userData"), "xtream.json");
}

/** Trailing slashes and a stray /player_api.php are both common in pasted URLs. */
function normaliseBase(url: string): string {
  let base = url.trim().replace(/\/+$/, "");
  base = base.replace(/\/player_api\.php.*$/i, "");
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base;
}

/** Portals encode base64 in a few fields and plain text in others; be forgiving. */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

export function loadAccount(): XtreamAccount | null {
  try {
    const raw = JSON.parse(fs.readFileSync(accountPath(), "utf-8")) as Partial<XtreamAccount>;
    if (!raw.url || !raw.username || !raw.password) return null;
    return { url: normaliseBase(raw.url), username: raw.username, password: raw.password };
  } catch {
    return null;
  }
}

export function saveAccount(account: XtreamAccount | null): void {
  try {
    const target = accountPath();
    if (!account) {
      fs.rmSync(target, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp`;
    fs.writeFileSync(
      temp,
      JSON.stringify({ ...account, url: normaliseBase(account.url) }, null, 2),
      "utf-8"
    );
    fs.renameSync(temp, target);
  } catch (err) {
    console.error("[A-X-M] could not save the TV Streaming login:", err);
  }
}

async function api(account: XtreamAccount, params: Record<string, string> = {}): Promise<unknown | null> {
  const base = normaliseBase(account.url);
  const query = new URLSearchParams({
    username: account.username,
    password: account.password,
    ...params,
  });
  try {
    const res = await fetch(`${base}/player_api.php?${query.toString()}`, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "A-X-M" },
    });
    if (!res.ok) return null;
    const body = await res.text();
    // A portal that is down, or rate limiting, often serves an HTML page here.
    if (!body.trim().startsWith("{") && !body.trim().startsWith("[")) return null;
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Checks the login and reports what the portal says about the account. */
export async function status(): Promise<XtreamStatus> {
  const account = loadAccount();
  if (!account) {
    return { configured: false, connected: false, message: "No TV Streaming account set up yet" };
  }

  const info = (await api(account)) as
    | { user_info?: Record<string, unknown>; server_info?: Record<string, unknown> }
    | null;

  if (!info?.user_info) {
    return { configured: true, connected: false, message: "Could not reach the TV Streaming service" };
  }
  const user = info.user_info;
  if (text(user.auth) === "0" || text(user.status).toLowerCase() === "banned") {
    return { configured: true, connected: false, message: "The service rejected this username and password" };
  }

  const expiry = text(user.exp_date);
  return {
    configured: true,
    connected: true,
    message: `Signed in as ${text(user.username) || account.username}`,
    // The portal gives a unix timestamp; a date is what a person wants to read.
    expiresAt: expiry && /^\d+$/.test(expiry) ? new Date(Number(expiry) * 1000).toISOString() : undefined,
    activeConnections: text(user.active_cons) || undefined,
    maxConnections: text(user.max_connections) || undefined,
  };
}

const CATEGORY_ACTION: Record<XtreamKind, string> = {
  live: "get_live_categories",
  movie: "get_vod_categories",
  series: "get_series_categories",
};

const STREAM_ACTION: Record<XtreamKind, string> = {
  live: "get_live_streams",
  movie: "get_vod_streams",
  series: "get_series",
};

export async function categories(kind: XtreamKind): Promise<XtreamCategory[]> {
  const account = loadAccount();
  if (!account) return [];
  const rows = (await api(account, { action: CATEGORY_ACTION[kind] })) as
    | { category_id?: unknown; category_name?: unknown }[]
    | null;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ id: text(r.category_id), name: text(r.category_name) }))
    .filter((c) => c.id && c.name);
}

export async function items(kind: XtreamKind, categoryId?: string): Promise<XtreamItem[]> {
  const account = loadAccount();
  if (!account) return [];
  const params: Record<string, string> = { action: STREAM_ACTION[kind] };
  if (categoryId) params.category_id = categoryId;

  const rows = (await api(account, params)) as Record<string, unknown>[] | null;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r) => ({
      // Live and VOD use stream_id; series uses series_id.
      id: text(r.stream_id) || text(r.series_id),
      name: text(r.name) || text(r.title),
      kind,
      categoryId: text(r.category_id),
      icon: text(r.stream_icon) || text(r.cover) || undefined,
      epgChannelId: text(r.epg_channel_id) || undefined,
      extension: text(r.container_extension) || undefined,
    }))
    .filter((i) => i.id && i.name);
}

/** What is on now and next, for the guide. Empty when the portal carries no EPG. */
export async function shortEpg(streamId: string, limit = 8): Promise<XtreamProgramme[]> {
  const account = loadAccount();
  if (!account) return [];
  const data = (await api(account, {
    action: "get_short_epg",
    stream_id: streamId,
    limit: String(limit),
  })) as { epg_listings?: Record<string, unknown>[] } | null;

  const rows = data?.epg_listings;
  if (!Array.isArray(rows)) return [];

  // Titles and descriptions come back base64 encoded on most panels.
  const decode = (value: unknown): string => {
    const raw = text(value);
    if (!raw) return "";
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf-8");
      // If it round-trips it really was base64; otherwise it was plain text.
      return Buffer.from(decoded, "utf-8").toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "")
        ? decoded
        : raw;
    } catch {
      return raw;
    }
  };

  return rows
    .map((r) => ({
      title: decode(r.title),
      description: decode(r.description) || undefined,
      start: text(r.start),
      end: text(r.end),
    }))
    .filter((p) => p.title);
}

/**
 * The URL a player opens. Built here rather than in the renderer so the password
 * never crosses into the window, where a page could read it.
 */
export function streamUrl(item: XtreamItem): string | null {
  const account = loadAccount();
  if (!account) return null;
  const base = normaliseBase(account.url);
  const user = encodeURIComponent(account.username);
  const pass = encodeURIComponent(account.password);

  if (item.kind === "live") return `${base}/live/${user}/${pass}/${item.id}.m3u8`;
  if (item.kind === "movie") return `${base}/movie/${user}/${pass}/${item.id}.${item.extension || "mp4"}`;
  // A series id is a show, not a playable stream; episodes are fetched separately.
  return null;
}
