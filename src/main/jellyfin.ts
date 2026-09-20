import * as dgram from "node:dgram";
import * as os from "node:os";
import { loadSettings, saveSettings, JellyfinLogin } from "./settingsStore";

/**
 * Jellyfin client: finds servers on the LAN the same way the official apps do (a
 * UDP broadcast that every server answers), signs in by name, and browses the
 * signed-in user's libraries. Only the access token a login returns is stored,
 * never the password.
 */

const DISCOVERY_PORT = 7359;
const DISCOVERY_MESSAGE = "who is JellyfinServer?";
const DISCOVERY_WINDOW_MS = 2200;
const CLIENT_NAME = "A-X-M";
const CLIENT_VERSION = "0.1.0";

export interface JellyfinServer {
  name: string;
  url: string;
  id: string;
}

export interface JellyfinItem {
  id: string;
  name: string;
  type: string;
  isFolder: boolean;
  imageUrl?: string;
  streamUrl?: string;
  /** True when streamUrl is an HLS playlist that needs hls.js rather than a plain src. */
  hls?: boolean;
}

function deviceId(): string {
  // Stable per machine so the server shows one device, not one per launch.
  return `axm-${os.hostname()}`.replace(/[^a-z0-9-]/gi, "").toLowerCase();
}

function authHeader(token?: string): string {
  const parts = [
    `MediaBrowser Client="${CLIENT_NAME}"`,
    `Device="${os.hostname()}"`,
    `DeviceId="${deviceId()}"`,
    `Version="${CLIENT_VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return parts.join(", ");
}

/** Every IPv4 broadcast address this machine can reach, so multi-homed boxes still find servers. */
function broadcastAddresses(): string[] {
  const out = new Set<string>(["255.255.255.255"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      const ip = iface.address.split(".").map(Number);
      const mask = iface.netmask.split(".").map(Number);
      out.add(ip.map((octet, i) => (octet | (~mask[i] & 255))).join("."));
    }
  }
  return [...out];
}

export function discoverServers(): Promise<JellyfinServer[]> {
  return new Promise((resolve) => {
    const found = new Map<string, JellyfinServer>();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    const finish = () => {
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve([...found.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };

    socket.on("error", finish);
    socket.on("message", (msg) => {
      try {
        const info = JSON.parse(msg.toString("utf-8")) as { Address?: string; Id?: string; Name?: string };
        if (!info.Address || !info.Id) return;
        found.set(info.Id, { name: info.Name ?? info.Address, url: info.Address.replace(/\/+$/, ""), id: info.Id });
      } catch {
        // not a Jellyfin reply
      }
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      const payload = Buffer.from(DISCOVERY_MESSAGE);
      for (const address of broadcastAddresses()) {
        socket.send(payload, DISCOVERY_PORT, address, () => {});
      }
      setTimeout(finish, DISCOVERY_WINDOW_MS);
    });
  });
}

async function api<T>(server: string, endpoint: string, token?: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${server}${endpoint}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Authorization": authHeader(token),
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function login(server: JellyfinServer, username: string, password: string): Promise<JellyfinLogin | null> {
  const result = await api<{ AccessToken?: string; User?: { Id: string; Name: string } }>(
    server.url,
    "/Users/AuthenticateByName",
    undefined,
    { method: "POST", body: JSON.stringify({ Username: username, Pw: password }) }
  );
  if (!result?.AccessToken || !result.User) return null;

  const saved: JellyfinLogin = {
    serverUrl: server.url,
    serverName: server.name,
    userId: result.User.Id,
    userName: result.User.Name,
    accessToken: result.AccessToken,
  };
  const settings = loadSettings();
  saveSettings({ jellyfinLogins: { ...settings.jellyfinLogins, [server.url]: saved } });
  return saved;
}

export function forgetLogin(serverUrl: string): void {
  const logins = { ...loadSettings().jellyfinLogins };
  delete logins[serverUrl];
  saveSettings({ jellyfinLogins: logins });
}

interface RawItem {
  Id: string;
  Name: string;
  Type: string;
  IsFolder?: boolean;
  ImageTags?: { Primary?: string };
  MediaType?: string;
  MediaSources?: { Container?: string; MediaStreams?: { Type: string; Codec?: string }[] }[];
}

/** Containers and codecs Chromium's <video> plays natively. Anything else is transcoded. */
const DIRECT_CONTAINERS = new Set(["mp4", "m4v", "mov", "webm"]);
const DIRECT_VIDEO = new Set(["h264", "avc", "vp8", "vp9", "av1"]);
const DIRECT_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

function canDirectPlay(raw: RawItem): boolean {
  const source = raw.MediaSources?.[0];
  if (!source) return false;
  const container = (source.Container ?? "").toLowerCase().split(",")[0];
  if (!DIRECT_CONTAINERS.has(container)) return false;
  const streams = source.MediaStreams ?? [];
  const video = streams.find((m) => m.Type === "Video");
  const audio = streams.find((m) => m.Type === "Audio");
  if (video && !DIRECT_VIDEO.has((video.Codec ?? "").toLowerCase())) return false;
  if (audio && !DIRECT_AUDIO.has((audio.Codec ?? "").toLowerCase())) return false;
  return true;
}

function toItem(login: JellyfinLogin, raw: RawItem): JellyfinItem {
  const playable = raw.MediaType === "Video" && !raw.IsFolder;
  const auth = `api_key=${login.accessToken}`;
  return {
    id: raw.Id,
    name: raw.Name,
    type: raw.Type,
    isFolder: !!raw.IsFolder || raw.Type === "CollectionFolder" || raw.Type === "Series" || raw.Type === "Season",
    imageUrl: raw.ImageTags?.Primary
      ? `${login.serverUrl}/Items/${raw.Id}/Images/Primary?maxHeight=400&tag=${raw.ImageTags.Primary}&${auth}`
      : undefined,
    // Direct play when the file is something the browser decodes as-is (an MP4 with
    // H.264/AAC, say). An MKV, HEVC, AC3 or DTS file would either fail outright or
    // play with no sound, so those go through the server's HLS transcode instead -
    // decided here from the media source, not discovered after a silent failure.
    streamUrl: playable
      ? canDirectPlay(raw)
        ? `${login.serverUrl}/Videos/${raw.Id}/stream?static=true&${auth}`
        : `${login.serverUrl}/Videos/${raw.Id}/master.m3u8?VideoCodec=h264&AudioCodec=aac&MaxStreamingBitrate=20000000&TranscodingContainer=ts&TranscodingProtocol=hls&SegmentContainer=ts&${auth}`
      : undefined,
    hls: playable && !canDirectPlay(raw),
  };
}

/** The user's libraries (Movies, Shows, ...). Null if the token no longer works. */
export async function getLibraries(login: JellyfinLogin): Promise<JellyfinItem[] | null> {
  const res = await api<{ Items?: RawItem[] }>(login.serverUrl, `/Users/${login.userId}/Views`, login.accessToken);
  if (!res) return null;
  return (res.Items ?? []).map((r) => toItem(login, r));
}

export async function getItems(login: JellyfinLogin, parentId: string): Promise<JellyfinItem[] | null> {
  const query = new URLSearchParams({
    ParentId: parentId,
    SortBy: "SortName",
    SortOrder: "Ascending",
    Fields: "MediaType,MediaSources",
    Limit: "500",
  });
  const res = await api<{ Items?: RawItem[] }>(
    login.serverUrl,
    `/Users/${login.userId}/Items?${query.toString()}`,
    login.accessToken
  );
  if (!res) return null;
  return (res.Items ?? []).map((r) => toItem(login, r));
}
