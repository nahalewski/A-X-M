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
const CLIENT_VERSION = "0.3.0-beta.1";

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
  /** Wide backdrop for the menu background while the row is focused. */
  backdropUrl?: string;
  year?: string;
  overview?: string;
  /** TMDB id when the server has matched it, so the info card needn't search. */
  tmdbId?: string;
  /** File container (mkv, mp4, ...) - for the download's file name. */
  container?: string;
  /** Series name for an episode, so the info card can look up the show. */
  seriesName?: string;
  /** Season and episode numbers for an episode. */
  season?: number;
  episode?: number;
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
    `Device="${loadSettings().systemName || os.hostname()}"`,
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
        // Jellyfin 10.9+ wants the standard header and 12 rejects the old one on its
        // own; older servers only know X-Emby-Authorization. Send both.
        Authorization: authHeader(token),
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
  BackdropImageTags?: string[];
  ParentBackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ProductionYear?: number;
  Overview?: string;
  ProviderIds?: { Tmdb?: string };
  SeriesName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  MediaType?: string;
  MediaSources?: { Id?: string; Container?: string; MediaStreams?: { Type: string; Codec?: string; Language?: string; Index?: number; IsDefault?: boolean }[] }[];
}

/** ISO 639-1 (the setting) to the 639-2 codes files carry. */
const LANG3: Record<string, string[]> = { en: ["eng", "en"], es: ["spa", "es"], fr: ["fre", "fra", "fr"], de: ["ger", "deu", "de"], it: ["ita", "it"], pt: ["por", "pt"], nl: ["dut", "nld", "nl"], ja: ["jpn", "ja"], ko: ["kor", "ko"], zh: ["chi", "zho", "zh"], ru: ["rus", "ru"], ar: ["ara", "ar"] };

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

function directUrl(login: JellyfinLogin, raw: RawItem): string {
  const q = new URLSearchParams({ static: "true", api_key: login.accessToken, DeviceId: deviceId() });
  const sourceId = raw.MediaSources?.[0]?.Id;
  if (sourceId) q.set("MediaSourceId", sourceId);
  return `${login.serverUrl}/Videos/${raw.Id}/stream?${q.toString()}`;
}

/**
 * The server-side HLS transcode. hls.js fetches the playlist and segments itself,
 * without the client auth header, so everything the server needs - token, device,
 * media source, session - has to ride along in the query string. The codec and
 * bitrate parameters match what the official web client sends for a 1080p H.264
 * transcode; without a video bitrate the transcoder refuses to start on some builds.
 */
function hlsUrl(login: JellyfinLogin, raw: RawItem): string {
  const q = new URLSearchParams({
    api_key: login.accessToken,
    DeviceId: deviceId(),
    PlaySessionId: `${deviceId()}-${raw.Id}-${Date.now().toString(36)}`,
    VideoCodec: "h264",
    AudioCodec: "aac",
    VideoBitrate: "20000000",
    AudioBitrate: "192000",
    MaxAudioChannels: "2",
    TranscodingMaxAudioChannels: "2",
    RequireAvc: "true",
    "h264-profile": "high,main,baseline,constrainedbaseline",
    "h264-level": "51",
    SegmentContainer: "ts",
    MinSegments: "1",
    BreakOnNonKeyFrames: "True",
    TranscodeReasons: "ContainerNotSupported",
  });
  const source = raw.MediaSources?.[0];
  if (source?.Id) q.set("MediaSourceId", source.Id);
  // More than one audio track: the one in the menu's audio language, else the file's default.
  const audio = (source?.MediaStreams ?? []).filter((m) => m.Type === "Audio");
  if (audio.length > 1) {
    const want = LANG3[loadSettings().audioLanguage || "en"] ?? [];
    const pick = audio.find((m) => want.includes((m.Language ?? "").toLowerCase()));
    if (pick?.Index !== undefined) q.set("AudioStreamIndex", String(pick.Index));
  }
  return `${login.serverUrl}/Videos/${raw.Id}/master.m3u8?${q.toString()}`;
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
    // The item's own backdrop, or its series' for an episode.
    backdropUrl: raw.BackdropImageTags?.[0]
      ? `${login.serverUrl}/Items/${raw.Id}/Images/Backdrop/0?maxWidth=1600&tag=${raw.BackdropImageTags[0]}&${auth}`
      : raw.ParentBackdropItemId && raw.ParentBackdropImageTags?.[0]
        ? `${login.serverUrl}/Items/${raw.ParentBackdropItemId}/Images/Backdrop/0?maxWidth=1600&tag=${raw.ParentBackdropImageTags[0]}&${auth}`
        : undefined,
    year: raw.ProductionYear ? String(raw.ProductionYear) : undefined,
    overview: raw.Overview,
    tmdbId: raw.ProviderIds?.Tmdb,
    container: (raw.MediaSources?.[0]?.Container ?? "").split(",")[0] || undefined,
    seriesName: raw.SeriesName,
    season: raw.Type === "Episode" ? raw.ParentIndexNumber : undefined,
    episode: raw.Type === "Episode" ? raw.IndexNumber : undefined,
    // Direct play when the file is something the browser decodes as-is (an MP4 with
    // H.264/AAC, say). An MKV, HEVC, AC3 or DTS file would either fail outright or
    // play with no sound, so those go through the server's HLS transcode instead -
    // decided here from the media source, not discovered after a silent failure.
    streamUrl: playable ? (canDirectPlay(raw) ? directUrl(login, raw) : hlsUrl(login, raw)) : undefined,
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
    Fields: "MediaType,MediaSources,Overview,ProviderIds,ProductionYear",
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
