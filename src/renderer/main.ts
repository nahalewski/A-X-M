import "./types";
import { RibbonBackground } from "../background/RibbonBackground";
import { AudioManager, AMBIENT_TRACKS, AMBIENT_TRACK_IDS } from "./audio";
import { GamepadNav } from "./gamepad";
import { Xmb, Category, MenuItem, sourceGlyph, btn } from "./xmb";
import { MusicPlayer } from "./musicPlayer";
import { MusicVisualizer, VISUALIZER_STYLES, VISUALIZER_STYLE_IDS, VisualizerStyle } from "./visualizer";
import { spriteEl, spriteHtml, progressRing } from "./sprites";
import { playIntroSparkle } from "./intro";
import { OptionsPopup, InfoCard, TextPanel, CenterMenu, PopupOption, InfoRow } from "./popups";
import { Notifier } from "./notify";
import { Assistant, Command } from "./assistant";
import { setDictionary } from "./textEntry";
import { MediaViewer } from "./mediaViewer";
import { ToyShelf, TOY_PLATFORM_NAMES } from "./toybox";
import { ToyboxDetections, resolveInstalledGames, TOY_BOXES } from "./toyboxDetect";
import { StoreApp } from "./store";
import { GridPicker, GridChoice } from "./gridPicker";
import { TextEntry } from "./textEntry";
import { BatteryIndicators } from "./battery";
import { StatusIcons } from "./statusIcons";
import { Hud } from "./hud";
import { GameBackground } from "./background";
import { ToyboxSummary, ToyPlatform, ToyboxDetectionEvent, ToyboxSettings, ToyKindRow, RetroPlatform, StoreItem, TvEpisode, TvCategory, TvItem, TvKind, TvStatus, CompanionStatus, CompanionSession, DbPlatform, PcPackage} from "./types";

const RETRO_NAMES: Record<RetroPlatform, string> = { ps5: "PlayStation 5", ps4: "PlayStation 4", ps3: "PlayStation 3", ps2: "PlayStation 2", ps1: "PlayStation", psp: "PSP", switch: "Nintendo Switch" };
const RETRO_ORDER: RetroPlatform[] = ["ps5", "ps4", "ps3", "ps2", "ps1", "psp", "switch"];
/** The disc a game shows until its box art is found: black PS, blue PS2, gold PS3. */
const RETRO_DISC: Partial<Record<RetroPlatform, string>> = { ps1: "assets/icons/retro-disc-ps1.webp", ps2: "assets/icons/retro-disc-ps2.webp", ps3: "assets/icons/retro-disc-ps3.webp" };
const RETRO_DEFAULTS: Record<RetroPlatform, string> = { ps5: "G:\\GAMES\\PS5", ps4: "G:\\GAMES\\PS4", ps3: "G:\\GAMES\\PS3", ps2: "G:\\GAMES\\PS2", ps1: "G:\\GAMES\\PS1", psp: "G:\\GAMES\\PSP", switch: "K:\\Switch Games" };
const EMULATOR_SITES: Record<RetroPlatform, string> = { ps5: "Kyty from github.com/InoriRus/Kyty (or Install above) - an experiment, not a way to play retail PS5 games", ps4: "shadPS4 from shadps4.net (or Install above)", ps3: "RPCS3 from rpcs3.net (or Install above)", ps2: "PCSX2 from pcsx2.net (or Install above)", ps1: "DuckStation from duckstation.org (or Install above)", psp: "PPSSPP from ppsspp.org (or Install above)", switch: "Eden - put eden.exe in C:\\eden" };
import { MemoryCardUtility, showApolloDatabaseOptions } from "./memoryCardUtility";
import { ChoiceScreen, ScreenChoice } from "./choiceScreen";
import {
  ThemeManager,
  RIBBON_SPEED_PRESETS,
  RIBBON_WIDTH_PRESETS,
  RIBBON_COLOR_PRESETS,
  BACKGROUND_COLOR_PRESETS,
  currentMonthIndex,
  labelForColor,
} from "./theme";
import {
  BackgroundQuality,
  BrowseListing,
  DEFAULT_MONTH_THEMES,
  GameEntry,
  JellyfinItem,
  JellyfinLogin,
  JellyfinServer,
  LauncherEntry,
  MediaEntry,
  MonthTheme,
  SaveEntry,
  MONTH_NAMES,
  MusicListing,
  Settings,
  SteamLibrary,
  ThemeMode,
  MediaDrive,
  BrowserNavState,
  VolumeInfo,
  TransferProgress,
  JellyfinItem as JfItem,
  HardwareInfo,
  MusicEntry,
  ControllerDevice,
  ResolutionState,
  WifiNetwork,
  BluetoothDevice,
  THEME_COLOURS,
  ScreenInfo,
  ClockInfo,
  PowerSettings,
  Disc,
  TrophyGame,
  Achievement,
  ConnectionStatus,
  RemotePlayStatus,
  AssistantStatus,
  UpdateInfo,
  TtsStatus,
  ToolState,
} from "./types";

const WAVE_CYCLE_PRESETS = [8, 12, 18, 25, 35];
const VOLUME_PRESETS = [0, 0.25, 0.5, 0.75, 1];
const QUALITY_PRESETS: BackgroundQuality[] = ["auto", "low", "medium", "high"];
const QUALITY_LABELS: Record<BackgroundQuality, string> = {
  auto: "Auto",
  low: "Low",
  medium: "Medium",
  high: "High",
};
const THEME_MODES: ThemeMode[] = ["monthly", "fixed", "cycle", "image"];
const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  monthly: "Changes each month",
  fixed: "One look all year",
  cycle: "Drifting palette",
  image: "Custom picture",
};

/** Steps through a preset list, snapping to the nearest entry if the value isn't in it. */
function nextPreset(presets: number[], value: number): number {
  let closest = 0;
  for (let i = 1; i < presets.length; i++) {
    if (Math.abs(presets[i] - value) < Math.abs(presets[closest] - value)) closest = i;
  }
  return presets[(closest + 1) % presets.length];
}

function nextColor(presets: { value: string }[], value: string): string {
  const i = presets.findIndex((p) => p.value.toLowerCase() === value.toLowerCase());
  return presets[(i + 1) % presets.length].value;
}

async function main(): Promise<void> {
  const audio = new AudioManager();

  let settings: Settings = await window.axm.getSettings();

  // Renderer-process only: the ribbon touches WebGL, the DOM and rAF, so none of it
  // may move to the main process. It needs no Node APIs, so it runs as-is under
  // contextIsolation: true / nodeIntegration: false.
  const backgroundLayer = document.getElementById("background-layer")!;
  const ribbon = new RibbonBackground(backgroundLayer, {
    color: "#ffffff",
    opacity: 0.22,
    speed: 0.25,
    layers: 4,
    quality: settings.backgroundQuality,
    glow: true,
    backdrop: "cycle",
    backdropCycleSeconds: settings.waveColorCycleSeconds,
  });
  // 0 means "whatever the display does"; otherwise the ribbon skips frames to the cap.
  ribbon.setMaxFps(settings.targetHz);
  let resolution: ResolutionState = { target: 0, nativeHeight: 0, nativeWidth: 0, auto: true };

  let games: GameEntry[] = await window.axm.getGames();
  /** Games whose box art is still being looked up - their disc spins meanwhile. */
  const artPending = new Set<string>();
  const artSearched = new Set<string>();
  const artPendingSince = new Map<string, number>();
  // Every console game without art is "being looked up" while SteamGridDB is set, until
  // the lookup answers (or two minutes pass, so a disc never spins for good).
  let artConfigured = !!settings.gameArtApiKey;
  void window.axm.artConfigured().then((v) => { artConfigured = v; markArtPending(); xmb.refresh(); });
  const markArtPending = () => {
    if (!artConfigured) return;
    const now = Date.now();
    for (const g of games) {
      if (g.source !== "retro" || g.iconPath || artSearched.has(g.id)) continue;
      if (!artPending.has(g.id)) { artPending.add(g.id); artPendingSince.set(g.id, now); }
    }
    for (const [id, at] of artPendingSince) if (now - at > 120_000) { artPending.delete(id); artPendingSince.delete(id); }
  };
  markArtPending();
  // Art found before this window was listening (the first lookups run during the scan)
  // is picked up here; so is anything a missed event would have brought.
  const reconcileArt = async () => {
    const snap = await window.axm.artSnapshot().catch(() => []);
    let changed = false;
    for (const s of snap) {
      const g = games.find((x) => x.id === s.id);
      if (!g) continue;
      if (s.iconPath && g.iconPath !== s.iconPath) { g.iconPath = s.iconPath; changed = true; }
      if (s.heroPath && g.heroPath !== s.heroPath) { g.heroPath = s.heroPath; changed = true; }
      if (s.iconPath) artPending.delete(s.id);
    }
    const before = artPending.size;
    markArtPending();
    if (changed || artPending.size !== before) xmb.refresh();
  };
  void reconcileArt();
  setInterval(() => void reconcileArt(), 6000);
  // Optical discs, only while one is in a drive; polled so the row appears on insert.
  let discs: Disc[] = [];
  const refreshDiscs = async () => {
    const next = await window.axm.listDiscs().catch(() => [] as Disc[]);
    const changed = JSON.stringify(next) !== JSON.stringify(discs);
    discs = next;
    if (changed) {
      for (const d of next) notifier.push(`${discLabel(d)} inserted: ${d.label}`, "general", discIcon(d));
      xmb.refresh();
    }
    for (const d of next) void lookupDisc(d);
  };
  const discLabel = (d: Disc) => ({ "audio-cd": "Audio CD", dvd: "DVD", bluray: "Blu-ray Disc", ps1: "PlayStation disc", ps2: "PlayStation 2 disc", data: "Data disc", unknown: "Disc" })[d.kind];
  const discIcon = (d: Disc) => ({ "audio-cd": "assets/icons/disc-dvd.webp", dvd: "assets/icons/disc-dvd.webp", bluray: "assets/icons/disc-bluray.webp", ps1: "assets/icons/disc-ps1.webp", ps2: "assets/icons/disc-ps2.webp", data: "assets/icons/disc-dvd.webp", unknown: "assets/icons/disc-dvd.webp" })[d.kind];
  const discTargets = (label: string, run: (target: string) => void): PopupOption[] => [
    { label: `${label} to this PC`, run: () => run("home") },
    ...volumes.filter((v) => !v.system).map((v) => ({ label: `${label} to ${v.label} (${v.drive})`, hint: `${fmtBytes(v.freeBytes)} free`, run: () => run(v.drive) })),
  ];
  /**
   * What a DVD / Blu-ray actually is: the label guessed into a title, then TMDB
   * for the real name, year, poster and overview. Looked up once per disc.
   */
  interface DiscMeta {
    title: string;
    info: ScreenInfo | null;
    backup: string | null;
    pending: boolean;
  }
  const discMeta = new Map<string, DiscMeta>();
  const discTitle = (d: Disc) => discMeta.get(d.drive + d.label)?.info?.title ?? discMeta.get(d.drive + d.label)?.title ?? (d.label !== d.drive ? d.label : discLabel(d));
  const discPoster = (d: Disc) => discMeta.get(d.drive + d.label)?.info?.posterUrl ?? null;
  const targetLabel = (t: string) => (t === "home" ? "this PC" : volumes.find((v) => v.drive === t)?.label ? `${volumes.find((v) => v.drive === t)!.label} (${t})` : t);
  const lookupDisc = async (d: Disc) => {
    const key = d.drive + d.label;
    if (discMeta.has(key) || (d.kind !== "dvd" && d.kind !== "bluray")) return;
    const guess = await window.axm.guessDiscTitle(d.label).catch(() => d.label);
    const meta: DiscMeta = { title: guess, info: null, backup: null, pending: true };
    discMeta.set(key, meta);
    xmb.refresh();
    const [info, backup] = await Promise.all([
      window.axm.getScreenInfo(guess, "", "movie").catch(() => null),
      window.axm.findDiscBackup(d, settings.discTarget, guess).catch(() => null),
    ]);
    meta.info = info;
    meta.backup = backup ?? (info ? await window.axm.findDiscBackup(d, settings.discTarget, info.title).catch(() => null) : null);
    meta.pending = false;
    xmb.refresh();
  };
  const refreshDiscBackup = async (d: Disc) => {
    const meta = discMeta.get(d.drive + d.label);
    if (!meta) return;
    meta.backup = await window.axm.findDiscBackup(d, settings.discTarget, discTitle(d)).catch(() => null);
    xmb.refresh();
  };

  /** Rips in flight, for the notifications ("started", "50%", "done") and play-after. */
  const ripJobs = new Map<string, { title: string; poster: string | null; announced: boolean; half: boolean; playAfter: boolean; disc: Disc; target: string }>();
  const playVideoFile = (file: string, name: string) => {
    musicPlayer.stop();
    audio.fadeOutAmbient(400);
    const url = "file:///" + encodeURI(file.replace(/\\/g, "/")).replace(/#/g, "%23");
    const entry = { kind: "file" as const, name, filePath: file, url };
    mediaViewer.open("video", entry, [entry]);
    pushOverlay((action) => mediaViewer.handle(action as Parameters<MediaViewer["handle"]>[0]));
  };
  /** Starts a backup on the XMB's background thread of tools; the toast and pills follow it. */
  const startRip = (d: Disc, target: string, playAfter = false): boolean => {
    const id = `disc-${d.drive}`;
    if (ripJobs.has(id)) {
      notifier.push(`${discTitle(d)} is already being ripped`);
      return false;
    }
    const title = discTitle(d);
    ripJobs.set(id, { title, poster: discPoster(d), announced: false, half: false, playAfter, disc: d, target });
    window.axm
      .backupDisc(d, target, title)
      .then((file) => {
        const job = ripJobs.get(id);
        ripJobs.delete(id);
        void refreshDiscBackup(d);
        if (job?.playAfter && file) playVideoFile(file, title);
      })
      .catch((e) => {
        ripJobs.delete(id);
        notifier.push(String(e.message ?? e));
      });
    return true;
  };
  const startCdImport = (d: Disc, target: string) => {
    void window.axm.importAudioCd(d, target, settings.importFormat).catch((e) => notifier.push(String(e.message ?? e)));
    notifier.push(`Importing ${d.label !== d.drive ? d.label : "Audio CD"} to ${targetLabel(target)} as ${settings.importFormat.toUpperCase()}`, "transfer", discIcon(d));
  };
  /**
   * Play on a DVD / Blu-ray means the MKV copy: commercial discs are encrypted
   * and the menu's player can't read them straight from the drive, so a disc
   * that hasn't been ripped yet is ripped first and starts when it's done.
   */
  const playDisc = (d: Disc) => {
    const meta = discMeta.get(d.drive + d.label);
    if (meta?.backup) {
      playVideoFile(meta.backup, discTitle(d));
      return;
    }
    if (ripJobs.has(`disc-${d.drive}`)) {
      const job = ripJobs.get(`disc-${d.drive}`)!;
      job.playAfter = true;
      notifier.push(`${job.title} will play as soon as the rip finishes`, "transfer", job.poster ?? discIcon(d));
      return;
    }
    void refreshVolumes().then(() =>
      showOptions(`${discTitle(d)} hasn't been ripped yet`, [
        { label: `Rip to ${targetLabel(settings.discTarget)} and play when done`, hint: "MKV · H.265 10-bit · the disc stays in", run: () => void startRip(d, settings.discTarget, true) },
        { label: "Rip only", children: discTargets("Rip", (t) => void startRip(d, t, false)) },
        { label: "Not now" },
      ])
    );
  };

  const discRows = (kinds: Disc["kind"][]): MenuItem[] =>
    discs
      .filter((d) => kinds.includes(d.kind))
      .map((d) => {
        const meta = discMeta.get(d.drive + d.label);
        const video = d.kind === "dvd" || d.kind === "bluray";
        const year = meta?.info?.year ? ` · ${meta.info.year}` : "";
        const state = ripJobs.has(`disc-${d.drive}`) ? " · ripping…" : meta?.backup ? " · ripped, ready to play" : meta?.pending ? " · looking up…" : "";
        return {
          id: `disc-${d.drive}`,
          title: video ? discTitle(d) : d.label !== d.drive ? d.label : discLabel(d),
          subtitle: `${discLabel(d)}${year} · ${d.drive}${d.tracks ? ` · ${d.tracks} tracks` : ""}${state}`,
          iconUrl: discIcon(d),
          iconClass: "disc",
          contextHint: "options",
          onConfirm: video ? () => playDisc(d) : undefined,
          onContext: () => {
            void refreshVolumes().then(() => {
              const opts: PopupOption[] = [];
              if (d.kind === "audio-cd") {
                opts.push({ label: `Import to ${targetLabel(settings.discTarget)}`, hint: `${settings.importFormat.toUpperCase()} · change in Settings › Audio`, run: () => startCdImport(d, settings.discTarget) });
                opts.push({ label: "Import to…", children: discTargets("Import", (t) => startCdImport(d, t)) });
              }
              if (video) {
                opts.push({ label: meta?.backup ? "Play" : "Rip and Play", run: () => playDisc(d) });
                opts.push({ label: `Rip to ${targetLabel(settings.discTarget)}`, hint: "MKV · H.265 10-bit · original audio and subtitles", run: () => void startRip(d, settings.discTarget) });
                opts.push({ label: "Rip to…", children: discTargets("Rip", (t) => void startRip(d, t)) });
              }
              opts.push({
                label: "Information",
                run: () => {
                  const info = meta?.info;
                  const rows: InfoRow[] = info
                    ? [
                        { label: "Sub-Title", value: `${discLabel(d)} · ${info.year}${info.tagline ? ` · ${info.tagline}` : ""}` },
                        { label: "Genre", value: info.genres.join(", ") },
                        { label: "Running time", value: info.runtimeMin ? `${info.runtimeMin} min` : "" },
                        { label: "Rating", value: info.rating ? `${info.rating.toFixed(1)} / 10 · ${info.votes.toLocaleString()} votes` : "" },
                        { label: "Drive", value: `${d.drive} · ${d.label}` },
                        { label: "Copy", value: meta?.backup ?? "Not ripped yet" },
                        { label: "Details", value: info.overview },
                        { label: "Source", value: info.source },
                      ]
                    : [
                        { label: "Sub-Title", value: discLabel(d) },
                        { label: "Drive", value: d.drive },
                        { label: "Tracks", value: d.tracks ? String(d.tracks) : "" },
                        { label: "Details", value: d.kind === "audio-cd" ? "Import rips every track with ffmpeg." : video ? "Rip makes an MKV (H.265 10-bit, original audio, all subtitles) with MakeMKV and HandBrake." : "" },
                      ];
                  showInfo(video ? discTitle(d) : d.label, info?.posterUrl ?? discIcon(d), null, rows);
                },
              });
              showOptions(video ? discTitle(d) : d.label, opts);
            });
            return true;
          },
        };
      });
  void refreshDiscs();
  setInterval(() => void refreshDiscs(), 15_000);

  // Drives with PHOTO / VIDEO / GAME folders at the root; re-read on each rescan.
  let mediaDrives: MediaDrive[] = await window.axm.getMediaDrives();
  // Every drive with media folders is remembered, so one that's unplugged still
  // has its row - greyed, "Not connected" - the way the PS3 kept a removed disc's
  // row until you pressed triangle to forget it.
  const rememberDrives = async () => {
    const known = [...settings.knownDrives];
    let changed = false;
    for (const d of mediaDrives) {
      const flags = { drive: d.drive, photo: !!d.photo, video: !!d.video, game: !!d.game, music: !!d.music };
      const i = known.findIndex((k) => k.drive === d.drive);
      if (i < 0) known.push(flags);
      else if (JSON.stringify(known[i]) !== JSON.stringify(flags)) known[i] = flags;
      else continue;
      changed = true;
    }
    if (changed) settings = await window.axm.setSettings({ knownDrives: known });
  };
  void rememberDrives();
  const driveRows = (kind: "photo" | "video" | "game" | "music", open: (folder: string) => void): MenuItem[] => {
    const present = mediaDrives
      .filter((d) => d[kind])
      .map((d): MenuItem => {
        // A drive on the Sabrent adapter is a cartridge: its games, under its own icon.
        const cart = kind === "game" && isCartridge(d.drive);
        const root = (settings.rootDrive || "").toUpperCase() === d.drive.toUpperCase();
        return {
          id: `drive-${kind}-${d.drive}`,
          title: cart ? `Cartridge (${d.drive})` : root ? `ROOT (${d.drive})` : `${d.drive} Drive`,
          subtitle: cart ? "Plugged into the SATA adapter · its games" : `${kind.toUpperCase()} folder`,
          iconUrl: cart ? "assets/icons/cartridge.png" : "assets/icons/hdd.webp",
          iconClass: cart ? "cartridge" : `hdd hdd-${kind}`,
          onConfirm: () => open(d[kind]!),
        };
      });
    const absent = settings.knownDrives
      .filter((k) => k[kind] && !mediaDrives.some((d) => d.drive === k.drive))
      .map((k): MenuItem => ({
        id: `drive-${kind}-${k.drive}-off`,
        title: `${k.drive} Drive`,
        subtitle: "Not connected",
        iconUrl: "assets/icons/hdd-off.webp",
        iconClass: "hdd hdd-off",
        contextHint: "forget drive",
        onContext: () => {
          void window.axm.setSettings({ knownDrives: settings.knownDrives.filter((x) => x.drive !== k.drive) }).then((next) => {
            settings = next;
            xmb.refresh();
          });
          return true;
        },
      }));
    return [...present, ...absent];
  };
  /** "New Folder…" for listings inside a drive's PHOTO / VIDEO / MUSIC tree. */
  const insideDriveMedia = (dir: string | null | undefined): boolean => {
    if (!dir) return false;
    const d = dir.toLowerCase();
    return mediaDrives.some((m) => [m.photo, m.video, m.music].some((root) => root && (d === root.toLowerCase() || d.startsWith(root.toLowerCase() + "\\"))));
  };
  const newFolderRow = (dir: string, after: () => void): MenuItem => ({
    id: `new-folder-${dir}`,
    title: "New Folder…",
    subtitle: "Inside this drive folder",
    iconUrl: "assets/icons/folder.png",
    onConfirm: async () => {
      const values = await askText("New Folder", [{ label: "Folder name" }]);
      if (!values?.[0]) return;
      try {
        await window.axm.createMediaFolder(dir, values[0]);
        audio.playConfirm();
        after();
      } catch (err) {
        console.error("[A-X-M] new folder:", err);
      }
    },
  });
  const emptyListing = (kind: "photo" | "video"): BrowseListing => ({
    kind,
    path: "",
    parent: null,
    title: kind === "photo" ? "Pictures" : "Videos",
    entries: [],
  });
  let photoListing: BrowseListing = emptyListing("photo");
  let videoListing: BrowseListing = emptyListing("video");
  let musicListing: MusicListing = { path: null, parent: null, title: "Music", entries: [] };
  let saves: SaveEntry[] = [];
  let launchers: LauncherEntry[] = await window.axm.getLaunchers();
  let steamLibrary: SteamLibrary = { account: null, games: [] };
  let steamInstallHint = "";
  const steamDrives = (): string[] =>
    Array.from(new Set(games.filter((g) => g.source === "steam").map((g) => g.drive))).sort();

  const musicPlayer = new MusicPlayer(audio);
  musicPlayer.setShuffle(settings.musicShuffle);
  const visualizer = new MusicVisualizer(document.getElementById("visualizer")!);
  visualizer.setStyle(settings.visualizerStyle as VisualizerStyle);
  const cycleVisualizerStyle = async (direction: 1 | -1, announce: boolean) => {
    const i = VISUALIZER_STYLE_IDS.indexOf(visualizer.currentStyle());
    const next = VISUALIZER_STYLE_IDS[(i + direction + VISUALIZER_STYLE_IDS.length) % VISUALIZER_STYLE_IDS.length];
    visualizer.setStyle(next, announce);
    settings = await window.axm.setSettings({ visualizerStyle: next });
  };
  const mediaViewer = new MediaViewer(document.getElementById("media-viewer")!);
  const toyShelf = new ToyShelf(document.body, {
    onClose: () => {
      popOverlay();
      void refreshToybox();
    },
    onFigure: (f, shelf) => {
      showOptions(f.name, [
        { label: f.owned ? "Remove from Owned" : "Mark as Owned", hint: f.owned ? "" : "it goes on your shelf in colour", run: async () => { await window.axm.toyboxSetState(f.id, { owned: !f.owned }); await shelf.refresh(); } },
        { label: f.favorite ? "Remove Favourite" : "Add to Favourites", run: async () => { await window.axm.toyboxSetState(f.id, { favorite: !f.favorite }); await shelf.refresh(); } },
        { label: f.wanted ? "Not Wanted" : "Add to Wanted", run: async () => { await window.axm.toyboxSetState(f.id, { wanted: !f.wanted }); await shelf.refresh(); } },
        {
          label: "Information",
          run: () =>
            showInfo(f.name, f.artUrl ?? "assets/icons/toybox.webp", null, [
              { label: "Sub-Title", value: `${TOY_PLATFORM_NAMES[f.platform] ?? f.platform}${f.series ? ` · ${f.series}` : ""}` },
              { label: "Franchise", value: f.franchise ?? "" },
              { label: "Variant", value: f.variant ?? "" },
              { label: "Manufacturer", value: f.manufacturer ?? "" },
              ...Object.entries(f.attributes ?? {}).filter(([k]) => !["character", "type", "amiiboSeries"].includes(k)).map(([k, v]) => ({ label: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), value: v })),
              { label: "Tag", value: f.nfc ? [f.nfc.technology, f.nfc.head && f.nfc.tail ? `${f.nfc.head}-${f.nfc.tail}` : f.nfc.characterId ? `character ${f.nfc.characterId}${f.nfc.variantId ? ` variant ${f.nfc.variantId}` : ""}` : ""].filter(Boolean).join(" · ") : "" },
              { label: "Artwork", value: f.media?.copyrightOwner ? `© ${f.media.copyrightOwner}` : "" },
            ]),
        },
      ]);
    },
    onFilters: (shelf) => {
      const cur = shelf.currentFilter();
      const views = [["all", "Whole collection"], ["owned", "Owned"], ["favorites", "Favourites"], ["recent", "Recently scanned"]] as const;
      const platforms = (["", "amiibo", "skylanders", "disney-infinity", "lego-dimensions"] as const).filter((p) => !p || (toybox?.stats.byPlatform[p] ?? 0) > 0);
      showOptions("Toybox", [
        { label: "Show", hint: views.find(([v]) => v === cur.view)?.[1], children: views.map(([v, label]) => ({ label, selected: cur.view === v, run: () => void shelf.setFilter({ ...cur, view: v }) })) },
        { label: "Platform", hint: cur.platform ? TOY_PLATFORM_NAMES[cur.platform] : "All", children: platforms.map((p) => ({ label: p ? TOY_PLATFORM_NAMES[p] : "All platforms", selected: (cur.platform ?? "") === p, run: () => void shelf.setFilter({ ...cur, platform: p }) })) },
        { label: "Search", hint: cur.query || "by name or series", run: async () => { const a = await askText("Search Toybox", [{ label: "Name", value: cur.query ?? "" }]); if (a) void shelf.setFilter({ ...cur, query: a[0].trim() }); } },
        ...(cur.query ? [{ label: "Clear search", run: () => void shelf.setFilter({ ...cur, query: "" }) }] : []),
      ]);
    },
  });
  /** Every emulator install ends with this one question, like a setup wizard's last page. */
  const offerShortcut = (platform: RetroPlatform, name: string) =>
    showOptions(`${name} is installed`, [
      { label: "Add a desktop shortcut", run: async () => { const ok = await window.axm.desktopShortcut(platform); notifier.push(ok ? `${name} is on the desktop` : "Couldn't make the shortcut", "install"); } },
      { label: "No shortcut", hint: "it runs from the Retro column either way" },
    ]);
  const findRetroGame = (item: StoreItem) => games.find((g) => g.source === "retro" && g.platform === item.platform && g.name.toLowerCase().replace(/[^a-z0-9]+/g, "") === item.name.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const storeApp = new StoreApp(document.body, {
    onClose: () => popOverlay(),
    onInstall: async (item, store) => {
      store.setBusy(item.id, true);
      try {
        if (item.kind === "emulator") {
          notifier.push(`Installing ${item.name}`, "install", item.iconPath);
          const ok = await window.axm.installEmulator(item.platform);
          notifier.push(ok ? `${item.name} installed` : `${item.name} didn't install`, "install", item.iconPath);
          if (ok) offerShortcut(item.platform, item.name);
        } else {
          notifier.push(`Adding ${item.name} to your library`, "install", item.iconPath);
          await window.axm.storeInstall(item);
          notifier.push(`${item.name} is in your library`, "install", item.iconPath);
        }
        games = await window.axm.getGames();
      } catch (e) {
        notifier.push(`${item.name}: ${String((e as Error).message ?? e)}`, "install");
      }
      store.setBusy(item.id, false);
      await store.reload();
      xmb.refresh();
    },
    onPlay: (item) => {
      const g = findRetroGame(item);
      if (!g) return;
      if (!g.emulator) {
        notifier.push(`${g.emulatorName ?? "The emulator"} isn't installed - it's in the Emulators tab`, "install");
        return;
      }
      notifier.push(`Starting ${g.name}`, "general", g.iconPath);
      void window.axm.launchGame(g.id);
    },
    onPrepare: (item, store) => {
      const g = findRetroGame(item);
      if (!g) return;
      // The Retro column's own preparation flow, so the trim toggles and the delete offer are the same.
      storeApp.close();
      popOverlay();
      goCategory("retro");
      xmb.selectItem("retro", g.id) || notifier.push("Open PlayStation 3 in Retro and press A on the game");
      void store;
    },
    onInfo: (item) =>
      showInfo(item.name, item.iconPath ?? `assets/icons/retro-${item.platform}.png`, item.path, [
        { label: "Sub-Title", value: item.kind === "emulator" ? `${RETRO_NAMES[item.platform]} emulator` : `${RETRO_NAMES[item.platform]} · ${item.emulatorName}` },
        { label: "Where", value: item.path ?? "" },
        { label: "Size", value: item.sizeBytes ? `${(item.sizeBytes / 1073741824).toFixed(2)} GB` : "" },
        { label: "Library", value: item.installed ? "In your library" : `Adds to ${item.libraryDir}` },
        ...(item.note ? [{ label: "Needs", value: item.note }] : []),
        ...(item.needsPrep ? [{ label: "Note", value: item.needsPrep }] : []),
      ], () => gameInfoRows(item.platform, item.name, item.path ?? null)),
  });
  const openStore = (tab = "explore") => {
    void storeApp.open(tab);
    pushOverlay((action) => storeApp.handle(action as Parameters<StoreApp["handle"]>[0]));
  };

  const openToyShelf = (filter: Parameters<ToyShelf["open"]>[0], title: string) => {
    void toyShelf.open(filter, title);
    pushOverlay((action) => toyShelf.handle(action as Parameters<ToyShelf["handle"]>[0]));
  };

  const gridPicker = new GridPicker(document.getElementById("grid-picker")!);
  const choiceScreen = new ChoiceScreen(document.getElementById("choice-screen")!);
  const textEntry = new TextEntry(document.getElementById("text-entry")!);
  const optionsPopup = new OptionsPopup(document.getElementById("options-popup")!);
  const infoCard = new InfoCard(document.getElementById("info-card")!);
  const textPanel = new TextPanel(document.getElementById("text-panel")!);
  const centerMenu = new CenterMenu(document.getElementById("center-menu")!);
  const showCenter = (options: PopupOption[], opts: { question?: string; status?: string; horizontal?: boolean } = {}) => {
    centerMenu.show(options, opts, () => popOverlay());
    pushOverlay((a) => centerMenu.handle(a as Parameters<CenterMenu["handle"]>[0]));
  };
  const notifier = new Notifier(document.body);
  const assistant = new Assistant(document.body, {
    setHover: (on) => audio.setGhostHover(on),
    playTransform: () => audio.playGhostTransform(),
  });
  let assistantStatus: AssistantStatus = { modelReady: false, modelUrl: null, modelName: "", listening: false };
  const applyAssistant = async () => {
    assistantStatus = await window.axm.assistantStatus().catch(() => assistantStatus);
    assistant.setPrefs({ ...settings.assistant, micId: settings.audioInputId });
    if (settings.assistant.enabled && assistantStatus.modelReady && !assistantStatus.listening) await window.axm.startVoice(settings.audioInputId);
    else if (!settings.assistant.enabled && assistantStatus.listening) await window.axm.stopVoice();
    // A voice window that was already up (the menu page reloaded) sent its "ready" long ago.
    else if (settings.assistant.enabled && assistantStatus.listening && !assistant.isListening()) assistant.onVoice("ready", null);
    void refreshTts();
  };
  assistant.setOnStatus((text) => notifier.push(text, "general"));
  window.axm.onVoice((m) => assistant.onVoice(m.event, m.payload));
  // Menu music and the player drop while Ghost listens or talks.
  assistant.setOnAwake((on) => {
    audio.duck(on);
    musicPlayer.duck(on);
  });
  // Ghost's replies come from the cloned voice on this machine - or not at all.
  let ttsStatus: TtsStatus = { python: null, engineReady: false, engineRunning: false, device: null, voiceClip: "", installing: false, cacheCount: 0 };
  let ghostAudio: HTMLAudioElement | null = null;
  assistant.setSpeaker(async (text) => {
    const file = await window.axm.speak(text).catch(() => null);
    if (!file) return;
    await new Promise<void>((resolve) => {
      ghostAudio?.pause();
      const el = new Audio("file:///" + encodeURI(file.replace(/\\/g, "/")).replace(/#/g, "%23"));
      ghostAudio = el;
      el.volume = Math.max(0.5, settings.sfxVolume);
      if (settings.audioOutputId) void (el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(settings.audioOutputId).catch(() => {});
      el.onended = () => resolve();
      el.onerror = () => resolve();
      el.play().catch(() => resolve());
    });
  });
  const refreshTts = async () => {
    ttsStatus = await window.axm.ttsStatus().catch(() => ttsStatus);
    if (settings.assistant.enabled && settings.assistant.voiceReplies && ttsStatus.engineReady && !ttsStatus.engineRunning) void window.axm.startTts().then(() => void window.axm.ttsStatus().then((t) => (ttsStatus = t)));
  };
  void refreshTts();
  // ---- Toybox detections: reader -> hub -> Ghost -> the normal launch path ------
  // While a Ghost card with choices is up, the d-pad goes to it.
  let cardHandlerOpen = false;
  assistant.setOnCardOpen((open) => {
    if (open && !cardHandlerOpen) {
      cardHandlerOpen = true;
      pushOverlay((action) => assistant.handleCardAction(action));
    } else if (!open && cardHandlerOpen) {
      cardHandlerOpen = false;
      popOverlay();
    }
  });
  const toyDetect = new ToyboxDetections({
    assistant,
    games: () => games,
    settings: () => settings.toybox,
    ghostMuted: () => !settings.assistant.voiceReplies,
    runningGame: () => window.axm.runningGame().catch(() => null),
    launch: (g) => {
      notifier.push(`Starting ${g.name}`, "general", g.iconPath);
      void window.axm.launchGame(g.id);
    },
    navigateTo: (g) => {
      if (!xmb.selectItem("game", g.id)) {
        goCategory("game");
        notifier.push(`${g.name} is in the Game column`, "general", g.iconPath);
      }
      xmb.refresh();
    },
    openShelf: (figureId) => {
      openToyShelf({ view: "recent", platform: "" }, "Recently Scanned");
      void figureId;
    },
    showCompatible: (event, installed) => {
      const all = event.compatibleGameIds.length ? event.compatibleGameIds.map((id) => id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())) : [`Any ${TOY_PLATFORM_NAMES[event.ecosystem as ToyPlatform] ?? ""} game`];
      showInfo(event.name, event.artwork?.png ?? "assets/icons/toybox.webp", null, [
        { label: "Sub-Title", value: TOY_PLATFORM_NAMES[event.ecosystem as ToyPlatform] ?? event.ecosystem },
        { label: "Installed", value: installed.length ? installed.map((g) => g.name).join(", ") : "None" },
        { label: "Works with", value: all.join(", ") },
        { label: "Details", value: "Add a game to A-X-M (Steam, Epic, Xbox, or a game folder) and Ghost will offer it on the next scan." },
      ]);
    },
    notify: (text, image) => notifier.push(text, "general", image),
    chime: () => audio.playNfcScan(),
    lastGame: (figureId) => window.axm.toyboxLastGame(figureId).catch(() => null),
    setLastGame: (figureId, gameId) => void window.axm.toyboxSetLastGame(figureId, gameId),
    identifyUnknown: (event) => {
      showOptions("Unknown Toy", [
        {
          label: "Identify",
          hint: "search the database by name and map this tag to it",
          run: async () => {
            const a = await askText("Which toy is this?", [{ label: "Name" }]);
            if (!a?.[0]) return;
            const hits = await window.axm.toyboxSearch(a[0]).catch(() => []);
            if (!hits.length) {
              notifier.push(`Nothing in the database matches "${a[0]}"`);
              return;
            }
            showOptions("Map this tag to", hits.slice(0, 12).map((f) => ({ label: f.name, hint: `${TOY_PLATFORM_NAMES[f.platform]}${f.series ? " · " + f.series : ""}`, run: async () => { await window.axm.toyboxSaveCustomTag(event.uid, f.name, f.id); notifier.push(`This tag is now ${f.name}`); } })));
          },
        },
        {
          label: "Save Custom Mapping",
          hint: "a label for a plain NFC card",
          run: async () => {
            const a = await askText("Label for this tag", [{ label: "Label" }]);
            if (a?.[0]) {
              await window.axm.toyboxSaveCustomTag(event.uid, a[0]);
              notifier.push(`Saved "${a[0]}"`);
            }
          },
        },
        { label: "Dismiss" },
      ]);
    },
    ask: (question, options) => showOptions(question, options),
  });
  window.axm.onToyboxDetected((event) => void toyDetect.onDetected(event));

  /**
   * The Android companion. Input arrives already reduced to the same actions a
   * local button produces, so it goes through the ordinary handlers - the menu
   * never learns a phone is involved, and a phone dropping mid-press leaves
   * nothing to unwind.
   */
  /**
   * The menu settings a paired phone shows and can change. The phone gets this
   * list (labels, choices, current values) and sends back an id and a value; the
   * same code that the menu's own rows run applies it, so nothing is duplicated.
   */
  const PCT = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => ({ id: String(v), label: `${Math.round(v * 100)}%` }));
  const onOff = (v: boolean) => (v ? "on" : "off");
  const companionSettingsItems = () => [
    { id: "musicVolume", title: "Music Volume", group: "Audio", kind: "choice" as const, value: String(settings.musicVolume), options: PCT },
    { id: "sfxVolume", title: "Menu Sound Volume", group: "Audio", kind: "choice" as const, value: String(settings.sfxVolume), options: PCT },
    { id: "navSounds", title: "Navigation Sounds", group: "Audio", kind: "toggle" as const, value: onOff(settings.navSoundsEnabled) },
    { id: "musicShuffle", title: "Music Shuffle", group: "Audio", kind: "toggle" as const, value: onOff(settings.musicShuffle), detail: "Next track at random" },
    { id: "lyrics", title: "Lyrics", group: "Audio", kind: "toggle" as const, value: onOff(settings.lyricsEnabled), detail: "LRCLIB words for the Karaoke visualizer" },
    { id: "visualizerEnabled", title: "Visualizer", group: "Theme", kind: "toggle" as const, value: onOff(settings.visualizerEnabled) },
    { id: "visualizerStyle", title: "Visualizer Style", group: "Theme", kind: "choice" as const, value: settings.visualizerStyle, options: VISUALIZER_STYLES.map((s) => ({ id: s.id, label: `${s.label} · ${s.origin}` })) },
    { id: "ribbon", title: "Ribbon Background", group: "Theme", kind: "toggle" as const, value: onOff(settings.ribbonEnabled) },
    { id: "windowMode", title: "Display Mode", group: "Display", kind: "choice" as const, value: settings.windowed ? "windowed" : "fullscreen", options: [{ id: "fullscreen", label: "Fullscreen" }, { id: "windowed", label: "Windowed" }] },
    { id: "tvEnglishOnly", title: "TV · English Only", group: "TV Streaming", kind: "toggle" as const, value: onOff(settings.tvEnglishOnly), detail: "Hide channels, films and shows tagged as another language" },
    { id: "tvAdultBlocked", title: "TV · Adult Content Blocked", group: "TV Streaming", kind: "toggle" as const, value: onOff(settings.tvAdultBlocked), detail: settings.tvPin ? "Behind the PIN" : "No PIN set - set one on the A-X-M screen" },
    { id: "subtitlesEnabled", title: "Subtitles", group: "TV Streaming", kind: "toggle" as const, value: onOff(settings.subtitles?.enabled ?? false), detail: "Fetched from SubDL when a film or episode starts" },
    { id: "subtitlesLanguage", title: "Subtitle Language", group: "TV Streaming", kind: "choice" as const, value: settings.subtitles?.language ?? "EN", options: ["EN", "ES", "FR", "DE", "IT", "PT", "NL", "JA"].map((l) => ({ id: l, label: l })) },
    { id: "audioLanguage", title: "Audio Language", group: "TV Streaming", kind: "choice" as const, value: settings.audioLanguage || "en", options: [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"], ["nl", "Dutch"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["ru", "Russian"], ["ar", "Arabic"]].map(([id, label]) => ({ id, label })) },
    { id: "assistant", title: "Ghost", group: "Assistant", kind: "toggle" as const, value: onOff(settings.assistant.enabled), detail: 'The voice assistant · "hey ghost"' },
    { id: "assistantVoice", title: "Ghost Speaks", group: "Assistant", kind: "toggle" as const, value: onOff(settings.assistant.voiceReplies) },
    { id: "toyboxSpeak", title: "Toybox · Ghost Announces Toys", group: "Toybox", kind: "toggle" as const, value: onOff(settings.toybox.speak) },
    { id: "toyboxCards", title: "Toybox · Cards", group: "Toybox", kind: "toggle" as const, value: onOff(settings.toybox.showCards) },
  ];
  let lastCompanionSettings = "";
  const publishCompanionSettings = () => {
    const items = companionSettingsItems();
    const key = JSON.stringify(items);
    if (key === lastCompanionSettings) return;
    lastCompanionSettings = key;
    window.axm.companionSettings(items);
  };
  publishCompanionSettings();
  // Changes made on this screen reach the phone within a couple of seconds.
  setInterval(publishCompanionSettings, 2000);

  const applyCompanionSetting = async (id: string, value: string) => {
    const on = value === "on";
    const pct = Math.min(1, Math.max(0, Number(value)));
    switch (id) {
      case "musicVolume": settings = await window.axm.setSettings({ musicVolume: pct }); audio.setVolumes(settings.musicVolume, settings.sfxVolume); musicPlayer.setVolume(settings.musicVolume); break;
      case "sfxVolume": settings = await window.axm.setSettings({ sfxVolume: pct }); audio.setVolumes(settings.musicVolume, settings.sfxVolume); break;
      case "navSounds": settings = await window.axm.setSettings({ navSoundsEnabled: on }); audio.setSfxEnabled(on); break;
      case "musicShuffle": settings = await window.axm.setSettings({ musicShuffle: on }); musicPlayer.setShuffle(on); break;
      case "lyrics": settings = await window.axm.setSettings({ lyricsEnabled: on }); break;
      case "visualizerEnabled": settings = await window.axm.setSettings({ visualizerEnabled: on }); if (!on && visualizer.currentMode() !== "off") clearVisualizer(); break;
      case "visualizerStyle":
        if (VISUALIZER_STYLE_IDS.includes(value as VisualizerStyle)) {
          visualizer.setStyle(value as VisualizerStyle, visualizer.currentMode() === "stage");
          settings = await window.axm.setSettings({ visualizerStyle: value as VisualizerStyle });
          // Picked from the phone while music plays: show it, behind the menu.
          if (musicPlayer.current() && settings.visualizerEnabled && visualizer.currentMode() === "off") {
            if (!visualizer.isAvailable()) visualizer.attach(musicPlayer.element());
            visualizer.setTrackName(musicPlayer.current()?.name ?? null);
            visualizer.setMode("background");
          }
        }
        break;
      case "ribbon": settings = await window.axm.setSettings({ ribbonEnabled: on }); applyTheme(); break;
      case "windowMode": if ((value === "windowed") !== settings.windowed) settings = await window.axm.toggleFullscreen(); break;
      case "tvEnglishOnly": settings = await window.axm.setSettings({ tvEnglishOnly: on }); tv.categories = []; tv.items = []; break;
      case "tvAdultBlocked": settings = await window.axm.setSettings({ tvAdultBlocked: on }); tvAdultUnlocked = false; tv.categories = []; tv.items = []; break;
      case "subtitlesEnabled": settings = await window.axm.setSettings({ subtitles: { enabled: on, language: settings.subtitles?.language ?? "EN" } }); break;
      case "subtitlesLanguage": settings = await window.axm.setSettings({ subtitles: { enabled: settings.subtitles?.enabled ?? true, language: value.toUpperCase().slice(0, 5) } }); break;
      case "audioLanguage": settings = await window.axm.setSettings({ audioLanguage: value.toLowerCase().slice(0, 3) }); mediaViewer.setAudioLanguage(settings.audioLanguage); break;
      case "assistant": settings = await window.axm.setSettings({ assistant: { ...settings.assistant, enabled: on } }); break;
      case "assistantVoice": settings = await window.axm.setSettings({ assistant: { ...settings.assistant, voiceReplies: on } }); break;
      case "toyboxSpeak": settings = await window.axm.setSettings({ toybox: { ...settings.toybox, speak: on } }); break;
      case "toyboxCards": settings = await window.axm.setSettings({ toybox: { ...settings.toybox, showCards: on } }); break;
      default: return;
    }
    xmb.refresh();
    publishCompanionSettings();
  };

  window.axm.onCompanionInput((input) => {
    if (input.kind === "setting") {
      void applyCompanionSetting(input.id, input.value);
      return;
    }
    if (input.kind === "keyboard") {
      textEntry.setValue(input.text, input.done);
      return;
    }
    if (input.kind === "musicPlay") {
      // The phone picked a track in the library: play it with its folder as the queue.
      const folder = input.filePath.replace(/[\\/][^\\/]*$/, "");
      void window.axm.browseMusic(folder).then((listing) => {
        const entry = listing.entries.find((e) => e.kind === "track" && e.filePath.toLowerCase() === input.filePath.toLowerCase());
        if (!entry) return;
        musicPlayer.play(entry, listing.entries, settings.musicVolume);
        xmb.refresh();
      }).catch(() => {});
      return;
    }
    if (input.kind === "xmb") {
      // Guide is not a menu action - it toggles the in-game overlay, the same as
      // the pad's guide button, so the phone's Home does what that button does.
      if (input.action === "guide") {
        void window.axm.overlayToggle();
        return;
      }
      // Through handleAction, not the raw category, so an overlay that is up -
      // a popup, the media viewer, the browser - takes the press first, exactly
      // as it would from the pad in your hands.
      xmb.handleAction(input.action);
      return;
    }
    if (input.kind === "media") {
      switch (input.command) {
        case "toggle": if (audioOutput === "phone") { phonePlaying = !phonePlaying; publishMedia(true); break; } musicPlayer.togglePause(); break;
        case "play": if (audioOutput === "phone") { phonePlaying = true; publishMedia(true); break; } if (!musicPlayer.isPlaying()) musicPlayer.togglePause(); break;
        case "pause": if (audioOutput === "phone") { phonePlaying = false; publishMedia(true); break; } if (musicPlayer.isPlaying()) musicPlayer.togglePause(); break;
        case "next": musicPlayer.next(); break;
        case "previous": musicPlayer.previous(); break;
        case "stop": musicPlayer.stop(); break;
        case "route": {
          // 1 = the phone plays from here (the menu goes quiet); 0 = back to the menu,
          // resuming where the phone got to.
          const toPhone = Number(input.value ?? 0) === 1;
          if (toPhone && musicPlayer.current()) {
            audioOutput = "phone";
            phonePlaying = true;
            if (musicPlayer.isPlaying()) musicPlayer.togglePause();
            notifier.push("Music is playing on the phone", "general");
          } else if (!toPhone) {
            audioOutput = "host";
            phonePlaying = false;
            if (musicPlayer.current() && !musicPlayer.isPlaying()) musicPlayer.togglePause();
            notifier.push("Music is back on this PC", "general");
          }
          publishMedia(true);
          break;
        }
        case "seek":
        case "position": {
          const video = document.querySelector("#media-viewer video") as HTMLVideoElement | null;
          const value = Number(input.value ?? 0);
          if (mediaViewer.isOpen() && video) video.currentTime = input.command === "seek" ? Math.max(0, video.currentTime + value) : Math.max(0, value);
          else if (musicPlayer.current()) musicPlayer.seekTo(input.command === "seek" ? musicPlayer.position() + value : value);
          publishMedia(true);
          break;
        }
        default: break;   // volume and the rest come with the media screen
      }
      xmb.refresh();
    }
  });

  // The code has to be readable from across the room, so it takes the screen
  // rather than going out as a notification that would slide away mid-typing.
  window.axm.onCompanionPairing(({ code, deviceName }) => {
    if (!code) return;
    showInfo(`Pair ${deviceName}`, undefined, null, [
      { label: "Code", value: code },
      { label: "Enter it", value: "on the phone, in A-X-M Companion" },
    ]);
  });

  window.axm.onCompanionStatus(({ message }) => notifier.push(message, "general"));
  void (0 as unknown as ToyboxDetectionEvent);
  window.axm.onToyboxRemoved((event) => toyDetect.onRemoved(event));
  const simulateScan = async (platform: ToyPlatform | "unknown") => {
    if (platform === "unknown") {
      await window.axm.toyboxSimulate(null);
      return;
    }
    const list = await window.axm.toyboxShelf({ view: "all", platform }).catch(() => []);
    const withArt = list.filter((f) => f.artUrl);
    const pick = (withArt.length ? withArt : list)[Math.floor(Math.random() * Math.max(1, (withArt.length ? withArt : list).length))];
    if (pick) await window.axm.toyboxSimulate(pick.id);
    else notifier.push("No figures for that platform in the database");
  };

  // The external tools (ffmpeg, HandBrakeCLI, MakeMKV, Python, the voice engine).
  let toolsSummary = "Checking…";
  const refreshTools = async () => {
    const state = await window.axm.toolsState().catch(() => [] as ToolState[]);
    const missing = state.filter((t) => !t.installed);
    toolsSummary = state.length ? (missing.length ? `Missing: ${missing.map((t) => t.name).join(", ")}` : "ffmpeg, HandBrakeCLI, MakeMKV, Python and Ghost's voice are all installed") : "Couldn't check";
    xmb.refresh();
  };
  const runToolsInstall = async () => {
    notifier.push("Setting up disc and voice tools in the background");
    await window.axm.installTools().catch((e) => notifier.push(`Tools: ${String(e.message ?? e)}`));
    await refreshTools();
    await refreshTts();
    settings = await window.axm.setSettings({ toolsSetupDone: true });
  };
  void refreshTools().then(() => {
    // First launch: get everything the disc rippers and Ghost need, unattended.
    if (!settings.toolsSetupDone && toolsSummary.startsWith("Missing")) setTimeout(() => void runToolsInstall(), 20_000);
    else if (!settings.toolsSetupDone) void window.axm.setSettings({ toolsSetupDone: true }).then((n) => (settings = n));
  });
  notifier.setPrefs(settings.notifications);
  setDictionary(settings.dictionaryTerms, settings.learnedWords, (words) => {
    void window.axm.setSettings({ learnedWords: words }).then((next) => (settings = next));
  });

  // ---- Overlay stack -------------------------------------------------------------
  //
  // Overlays (viewer, picker, keyboard, visualizer stage) each want first refusal on
  // input. The menu only supports one external handler, so nesting - a wizard that
  // opens a keyboard that gives way to a picker - is managed here as a stack.
  type Handler = (action: string) => boolean;
  const overlayStack: Handler[] = [];
  const pushOverlay = (h: Handler) => {
    overlayStack.push(h);
    xmb.setExternalHandler(h);
  };
  const popOverlay = () => {
    overlayStack.pop();
    xmb.setExternalHandler(overlayStack[overlayStack.length - 1] ?? null);
  };

  /** The Y-button menu for a row: a few actions, run after the popup closes. */
  const showOptions = (title: string, options: PopupOption[], onCancel?: () => void) => {
    if (options.length === 0) return;
    optionsPopup.show(title, options, (cancelled) => {
      popOverlay();
      if (cancelled) onCancel?.();
    });
    pushOverlay((a) => optionsPopup.handle(a as Parameters<OptionsPopup["handle"]>[0]));
    audio.playConfirm();
  };
  const fmtBytesInfo = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
  const fmtWhen = (iso: string): string => (iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: !settings.clock24h }) : "");
  /**
   * The PS3 Information screen: opens with the file's own facts straight away
   * (sub-title, updated, size), then `more()` adds what the lookups bring back.
   */
  /**
   * The Information rows for a game: who made it, who put it out, when.
   *
   * Only the platforms a database actually covers are asked about. A row is left
   * out when the database has nothing for it rather than shown empty, except for
   * the ones worth stating a blank for - a PS3 entry genuinely has no publisher
   * recorded, and saying so beats leaving the reader wondering.
   *
   * The match is reported too. A serial is conclusive; a title match is a guess
   * that happens to be right most of the time, and is labelled as one.
   */
  const GAME_DB_PLATFORMS: Record<string, DbPlatform> = { ps1: "ps1", ps2: "ps2", ps3: "ps3" };

  const gameInfoRows = async (platform: string, name: string, filePath: string | null): Promise<InfoRow[]> => {
    const db = GAME_DB_PLATFORMS[platform];
    if (!db) return [];

    const info = await window.axm.getGameInfo(db, name, filePath ?? undefined).catch(() => null);
    if (!info) return [{ label: "Information", value: "No database available offline" }];
    if (info.matchedBy === "none") return [{ label: "Information", value: `Not listed in ${info.source}` }];

    const rows: InfoRow[] = [];
    const add = (label: string, value: string) => { if (value) rows.push({ label, value }); };

    add("Full Title", info.title);
    add("Serial", info.serial);
    add("Region", info.region);
    add("Released", info.releaseDate || info.year);
    rows.push({ label: "Publisher", value: info.publisher || "Not recorded" });
    rows.push({ label: "Developer", value: info.developer || "Not recorded" });
    add("Genre", info.genre);
    add("Languages", info.languages);
    add("Players", info.players);
    add("Synopsis", info.synopsis);
    rows.push({ label: "Matched by", value: info.matchedBy });
    rows.push({ label: "Data from", value: info.source });
    return rows;
  };

  const showInfo = (title: string, art: string | undefined, filePath: string | null, base: InfoRow[], more?: () => Promise<InfoRow[]>) => {
    infoCard.show(title, art, base, () => popOverlay());
    pushOverlay((a) => infoCard.handle(a as Parameters<InfoCard["handle"]>[0]));
    void (async () => {
      let rows = [...base];
      if (filePath) {
        const f = await window.axm.fileInfo(filePath).catch(() => null);
        if (f?.exists) rows = [...rows, { label: "Updated", value: fmtWhen(f.modified) }, { label: "Size", value: fmtBytesInfo(f.sizeBytes) }];
      }
      infoCard.rows([{ label: "Title", value: title }, ...rows]);
      if (more) {
        const extra = await more();
        infoCard.rows([{ label: "Title", value: title }, ...rows, ...extra]);
      }
    })();
  };
  const showText = (title: string, paragraphs: string[]) => {
    textPanel.show(title, paragraphs, () => popOverlay());
    pushOverlay((a) => textPanel.handle(a as Parameters<TextPanel["handle"]>[0]));
  };

  // ---- Copy / download targets ----------------------------------------------------
  //
  // Every mounted drive other than the one the file already sits on, plus "this PC"
  // for files that live on an external drive. Refreshed each time a menu asks, so a
  // stick plugged in a moment ago is offered.
  let volumes: VolumeInfo[] = [];
  const refreshVolumes = async () => {
    const before = volumes.filter((v) => v.cartridge).map((v) => v.drive).join();
    volumes = await window.axm.getVolumes();
    if (volumes.filter((v) => v.cartridge).map((v) => v.drive).join() !== before) xmb.refresh();
  };
  const isCartridge = (drive: string) => volumes.some((v) => v.cartridge && v.drive.toUpperCase() === drive.slice(0, 2).toUpperCase());
  void refreshVolumes();
  // Plugging the cartridge in (or pulling it) shows up within the minute.
  setInterval(() => void refreshVolumes(), 45_000);
  const fmtBytes = (n: number): string => (n >= 1e12 ? `${(n / 1e12).toFixed(2)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(0)} MB`);
  const copyTargets = (kind: "music" | "photo" | "video", sourcePath: string | null): PopupOption[] => {
    const folder = { music: "MUSIC", photo: "PHOTO", video: "VIDEO" }[kind];
    const onDrive = (sourcePath ?? "").slice(0, 2).toUpperCase();
    const opts: PopupOption[] = [];
    if (sourcePath && onDrive !== (volumes.find((v) => v.system)?.drive ?? "C:").toUpperCase()) {
      opts.push({ label: "Copy to this PC", hint: { music: "Music", photo: "Pictures", video: "Videos" }[kind], run: () => runCopy(kind, sourcePath, "home") });
    }
    for (const v of volumes) {
      if (v.system || v.drive.toUpperCase() === onDrive) continue;
      opts.push({
        label: `Copy to ${v.label} (${v.drive})`,
        hint: `${folder} · ${fmtBytes(v.freeBytes)} free`,
        run: () => (sourcePath ? runCopy(kind, sourcePath, v.drive) : undefined),
      });
    }
    return opts;
  };
  const runCopy = async (kind: "music" | "photo" | "video", source: string, target: string) => {
    try {
      await window.axm.copyMedia(kind, source, target);
      audio.playConfirm();
      // The drive rows and listings may have gained a folder.
      mediaDrives = await window.axm.getMediaDrives();
      xmb.refresh();
    } catch (err) {
      console.error("[A-X-M] copy failed:", err);
    }
  };

  // Progress toast, bottom centre, one line per transfer in flight.
  const transferToast = document.getElementById("transfer-toast")!;
  const transfers = new Map<string, TransferProgress>();
  window.axm.onTransfer((p) => {
    // Disc rips get the media pill with the poster: when they start, at half way, and when done.
    const job = ripJobs.get(p.id);
    if (job) {
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      if (p.finished) {
        if (p.error) notifier.push(`${job.title}: ${p.error}`, "transfer", job.poster ?? undefined);
        else notifier.push(`${job.title} ripped to ${targetLabel(job.target)}${job.playAfter ? " · starting" : ""}`, "transfer", job.poster ?? undefined);
      } else if (!job.announced) {
        job.announced = true;
        notifier.push(`Ripping ${job.title} to ${targetLabel(job.target)}`, "transfer", job.poster ?? undefined);
      } else if (!job.half && pct >= 50) {
        job.half = true;
        notifier.push(`${job.title} is half way there · ${pct}%`, "transfer", job.poster ?? undefined);
      }
      xmb.refresh();
    }
    if (p.finished) {
      transfers.delete(p.id);
      if (!job) notifier.push(p.error ? `${p.name}: ${p.error}` : `${p.id.startsWith("dl-") ? "Downloaded" : p.id.startsWith("cd-") ? "Imported" : p.id === "tools" || p.id === "ghost-voice" ? "Finished" : "Copied"} ${p.name}`, "transfer");
      if (p.error) {
        transfers.set(p.id + "-err", { ...p });
        setTimeout(() => {
          transfers.delete(p.id + "-err");
          renderTransfers();
        }, 5000);
      }
    } else transfers.set(p.id, p);
    renderTransfers();
  });
  const renderTransfers = () => {
    transferToast.classList.toggle("hidden", transfers.size === 0);
    transferToast.innerHTML = [...transfers.values()]
      .map((p) => {
        const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
        const verb = p.id.startsWith("dl-") ? "Downloading" : p.id.startsWith("disc-") ? "Ripping" : p.id.startsWith("cd-") ? "Importing" : p.id === "tools" || p.id === "ghost-voice" || p.id === "ghost-model" ? "Setting up" : p.id.startsWith("store-") ? "Adding" : "Copying";
        // Everything here is read at a glance by someone who just pressed a button,
        // so it says what is happening to what - never a verb from the code, and
        // never a file path. The step names come from the job and are translated
        // into plain words; anything unrecognised falls back to the plain sentence.
        const STEP_WORDS: Record<string, string> = {
          decrypting: "unlocking the disc",
          extracting: "copying the game",
          trimming: "tidying up",
          copying: "copying the game",
          installing: "installing",
          downloading: "downloading",
          "ready for RPCS3": "nearly done",
        };
        const [subject, step] = p.name.split(" · ");
        const plainStep = step ? (STEP_WORDS[step] ?? step) : null;
        const text = p.error
          ? `${subject} — ${p.error}`
          : p.id.startsWith("ps3-")
            ? `Getting ${subject} ready to play · ${plainStep ?? "working"} · ${pct}%`
            : `${verb} ${subject}${plainStep ? ` · ${plainStep}` : ""} · ${pct}%`;
        return `<div class="transfer${p.error ? " error" : ""}"><span class="ring" style="background-position:${(Math.round((pct / 100) * 16) * 100) / 16}% 0"></span><div class="transfer-text"><span>${text}</span><div class="transfer-bar"><div style="width:${pct}%"></div></div></div></div>`;
      })
      .join("");
  };

  textEntry.setOnPrompt((prompt) => window.axm.companionKeyboard(prompt));

  const askText = (title: string, fields: Parameters<TextEntry["show"]>[1]): Promise<string[] | null> =>
    new Promise((resolve) => {
      textEntry.show(
        title,
        fields,
        (values) => { popOverlay(); resolve(values); },
        () => { popOverlay(); resolve(null); }
      );
      pushOverlay((a) => textEntry.handle(a as Parameters<TextEntry["handle"]>[0]));
    });

  /** The PS3-style centred choice screen (a title, a short list, a note along the bottom). */
  const pickFromScreen = (title: string, choices: ScreenChoice[]): Promise<ScreenChoice | null> =>
    new Promise((resolve) => {
      choiceScreen.show(
        title,
        choices,
        (c) => { popOverlay(); resolve(c); },
        () => { popOverlay(); resolve(null); }
      );
      pushOverlay((a) => choiceScreen.handle(a as Parameters<ChoiceScreen["handle"]>[0]));
    });

  const pickFromGrid = (title: string, choices: GridChoice[]): Promise<GridChoice | null> =>
    new Promise((resolve) => {
      gridPicker.show(
        title,
        choices,
        (c) => { popOverlay(); resolve(c); },
        () => { popOverlay(); resolve(null); }
      );
      pushOverlay((a) => gridPicker.handle(a as Parameters<GridPicker["handle"]>[0]));
    });

  // ---- Avatar picking ------------------------------------------------------------

  // One IPC subscription for the streamed game-icon lookups; whichever picker is
  // open at the time is the sink, so repeated pickers don't stack listeners.
  let gameIconSink: ((u: { gameId?: string; name?: string; url?: string; done?: boolean }) => void) | null = null;
  window.axm.onGameIcon((u) => gameIconSink?.(u));

  /** Three sources: the bundled set, the user's own pictures, or a game's icon. */
  const pickAvatar = async (): Promise<string | null> => {
    const bundled = await window.axm.listBundledAvatars();
    const source = await pickFromGrid("Where should your avatar come from?", [
      { id: "bundled", imageUrl: bundled[0]?.url ?? "assets/icons/user.png", label: "A-X-M avatars" },
      { id: "pictures", imageUrl: "assets/icons/photo.png", label: "My Pictures" },
      { id: "games", imageUrl: "assets/icons/games.svg", label: "Game icons" },
    ]);
    if (!source) return null;

    if (source.id === "bundled") {
      const pick = await pickFromGrid("Choose an avatar", bundled.map((a) => ({ id: a.id, imageUrl: a.url })));
      return pick?.imageUrl ?? null;
    }

    if (source.id === "pictures") {
      const pictures = await window.axm.listPictures();
      const pick = await pickFromGrid(
        "Choose a picture",
        pictures.map((p) => ({ id: p.id, imageUrl: p.url, label: p.label }))
      );
      if (!pick) return null;
      // Copy it into the app's cache so the avatar survives the original moving.
      return (await window.axm.cacheImage(pick.imageUrl, `avatar-${pick.id}`)) ?? pick.imageUrl;
    }

    // Game icons arrive one lookup at a time; the grid fills as they land.
    const icons: GridChoice[] = [];
    const donePromise = new Promise<void>((resolve) => {
      gameIconSink = (u) => {
        if (u.done) {
          gridPicker.setStatus(`${icons.length} game icons`);
          gameIconSink = null;
          resolve();
          return;
        }
        if (u.gameId && u.url) {
          icons.push({ id: u.gameId, imageUrl: u.url, label: u.name });
          if (gridPicker.isOpen()) gridPicker.setChoices([...icons], `Loading… ${icons.length} so far`);
        }
      };
    });
    void window.axm.fetchGameIcons();
    const pickPromise = pickFromGrid("Choose a game icon", []);
    gridPicker.setStatus("Looking up icons on SteamGridDB…");
    await Promise.race([donePromise, pickPromise]);
    const pick = await pickPromise;
    if (!pick) return null;
    return (await window.axm.cacheImage(pick.imageUrl, `avatar-${pick.id}`)) ?? pick.imageUrl;
  };

  /** First-boot setup: a name and an avatar. Also reachable later from Users. */
  const runProfileSetup = async (existing: { name: string; avatarUrl: string } | null): Promise<void> => {
    const answers = await askText("Welcome to A-X-M", [{ label: "Your name", value: existing?.name ?? "" }]);
    if (!answers) return;
    const name = answers[0] || existing?.name || "Player";
    const avatarUrl = (await pickAvatar()) ?? existing?.avatarUrl ?? "assets/icons/user.png";
    settings = await window.axm.saveProfile({ name, avatarUrl });
    audio.playConfirm();
    xmb.refresh();
    // The hand-over to the menu: a sweep of sparkles over the freshly revealed XMB.
    if (settings.introSparkleEnabled) playIntroSparkle(document.body);
  };
  const themeManager = new ThemeManager(ribbon, backgroundLayer);

  /**
   * The one place the ribbon's look is set from settings. While the visualizer is
   * standing in for the ribbons it wins over the theme's own ribbon toggle, which is
   * why every theme change routes through here rather than calling apply() directly.
   */
  const applyTheme = () => {
    themeManager.apply(settings);
    if (visualizer.currentMode() !== "off") ribbon.setRibbonsVisible(false);
  };

  audio.setVolumes(settings.musicVolume, settings.sfxVolume);
  audio.setAmbientTrack(settings.ambientTrack);
  applyTheme();
  ribbon.start();

  // ---- In-game overlay mode -----------------------------------------------------
  //
  // Toggled from the main process on the Guide button. Over a game the ribbons go,
  // the backdrop goes transparent so the game shows through the window, and the
  // menu itself is drawn translucent, the way the XMB sits over a PS3 game.
  let overlayActive = false;
  const inGameMenu = async () => {
    const running = await window.axm.runningGame().catch(() => null);
    if (!running) return;
    const pads = gamepad.snapshot();
    const status = `<span class="center-players">${[1, 2, 3, 4].map((n) => `<i class="${pads.some((p) => p.index === n - 1) ? "on" : ""}">${n}</i>`).join("")}</span><span>Controller ${pads.length ? pads.map((p) => p.index + 1).join(", ") : "—"}</span><span>${running.name}</span>`;
    showCenter(
      [
        {
          label: "Quit Game",
          run: () =>
            showCenter(
              [
                { label: "Yes", run: async () => { await window.axm.quitRunningGame(); notifier.push(`Quit ${running.name}`); void window.axm.overlayClose(); } },
                { label: "No", run: () => void inGameMenu() },
              ],
              { question: "Do you want to quit the game?", horizontal: true }
            ),
        },
        ...(toyDetect.currentFigure()
          ? [{
              label: `Toybox · ${toyDetect.currentFigure()!.name}`,
              run: () => {
                const f = toyDetect.currentFigure()!;
                assistant.showCard({
                  id: `toybox-overlay:${f.uid}`,
                  title: f.name,
                  subtitle: TOY_PLATFORM_NAMES[f.ecosystem as ToyPlatform] ?? f.ecosystem,
                  message: `Current game: ${running.name}`,
                  image: f.artwork?.png ? { src: f.artwork.png, fit: "contain", fallbacks: ["assets/toybox/silhouette-toy.svg"] } : undefined,
                  choices: [
                    { id: "info", label: "Character Info" },
                    { id: "toybox", label: "Toybox" },
                  ],
                  onChoice: (id) => {
                    assistant.closeCard();
                    if (id === "info") showInfo(f.name, f.artwork?.png ?? "assets/icons/toybox.webp", null, [{ label: "Sub-Title", value: TOY_PLATFORM_NAMES[f.ecosystem as ToyPlatform] ?? f.ecosystem }, { label: "Series", value: f.series ?? "" }, { label: "Franchise", value: f.franchise ?? "" }, { label: "Variant", value: f.variant ?? "" }, { label: "Installed games", value: resolveInstalledGames(f, games).map((g) => g.name).join(", ") || "None" }]);
                    else openToyShelf({ view: "recent", platform: "" }, "Recently Scanned");
                  },
                });
              },
            }]
          : []),
        { label: "Controller Settings", run: () => { xmb.setActiveCategory("settings"); xmb.refresh(); notifier.push("Settings › System › Controller"); } },
        { label: "Turn Off the System", run: () => confirmPower("Turn Off the System", "shutdown") },
        { label: "Return to Game", run: () => void window.axm.overlayClose() },
      ],
      { status }
    );
  };
  const setOverlayMode = (active: boolean) => {
    overlayActive = active;
    document.body.classList.toggle("overlay", active);
    if (active) {
      ribbon.setRibbonsVisible(false);
      ribbon.setBackdrop("none");
      // Menu music over a game would fight the game's own audio.
      void audio.fadeOutAmbient(300);
      void inGameMenu();
    } else {
      if (centerMenu.isOpen()) centerMenu.close();
      applyTheme();
      if (!musicPlayer.current()) audio.fadeInAmbient(800);
    }
    xmb.refresh();
  };
  window.axm.onOverlay(({ active }) => setOverlayMode(active));

  // A monthly theme should roll over at midnight on the 1st without a restart.
  setInterval(() => {
    if (settings.themeMode === "monthly" && themeManager.monthChanged()) applyTheme();
  }, 60_000);

  const clockEl = document.getElementById("clock")!;
  const updateClock = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !settings.clock24h });
  };
  updateClock();
  setInterval(updateClock, 15_000);

  const batteries = new BatteryIndicators(document.getElementById("batteries")!);
  batteries.setPercentVisible(settings.batteryPercentEnabled);
  void batteries.start();
  audio.setSfxEnabled(settings.navSoundsEnabled);
  audio.setAmbientEnabled(settings.menuMusicEnabled);
  if (settings.audioOutputId) audio.setOutputDevice(settings.audioOutputId);
  const statusIcons = new StatusIcons(document.getElementById("batteries")!);
  statusIcons.start();
  const hud = new Hud(document.body);
  hud.setFpsVisible(settings.fpsCounterEnabled);
  void hud.setHardwareVisible(settings.hardwareInfoEnabled);

  // ---- Visualizer lifecycle -------------------------------------------------------
  //
  // Y on a track brings the full-screen "stage" up. B drops back to the menu and the
  // visualizer moves behind it, taking the ribbons' place, where it stays across
  // track changes. It only clears when playback actually stops.

  const stageHandler = (action: string): boolean => {
    switch (action) {
      case "back":
        leaveStage();
        return true;
      case "confirm":
      case "context":
        musicPlayer.togglePause();
        return true;
      case "left":
        void cycleVisualizerStyle(-1, true);
        return true;
      case "right":
        void cycleVisualizerStyle(1, true);
        return true;
      default:
        // Swallow navigation so the menu doesn't scroll behind the stage.
        return true;
    }
  };

  const enterStage = () => {
    if (!visualizer.isAvailable()) visualizer.attach(musicPlayer.element());
    visualizer.setTrackName(musicPlayer.current()?.name ?? null);
    visualizer.setMode("stage");
    ribbon.setRibbonsVisible(false);
    pushOverlay(stageHandler);
  };

  const leaveStage = () => {
    if (overlayStack[overlayStack.length - 1] === stageHandler) popOverlay();
    visualizer.setMode("background");
    audio.playBack();
    xmb.refresh();
  };

  const clearVisualizer = () => {
    if (overlayStack[overlayStack.length - 1] === stageHandler) popOverlay();
    visualizer.setMode("off");
    visualizer.setTrackName(null);
    applyTheme();
  };

  // ---- Categories ------------------------------------------------------------------

  /** The PS3 kept Turn Off System under Users; so do we, with Restart, Sleep and Exit. */
  const powerRows = (): MenuItem[] => [
    { id: "turn-off", title: "Turn Off System", subtitle: "Shut the device down", iconUrl: "assets/icons/power.png", onConfirm: () => confirmPower("Turn Off System", "shutdown") },
    { id: "restart", title: "Restart System", iconGlyph: "↻", onConfirm: () => confirmPower("Restart System", "restart") },
    { id: "sleep", title: "Sleep", subtitle: "Rest mode", iconGlyph: "☾", onConfirm: () => confirmPower("Sleep", "sleep") },
    {
      id: "exit",
      title: "Exit to Desktop",
      subtitle: "Close A-X-M",
      iconUrl: "assets/icons/power.png",
      onConfirm: async () => {
        await audio.fadeOutAmbient(800);
        window.axm.quit();
      },
    },
  ];
  const confirmPower = (title: string, action: "shutdown" | "restart" | "sleep") =>
    showOptions(title, [
      { label: "Yes", run: async () => { await audio.fadeOutAmbient(500); void window.axm.powerAction(action); } },
      { label: "No" },
    ]);

  function usersCategory(): Category {
    return {
      id: "users",
      label: "Users",
      // A getter, so the column's own icon becomes the avatar once one is chosen.
      get iconUrl() {
        return settings.profile?.avatarUrl ?? "assets/icons/user.png";
      },
      getItems: () => {
        const profile = settings.profile;
        if (!profile) {
          return [
            {
              id: "create-profile",
              title: "Create your profile",
              subtitle: "Name and avatar",
              iconUrl: "assets/icons/user.png",
              onConfirm: () => runProfileSetup(null),
            },
            ...powerRows(),
          ];
        }
        return [
          {
            id: "profile",
            title: profile.name,
            subtitle: "Signed in",
            iconUrl: profile.avatarUrl,
            iconGlyph: profile.name.slice(0, 1).toUpperCase(),
          },
          {
            id: "change-avatar",
            title: "Change Avatar",
            iconUrl: "assets/icons/photo.png",
            onConfirm: async () => {
              const avatarUrl = await pickAvatar();
              if (!avatarUrl) return;
              settings = await window.axm.saveProfile({ ...profile, avatarUrl });
              xmb.refresh();
            },
          },
          ...powerRows(),
          {
            id: "change-name",
            title: "Change Name",
            iconGlyph: "Aa",
            onConfirm: async () => {
              const answers = await askText("Your name", [{ label: "Name", value: profile.name }]);
              if (!answers || !answers[0]) return;
              settings = await window.axm.saveProfile({ ...profile, name: answers[0] });
              xmb.refresh();
            },
          },
        ];
      },
    };
  }

  // ---- In-menu browser ------------------------------------------------------------
  //
  // The page is a WebContentsView owned by the main process, drawn over everything
  // but the footer. While it's up the menu keeps the controller and relays each
  // press over IPC: D-pad scrolls / history, Y reloads, B closes.
  let browserOpen = false;
  const browserHandler = (action: string): boolean => {
    void window.axm.browserInput(action);
    return true;
  };
  const openInMenuBrowser = (url: string) => {
    if (!/^(https?|file):\/\//i.test(url)) url = "https://" + url;
    if (!browserOpen) {
      browserOpen = true;
      pushOverlay(browserHandler);
    }
    void window.axm.browserOpen(url);
    xmb.refresh();
  };
  let browserNav: BrowserNavState | null = null;
  window.axm.onBrowserNav((state) => {
    browserNav = state;
    if (browserOpen) xmb.refresh();
  });
  const browserToolbar = (): string => {
    const nav = browserNav;
    const dim = (ok: boolean) => (ok ? "" : "dim");
    const url = nav ? nav.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
    return (
      `<span class="browser-bar">` +
      `<span class="viewer-key">◀</span>${spriteHtml("browser", "back", dim(!!nav?.canGoBack))}` +
      `<span class="viewer-key">▶</span>${spriteHtml("browser", "forward", dim(!!nav?.canGoForward))}` +
      `${btn("y")}${spriteHtml("browser", nav?.loading ? "stop" : "reload")}${nav?.loading ? '<span class="ring spin"></span>' : ""}` +
      `${spriteHtml("browser", "address")}<span class="browser-url">${url || "Loading…"}</span>` +
      `</span>`
    );
  };
  window.axm.onBrowserClosed(() => {
    if (!browserOpen) return;
    browserOpen = false;
    if (overlayStack[overlayStack.length - 1] === browserHandler) popOverlay();
    xmb.refresh();
  });

  function browserCategory(): Category {
    const sites: [string, string][] = [
      ["Google", "https://www.google.com"],
      ["YouTube", "https://www.youtube.com/tv"],
      ["Xbox Cloud Gaming", "https://www.xbox.com/play"],
      ["GeForce NOW", "https://play.geforcenow.com"],
    ];
    let view: "root" | "browsers" = "root";
    let remote: RemotePlayStatus | null = null;
    const refreshRemote = async () => {
      remote = await window.axm.remotePlayStatus().catch(() => null);
      xmb.refresh();
    };
    void refreshRemote();
    window.axm.onRemotePlayExit(() => {
      notifier.push("Remote Play ended");
      void refreshRemote();
    });
    const launchRemote = async () => {
      if (!remote?.installed) {
        showOptions("Remote Play needs chiaki-ng", [
          {
            label: "Download chiaki-ng",
            hint: "open source, from GitHub · about 40 MB",
            run: async () => {
              notifier.push("Downloading chiaki-ng…");
              try {
                remote = await window.axm.installRemotePlay();
                notifier.push(`chiaki-ng ${remote.version ?? ""} ready`);
                xmb.refresh();
              } catch (e) {
                notifier.push(`Couldn't get chiaki-ng: ${String((e as Error).message ?? e)}`);
              }
            },
          },
          { label: "Not now" },
        ]);
        return;
      }
      await audio.fadeOutAmbient(300);
      const ok = await window.axm.launchRemotePlay();
      if (!ok) notifier.push("Remote Play didn't start");
    };
    const rootItems = (): MenuItem[] => [
      { id: "net-browsers", title: "Web Browser", subtitle: "Google, YouTube, Xbox Cloud Gaming, GeForce NOW, or any address", iconUrl: "assets/icons/browser.png", onConfirm: () => { view = "browsers"; xmb.enterLevel("browser", "browsers"); xmb.refresh(); } },
      {
        id: "net-remote",
        title: "Remote Play",
        subtitle: remote?.running ? "Running" : remote?.installed ? `PS4 / PS5 · chiaki-ng ${remote.version ?? ""}` : "PS4 / PS5 · fetches chiaki-ng on first use",
        iconUrl: "assets/icons/remote-play.webp",
        onConfirm: () => void launchRemote(),
      },
      { id: "net-manual", title: "Online Instructions", subtitle: "How the menu works and how to use every feature", iconUrl: "assets/icons/about.webp", onConfirm: async () => openInMenuBrowser(await window.axm.manualUrl()) },
    ];
    return {
      id: "browser",
      label: "Network",
      iconUrl: "assets/icons/browser.png",
      onBack: () => {
        if (view === "root") return false;
        view = "root";
        xmb.enterLevel("browser", "root");
        xmb.refresh();
        return true;
      },
      footerHint: () => (browserOpen ? browserToolbar() : view === "browsers" ? "Network › Web Browser" : undefined),
      getItems: () => view === "root" ? rootItems() : [
        {
          id: "browser-address",
          title: "Enter Address…",
          subtitle: "Opens inside the menu",
          iconUrl: "assets/icons/browser.png",
          onConfirm: async () => {
            const values = await askText("Web Address", [{ label: "Address", value: "https://" }]);
            if (values?.[0] && values[0] !== "https://") openInMenuBrowser(values[0]);
          },
        },
        ...sites.map(([title, url]) => ({
          id: `site-${title}`,
          title,
          subtitle: url.replace(/^https?:\/\//, ""),
          iconUrl: "assets/icons/browser.png",
          onConfirm: () => openInMenuBrowser(url),
        })),
      ],
    };
  }

  function musicCategory(): Category {
    // Named playlists, the PS3 way: "Create New Playlist" at the top of Music, each
    // playlist a row with its track count, Y for Play / Edit / Copy / Delete /
    // Information. The single list from earlier builds migrates to "Playlist".
    let playlistView: number | null = null;
    if (settings.playlist.length && settings.playlists.length === 0) {
      void window.axm.setSettings({ playlists: [{ name: "Playlist", tracks: settings.playlist }], playlist: [] }).then((next) => {
        settings = next;
        xmb.refresh();
      });
    }
    const savePlaylists = async (lists: Settings["playlists"]) => {
      settings = await window.axm.setSettings({ playlists: lists });
      xmb.refresh();
    };
    const openFolder = async (dirPath: string | null) => {
      playlistView = null;
      musicListing = await window.axm.browseMusic(dirPath);
      // Keyed on the folder we landed in, so backing out restores the parent's
      // cursor and opening the same folder again returns to where we were.
      xmb.enterLevel("music", musicListing.path ?? "");
      xmb.refresh();
    };
    const asTrack = (entry: MusicEntry): MusicEntry => ({ kind: "track", name: entry.name, filePath: entry.filePath, url: entry.url ?? "" });
    /** "Add to Playlist ▸" with one child per playlist, plus a new one. */
    const addToPlaylistOption = (entry: MusicEntry): PopupOption => ({
      label: "Add to Playlist",
      children: [
        ...settings.playlists.map((pl, i) => ({
          label: pl.name,
          hint: pl.tracks.some((t) => t.filePath === entry.filePath) ? "already in it" : `${pl.tracks.length} tracks`,
          run: async () => {
            if (pl.tracks.some((t) => t.filePath === entry.filePath)) return;
            const lists = settings.playlists.map((p, j) => (j === i ? { ...p, tracks: [...p.tracks, asTrack(entry)] } : p));
            await savePlaylists(lists);
            notifier.push(`Added to ${pl.name}`);
          },
        })),
        {
          label: "New Playlist…",
          run: async () => {
            const answers = await askText("New Playlist", [{ label: "Name", value: `Playlist ${settings.playlists.length + 1}` }]);
            if (!answers?.[0]) return;
            await savePlaylists([...settings.playlists, { name: answers[0], tracks: [asTrack(entry)] }]);
          },
        },
      ],
    });
    const removeFromPlaylist = async (index: number, entry: MusicEntry) => {
      const lists = settings.playlists.map((p, j) => (j === index ? { ...p, tracks: p.tracks.filter((t) => t.filePath !== entry.filePath) } : p));
      await savePlaylists(lists);
    };
    const shuffleOption = (): PopupOption => ({
      label: settings.musicShuffle ? "Shuffle: On" : "Shuffle: Off",
      hint: "next track at random",
      run: async () => {
        settings = await window.axm.setSettings({ musicShuffle: !settings.musicShuffle });
        musicPlayer.setShuffle(settings.musicShuffle);
        xmb.refresh();
      },
    });
    const playlistItems = (): MenuItem[] => {
      const index = playlistView ?? 0;
      const pl = settings.playlists[index];
      const tracks: MusicEntry[] = (pl?.tracks ?? []).map((t) => ({ kind: "track", name: t.name, filePath: t.filePath, url: t.url }));
      if (tracks.length === 0) return [{ id: "playlist-empty", title: "Playlist is empty", subtitle: "Y on a song · Add to Playlist", iconUrl: "assets/icons/music.png" }];
      return tracks.map((entry, i): MenuItem => {
        const playing = musicPlayer.current()?.filePath === entry.filePath;
        return {
          id: `pl-${entry.filePath}`,
          title: entry.name,
          subtitle: `${i + 1} of ${tracks.length}`,
          iconUrl: "assets/icons/music.png",
          badge: playing ? (musicPlayer.isPlaying() ? "PLAYING" : "PAUSED") : undefined,
          onConfirm: () => {
            musicPlayer.play(entry, tracks, settings.musicVolume);
            xmb.refresh();
          },
          contextHint: "options",
          onContext: () => {
            showOptions(entry.name, [
              { label: "Remove from Playlist", run: () => removeFromPlaylist(index, entry) },
              shuffleOption(),
              ...(settings.visualizerEnabled ? [{ label: "Visualizer", run: () => { if (!playing) musicPlayer.play(entry, tracks, settings.musicVolume); enterStage(); } }] : []),
            ]);
            return true;
          },
        };
      });
    };

    return {
      id: "music",
      label: "Music",
      iconUrl: "assets/icons/music.png",
      onBack: () => {
        if (playlistView !== null) {
          playlistView = null;
          xmb.enterLevel("music", musicListing.path ?? "");
          xmb.refresh();
          return true;
        }
        if (musicListing.parent === null) return false;
        void openFolder(musicListing.parent || null);
        return true;
      },
      onContext: () => {
        if (!musicPlayer.current()) return false;
        musicPlayer.togglePause();
        return true;
      },
      footerHint: () => (playlistView !== null ? `${settings.playlists[playlistView]?.name ?? "Playlist"} · ${settings.playlists[playlistView]?.tracks.length ?? 0} tracks${settings.musicShuffle ? " · shuffle" : ""}` : musicListing.path ? musicListing.title : undefined),
      getItems: () => {
        if (playlistView !== null) return playlistItems();
        const top: MenuItem[] = [];
        if (!musicListing.path) {
          top.push({
            id: "playlist-new",
            title: "Create New Playlist",
            iconGlyph: "≡+",
            onConfirm: async () => {
              const answers = await askText("New Playlist", [{ label: "Name", value: `Playlist ${settings.playlists.length + 1}` }]);
              if (!answers?.[0]) return;
              await savePlaylists([...settings.playlists, { name: answers[0], tracks: [] }]);
            },
          });
          settings.playlists.forEach((pl, i) => {
            const tracks: MusicEntry[] = pl.tracks.map((t) => ({ kind: "track", name: t.name, filePath: t.filePath, url: t.url }));
            const play = () => {
              if (tracks.length === 0) return;
              musicPlayer.play(tracks[settings.musicShuffle ? Math.floor(Math.random() * tracks.length) : 0], tracks, settings.musicVolume);
              xmb.refresh();
            };
            top.push({
              id: `playlist-${i}`,
              title: pl.name,
              subtitle: `${pl.tracks.length} Track${pl.tracks.length === 1 ? "" : "s"}`,
              iconGlyph: "▶≡",
              onConfirm: () => {
                playlistView = i;
                xmb.enterLevel("music", `playlist:${i}`);
                xmb.refresh();
              },
              contextHint: "options",
              onContext: () => {
                void refreshVolumes().then(() =>
                  showOptions(pl.name, [
                    { label: "Play", run: play },
                    {
                      label: "Edit",
                      hint: "rename",
                      run: async () => {
                        const answers = await askText("Rename Playlist", [{ label: "Name", value: pl.name }]);
                        if (!answers?.[0]) return;
                        await savePlaylists(settings.playlists.map((p, j) => (j === i ? { ...p, name: answers[0] } : p)));
                      },
                    },
                    { label: "Copy", hint: "duplicate", run: () => savePlaylists([...settings.playlists, { name: `${pl.name} (copy)`, tracks: [...pl.tracks] }]) },
                    { label: "Delete", run: () => showOptions(`Delete ${pl.name}?`, [{ label: "Yes", run: () => savePlaylists(settings.playlists.filter((_, j) => j !== i)) }, { label: "No" }]) },
                    {
                      label: "Information",
                      run: () =>
                        showInfo(pl.name, undefined, null, [
                          { label: "Sub-Title", value: "Playlist" },
                          { label: "Tracks", value: String(pl.tracks.length) },
                          { label: "Details", value: pl.tracks.slice(0, 12).map((t) => t.name).join("\n") + (pl.tracks.length > 12 ? `\n… and ${pl.tracks.length - 12} more` : "") },
                        ]),
                    },
                  ])
                );
                return true;
              },
            });
          });
        }
        if (!musicListing.path) top.push(...discRows(["audio-cd"]));
        if (insideDriveMedia(musicListing.path)) top.push(newFolderRow(musicListing.path!, () => void openFolder(musicListing.path)));
        if (musicListing.entries.length === 0 && top.length > 0) return top;
        if (musicListing.entries.length === 0) {
          return [
            {
              id: "music-empty",
              title: "No music found",
              subtitle: "Add a music folder in Settings",
              iconUrl: "assets/icons/music.png",
            },
          ];
        }
        return [...top, ...musicListing.entries.map((entry): MenuItem => {
          if (entry.kind === "folder") {
            return {
              id: entry.filePath,
              title: entry.name,
              iconUrl: "assets/icons/folder.png",
              onConfirm: () => openFolder(entry.filePath),
              contextHint: "options",
              onContext: () => {
                void refreshVolumes().then(() =>
                  showOptions(entry.name, [
                    {
                      label: "Shuffle Play",
                      hint: "every song in this folder",
                      run: async () => {
                        const listing = await window.axm.browseMusic(entry.filePath);
                        const tracks = listing.entries.filter((t) => t.kind === "track");
                        if (tracks.length === 0) return;
                        settings = await window.axm.setSettings({ musicShuffle: true });
                        musicPlayer.setShuffle(true);
                        musicPlayer.play(tracks[Math.floor(Math.random() * tracks.length)], tracks, settings.musicVolume);
                        xmb.refresh();
                      },
                    },
                    ...copyTargets("music", entry.filePath),
                  ])
                );
                return true;
              },
            };
          }
          const playing = musicPlayer.current()?.filePath === entry.filePath;
          return {
            id: entry.filePath,
            title: entry.name,
            iconUrl: "assets/icons/music.png",
            badge: playing ? (musicPlayer.isPlaying() ? "PLAYING" : "PAUSED") : undefined,
            onConfirm: () => {
              musicPlayer.play(entry, musicListing.entries, settings.musicVolume);
              xmb.refresh();
            },
            // Y opens the visualizer on this track, starting it if it isn't the one
            // playing. When the visualizer is switched off in settings this returns
            // false so Y falls through to the category's plain play/pause.
            contextHint: "options",
            onContext: () => {
              void refreshVolumes().then(() =>
                showOptions(entry.name, [
                  {
                    label: "Information",
                    run: () =>
                      showInfo(entry.name, undefined, entry.filePath, [{ label: "Sub-Title", value: musicListing.title }], async () => {
                        const info = await window.axm.getSongInfo(entry.filePath);
                        if (!info) return [];
                        if (info.coverUrl) infoCard.setArt(info.coverUrl);
                        const a = info.artistInfo;
                        const bits = a ? [a.type, a.area, a.began ? `${a.began.slice(0, 4)}${a.ended ? ` – ${a.ended.slice(0, 4)}` : " –"}` : "", a.disambiguation].filter(Boolean).join(" · ") : "";
                        const len = info.durationSec ? `${Math.floor(info.durationSec / 60)}:${String(info.durationSec % 60).padStart(2, "0")}` : "";
                        return [
                          { label: "Artist", value: info.artist },
                          { label: "Album", value: [info.album, info.year].filter(Boolean).join(" · ") },
                          { label: "Length", value: len },
                          { label: "Genre", value: info.genre },
                          { label: "Format", value: info.bitrateKbps ? `${info.bitrateKbps} kbps` : "" },
                          { label: "Details", value: [bits, a?.tags.join(", ")].filter(Boolean).join("\n") },
                          { label: "Source", value: info.source },
                        ];
                      }),
                  },
                  ...(settings.visualizerEnabled
                    ? [
                        {
                          label: "Visualizer",
                          hint: playing ? "" : "plays this track",
                          run: () => {
                            if (!playing) musicPlayer.play(entry, musicListing.entries, settings.musicVolume);
                            enterStage();
                          },
                        },
                      ]
                    : []),
                  addToPlaylistOption(entry),
                  shuffleOption(),
                  ...copyTargets("music", entry.filePath),
                ])
              );
              return true;
            },
          };
        })];
      },
    };
  }

  /**
   * The Game column follows the PS3 layout: the two utility folders sit at the top,
   * then launcher shortcuts, then the games themselves. Opening a utility folder
   * descends into it the same way the music library does; B comes back out.
   */
  function gamesCategory(): Category {
    let view: "root" | "saves" | "gamedata" | "steam" | "drive" | "trophies" | "trophy-list" | "trophy-game" | "memcards" | "pcpackages" = "root";
    let pcPackages: PcPackage[] = [];
    let pcInstallHint = "";
    // Virtual PS / PS2 memory cards, the saves on them, and Apollo's cheats.
    const memcards = new MemoryCardUtility({
      refresh: () => xmb.refresh(),
      enterLevel: (key) => xmb.enterLevel("games", key),
      resetSelection: () => xmb.resetSelection("games"),
      showOptions,
      showInfo: (title, art, rows) => showInfo(title, art, null, rows),
      askText: (title, fields) => askText(title, fields),
      pickScreen: pickFromScreen,
      notify: (text, icon) => notifier.push(text, "general", icon),
      volumes: () => volumes,
      sendToPhone: (cardId, save) => window.axm.companionSendSave(cardId, save),
      phoneConnected: () => (companionState?.sessions.filter((s) => s.paired).length ?? 0) > 0,
    });
    let trophySource: "steam" | "ra" = "steam";
    let trophyGames: TrophyGame[] = [];
    let trophyError: string | null = null;
    let trophyGame: TrophyGame | null = null;
    let trophyList: Achievement[] = [];
    const openTrophies = async (source: "steam" | "ra") => {
      trophySource = source;
      trophyGames = [];
      trophyError = "Loading…";
      go("trophy-list");
      const res = source === "steam" ? await window.axm.steamTrophyGames() : await window.axm.raTrophyGames();
      trophyGames = res.games;
      trophyError = res.error;
      xmb.refresh();
    };
    const openTrophyGame = async (g: TrophyGame) => {
      trophyGame = g;
      trophyList = [];
      trophyError = "Loading…";
      go("trophy-game");
      const res = g.source === "steam" ? await window.axm.steamAchievements(g.id) : await window.axm.raAchievements(g.id);
      trophyList = res.list;
      trophyError = res.error;
      if (g.source === "steam" && res.list.length) {
        g.unlocked = res.list.filter((a) => a.unlocked).length;
        g.total = res.list.length;
      }
      xmb.refresh();
    };
    const raSignIn = async () => {
      const answers = await askText("RetroAchievements", [{ label: "Username", value: settings.raUsername }, { label: "Web API key", secret: true }]);
      if (!answers?.[0] || !answers[1]) return;
      const res = await window.axm.raVerify(answers[0], answers[1]);
      notifier.push(res.message);
      if (res.ok) {
        settings = await window.axm.setSettings({ raUsername: answers[0], raApiKey: answers[1] });
        await openTrophies("ra");
      }
    };
    const trophyItems = (): MenuItem[] => [
      { id: "tr-steam", title: "Steam Achievements", subtitle: settings.steamWebApiKey ? "Your played games" : "Add a Steam Web API key in Settings › System › Trophies", iconUrl: "assets/icons/steam.svg", onConfirm: () => openTrophies("steam") },
      { id: "tr-ra", title: "RetroAchievements", subtitle: settings.raUsername ? `Signed in as ${settings.raUsername}` : "Sign in on first use", iconUrl: "assets/icons/trophy.webp", onConfirm: () => (settings.raUsername && settings.raApiKey ? openTrophies("ra") : raSignIn()), contextHint: settings.raUsername ? "sign out" : undefined, onContext: () => { if (!settings.raUsername) return false; void window.axm.setSettings({ raUsername: "", raApiKey: "" }).then((n) => { settings = n; xmb.refresh(); }); return true; } },
    ];
    const trophyListItems = (): MenuItem[] => {
      if (trophyError && !trophyGames.length) return [{ id: "tr-msg", title: trophyError, iconUrl: "assets/icons/trophy.webp" }];
      return trophyGames.map((g) => ({
        id: `tr-${g.source}-${g.id}`,
        title: g.name,
        subtitle: g.total >= 0 ? `${g.unlocked} of ${g.total} unlocked` : "A to see achievements",
        iconUrl: g.icon ?? "assets/icons/trophy.webp",
        meter: g.total > 0 ? g.unlocked / g.total : undefined,
        onConfirm: () => openTrophyGame(g),
      }));
    };
    const trophyGameItems = (): MenuItem[] => {
      if (trophyError && !trophyList.length) return [{ id: "tr-msg", title: trophyError, iconUrl: "assets/icons/trophy.webp" }];
      return trophyList.map((a) => ({
        id: `ach-${a.id}`,
        title: a.name,
        subtitle: `${a.description}${a.unlockedAt ? ` · ${new Date(a.unlockedAt).toLocaleDateString()}` : ""}${a.points ? ` · ${a.points} pts` : ""}`,
        iconUrl: a.icon ?? "assets/icons/trophy.webp",
        iconClass: a.unlocked ? "" : "locked",
        badge: a.unlocked ? "UNLOCKED" : undefined,
      }));
    };
    let driveFolder = "";

    const go = (next: typeof view) => {
      view = next;
      // The drive browser is a different level per folder, so it gets the path too.
      xmb.enterLevel("games", next === "drive" ? `drive:${driveFolder}` : next);
      xmb.refresh();
    };

    const openSaves = async () => {
      saves = await window.axm.getSaves();
      go("saves");
    };

    const openPcPackages = async () => {
      pcInstallHint = "";
      pcPackages = await window.axm.listPcPackages();
      go("pcpackages");
    };

    // The installer reports what it is doing; show it on the footer as it goes.
    window.axm.onPcInstallProgress(({ note }) => {
      pcInstallHint = note;
      if (view === "pcpackages") xmb.refresh();
    });

    const openSteam = async () => {
      steamLibrary = await window.axm.getSteamLibrary();
      go("steam");
    };

    /**
     * After an install is requested, Steam downloads on its own. Poll the manifests
     * until nothing is mid-download any more, then rescan so the game shows up in
     * the main list alongside everything else. Kept to one timer however many
     * installs are queued.
     */
    let installPoll = 0;
    const watchInstalls = () => {
      if (installPoll) return;
      installPoll = window.setInterval(async () => {
        const before = steamLibrary.games.filter((g) => g.state === "installing").length;
        steamLibrary = await window.axm.getSteamLibrary();
        const now = steamLibrary.games.filter((g) => g.state === "installing").length;
        // Something finished: refresh the installed games so it appears in the list.
        if (now < before) {
          games = await window.axm.scanGames();
          notifier.push("A Steam install finished", "install");
        }
        if (now === 0) {
          window.clearInterval(installPoll);
          installPoll = 0;
        }
        xmb.refresh();
      }, 15_000);
    };

    const steamItems = (): MenuItem[] => {
      if (steamLibrary.games.length === 0) {
        return [
          {
            id: "steam-empty",
            title: steamLibrary.account ? "No games in this library" : "Steam not found",
            subtitle: steamLibrary.account ? undefined : "Install Steam and sign in once",
            iconUrl: "assets/icons/steam.svg",
          },
        ];
      }
      return steamLibrary.games.map((g): MenuItem => {
        const badge = g.state === "installed" ? "INSTALLED" : g.state === "installing" ? (g.progress !== undefined ? `INSTALLING · ${Math.round(g.progress * 100)}%` : "INSTALLING…") : undefined;
        return {
          id: `steam-lib-${g.appid}`,
          title: g.name,
          subtitle: g.state === "not-installed" ? "Not installed · A to install" : undefined,
          iconUrl: g.coverUrl,
          iconGlyph: "S",
          badge,
          meter: g.state === "installing" ? (g.progress ?? 0) : undefined,
          onConfirm: async () => {
            if (g.state === "installed") {
              window.axm.launchSteamApp(g.appid);
              return;
            }
            if (g.state === "installing") return;
            // Steam takes it from here in the background; flip the badge straight
            // away rather than waiting for the first poll to notice the manifest.
            // Steam always shows its own location dialog and offers no way to preset
            // it, so the preferred drive is surfaced here as the reminder.
            await window.axm.installSteamGame(g.appid);
            g.state = "installing";
            if (settings.steamInstallDrive) steamInstallHint = `Choose ${settings.steamInstallDrive} in Steam's install window`;
            xmb.refresh();
            watchInstalls();
          },
        };
      });
    };

    const gameRows = (): MenuItem[] =>
      games
        .filter((g) => !g.hidden && g.source !== "retro")
        .map((g) => ({
          id: g.id,
          title: g.name,
          // Drive and folder live in the Y options view now, not under every row.
          iconUrl: g.iconPath,
          backgroundUrl: g.heroPath,
          iconGlyph: sourceGlyph(g.source),
          badge: g.losslessProfile ? `LS ${g.losslessProfile}` : undefined,
          contextGame: g,
          onConfirm: () => {
            notifier.push(`Starting ${g.name}`, "general", g.iconPath);
            return window.axm.launchGame(g.id);
          },
        }));

    const rootItems = (): MenuItem[] => [
      ...(overlayActive
        ? [
            {
              id: "return-to-game",
              title: "Return to Game",
              subtitle: "Or press the Xbox / PS button",
              iconUrl: "assets/icons/games.svg",
              onConfirm: () => window.axm.overlayClose(),
            } as MenuItem,
          ]
        : []),
      {
        id: "saved-data-utility",
        title: "Saved Data Utility",
        subtitle: "Game saves",
        iconUrl: "assets/icons/folder.png",
        onConfirm: () => openSaves(),
      },
      {
        id: "memory-card-utility",
        title: "Memory Card Utility",
        subtitle: "PS and PS2 memory cards · saves, cheats, backups",
        iconUrl: "assets/icons/memcard-utility.webp",
        iconClass: "memcard",
        onConfirm: async () => { await refreshVolumes(); view = "memcards"; await memcards.open(); },
      },
      {
        id: "install-package-files",
        title: "Install Package Files",
        subtitle: "PC disc images in GAME\PCISO · mount and install",
        iconUrl: "assets/icons/folder.png",
        onConfirm: () => void openPcPackages(),
      },
      {
        id: "game-data-utility",
        title: "Game Data Utility",
        subtitle: "Installed game files",
        iconUrl: "assets/icons/folder.png",
        onConfirm: () => go("gamedata"),
      },
      {
        id: "trophies",
        title: "Trophy Collection",
        subtitle: settings.profile?.name ?? "Steam achievements · RetroAchievements",
        iconUrl: "assets/icons/trophy.webp",
        onConfirm: () => go("trophies"),
      },
      {
        id: "steam-library",
        title: "Steam",
        subtitle: steamLibrary.account ? `${steamLibrary.account}'s library` : "Your Steam library",
        iconUrl: "assets/icons/steam.svg",
        onConfirm: () => openSteam(),
      },
      ...launchers
        .filter((l) => l.installed)
        .map((l) => ({
          id: `launcher-${l.id}`,
          title: l.name,
          iconUrl: l.id === "epic" ? "assets/icons/epic.svg" : `assets/icons/${l.id}.png`,
          onConfirm: () => window.axm.openLauncher(l.id),
        })),
      ...driveRows("game", (folder) => {
        driveFolder = folder;
        go("drive");
      }),
      // The cartridge (a drive on the Sabrent adapter), whether or not it has a GAME folder.
      ...volumes.filter((v) => v.cartridge && !mediaDrives.some((d) => d.game && d.drive.toUpperCase() === v.drive.toUpperCase())).map((v): MenuItem => ({
        id: `cartridge-${v.drive}`,
        title: `Cartridge (${v.drive})`,
        subtitle: "Plugged into the SATA adapter · its games",
        iconUrl: "assets/icons/cartridge.png",
        iconClass: "cartridge",
        onConfirm: () => { driveFolder = `${v.drive}\\`; go("drive"); },
      })),
      ...discRows(["ps1", "ps2"]),
      ...gameRows(),
      {
        id: "game-about",
        title: "About & Credits",
        subtitle: "Apollo Save Tool, the texture pack authors, and the community collections",
        iconUrl: "assets/icons/about.webp",
        onConfirm: () => void window.axm.textureDb().then((db) => {
          const authors = [...new Set(db.games.flatMap((g) => g.packs.map((p) => `${p.author} - ${p.name} (github.com/${p.repo})`)))];
          showInfo("About & Credits", "assets/icons/about.webp", null, [
            { label: "Apollo Save Tool", value: "Damian \"bucanero\" Parrino: apollo-lib (the patch engine A-X-M ports), apollo-patches (the cheat database) and apollo-saves (the community saves). GPL-3.0." },
            { label: "Game information", value: "niemasd's GameDB (PSX, PS2, PS3) for PlayStation release data, and GameTDB for the Nintendo platforms. Downloaded on demand, never bundled. GPL-3.0." },
            { label: "HD texture packs", value: authors.join("\n") },
            { label: "Collections", value: db.moreSources.map((s) => `${s.name}\n${s.url}`).join("\n") },
            { label: "Emulators", value: "DuckStation (stenzek) and PCSX2, whose card formats and texture folders these are; RPCS3, PPSSPP, Eden, shadPS4, Kyty." },
            { label: "Memory cards", value: "Ross Ridge's ps2mc / mymc notes on the PS2 card filesystem." },
            { label: "Thank you", value: "To everyone above, and to every author whose name is in a patch header or a pack's README. Full notices: assets/THIRD_PARTY_LICENSES.md." },
          ]);
        }),
      },
    ];

    /** Games the scanner found under a drive's GAME folder. */
    const driveItems = (): MenuItem[] => {
      const root = driveFolder.toLowerCase();
      const rows = gameRows().filter((r) => {
        const dir = r.contextGame?.installDir?.toLowerCase() ?? "";
        return dir === root || dir.startsWith(root + "\\");
      });
      if (rows.length === 0) {
        if (isCartridge(driveFolder)) {
          const n = games.filter((g) => g.source === "retro" && !g.hidden && g.drive?.toUpperCase() === driveFolder.slice(0, 2).toUpperCase()).length;
          return [{ id: "drive-empty", title: n ? `${n} console game${n === 1 ? "" : "s"} on the cartridge` : "No games found", subtitle: n ? `Under Retro › Cartridge (${driveFolder.slice(0, 2)}) · PC games go in ${driveFolder.slice(0, 2)}\\GAME` : `Put PC games in ${driveFolder.slice(0, 2)}\\GAME and console games in ${driveFolder.slice(0, 2)}\\ROMS\\<platform>`, iconUrl: "assets/icons/cartridge.png", iconClass: "cartridge" }];
        }
        return [{ id: "drive-empty", title: "No games found", subtitle: `Put each game in its own folder under ${driveFolder}`, iconUrl: "assets/icons/hdd.webp", iconClass: "hdd hdd-game" }];
      }
      return rows;
    };

    const savesItems = (): MenuItem[] => {
      if (saves.length === 0) {
        return [{ id: "saves-empty", title: "No saved data found", iconUrl: "assets/icons/folder.png" }];
      }
      return saves.map((s) => ({
        id: s.id,
        title: s.name,
        subtitle: `${s.source} · ${new Date(s.modified).toLocaleDateString()}`,
        iconUrl: "assets/icons/folder.png",
        onConfirm: () => window.axm.openFolder(s.filePath),
      }));
    };

    /**
     * The PC disc images waiting in PCISO.
     *
     * Each shows a plain silver disc until SteamGridDB has artwork for it, which
     * is why the disc art is deliberately generic - it reads as "a disc we have
     * not identified yet" rather than as a wrong cover.
     */
    const pcPackageItems = (): MenuItem[] => {
      if (pcPackages.length === 0) {
        return [{
          id: "pcpackages-empty",
          title: "No disc images found",
          subtitle: "Put .iso files in GAME\PCISO on the ROOT drive",
          iconUrl: "assets/icons/disc-pc.webp",
        }];
      }
      return pcPackages.map((pkg) => ({
        id: pkg.id,
        title: pkg.name,
        subtitle: pkg.installed
          ? `Installed · ${fmtBytes(pkg.sizeBytes)}`
          : `Disc image · ${fmtBytes(pkg.sizeBytes)}`,
        iconUrl: pkg.artUrl ?? "assets/icons/disc-pc.webp",
        onConfirm: () => installPcPackage(pkg),
        onInfo: () =>
          showInfo(pkg.name, pkg.artUrl ?? "assets/icons/disc-pc.webp", pkg.filePath, [
            { label: "Sub-Title", value: pkg.installed ? "Installed" : "Not installed yet" },
            { label: "Image", value: pkg.filePath },
            { label: "Installs to", value: pkg.installPath ?? "" },
          ]),
      }));
    };

    /**
     * Installs a package, or offers to open it again when it is already in.
     *
     * Mounting and installing can take a long while on a repack, so the footer
     * carries the running commentary and the list is refreshed afterwards so the
     * row flips to "Installed".
     */
    const installPcPackage = async (pkg: PcPackage) => {
      const run = async () => {
        pcInstallHint = `Starting ${pkg.name}`;
        xmb.refresh();
        const out = await window.axm.installPcPackage(pkg.filePath);
        pcInstallHint = out.message;
        notifier.push(out.message, out.ok ? "install" : undefined);
        pcPackages = await window.axm.listPcPackages();
        games = await window.axm.scanGames();
        xmb.refresh();
      };

      if (pkg.installed) {
        showOptions(pkg.name, [
          { label: "Open install folder", run: () => window.axm.openFolder(pkg.installPath ?? "") },
          { label: "Install again", hint: "Overwrites what is there", run: () => void run() },
          {
            label: "Mount only",
            hint: "Browse the disc yourself",
            run: () => {
              void (async () => {
                const m = await window.axm.mountPcPackage(pkg.filePath);
                notifier.push(m.message);
                if (m.ok && m.drive) window.axm.openFolder(m.drive);
              })();
            },
          },
        ]);
        return;
      }
      void run();
    };

    const gameDataItems = (): MenuItem[] => {
      // WindowsApps is ACL-locked, so an Xbox install folder can't be opened anyway.
      const rows = games.filter((g) => !g.hidden && g.installDir && g.source !== "xbox");
      if (rows.length === 0) {
        return [{ id: "gamedata-empty", title: "No game data found", iconUrl: "assets/icons/folder.png" }];
      }
      return rows.map((g) => ({
        id: `gamedata-${g.id}`,
        title: g.name,
        subtitle: g.installDir,
        iconUrl: g.iconPath,
        iconGlyph: sourceGlyph(g.source),
        onConfirm: () => window.axm.openFolder(g.installDir),
      }));
    };

    return {
      id: "games",
      label: "Game",
      iconUrl: "assets/icons/games.svg",
      onBack: () => {
        if (view === "root") return false;
        if (view === "memcards") { if (!memcards.back()) go("root"); return true; }
        if (view === "trophy-game") go("trophy-list");
        else if (view === "trophy-list") go("trophies");
        else go("root");
        return true;
      },
      footerHint: () => {
        if (view === "saves") return "Saved Data Utility";
        if (view === "pcpackages") return pcInstallHint || `Install Package Files · ${pcPackages.length} image(s)`;
        if (view === "memcards") return memcards.hint();
        if (view === "gamedata") return "Game Data Utility";
        if (view === "drive") return driveFolder;
        if (view === "trophies") return "Trophy Collection";
        if (view === "trophy-list") return `Trophy Collection › ${trophySource === "steam" ? "Steam" : "RetroAchievements"}`;
        if (view === "trophy-game") return `Trophy Collection › ${trophyGame?.name ?? ""}`;
        if (view === "steam") {
          if (steamInstallHint) return steamInstallHint;
          const installed = steamLibrary.games.filter((g) => g.state === "installed").length;
          return `Steam · ${installed} of ${steamLibrary.games.length} installed`;
        }
        return undefined;
      },
      getItems: () => {
        if (view === "saves") return savesItems();
        if (view === "pcpackages") return pcPackageItems();
        if (view === "memcards") return memcards.items();
        if (view === "gamedata") return gameDataItems();
        if (view === "steam") return steamItems();
        if (view === "drive") return driveItems();
        if (view === "trophies") return trophyItems();
        if (view === "trophy-list") return trophyListItems();
        if (view === "trophy-game") return trophyGameItems();
        return rootItems();
      },
    };
  }

  /**
   * Photo and Video browse the user's own Pictures / Videos folder a level at a
   * time, and open files in the in-app viewer rather than handing off to Windows.
   * A descends into a folder or opens a file, B goes back up.
   */
  /** A mode that can take over a media column's list, e.g. Jellyfin inside Video. */
  interface ColumnMode {
    active: () => boolean;
    items: () => MenuItem[];
    back: () => boolean;
    hint: () => string;
  }

  function mediaCategory(
    kind: "photo" | "video",
    label: string,
    iconUrl: string,
    getListing: () => BrowseListing,
    setListing: (l: BrowseListing) => void,
    leading: (openFolder: (dirPath: string) => void) => MenuItem[] = () => [],
    mode?: ColumnMode
  ): Category {
    const openFolder = async (dirPath: string | null) => {
      setListing(await window.axm.browseMedia(kind, dirPath));
      xmb.enterLevel(kind, getListing().path ?? "");
      xmb.refresh();
    };

    const openFile = (entry: BrowseListing["entries"][number]) => {
      // Video takes the audio channel; a photo doesn't need to interrupt anything.
      if (kind === "video") {
        musicPlayer.stop();
        audio.fadeOutAmbient(400);
      }
      mediaViewer.open(kind, entry, getListing().entries);
      pushOverlay((action) => mediaViewer.handle(action as Parameters<MediaViewer["handle"]>[0]));
    };

    return {
      id: kind,
      label,
      iconUrl,
      onBack: () => {
        if (mode?.active()) return mode.back();
        const listing = getListing();
        if (!listing.parent) return false;
        void openFolder(listing.parent);
        return true;
      },
      footerHint: () => {
        if (mode?.active()) return mode.hint();
        const listing = getListing();
        return listing.parent ? listing.title : undefined;
      },
      getItems: () => {
        if (mode?.active()) return mode.items();
        const listing = getListing();
        const lead = leading((p) => void openFolder(p));
        if (listing.entries.length === 0 && lead.length === 0 && !insideDriveMedia(listing.path)) {
          return [
            {
              id: `${kind}-empty`,
              title: `No ${label.toLowerCase()}s found`,
              subtitle: `Add files to your Windows ${listing.title} folder`,
              iconUrl,
            },
          ];
        }
        return [
          ...(listing.parent ? [] : lead),
          ...(insideDriveMedia(listing.path) ? [newFolderRow(listing.path, () => void openFolder(listing.path))] : []),
          ...listing.entries.map((entry): MenuItem =>
            entry.kind === "folder"
              ? {
                  id: entry.filePath,
                  title: entry.name,
                  iconUrl: "assets/icons/folder.png",
                  onConfirm: () => openFolder(entry.filePath),
                  contextHint: "options",
                  onContext: () => {
                    void refreshVolumes().then(() => showOptions(entry.name, copyTargets(kind, entry.filePath)));
                    return true;
                  },
                }
              : {
                  id: entry.filePath,
                  title: entry.name,
                  // Photos preview as their own thumbnail; the tile crops to square.
                  iconUrl: kind === "photo" ? entry.url : iconUrl,
                  onConfirm: () => openFile(entry),
                  contextHint: "options",
                  onContext: () => {
                    void refreshVolumes().then(() =>
                      showOptions(entry.name, [
                        ...(kind === "photo"
                          ? [
                              { label: "Information", run: () => showInfo(entry.name, entry.url, entry.filePath, [{ label: "Sub-Title", value: listing.title }]) },
                              { label: "Set as Wallpaper", hint: "this picture", run: () => setWallpaper({ url: entry.url!, filePath: entry.filePath, mode: "single" as const, folder: listing.path }) },
                              { label: "Shuffle Folder as Wallpaper", hint: "changes every few minutes", run: () => setWallpaper({ url: entry.url!, filePath: entry.filePath, mode: "shuffle" as const, folder: listing.path }) },
                            ]
                          : []),
                        ...(kind === "video"
                          ? [
                              {
                                label: "Information",
                                run: () =>
                                  showInfo(entry.name, undefined, entry.filePath, [{ label: "Sub-Title", value: listing.title }], async () => {
                                    const info = await window.axm.getScreenInfo(entry.name, "", "auto");
                                    return screenRows(info);
                                  }),
                              },
                            ]
                          : []),
                        ...copyTargets(kind, entry.filePath),
                      ])
                    );
                    return true;
                  },
                }
          ),
        ];
      },
    };
  }

  // Leaving either viewer hands input back to the menu and brings the menu music
  // back if a video had taken it.
  mediaViewer.setOnClose(() => {
    popOverlay();
    audio.playBack();
    if (!musicPlayer.current()) audio.fadeInAmbient(1200);
  });

  // ---- Jellyfin, inside the Video column ---------------------------------------
  //
  // Servers are found by broadcast; a sign-in is asked for once per server and the
  // token kept, so the next visit goes straight to the libraries. Video items play
  // in the in-app viewer off the server's direct stream.
  const jf = {
    active: false,
    view: "servers" as "servers" | "libraries" | "items",
    servers: [] as JellyfinServer[],
    searching: false,
    login: null as JellyfinLogin | null,
    libraries: [] as JellyfinItem[],
    // Folder stack: each level's parent id + name + items.
    stack: [] as { id: string; name: string; items: JellyfinItem[] }[],
    status: "" as string,
  };

  const jfRefresh = () => {
    // Jellyfin keeps its own folder stack; the path through it identifies the level.
    xmb.enterLevel("video", `jf:${jf.stack.map((f) => f.id).join("/")}`);
    xmb.refresh();
  };

  const jfDiscover = async () => {
    if (!settings.mediaServerEnabled) {
      jf.status = "Media Server Connection is disabled in Settings › Network";
      xmb.refresh();
      return;
    }
    jf.searching = true;
    jf.status = "Searching the network…";
    xmb.refresh();
    jf.servers = await window.axm.jellyfinDiscover();
    jf.searching = false;
    jf.status = jf.servers.length === 0 ? "No Jellyfin servers answered" : "";
    xmb.refresh();
  };

  const jfOpenLibraries = async (login: JellyfinLogin) => {
    jf.status = "Loading libraries…";
    xmb.refresh();
    const libs = await window.axm.jellyfinLibraries(login);
    if (!libs) {
      // Token revoked or server changed - drop the saved login and ask again.
      settings = await window.axm.jellyfinForget(login.serverUrl);
      jf.status = "Saved sign-in no longer works - sign in again";
      jf.view = "servers";
      jfRefresh();
      return;
    }
    jf.login = login;
    jf.libraries = libs;
    jf.stack = [];
    jf.status = "";
    jf.view = "libraries";
    jfRefresh();
  };

  const jfSignIn = async (server: JellyfinServer) => {
    const saved = settings.jellyfinLogins[server.url];
    if (saved) return jfOpenLibraries(saved);
    const answers = await askText(`Sign in to ${server.name}`, [
      { label: "Username" },
      { label: "Password", secret: true },
    ]);
    if (!answers) return;
    jf.status = "Signing in…";
    xmb.refresh();
    const login = await window.axm.jellyfinLogin(server, answers[0], answers[1]);
    if (!login) {
      jf.status = "Sign-in failed - check the username and password";
      xmb.refresh();
      return;
    }
    settings = await window.axm.getSettings();
    await jfOpenLibraries(login);
  };

  const jfDescend = async (item: JellyfinItem) => {
    if (!jf.login) return;
    jf.status = "Loading…";
    xmb.refresh();
    const items = (await window.axm.jellyfinItems(jf.login, item.id)) ?? [];
    jf.stack.push({ id: item.id, name: item.name, items });
    jf.status = "";
    jf.view = "items";
    jfRefresh();
  };

  const jfPlay = (item: JellyfinItem) => {
    if (!item.streamUrl) return;
    musicPlayer.stop();
    audio.fadeOutAmbient(400);
    videoArt = { title: item.name, art: item.imageUrl ?? item.backdropUrl };
    const entry = { kind: "file" as const, name: item.name, filePath: item.id, url: item.streamUrl, hls: item.hls };
    mediaViewer.open("video", entry, [entry]);
    pushOverlay((action) => mediaViewer.handle(action as Parameters<MediaViewer["handle"]>[0]));
    void fetchSubtitles(
      item.seriesName ? { title: item.seriesName, kind: "tv", season: item.season, episode: item.episode } : { title: item.name, year: item.year, kind: "movie" },
      item.id
    );
  };

  /** Subtitles from SubDL for the video just opened, shown once they arrive (if it's still playing). */
  const fetchSubtitles = async (q: { title: string; year?: string; kind: "movie" | "tv"; season?: number; episode?: number }, forPath: string) => {
    if (!settings.subtitles?.enabled || !settings.subdlApiKey) return;
    const vtt = await window.axm.findSubtitles(q).catch(() => null);
    if (!vtt || mediaViewer.current()?.filePath !== forPath) return;
    mediaViewer.setSubtitles(vtt);
    notifier.push(`Subtitles on · ${q.title}`, "general");
  };

  const jfItems = (): MenuItem[] => {
    const statusRow: MenuItem[] = jf.status
      ? [{ id: "jf-status", title: jf.status, iconUrl: "assets/icons/jellyfin.svg" }]
      : [];

    if (jf.view === "servers") {
      // Discovered servers first, then any saved sign-in the broadcast didn't reach
      // (another subnet, a VPN, or a server off the LAN entirely).
      const listed = new Set(jf.servers.map((s) => s.url));
      const saved: JellyfinServer[] = Object.values(settings.jellyfinLogins)
        .filter((l) => !listed.has(l.serverUrl))
        .map((l) => ({ name: l.serverName, url: l.serverUrl, id: l.serverUrl }));
      const rows: MenuItem[] = [...jf.servers, ...saved].map((s) => ({
        id: `jf-server-${s.id}`,
        title: s.name,
        subtitle: settings.jellyfinLogins[s.url]
          ? `${s.url} · signed in as ${settings.jellyfinLogins[s.url].userName}`
          : s.url,
        iconUrl: "assets/icons/jellyfin.svg",
        badge: settings.jellyfinLogins[s.url] ? "SAVED" : undefined,
        onConfirm: () => jfSignIn(s),
        contextHint: settings.jellyfinLogins[s.url] ? "forget sign-in" : undefined,
        onContext: () => {
          if (!settings.jellyfinLogins[s.url]) return false;
          void window.axm.jellyfinForget(s.url).then((next) => {
            settings = next;
            xmb.refresh();
          });
          return true;
        },
      }));
      rows.push({
        id: "jf-search",
        title: jf.searching ? "Searching…" : "Search Again",
        iconGlyph: "↻",
        onConfirm: () => (jf.searching ? undefined : jfDiscover()),
      });
      rows.push({
        id: "jf-manual",
        title: "Enter Server Address…",
        subtitle: "e.g. 192.168.1.20:8096",
        iconGlyph: "⌨",
        onConfirm: async () => {
          const values = await askText("Jellyfin Server", [{ label: "Address", value: "http://" }]);
          const typed = values?.[0]?.trim();
          if (!typed || typed === "http://") return;
          const url = (/^https?:\/\//i.test(typed) ? typed : "http://" + typed).replace(/\/+$/, "");
          void jfSignIn({ name: url.replace(/^https?:\/\//, ""), url, id: url });
        },
      });
      return [...statusRow, ...rows];
    }

    if (jf.view === "libraries") {
      return [
        ...statusRow,
        ...jf.libraries.map((lib) => ({
          id: `jf-lib-${lib.id}`,
          title: lib.name,
          subtitle: lib.type,
          iconUrl: lib.imageUrl ?? "assets/icons/jellyfin.svg",
          iconGlyph: "J",
          onConfirm: () => jfDescend(lib),
        })),
      ];
    }

    const level = jf.stack[jf.stack.length - 1];
    if (!level) return statusRow;
    if (level.items.length === 0) return [...statusRow, { id: "jf-empty", title: "Nothing here", iconUrl: "assets/icons/jellyfin.svg" }];
    return [
      ...statusRow,
      ...level.items.map((item) => ({
        id: `jf-item-${item.id}`,
        title: item.name,
        subtitle: item.isFolder ? (item.year ? `${item.type} · ${item.year}` : item.type) : item.streamUrl ? (item.year ? `Play · ${item.year}` : "Play") : item.type,
        iconUrl: item.imageUrl ?? (item.isFolder ? "assets/icons/folder.png" : "assets/icons/video.png"),
        iconGlyph: item.isFolder ? "▸" : "▶",
        backgroundUrl: item.backdropUrl,
        onConfirm: () => (item.isFolder ? jfDescend(item) : jfPlay(item)),
        contextHint: "options",
        onContext: () => {
          void refreshVolumes().then(() => showOptions(item.name, jfOptions(item)));
          return true;
        },
      })),
    ];
  };

  /** TMDB facts as Information rows. */
  const screenRows = (info: ScreenInfo | null): InfoRow[] => {
    if (!info) return [{ label: "Details", value: "No information found" }];
    if (info.posterUrl) infoCard.setArt(info.posterUrl);
    const runtime = info.runtimeMin ? `${Math.floor(info.runtimeMin / 60)}h ${info.runtimeMin % 60}m` : "";
    return [
      { label: "Year", value: info.year },
      { label: "Rating", value: info.rating !== null ? `★ ${info.rating} / 10 · ${info.votes.toLocaleString()} votes` : "" },
      { label: "Genre", value: info.genres.join(", ") },
      { label: info.kind === "tv" ? "Episode" : "Runtime", value: runtime },
      { label: "Seasons", value: info.seasons ? `${info.seasons} · ${info.episodes ?? "?"} episodes` : "" },
      { label: "Details", value: [info.tagline, info.overview].filter(Boolean).join("\n") },
      { label: "Source", value: info.source },
    ];
  };

  /** Information (TMDB) and downloads for a Jellyfin row. */
  const jfOptions = (item: JfItem): PopupOption[] => {
    const isShow = ["Series", "Season", "Episode"].includes(item.type);
    const opts: PopupOption[] = [];
    if (["Movie", "Series", "Season", "Episode", "Video"].includes(item.type)) {
      opts.push({
        label: "Information",
        run: () =>
          showInfo(item.name, item.imageUrl, null, [{ label: "Sub-Title", value: [item.type, item.year].filter(Boolean).join(" · ") }, { label: "Details", value: item.overview ?? "" }], async () => {
            const title = item.seriesName ?? item.name;
            const info = await window.axm.getScreenInfo(title, item.year ?? "", isShow ? "tv" : item.type === "Movie" ? "movie" : "auto", item.type === "Movie" || item.type === "Series" ? item.tmdbId : undefined);
            return screenRows(info);
          }),
      });
    }
    if (item.streamUrl && jf.login) {
      const login = jf.login;
      const kind = item.type === "Audio" ? "music" : "video";
      const folder = kind === "music" ? "MUSIC" : "VIDEO";
      opts.push({
        label: "Download to this PC",
        hint: kind === "music" ? "Music" : "Videos",
        run: () => void window.axm.jellyfinDownload(login, item.id, item.name, kind, "home", item.container ?? "mkv").catch((e) => console.error(e)),
      });
      for (const v of volumes) {
        if (v.system) continue;
        opts.push({
          label: `Download to ${v.label} (${v.drive})`,
          hint: `${folder} · ${fmtBytes(v.freeBytes)} free`,
          run: () => void window.axm.jellyfinDownload(login, item.id, item.name, kind, v.drive, item.container ?? "mkv").catch((e) => console.error(e)),
        });
      }
    }
    return opts;
  };

  /** True if B was consumed by stepping back inside Jellyfin. */
  const jfBack = (): boolean => {
    if (!jf.active) return false;
    if (jf.view === "items") {
      jf.stack.pop();
      if (jf.stack.length === 0) jf.view = "libraries";
      jfRefresh();
      return true;
    }
    if (jf.view === "libraries") {
      jf.view = "servers";
      jf.login = null;
      jfRefresh();
      return true;
    }
    jf.active = false;
    jf.status = "";
    jfRefresh();
    return true;
  };

  const jfHint = (): string => {
    if (jf.view === "servers") return "Jellyfin";
    if (jf.view === "libraries") return `Jellyfin · ${jf.login?.serverName ?? ""}`;
    return `Jellyfin · ${jf.stack.map((s) => s.name).join(" › ")}`;
  };

  /**
   * TV Streaming: an Xtream Codes provider, shown as an app inside the Video
   * column. The renderer never holds the password - it asks the main process for a
   * playable URL when something is chosen, and gets one back.
   *
   * Live channels are HLS, which Chromium cannot play natively, so they go to the
   * media viewer with the hls flag that already exists for exactly this.
   */
  const tv = {
    active: false,
    view: "root" as "root" | "categories" | "items" | "episodes",
    kind: "live" as TvKind,
    status: null as TvStatus | null,
    categories: [] as TvCategory[],
    items: [] as TvItem[],
    categoryName: "",
    busy: false,
    show: null as TvItem | null,
    episodes: [] as TvEpisode[],
  };

  const tvRefresh = () => {
    xmb.enterLevel("video", `tv:${tv.view}:${tv.kind}:${tv.categoryName}`);
    xmb.refresh();
  };

  const tvSignIn = async () => {
    const values = await askText("TV Streaming Sign In", [
      { label: "Portal address", value: tv.status?.configured ? "" : "http://" },
      { label: "Username", value: "" },
      { label: "Password", value: "" },
    ]);
    if (!values || values.length < 3 || !values[0] || !values[1]) return;
    tv.busy = true;
    tvRefresh();
    tv.status = await window.axm.tvLogin({ url: values[0], username: values[1], password: values[2] });
    tv.busy = false;
    notifier.push(tv.status.message, "general");
    tvRefresh();
  };

  const tvOpenKind = async (kind: TvKind) => {
    tv.kind = kind;
    tv.busy = true;
    tv.view = "categories";
    tvRefresh();
    tv.categories = await window.axm.tvCategories(kind, tvAdultUnlocked).catch(() => []);
    tv.busy = false;
    tvRefresh();
  };

  const tvOpenCategory = async (category: TvCategory) => {
    tv.categoryName = category.name;
    tv.busy = true;
    tv.view = "items";
    tvRefresh();
    tv.items = await window.axm.tvItems(tv.kind, category.id, tvAdultUnlocked).catch(() => []);
    tv.busy = false;
    tvRefresh();
  };

  const tvOpenShow = async (item: TvItem) => {
    tv.busy = true;
    tvRefresh();
    tv.episodes = await window.axm.tvEpisodes(item.id).catch(() => [] as TvEpisode[]);
    tv.show = item;
    tv.view = "episodes";
    tv.busy = false;
    xmb.resetSelection("video");
    tvRefresh();
  };
  /** Films and episodes play straight from the portal; if the browser can't, the same stream is relayed with a player's User-Agent. */
  let tvRelayTried = "";
  const tvPlayUrl = (name: string, url: string, hls: boolean, art?: string, subs?: { title: string; year?: string; kind: "movie" | "tv"; season?: number; episode?: number }) => {
    musicPlayer.stop();
    audio.fadeOutAmbient(400);
    videoArt = { title: name, art };
    tvRelayTried = "";
    mediaViewer.open("video", { kind: "file", name, filePath: url, url, hls }, []);
    pushOverlay((action) => mediaViewer.handle(action as Parameters<MediaViewer["handle"]>[0]));
    if (subs) void fetchSubtitles(subs, url);
  };
  mediaViewer.setAudioLanguage(settings.audioLanguage || "en");
  mediaViewer.setOnVideoError((entry) => {
    if (!/^https?:\/\//.test(entry.url ?? "") || entry.hls || tvRelayTried === entry.filePath) return;
    tvRelayTried = entry.filePath;
    void window.axm.tvRelayUrl(entry.filePath).then((relay) => {
      if (!relay) return;
      notifier.push(`Retrying ${entry.name} through the relay`, "general");
      mediaViewer.replaceSource(relay);
    });
  });
  const tvPlay = async (item: TvItem) => {
    if (item.kind === "series") {
      await tvOpenShow(item);
      return;
    }
    const url = await window.axm.tvStreamUrl(item).catch(() => null);
    if (!url) {
      notifier.push(`${item.name} has no playable stream`, "general");
      return;
    }
    // Live is a playlist; a film is a plain file the portal serves directly.
    // Portals name films "Title (2019)"; the year helps SubDL pick the right one.
    const m = item.name.replace(/^[A-Z]{2,3}\s*[-|:]\s*/, "").match(/^(.*?)\s*\((\d{4})\)\s*$/);
    tvPlayUrl(item.name, url, item.kind === "live", item.icon, item.kind === "movie" ? { title: m?.[1] ?? item.name, year: m?.[2], kind: "movie" } : undefined);
  };
  const tvPlayEpisode = async (ep: TvEpisode) => {
    const url = await window.axm.tvEpisodeUrl(ep).catch(() => null);
    if (!url) return;
    tvPlayUrl(`${tv.show?.name ?? ""} · S${ep.season} E${ep.episode} ${ep.title}`.trim(), url, false, tv.show?.icon, tv.show ? { title: tv.show.name.replace(/^[A-Z]{2,3}\s*[-|:]\s*/, "").replace(/\s*\(\d{4}\)\s*$/, ""), kind: "tv", season: ep.season, episode: ep.episode } : undefined);
  };
  /** Y on a film or episode: save it to a drive's VIDEO folder, space permitting. */
  const tvDownloadOptions = (name: string, urlOf: () => Promise<string | null>, container: string) => {
    void refreshVolumes().then(() =>
      showOptions(name, [
        {
          label: "Download",
          hint: "into VIDEO on a drive; checked for space first",
          children: discTargets("Download", (target) => {
            void urlOf().then(async (url) => {
              if (!url) return notifier.push(`${name} has no stream to save`, "transfer");
              try {
                await window.axm.tvDownload(url, name, target, container);
              } catch (e) {
                notifier.push(String((e as Error).message ?? e), "transfer");
              }
            });
          }),
        },
        { label: "Play", run: () => void urlOf().then((u) => u && tvPlayUrl(name, u, false)) },
      ])
    );
  };

  const tvBack = (): boolean => {
    if (tv.view === "episodes") {
      tv.view = "items";
      tv.show = null;
      tvRefresh();
      return true;
    }
    if (tv.view === "items") {
      tv.view = "categories";
      tvRefresh();
      return true;
    }
    if (tv.view === "categories") {
      tv.view = "root";
      tvRefresh();
      return true;
    }
    tv.active = false;
    tvRefresh();
    return true;
  };

  const tvHint = (): string => {
    if (tv.view === "episodes") return `TV Streaming › ${tv.show?.name ?? "Series"}`;
    if (tv.view === "items") return `TV Streaming › ${tv.categoryName}`;
    if (tv.view === "categories") return `TV Streaming › ${tv.kind === "live" ? "Live TV" : tv.kind === "movie" ? "Movies" : "Series"}`;
    return tv.status?.connected ? `TV Streaming · ${tv.status.message}` : "TV Streaming";
  };

  const tvMenu = (): MenuItem[] => {
    if (tv.busy) return [{ id: "tv-busy", title: "Loading…", iconUrl: "assets/icons/tv-live.webp" }];

    if (tv.view === "categories") {
      if (tv.categories.length === 0) {
        return [{ id: "tv-none", title: "Nothing here", subtitle: "The service returned no categories", iconUrl: "assets/icons/tv-live.webp" }];
      }
      return tv.categories.map((c) => ({
        id: `tv-cat-${c.id}`,
        title: c.name,
        iconUrl: tv.kind === "live" ? "assets/icons/tv-live.webp" : tv.kind === "movie" ? "assets/icons/tv-movies.webp" : "assets/icons/tv-series.webp",
        onConfirm: () => void tvOpenCategory(c),
      }));
    }

    if (tv.view === "episodes") {
      if (tv.episodes.length === 0) return [{ id: "tv-noeps", title: "No episodes listed", subtitle: "The service returned nothing for this show", iconUrl: "assets/icons/tv-series.webp" }];
      return tv.episodes.map((ep) => ({
        id: `tv-ep-${ep.id}`,
        title: `S${ep.season} E${ep.episode} · ${ep.title}`,
        subtitle: ep.duration ? `${ep.duration}${ep.extension ? " · " + ep.extension : ""}` : ep.extension,
        iconUrl: tv.show?.icon || "assets/icons/tv-series.webp",
        iconGlyph: "TV",
        contextHint: "options",
        onConfirm: () => void tvPlayEpisode(ep),
        onContext: () => {
          tvDownloadOptions(`${tv.show?.name ?? ""} S${ep.season}E${String(ep.episode).padStart(2, "0")} ${ep.title}`.trim(), () => window.axm.tvEpisodeUrl(ep), ep.extension || "mp4");
          return true;
        },
      }));
    }
    if (tv.view === "items") {
      if (tv.items.length === 0) {
        return [{ id: "tv-empty", title: "Nothing in here", iconUrl: "assets/icons/tv-live.webp" }];
      }
      return tv.items.map((item) => ({
        id: `tv-item-${item.id}`,
        title: item.name,
        // The provider serves its own channel artwork; nothing is bundled.
        iconUrl: item.icon || (item.kind === "live" ? "assets/icons/tv-live.webp" : item.kind === "series" ? "assets/icons/tv-series.webp" : "assets/icons/tv-movies.webp"),
        iconGlyph: "TV",
        contextHint: item.kind === "movie" ? "options" : undefined,
        onConfirm: () => void tvPlay(item),
        onContext: item.kind === "movie" ? () => { tvDownloadOptions(item.name, () => window.axm.tvStreamUrl(item), item.extension || "mp4"); return true; } : undefined,
      }));
    }

    if (!tv.status?.configured) {
      return [{
        id: "tv-signin",
        title: "Sign In",
        subtitle: "Portal address, username and password from your provider",
        iconUrl: "assets/icons/tv-live.webp",
        onConfirm: () => void tvSignIn(),
      }];
    }

    return [
      { id: "tv-live", title: "Live TV", subtitle: "Channels", iconUrl: "assets/icons/tv-live.webp", onConfirm: () => void tvOpenKind("live") },
      { id: "tv-movies", title: "Movies", iconUrl: "assets/icons/tv-movies.webp", onConfirm: () => void tvOpenKind("movie") },
      { id: "tv-series", title: "Series", iconUrl: "assets/icons/tv-series.webp", onConfirm: () => void tvOpenKind("series") },
      ...(settings.tvAdultBlocked
        ? [{ id: "tv-adult", title: "Adult Content", subtitle: tvAdultUnlocked ? "Unlocked until A-X-M closes · press to lock again" : "Locked · enter the PIN to show it this once", iconUrl: "assets/icons/tv-epg.webp", onConfirm: async () => { if (tvAdultUnlocked) { tvAdultUnlocked = false; tv.categories = []; tv.items = []; xmb.refresh(); return; } if (await askPin("Adult Content")) { tvAdultUnlocked = true; tv.categories = []; tv.items = []; notifier.push("Adult content shown until A-X-M closes", "general"); xmb.refresh(); } } }]
        : []),
      { id: "tv-settings-hint", title: "Languages and Filters", subtitle: `${settings.tvEnglishOnly ? "English only" : "All languages"}${Object.keys(settings.tvLanguageOverrides ?? {}).length ? ` · ${Object.keys(settings.tvLanguageOverrides).length} overridden` : ""} · Settings › TV Streaming`, iconUrl: "assets/icons/tv-epg.webp", onConfirm: () => notifier.push("Languages, adult PIN, subtitles and audio are in Settings › TV Streaming", "general") },
      { id: "tv-account", title: "Account", subtitle: tv.status.message, iconUrl: "assets/icons/tv-epg.webp", onConfirm: () => void tvSignIn() },
    ];
  };

  /** Adult rows are shown only after the PIN, and only until the app closes. */
  let tvAdultUnlocked = false;
  const askPin = async (title: string): Promise<boolean> => {
    if (!settings.tvPin) return true;
    const a = await askText(title, [{ label: "PIN", value: "", secret: true }]);
    if (!a) return false;
    if (a[0].trim() === settings.tvPin) return true;
    notifier.push("That PIN isn't right", "general");
    return false;
  };

  const tvEntry: MenuItem = {
    id: "tv-streaming",
    title: "TV Streaming",
    subtitle: tv.status?.connected ? tv.status.message : "Live TV, films and series from your provider",
    iconUrl: "assets/icons/tv-live.webp",
    onConfirm: async () => {
      tv.active = true;
      tv.view = "root";
      tvRefresh();
      if (!tv.status) {
        tv.busy = true;
        tvRefresh();
        tv.status = await window.axm.tvStatus().catch(() => null);
        tv.busy = false;
        tvRefresh();
      }
    },
  };

  const jellyfinEntry: MenuItem = {
    id: "jellyfin",
    title: "Jellyfin",
    subtitle: (() => {
      const logins = Object.values(settings.jellyfinLogins);
      return logins.length > 0 ? `Signed in to ${logins.map((l) => l.serverName).join(", ")}` : "Media server";
    })(),
    iconUrl: "assets/icons/jellyfin.svg",
    onConfirm: () => {
      jf.active = true;
      jf.view = "servers";
      jfRefresh();
      if (jf.servers.length === 0) void jfDiscover();
    },
  };

  // ---- Settings, with the Theme sub-views ------------------------------------------

  type SettingsView = "root" | "theme" | "months" | "system" | "controller" | "about" | "display" | "audio" | "sys" | "network" | "datetime" | "power" | "chat" | "notify" | "dictionary" | "assistant" | "toybox" | "companion" | "tv" | "tvlang" | { month: number };
  /** Which group each root row files under; anything unlisted stays at the top level. */
  const SETTINGS_GROUPS: Record<string, "display" | "audio" | "sys" | "theme" | "tv"> = {
    windowMode: "display", renderResolution: "display", menuUpscaling: "display", targetHz: "display", backgroundQuality: "display",
    fpsCounter: "display", hardwareInfo: "display", batteryPercent: "display",
    musicVolume: "audio", ambientTrack: "audio", importFormat: "audio", trophies: "sys", discTools: "sys", installTools: "sys", discTarget: "sys", makemkvKey: "sys", subtitles: "tv", subdlKey: "tv", lyrics: "audio", apolloDb: "sys", sfxVolume: "audio", navSounds: "audio", musicShuffle: "audio", addMusicFolder: "audio",
    "system-info": "sys", controller: "sys", "system-name": "sys", "system-language": "sys", datetime: "sys", powersave: "sys", chat: "sys", notifications: "sys", dictionary: "sys", steamHandsOff: "sys", steamInstallDrive: "sys", overlayHotkey: "sys", addFolder: "sys", rescan: "sys",
    "saved-data-utility": "sys", "game-data-utility": "sys", "steam-library": "sys",
    wallpaper: "theme", introSparkle: "theme",
  };

  /**
   * Companion Devices. The pairing code is not requested from here - it appears by
   * itself the moment a phone says hello, because that is when the host generates
   * one. This screen exists to show that A-X-M is listening, on which address, and
   * to forget a device.
   */
  let companionState: CompanionStatus | null = null;
  const refreshCompanion = async () => {
    companionState = await window.axm.companionStatus().catch(() => null);
    xmb.refresh();
  };

  const companionRows = (): MenuItem[] => {
    const state = companionState;
    if (!state) return [{ id: "companion-loading", title: "Loading…", iconGlyph: "▤" }];

    const rows: MenuItem[] = [
      {
        id: "companion-enabled",
        title: "Companion",
        subtitle: state.enabled
          ? state.running
            ? `Listening on ${state.addresses[0] ?? "this machine"}`
            : "On, but the network port could not be opened"
          : "Off",
        iconGlyph: "▤",
        onConfirm: async () => {
          await window.axm.companionSetEnabled(!state.enabled);
          await refreshCompanion();
        },
      },
      {
        id: "companion-saves",
        title: "Memory Card Saves on the Phone",
        subtitle: settings.memcardSyncToPhone ? "On · the phone keeps a copy of every save and refreshes it as they change" : "Off · copies go over only when you send one",
        iconUrl: "assets/icons/memcard-utility.webp",
        onConfirm: async () => { settings = await window.axm.setSettings({ memcardSyncToPhone: !settings.memcardSyncToPhone }); window.axm.memcardsChanged(); xmb.refresh(); },
      },
      {
        id: "companion-howto",
        title: "How to pair",
        subtitle: "Open A-X-M Companion on your phone, on this Wi-Fi, and tap this machine",
        iconGlyph: "?",
        onConfirm: () =>
          showInfo("Pair your phone", undefined, null, [
            { label: "1", value: "Put the phone on the same Wi-Fi as this machine" },
            { label: "2", value: "Open A-X-M Companion and tap this machine in the list" },
            { label: "3", value: "A four digit code appears here; type it on the phone" },
            { label: "Address", value: state.addresses.join(", ") || "no network found" },
          ]),
      },
    ];

    for (const device of state.trusted) {
      const live = state.sessions.find((x: CompanionSession) => x.deviceId === device.deviceId && x.paired);
      rows.push({
        id: `companion-device-${device.deviceId}`,
        title: device.name,
        subtitle: live ? `Connected · ${live.address}` : `Paired · last seen ${fmtWhen(device.lastSeenAt)}`,
        iconGlyph: live ? "●" : "○",
        contextHint: "forget",
        onContext: () => {
          void showOptions(device.name, [
            {
              label: "Forget this device",
              hint: "It will have to pair again",
              run: async () => {
                await window.axm.companionForget(device.deviceId);
                await refreshCompanion();
              },
            },
          ]);
          return true;
        },
      });
    }

    if (state.trusted.length === 0) {
      rows.push({
        id: "companion-none",
        title: "No devices paired yet",
        subtitle: "Your phone will appear here once it has paired",
        iconGlyph: "○",
      });
    }
    return rows;
  };

  function settingsCategory(): Category {
    let view: SettingsView = "root";

    /**
     * Identifies the settings level for the cursor memory. Network has a sub-view of
     * its own, so it contributes too - otherwise coming back from Wi-Fi would look
     * like the same level as Network itself and land on the wrong row.
     */
    const settingsLevelKey = (): string => {
      // The month editor is a view per month, so each remembers its own row.
      if (typeof view === "object") return `month:${view.month}`;
      return view === "network" ? `network:${netView}` : view;
    };

    const go = (next: SettingsView) => {
      view = next;
      xmb.enterLevel("settings", settingsLevelKey());
      xmb.refresh();
    };

    const save = async (partial: Partial<Settings>) => {
      settings = await window.axm.setSettings(partial);
      applyTheme();
      xmb.refresh();
    };

    const cycleIdx = () => {
      const i = WAVE_CYCLE_PRESETS.indexOf(settings.waveColorCycleSeconds);
      return i === -1 ? 2 : i;
    };
    const volumeIdx = (value: number) => {
      const i = VOLUME_PRESETS.findIndex((v) => Math.abs(v - value) < 0.01);
      return i === -1 ? 2 : i;
    };

    /**
     * Which MonthTheme the ribbon controls in the Theme view edit. In monthly mode
     * that's this month's entry (so a tweak shows immediately); fixed and image
     * modes share the single fixed entry.
     */
    const themeTarget = (): { theme: MonthTheme; write: (t: MonthTheme) => Partial<Settings> } => {
      if (settings.themeMode === "monthly") {
        const month = currentMonthIndex();
        return {
          theme: settings.monthlyThemes[month],
          write: (t) => {
            const monthlyThemes = settings.monthlyThemes.map((m, i) => (i === month ? t : m));
            return { monthlyThemes };
          },
        };
      }
      return { theme: settings.fixedTheme, write: (t) => ({ fixedTheme: t }) };
    };

    const monthTarget = (month: number): { theme: MonthTheme; write: (t: MonthTheme) => Partial<Settings> } => ({
      theme: settings.monthlyThemes[month],
      write: (t) => ({ monthlyThemes: settings.monthlyThemes.map((m, i) => (i === month ? t : m)) }),
    });

    /** The four per-theme controls, shared by the Theme view and each month editor. */
    const ribbonControls = (
      target: () => { theme: MonthTheme; write: (t: MonthTheme) => Partial<Settings> },
      idPrefix: string,
      includeBackground: boolean
    ): MenuItem[] => {
      const items: MenuItem[] = [
        {
          id: `${idPrefix}-speed`,
          title: "Ribbon Speed",
          subtitle: `${target().theme.ribbonSpeed.toFixed(2)}×`,
          iconGlyph: "»",
          onConfirm: () => {
            const { theme, write } = target();
            return save(write({ ...theme, ribbonSpeed: nextPreset(RIBBON_SPEED_PRESETS, theme.ribbonSpeed) }));
          },
        },
        {
          id: `${idPrefix}-width`,
          title: "Ribbon Width",
          subtitle: `${target().theme.ribbonWidth.toFixed(1)}×`,
          iconGlyph: "≡",
          onConfirm: () => {
            const { theme, write } = target();
            return save(write({ ...theme, ribbonWidth: nextPreset(RIBBON_WIDTH_PRESETS, theme.ribbonWidth) }));
          },
        },
      ];
      if (includeBackground) {
        // The PS3's Colour picker: a swatch column on the right, the background
        // fading to each colour as you move over it, "Original" being the month's own.
        items.push({
          id: `${idPrefix}-colour`,
          title: "Colour",
          subtitle: (() => {
            const hex = target().theme.backgroundColor.toUpperCase();
            const hit = THEME_COLOURS.find((c) => colourFor(c.hex).backgroundColor.toUpperCase() === hex);
            return `${hit ? hit.name : "Original"} · sets the colour of the background and options menu`;
          })(),
          iconGlyph: "■",
          onConfirm: () => {
            const { theme, write } = target();
            const before = { ...theme };
            const preview = (t: MonthTheme) => {
              ribbon.setColor(t.ribbonColor);
              ribbon.setBackdrop("static", [t.backgroundColor, darkenHex(t.backgroundColor, 0.72)]);
            };
            const monthOriginal = DEFAULT_MONTH_THEMES[settings.themeMode === "monthly" ? currentMonthIndex() : 0];
            showOptions(
              "Colour",
              [
                { label: "Original", swatch: monthOriginal.backgroundColor, selected: theme.backgroundColor === monthOriginal.backgroundColor, preview: () => preview({ ...theme, ...monthOriginal }), run: () => save(write({ ...theme, ribbonColor: monthOriginal.ribbonColor, backgroundColor: monthOriginal.backgroundColor })) },
                ...THEME_COLOURS.map((c) => {
                  const t = { ...theme, ...colourFor(c.hex) };
                  return { label: c.name, swatch: c.hex, selected: theme.backgroundColor.toUpperCase() === t.backgroundColor.toUpperCase(), preview: () => preview(t), run: () => save(write(t)) };
                }),
              ],
              () => preview(before)
            );
          },
        });
      }
      return items;
    };

    /** A PS3 tint as a theme: bright backdrop, pale ribbon of the same hue. */
    const colourFor = (hex: string): { ribbonColor: string; backgroundColor: string } => ({ backgroundColor: hex, ribbonColor: lightenHex(hex, 0.78) });
    const darkenHex = (hex: string, k: number): string => mixHex(hex, "#000000", k);
    const lightenHex = (hex: string, k: number): string => mixHex(hex, "#ffffff", k);
    function mixHex(a: string, b: string, k: number): string {
      const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
      const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
      return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, "0")).join("");
    }

    // The root shows the groups; every original row still exists and is filed into
    // one of them (or stays at the top level, like Theme and About).
    const groupedRoot = (): MenuItem[] => {
      // Let Ghost know every settings row by name, and how to reach it.
      settingLabels.length = 0;
      for (const item of allRootItems()) {
        const group = SETTINGS_GROUPS[item.id];
        settingLabels.push({ name: item.title, go: () => { goCategory("settings"); if (group) go(group); else go("root"); xmb.refresh(); } });
      }
      for (const [name, v] of [["display settings", "display"], ["audio settings", "audio"], ["network settings", "network"], ["system settings", "sys"], ["assistant settings", "assistant"], ["toybox settings", "toybox"], ["tv settings", "tv"], ["theme settings", "theme"]] as const) {
        settingLabels.push({ name, go: () => { goCategory("settings"); if (v === "network") void netOpen(); else go(v as SettingsView); } });
      }
      const all = allRootItems();
      const groups: MenuItem[] = [
        { id: "group-display", title: "Display", subtitle: "Fullscreen, resolution, upscaling, refresh rate, readouts", iconUrl: "assets/icons/settings-display.webp", onConfirm: () => go("display") },
        { id: "group-audio", title: "Audio", subtitle: "Volumes, menu music, sounds, shuffle, music folders", iconUrl: "assets/icons/settings-audio.webp", onConfirm: () => go("audio") },
        { id: "group-network", title: "Network", subtitle: "Connection status, Wi-Fi, connection test, media server, Bluetooth", iconUrl: "assets/icons/network-settings.webp", onConfirm: () => { void netOpen(); } },
        { id: "group-sys", title: "System", subtitle: "System information, controller, Steam, game folders, in-game menu", iconUrl: "assets/icons/settings-system.webp", onConfirm: () => go("sys") },
        {
          id: "group-companion",
          title: "Companion Devices",
          subtitle: companionState
            ? companionState.sessions.some((x: CompanionSession) => x.paired)
              ? `${companionState.sessions.filter((x: CompanionSession) => x.paired).length} connected`
              : companionState.trusted.length > 0
                ? `${companionState.trusted.length} paired · none connected`
                : "Pair your phone with A-X-M"
            : "Pair your phone with A-X-M",
          iconGlyph: "▤",
          onConfirm: () => {
            void refreshCompanion();
            go("companion");
          },
        },
        { id: "group-tv", title: "TV Streaming", subtitle: `${settings.tvEnglishOnly ? "English only" : "All languages"} · adult content ${settings.tvAdultBlocked ? "behind a PIN" : "shown"} · subtitles ${settings.subtitles?.enabled ? settings.subtitles.language : "off"} · audio ${(settings.audioLanguage || "en").toUpperCase()}`, iconUrl: "assets/icons/tv-epg.webp", onConfirm: () => go("tv") },
        { id: "group-assistant", title: "Assistant", subtitle: settings.assistant.enabled ? 'Ghost is on · say "hey ghost"' : "Ghost, the voice assistant · off", iconUrl: "assets/icons/settings-assistant.png", onConfirm: () => go("assistant") },
        { id: "group-toybox", title: "Toybox", subtitle: "What Ghost does when a toy is scanned, readers, the companion app", iconUrl: "assets/icons/toybox.webp", onConfirm: () => go("toybox") },
      ];
      const top = all.filter((i) => !SETTINGS_GROUPS[i.id]);
      // Theme first, then the groups, then whatever else is unfiled (About, Exit).
      const theme = top.filter((i) => i.id === "theme");
      const rest = top.filter((i) => i.id !== "theme");
      return [updateRow(), ...theme, ...groups, ...rest];
    };

    // System Update: at the top, the way the PS3 kept it. Checks GitHub's releases.
    let update: UpdateInfo | null = null;
    let updateFile: string | null = null;
    const updateRow = (): MenuItem => ({
      id: "system-update",
      title: "System Update",
      subtitle: update
        ? update.error
          ? `Version ${update.current} · ${update.error}`
          : update.newer
            ? `${update.latest} is available · you have ${update.current}`
            : `Up to date · ${update.current}`
        : `Version ${settings.systemName ? "" : ""}${update === null ? "A to check for updates" : ""}`,
      iconUrl: "assets/icons/system-update.webp",
      badge: update?.newer ? "UPDATE" : undefined,
      onConfirm: async () => {
        if (update?.newer && update.assetUrl && update.assetName) {
          showOptions(`A-X-M ${update.latest}`, [
            {
              label: updateFile ? "Install now" : "Download and install",
              hint: update.assetName,
              run: async () => {
                try {
                  if (!updateFile) {
                    notifier.push(`Downloading A-X-M ${update!.latest}…`);
                    updateFile = await window.axm.downloadUpdate(update!.assetUrl!, update!.assetName!);
                  }
                  showOptions("Install the update?", [{ label: "Yes, close and install", run: () => void window.axm.openUpdate(updateFile!) }, { label: "Later" }]);
                } catch (e) {
                  notifier.push(`Update: ${String((e as Error).message ?? e)}`);
                }
              },
            },
            { label: "Release notes", run: () => showText(`A-X-M ${update!.latest}`, update!.notes.split(/\r?\n\r?\n/).filter(Boolean)) },
            { label: "Not now" },
          ]);
          return;
        }
        notifier.push("Checking for updates…");
        update = await window.axm.checkForUpdate();
        notifier.push(update.error ? `Update check: ${update.error}` : update.newer ? `A-X-M ${update.latest} is available` : "A-X-M is up to date");
        xmb.refresh();
      },
    });

    const allRootItems = (): MenuItem[] => [
      {
        id: "theme",
        title: "Theme",
        subtitle: THEME_MODE_LABELS[settings.themeMode],
        iconUrl: "assets/icons/settings-theme.webp",
        onConfirm: () => go("theme"),
      },
      {
        id: "windowMode",
        title: "Display Mode",
        subtitle: settings.windowed ? "Windowed" : "Fullscreen",
        iconGlyph: "▢",
        onConfirm: async () => {
          settings = await window.axm.toggleFullscreen();
          xmb.refresh();
        },
      },
      {
        id: "backgroundQuality",
        title: "Background Quality",
        subtitle:
          settings.backgroundQuality === "auto"
            ? `Auto (${ribbon.activeQuality()})`
            : QUALITY_LABELS[settings.backgroundQuality],
        iconGlyph: "◈",
        onConfirm: async () => {
          const i = QUALITY_PRESETS.indexOf(settings.backgroundQuality);
          const next = QUALITY_PRESETS[(i + 1) % QUALITY_PRESETS.length];
          settings = await window.axm.setSettings({ backgroundQuality: next });
          ribbon.setQuality(next);
          xmb.refresh();
        },
      },
      {
        id: "musicVolume",
        title: "Music Volume",
        subtitle: `${Math.round(settings.musicVolume * 100)}%`,
        iconGlyph: "♪",
        onConfirm: async () => {
          const next = VOLUME_PRESETS[(volumeIdx(settings.musicVolume) + 1) % VOLUME_PRESETS.length];
          settings = await window.axm.setSettings({ musicVolume: next });
          audio.setVolumes(settings.musicVolume, settings.sfxVolume);
          musicPlayer.setVolume(settings.musicVolume);
          xmb.refresh();
        },
      },
      {
        id: "ambientTrack",
        title: "Menu Music",
        subtitle: settings.menuMusicEnabled ? AMBIENT_TRACKS[settings.ambientTrack].label : "Off",
        iconUrl: "assets/icons/music.png",
        onConfirm: async () => {
          // One row cycles through each loop and then Off: the chosen track survives
          // being switched off, so turning it back on resumes the same one.
          if (!settings.menuMusicEnabled) {
            settings = await window.axm.setSettings({ menuMusicEnabled: true });
            audio.setAmbientEnabled(true);
          } else {
            const i = AMBIENT_TRACK_IDS.indexOf(settings.ambientTrack);
            if (i >= AMBIENT_TRACK_IDS.length - 1) {
              settings = await window.axm.setSettings({ menuMusicEnabled: false });
              audio.setAmbientEnabled(false);
            } else {
              settings = await window.axm.setSettings({ ambientTrack: AMBIENT_TRACK_IDS[i + 1] });
              audio.setAmbientTrack(settings.ambientTrack);
            }
          }
          xmb.refresh();
        },
      },
      {
        id: "sfxVolume",
        title: "Menu Sound Volume",
        subtitle: `${Math.round(settings.sfxVolume * 100)}%`,
        iconGlyph: "♫",
        onConfirm: async () => {
          const next = VOLUME_PRESETS[(volumeIdx(settings.sfxVolume) + 1) % VOLUME_PRESETS.length];
          settings = await window.axm.setSettings({ sfxVolume: next });
          audio.setVolumes(settings.musicVolume, settings.sfxVolume);
          xmb.refresh();
        },
      },
      {
        id: "navSounds",
        title: "Navigation Sounds",
        subtitle: settings.navSoundsEnabled ? "On" : "Off",
        iconGlyph: "♫",
        onConfirm: async () => {
          settings = await window.axm.setSettings({ navSoundsEnabled: !settings.navSoundsEnabled });
          audio.setSfxEnabled(settings.navSoundsEnabled);
          xmb.refresh();
        },
      },
      {
        id: "system-name",
        title: "System Name",
        subtitle: settings.systemName || sysHostName || "—",
        iconGlyph: "▣",
        onConfirm: async () => {
          const answers = await askText("System Name", [{ label: "Name", value: settings.systemName || sysHostName }]);
          if (!answers?.[0]) return;
          settings = await window.axm.setSettings({ systemName: answers[0].trim() });
          notifier.push(`System name is now ${settings.systemName}`);
          xmb.refresh();
        },
      },
      {
        id: "system-language",
        title: "System Language",
        subtitle: "English · more languages are on the roadmap",
        iconGlyph: "A",
      },
      {
        id: "datetime",
        title: "Date and Time Settings",
        subtitle: new Date().toLocaleString([], { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: !settings.clock24h }),
        iconGlyph: "◷",
        onConfirm: async () => {
          clock = await window.axm.getClock().catch(() => null);
          go("datetime");
        },
      },
      {
        id: "powersave",
        title: "Power Save Settings",
        subtitle: "Power plan, screen off, sleep, menu dimming",
        iconUrl: "assets/icons/power.png",
        onConfirm: async () => {
          power = await window.axm.getPowerSettings().catch(() => null);
          go("power");
        },
      },
      {
        id: "chat",
        title: "Chat Settings",
        subtitle: "Audio output and microphone for the menu",
        iconGlyph: "◉",
        onConfirm: async () => {
          await refreshAudioDevices();
          go("chat");
        },
      },
      {
        id: "notifications",
        title: "Notification Settings",
        subtitle: settings.notifications.enabled ? "Display" : "Off",
        iconGlyph: "▤",
        onConfirm: () => go("notify"),
      },
      {
        id: "trophies",
        title: "Trophies",
        subtitle: `Steam key ${settings.steamWebApiKey ? "set" : "not set"} · RetroAchievements ${settings.raUsername ? settings.raUsername : "not signed in"}`,
        iconUrl: "assets/icons/trophy.webp",
        onConfirm: () =>
          showOptions("Trophies", [
            {
              label: "Steam Web API Key…",
              hint: "steamcommunity.com/dev/apikey",
              run: async () => {
                const answers = await askText("Steam Web API Key", [{ label: "Key", value: settings.steamWebApiKey, secret: true }]);
                if (!answers) return;
                settings = await window.axm.setSettings({ steamWebApiKey: answers[0].trim() });
                xmb.refresh();
              },
            },
            {
              label: "RetroAchievements Sign-in…",
              hint: "username + web API key",
              run: async () => {
                const answers = await askText("RetroAchievements", [{ label: "Username", value: settings.raUsername }, { label: "Web API key", secret: true }]);
                if (!answers?.[0] || !answers[1]) return;
                const res = await window.axm.raVerify(answers[0], answers[1]);
                notifier.push(res.message);
                if (res.ok) settings = await window.axm.setSettings({ raUsername: answers[0], raApiKey: answers[1] });
                xmb.refresh();
              },
            },
          ]),
      },
      {
        id: "installTools",
        title: "Install Tools",
        subtitle: toolsSummary,
        iconGlyph: "⇩",
        onConfirm: async () => {
          const state = await window.axm.toolsState();
          const missing = state.filter((t) => !t.installed);
          showOptions("Install Tools", [
            ...(missing.length
              ? [{ label: `Install ${missing.map((t) => t.name).join(", ")}`, hint: "winget on Windows · the voice engine is a few GB", run: runToolsInstall }]
              : [{ label: "Everything is installed" }]),
            ...state.map((t) => ({ label: `${t.installed ? "✓" : "✕"} ${t.name}`, hint: t.detail })),
          ]);
        },
      },
      {
        id: "discTarget",
        title: "Disc Backup Location",
        subtitle: `${targetLabel(settings.discTarget)} · rips, CD imports and Ghost's "copy the disc" go here`,
        iconUrl: "assets/icons/disc-dvd.webp",
        onConfirm: async () => {
          await refreshVolumes();
          showOptions("Disc Backup Location", [
            { label: "This PC", hint: "VIDEO and MUSIC in your user folder", selected: settings.discTarget === "home", run: async () => { settings = await window.axm.setSettings({ discTarget: "home" }); xmb.refresh(); } },
            ...volumes.filter((v) => !v.system).map((v) => ({ label: `${v.label} (${v.drive})`, hint: `${fmtBytes(v.freeBytes)} free`, selected: settings.discTarget === v.drive, run: async () => { settings = await window.axm.setSettings({ discTarget: v.drive }); xmb.refresh(); } })),
          ]);
        },
      },
      {
        id: "makemkvKey",
        title: "MakeMKV Key",
        subtitle: settings.makemkvKey ? `Set · ${settings.makemkvKey.slice(0, 6)}… · Blu-ray reading is licensed by MakeMKV` : "Not set · the beta key is posted on makemkv.com's forum; Blu-rays need it",
        iconUrl: "assets/icons/disc-bluray.webp",
        onConfirm: async () => {
          const answers = await askText("MakeMKV Key", [{ label: "Key", value: settings.makemkvKey, secret: true }]);
          if (!answers) return;
          settings = await window.axm.setSettings({ makemkvKey: answers[0].trim() });
          xmb.refresh();
        },
      },
      {
        id: "subtitles",
        title: "Subtitles",
        subtitle: settings.subtitles?.enabled ? `On · ${settings.subtitles.language} · fetched from SubDL for Jellyfin and TV Streaming films and episodes` : "Off · videos play without subtitles",
        iconUrl: "assets/icons/tv-epg.webp",
        onConfirm: async () => {
          showOptions("Subtitles", [
            { label: settings.subtitles?.enabled ? "Turn off" : "Turn on", hint: "Auto-download and show subtitles when a film or episode starts", run: async () => { settings = await window.axm.setSettings({ subtitles: { ...settings.subtitles, enabled: !settings.subtitles?.enabled } }); xmb.refresh(); } },
            ...(["EN", "ES", "FR", "DE", "IT", "PT", "NL", "JA"] as const).map((lang) => ({ label: lang, selected: settings.subtitles?.language === lang, run: async () => { settings = await window.axm.setSettings({ subtitles: { enabled: settings.subtitles?.enabled ?? true, language: lang } }); xmb.refresh(); } })),
          ]);
        },
      },
      {
        id: "subdlKey",
        title: "SubDL Key",
        subtitle: settings.subdlApiKey ? `Set · ${settings.subdlApiKey.slice(0, 10)}… · subtitles come from subdl.com` : "Not set · a free key from subdl.com › API; subtitles need it",
        iconUrl: "assets/icons/tv-epg.webp",
        onConfirm: async () => {
          const answers = await askText("SubDL Key", [{ label: "Key", value: settings.subdlApiKey, secret: true }]);
          if (!answers) return;
          settings = await window.axm.setSettings({ subdlApiKey: answers[0].trim() });
          xmb.refresh();
        },
      },
      {
        id: "lyrics",
        title: "Lyrics",
        subtitle: settings.lyricsEnabled ? "On · LRCLIB lyrics for the Karaoke visualizer" : "Off · the Karaoke visualizer shows the title only",
        iconUrl: "assets/icons/music.png",
        onConfirm: async () => {
          settings = await window.axm.setSettings({ lyricsEnabled: !settings.lyricsEnabled });
          xmb.refresh();
        },
      },
      {
        id: "apolloDb",
        title: "Apollo Save Tool",
        subtitle: "Cheat and community save databases for the Memory Card Utility · update, auto-update, offline, location, cache",
        iconUrl: "assets/icons/memcard-utility.webp",
        onConfirm: () => showApolloDatabaseOptions({ showOptions, notify: (text, icon) => notifier.push(text, "general", icon), volumes: () => volumes }),
      },
      {
        id: "discTools",
        title: "Disc Tools",
        subtitle: "ffmpeg (CD import), HandBrakeCLI (DVD), MakeMKV (Blu-ray)",
        iconUrl: "assets/icons/disc-bluray.webp",
        onConfirm: async () => {
          const t = await window.axm.discTools();
          showInfo("Disc Tools", "assets/icons/disc-bluray.webp", null, [
            { label: "ffmpeg", value: t.ffmpeg ? `${t.ffmpeg}${t.ffmpegCdio ? " · libcdio: yes" : " · no libcdio - CD import needs the 'full' build"}` : "Not found · put ffmpeg.exe on PATH or in C:\\ffmpeg\\bin" },
            { label: "HandBrakeCLI", value: t.handbrake ?? "Not found · handbrake.fr › Downloads › Command Line, into C:\\Program Files\\HandBrake" },
            { label: "MakeMKV", value: t.makemkv ?? "Not found · makemkv.com, into C:\\Program Files (x86)\\MakeMKV" },
            { label: "Details", value: "The tools run headless from the menu; discs with copy protection need the tools' own decryption support (libdvdcss, AACS)." },
          ]);
        },
      },
      {
        id: "dictionary",
        title: "Predictive Text Dictionary",
        subtitle: `${settings.dictionaryTerms.length} terms · ${settings.learnedWords.length} learnt words`,
        iconGlyph: "Aa",
        onConfirm: () => go("dictionary"),
      },
      {
        id: "system-info",
        title: "System Information",
        subtitle: "Device, storage and free space",
        iconGlyph: "▤",
        onConfirm: async () => {
          sysHardware = await window.axm.getHardwareInfo().catch(() => null);
          await refreshVolumes();
          go("system");
        },
      },
      {
        id: "controller",
        title: "Controller",
        subtitle: "Profiles, dead zone, vibration, battery, players",
        iconUrl: "assets/icons/games.svg",
        onConfirm: async () => {
          controllerDevices = await window.axm.getControllerDevices().catch(() => []);
          go("controller");
        },
      },
      {
        id: "steamHandsOff",
        title: "Steam Hands-off Install",
        subtitle: settings.steamHandsOffInstall ? "On · confirms Steam's dialog and returns here" : "Off · Steam's install window stays up",
        iconUrl: "assets/icons/steam.svg",
        onConfirm: async () => {
          settings = await window.axm.setSettings({ steamHandsOffInstall: !settings.steamHandsOffInstall });
          xmb.refresh();
        },
      },
      {
        id: "wallpaper",
        title: "Wallpaper",
        subtitle: settings.wallpaper
          ? `${settings.wallpaper.mode === "shuffle" ? "Shuffling" : "Picture"} · ${settings.wallpaper.filePath.split("\\").pop()}`
          : "Off · pick one in Photo with Y",
        iconUrl: "assets/icons/photo.png",
        onConfirm: async () => {
          if (!settings.wallpaper) return;
          // Cycle: single -> shuffle -> off
          const w = settings.wallpaper;
          await setWallpaper(w.mode === "single" ? { ...w, mode: "shuffle" } : null);
        },
      },
      {
        id: "importFormat",
        title: "CD Import Format",
        subtitle: { mp3: "MP3 · 320 kbps", aac: "AAC · 256 kbps (M4A)", opus: "Opus · 160 kbps", flac: "FLAC · lossless" }[settings.importFormat],
        iconUrl: "assets/icons/disc-dvd.webp",
        onConfirm: () => showOptions("CD Import Format", (["mp3", "aac", "opus", "flac"] as const).map((f) => ({ label: f.toUpperCase(), selected: settings.importFormat === f, run: async () => { settings = await window.axm.setSettings({ importFormat: f }); xmb.refresh(); } }))),
      },
      {
        id: "musicShuffle",
        title: "Music Shuffle",
        subtitle: settings.musicShuffle ? "On · next track at random" : "Off · folder order",
        iconUrl: "assets/icons/music.png",
        onConfirm: async () => {
          settings = await window.axm.setSettings({ musicShuffle: !settings.musicShuffle });
          musicPlayer.setShuffle(settings.musicShuffle);
          xmb.refresh();
        },
      },
      {
        id: "introSparkle",
        title: "Welcome Sparkle",
        subtitle: settings.introSparkleEnabled ? "On · after the splash and a new profile" : "Off",
        iconGlyph: "✧",
        onConfirm: async () => {
          settings = await window.axm.setSettings({ introSparkleEnabled: !settings.introSparkleEnabled });
          if (settings.introSparkleEnabled) playIntroSparkle(document.body);
          xmb.refresh();
        },
      },
      {
        id: "renderResolution",
        title: "Menu Resolution",
        subtitle: (() => {
          const label = (h: number) => (h === 2160 ? "4K (2160p)" : `${h}p`);
          const native = resolution.nativeHeight ? ` · display ${resolution.nativeWidth}×${resolution.nativeHeight}` : "";
          return settings.renderResolution ? `${label(settings.renderResolution)}${native}` : `Auto · ${resolution.target ? label(resolution.target) : "native"}${native}`;
        })(),
        iconGlyph: "▭",
        onConfirm: async () => {
          // Auto -> 720p -> 800p -> ... up to the display's own height -> Auto.
          const steps = [0, 720, 800, 900, 1080, 1200, 1440, 1600, 2160].filter((h) => h === 0 || !resolution.nativeHeight || h <= resolution.nativeHeight);
          const next = steps[(steps.indexOf(settings.renderResolution) + 1) % steps.length];
          settings = await window.axm.setSettings({ renderResolution: next });
          xmb.refresh();
        },
      },
      {
        id: "menuUpscaling",
        title: "Menu Upscaling",
        subtitle: (() => {
          const label = { off: "Off · plain scaling", sharpen: "Sharpen · FSR-style contrast sharpening", "sharpen-strong": "Sharpen+ · stronger" }[settings.menuUpscaling];
          return `${label}${document.body.classList.contains("upscaled") ? "" : " · idle at native resolution"}`;
        })(),
        iconGlyph: "◈",
        onConfirm: async () => {
          const order = ["off", "sharpen", "sharpen-strong"] as const;
          const next = order[(order.indexOf(settings.menuUpscaling) + 1) % order.length];
          settings = await window.axm.setSettings({ menuUpscaling: next });
          applyUpscaling();
          xmb.refresh();
        },
      },
      {
        id: "targetHz",
        title: "Menu Refresh Rate",
        subtitle: settings.targetHz ? `${settings.targetHz} fps` : "Match display",
        iconGlyph: "⟳",
        onConfirm: async () => {
          // 60 -> 120 -> 144 -> display -> 60. The ribbon can't exceed the panel's
          // own refresh, so "144" on a 120 Hz screen simply runs uncapped.
          const steps = [60, 120, 144, 0];
          const next = steps[(steps.indexOf(settings.targetHz) + 1) % steps.length];
          settings = await window.axm.setSettings({ targetHz: next });
          ribbon.setMaxFps(next);
          xmb.refresh();
        },
      },
      {
        id: "fpsCounter",
        title: "FPS Counter",
        subtitle: settings.fpsCounterEnabled ? "Shown top-left" : "Hidden",
        iconGlyph: "▤",
        onConfirm: async () => {
          settings = await window.axm.setSettings({ fpsCounterEnabled: !settings.fpsCounterEnabled });
          hud.setFpsVisible(settings.fpsCounterEnabled);
          xmb.refresh();
        },
      },
      {
        id: "hardwareInfo",
        title: "Hardware Info",
        subtitle: settings.hardwareInfoEnabled ? "Shown bottom-left" : "Hidden",
        iconGlyph: "▦",
        onConfirm: async () => {
          settings = await window.axm.setSettings({ hardwareInfoEnabled: !settings.hardwareInfoEnabled });
          void hud.setHardwareVisible(settings.hardwareInfoEnabled);
          xmb.refresh();
        },
      },
      {
        id: "batteryPercent",
        title: "Battery Percentage",
        subtitle: settings.batteryPercentEnabled ? "Shown" : "Hidden",
        iconGlyph: "▮",
        onConfirm: async () => {
          settings = await window.axm.setSettings({ batteryPercentEnabled: !settings.batteryPercentEnabled });
          batteries.setPercentVisible(settings.batteryPercentEnabled);
          xmb.refresh();
        },
      },
      {
        id: "steamInstallDrive",
        title: "Steam Install Drive",
        subtitle: settings.steamInstallDrive ? `${settings.steamInstallDrive} · reminder at install` : "Let Steam decide",
        iconUrl: "assets/icons/steam.svg",
        onConfirm: async () => {
          // Cycle: none -> each drive that holds a Steam library -> none
          const drives = steamDrives();
          const i = drives.indexOf(settings.steamInstallDrive);
          const next = i >= drives.length - 1 ? "" : drives[i + 1];
          settings = await window.axm.setSettings({ steamInstallDrive: next });
          xmb.refresh();
        },
      },
      {
        id: "overlayHotkey",
        title: "In-Game Menu Button",
        subtitle: `Xbox / PS button, or M1 mapped to ${settings.overlayHotkey} in Armoury Crate`,
        iconGlyph: "⌂",
      },
      {
        id: "addFolder",
        title: "Add Game Folder…",
        subtitle: `${settings.extraGameFolders.length} added`,
        iconUrl: "assets/icons/folder.png",
        onConfirm: async () => {
          settings = await window.axm.pickGameFolder();
          games = await window.axm.scanGames();
          xmb.refresh();
        },
      },
      {
        id: "addMusicFolder",
        title: "Add Music Folder…",
        subtitle: `${settings.musicFolders.length} added`,
        iconUrl: "assets/icons/music.png",
        onConfirm: async () => {
          settings = await window.axm.pickMusicFolder();
          musicListing = await window.axm.browseMusic(null);
          xmb.refresh();
        },
      },
      {
        id: "rescan",
        title: "Rescan Game Library",
        subtitle: `${games.length} games found`,
        iconGlyph: "↻",
        onConfirm: async () => {
          games = await window.axm.scanGames();
          xmb.refresh();
        },
      },
      {
        id: "about",
        title: "About A-X-M",
        subtitle: "A passion project · developed with Naha0",
        iconUrl: "assets/icons/settings-about.webp",
        onConfirm: () =>
          showText("About A-X-M", [
            "A-X-M · Ally XMB Menu · Version 0.3.0 Beta 1",
            "This app was developed using AI. It is a passion project I've always wanted since the PS3 and PSP, then seeing handhelds.",
            "I don't care about negative AI comments - move along. Otherwise, let's bring our dreams to fruition by any means possible.",
            "User developed with Naha0 · github.com/nahalewski/A-X-M",
            "Thanks to SteamGridDB, TMDB, MusicBrainz, the Cover Art Archive, Jellyfin, and the PS3 XMB that started it all.",
          ]),
      },
    ];

    const themeItems = (): MenuItem[] => {
      const items: MenuItem[] = [
        {
          id: "theme-mode",
          title: "Theme Mode",
          subtitle: THEME_MODE_LABELS[settings.themeMode],
          iconGlyph: "❖",
          onConfirm: () => {
            const i = THEME_MODES.indexOf(settings.themeMode);
            return save({ themeMode: THEME_MODES[(i + 1) % THEME_MODES.length] });
          },
        },
        {
          id: "theme-ribbons",
          title: "Ribbons",
          subtitle: settings.ribbonEnabled ? "On" : "Off",
          iconGlyph: "〰",
          onConfirm: () => save({ ribbonEnabled: !settings.ribbonEnabled }),
        },
      ];

      if (settings.themeMode === "cycle") {
        items.push({
          id: "waveSpeed",
          title: "Palette Speed",
          subtitle: `${settings.waveColorCycleSeconds}s / color`,
          iconGlyph: "◐",
          onConfirm: async () => {
            const next = WAVE_CYCLE_PRESETS[(cycleIdx() + 1) % WAVE_CYCLE_PRESETS.length];
            settings = await window.axm.setSettings({ waveColorCycleSeconds: next });
            ribbon.setBackdropCycleSeconds(settings.waveColorCycleSeconds);
            xmb.refresh();
          },
        });
      } else {
        items.push(...ribbonControls(themeTarget, "theme", settings.themeMode !== "image"));
      }

      items.push(
        {
          id: "theme-image",
          title: "Background Picture…",
          subtitle: settings.customImageUrl
            ? decodeURIComponent(settings.customImageUrl.split("/").pop() ?? "")
            : "None chosen",
          iconUrl: "assets/icons/photo.png",
          onConfirm: async () => {
            settings = await window.axm.pickBackgroundImage();
            applyTheme();
            xmb.refresh();
          },
        },
        {
          id: "theme-months",
          title: "Month Colors…",
          subtitle: `Now: ${MONTH_NAMES[currentMonthIndex()]}`,
          iconGlyph: "▦",
          onConfirm: () => go("months"),
        },
        {
          id: "theme-visualizer",
          title: "Music Visualizer",
          subtitle: settings.visualizerEnabled ? "On" : "Off",
          iconGlyph: "▮",
          onConfirm: async () => {
            const next = !settings.visualizerEnabled;
            await save({ visualizerEnabled: next });
            if (!next && visualizer.currentMode() !== "off") clearVisualizer();
          },
        },
        {
          id: "theme-visualizer-style",
          title: "Visualizer Style",
          subtitle: (() => {
            const info = VISUALIZER_STYLES.find((v) => v.id === settings.visualizerStyle) ?? VISUALIZER_STYLES[0];
            return `${info.label} · ${info.origin}`;
          })(),
          iconGlyph: "▥",
          onConfirm: async () => {
            await cycleVisualizerStyle(1, visualizer.currentMode() !== "off");
            xmb.refresh();
          },
        },
        {
          id: "theme-reset",
          title: "Reset Theme to Defaults",
          iconGlyph: "↺",
          onConfirm: () =>
            save({
              themeMode: "monthly",
              monthlyThemes: DEFAULT_MONTH_THEMES.map((t) => ({ ...t })),
              fixedTheme: { ...DEFAULT_MONTH_THEMES[11] },
              customImageUrl: "",
              ribbonEnabled: true,
            }),
        }
      );
      return items;
    };

    // Controller: what the Gamepad API knows about each pad, plus what Windows
    // knows about the Bluetooth ones (battery, wired or wireless), and the few
    // things the menu itself can change: dead zone, vibration, the A/B swap.
    let controllerDevices: ControllerDevice[] = [];
    const controllerItems = (): MenuItem[] => {
      const rows: MenuItem[] = [];
      const pads = gamepad.snapshot();
      if (pads.length === 0) rows.push({ id: "pad-none", title: "No controller connected", subtitle: "Press a button on the pad to wake it", iconUrl: "assets/icons/games.svg" });
      pads.forEach((p) => {
        const family = p.type === "ps" ? "PlayStation" : p.type === "switch" ? "Nintendo Switch" : p.type === "kishi" ? "Razer Kishi" : "Xbox";
        const dev = controllerDevices.find((d) => d.kind === (p.type === "ps" ? "ps" : p.type === "xbox" ? "xbox" : "other")) ?? controllerDevices[p.index];
        const link = dev ? (dev.wireless ? "Wireless · Bluetooth" : "Wired · USB") : p.id.includes("Vendor") ? "USB" : "";
        const battery = dev?.battery !== null && dev?.battery !== undefined ? `${dev.battery}%` : dev?.wireless ? "Battery unknown" : "";
        rows.push({
          id: `pad-${p.index}`,
          title: `Player ${p.index + 1} · ${family}`,
          subtitle: [p.model, p.model !== p.name ? p.name : "", link, battery].filter(Boolean).join(" · "),
          iconUrl: "assets/icons/games.svg",
          badge: `${p.buttons} buttons · ${p.axes} axes${p.vibration ? " · rumble" : ""}`,
          meter: dev?.battery !== null && dev?.battery !== undefined ? dev.battery / 100 : undefined,
        });
      });
      rows.push(
        {
          id: "pad-profile",
          title: "Profile",
          subtitle: settings.gamepadProfile === "swapped" ? "Swapped · B confirms, A backs out (Nintendo style)" : "Standard · A confirms, B backs out",
          iconGlyph: "⇄",
          onConfirm: async () => {
            settings = await window.axm.setSettings({ gamepadProfile: settings.gamepadProfile === "swapped" ? "standard" : "swapped" });
            gamepad.setSwapConfirm(settings.gamepadProfile === "swapped");
            xmb.refresh();
          },
        },
        {
          id: "pad-deadzone",
          title: "Stick Dead Zone",
          subtitle: `${Math.round(settings.gamepadDeadZone * 100)}% · how far the stick moves before the menu scrolls`,
          iconGlyph: "◎",
          meter: settings.gamepadDeadZone,
          onConfirm: async () => {
            const steps = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
            const next = steps[(steps.indexOf(settings.gamepadDeadZone) + 1) % steps.length];
            settings = await window.axm.setSettings({ gamepadDeadZone: next });
            gamepad.setDeadZone(next);
            xmb.refresh();
          },
        },
        {
          id: "pad-vibration",
          title: "Vibration",
          subtitle: settings.gamepadVibration ? "On · A to test" : "Off",
          iconGlyph: "≋",
          onConfirm: async () => {
            if (settings.gamepadVibration) gamepad.rumble(300);
            settings = await window.axm.setSettings({ gamepadVibration: !settings.gamepadVibration });
            gamepad.setVibration(settings.gamepadVibration);
            xmb.refresh();
          },
          contextHint: "test rumble",
          onContext: () => {
            gamepad.rumble(400);
            return true;
          },
        },
        {
          id: "pad-gyro",
          title: "Gyro / Motion",
          subtitle: "Not exposed to apps by Windows' controller API · use Armoury Crate or DS4Windows",
          iconGlyph: "↻",
        },
        {
          id: "pad-remap",
          title: "Remap Buttons",
          subtitle: "Menu buttons are fixed: A select, B back, Y options, Guide overlay · remap the pad in Armoury Crate",
          iconGlyph: "⌨",
        }
      );
      return rows;
    };

    // ---- Assistant (Ghost) -----------------------------------------------------------------
    const saveAssistant = async (partial: Partial<Settings["assistant"]>) => {
      settings = await window.axm.setSettings({ assistant: { ...settings.assistant, ...partial } });
      await applyAssistant();
      xmb.refresh();
    };
    const assistantItems = (): MenuItem[] => [
      {
        id: "as-enable",
        title: "Voice Assistant",
        subtitle: settings.assistant.enabled ? (assistantStatus.modelReady ? (assistant.isListening() ? "On · listening on this device, nothing is sent anywhere" : "On · starting…") : "On · voice model not ready") : "Off",
        iconGlyph: "◈",
        onConfirm: async () => {
          if (!settings.assistant.enabled && !assistantStatus.modelReady) {
            showOptions("Ghost needs a voice model", [
              {
                label: "Download the model",
                hint: "Vosk small English · about 40 MB, once",
                run: async () => {
                  try {
                    assistantStatus = await window.axm.installAssistantModel();
                    await saveAssistant({ enabled: true });
                    notifier.push('Ghost is ready - say "hey ghost"');
                  } catch (e) {
                    notifier.push(`Voice model: ${String((e as Error).message ?? e)}`);
                  }
                },
              },
              { label: "Not now" },
            ]);
            return;
          }
          await saveAssistant({ enabled: !settings.assistant.enabled });
        },
      },
      { id: "as-wake", title: "Wake Word", subtitle: settings.assistant.wakeWord ? 'On · "hey ghost"' : "Off · Ghost only answers the Assistant button", iconGlyph: "◉", onConfirm: () => saveAssistant({ wakeWord: !settings.assistant.wakeWord }) },
      { id: "as-voice", title: "Voice Replies", subtitle: settings.assistant.voiceReplies ? (ttsStatus.engineReady ? "On · Ghost speaks in its cloned voice" : "On · text only until the voice engine is installed") : "Off · text only", iconGlyph: "♫", onConfirm: () => saveAssistant({ voiceReplies: !settings.assistant.voiceReplies }) },
      {
        id: "as-engine",
        title: "Ghost's Voice",
        subtitle: ttsStatus.installing ? "Installing…" : ttsStatus.engineReady ? `Chatterbox on this ${ttsStatus.device === "cuda" ? "GPU" : ttsStatus.device === "cpu" ? "CPU" : "device"} · ${ttsStatus.cacheCount} phrases remembered` : ttsStatus.python ? "Not installed · Chatterbox (MIT) clones the voice from one clip, all on this device" : "Needs Python 3.11 · Settings › System › Install Tools",
        iconGlyph: "◈",
        onConfirm: async () => {
          if (ttsStatus.engineReady || ttsStatus.installing) {
            showOptions("Ghost's Voice", [
              { label: "Hear it", run: () => assistant.sayNow("Hello. I'm Ghost. Say hey ghost, then tell me what to launch, play, or open.") },
              { label: "Remove the voice engine", hint: "frees a few GB", run: async () => { await window.axm.removeTts(); await refreshTts(); xmb.refresh(); } },
            ]);
            return;
          }
          showOptions("Install Ghost's voice?", [
            {
              label: "Install",
              hint: "Python packages + model · a few GB, once · runs offline",
              run: async () => {
                try {
                  ttsStatus = await window.axm.installTts();
                  notifier.push("Ghost's voice is ready");
                } catch (e) {
                  notifier.push(`Ghost's voice: ${String((e as Error).message ?? e)}`);
                }
                await refreshTts();
                xmb.refresh();
              },
            },
            { label: "Not now" },
          ]);
        },
      },
      {
        id: "as-clip",
        title: "Voice Clip",
        subtitle: ttsStatus.voiceClip.replace(/\\/g, "/").includes("/assets/voice/") ? "The clip that ships with the menu" : `Your clip · ${ttsStatus.voiceClip.split(/[\\/]/).pop()}`,
        iconGlyph: "◎",
        onConfirm: () =>
          showOptions("Voice Clip", [
            { label: "Choose a clip…", hint: "3-15 seconds of one voice, any audio file", run: async () => { const f = await window.axm.pickVoiceClip().catch((e) => { notifier.push(String(e.message ?? e)); return null; }); if (f) notifier.push("Ghost has a new voice"); await refreshTts(); xmb.refresh(); } },
            { label: "Use the built-in clip", run: async () => { await window.axm.resetVoiceClip(); await refreshTts(); xmb.refresh(); } },
          ]),
      },
      {
        id: "as-size",
        title: "Chat Bubble Size",
        subtitle: { small: "Small", medium: "Medium", large: "Large" }[settings.assistant.bubbleSize],
        iconGlyph: "▭",
        onConfirm: () => showOptions("Chat Bubble Size", (["small", "medium", "large"] as const).map((b) => ({ label: { small: "Small", medium: "Medium", large: "Large" }[b], selected: settings.assistant.bubbleSize === b, run: () => saveAssistant({ bubbleSize: b }) }))),
      },
      { id: "as-mic", title: "Microphone", subtitle: "Chosen in Settings › System › Chat › Input Device", iconGlyph: "◎", onConfirm: async () => { await refreshAudioDevices(); go("chat"); } },
      { id: "as-try", title: "Try It", subtitle: 'Wakes Ghost now - then say "launch" and a game, "play" a playlist, "go to settings"…', iconGlyph: "▶", onConfirm: () => (assistant.isListening() ? assistant.wake() : notifier.push("Turn the assistant on first")) },
      {
        id: "as-remove",
        title: "Delete Voice Model",
        subtitle: assistantStatus.modelReady ? `${assistantStatus.modelName} · frees about 40 MB` : "Not downloaded",
        iconGlyph: "✕",
        onConfirm: async () => {
          if (!assistantStatus.modelReady) return;
          await window.axm.removeAssistantModel();
          await saveAssistant({ enabled: false });
        },
      },
      { id: "as-note", title: "What Ghost understands", subtitle: "launch <game> · play <playlist or song> · go to <column or setting> · next track · stop music · quit game · turn off · help", iconGlyph: "ⓘ" },
    ];

    // ---- Toybox --------------------------------------------------------------------------
    let nfcStatus: { pcscRunning: boolean; readers: string[]; companionPort: number | null; pythonReady: boolean; lastError: string | null } | null = null;
    void window.axm.toyboxNfcStatus().then((st) => (nfcStatus = st)).catch(() => {});
    const saveToybox = async (partial: Partial<ToyboxSettings>) => {
      settings = await window.axm.setSettings({ toybox: { ...settings.toybox, ...partial } });
      xmb.refresh();
    };
    const onOff = (v: boolean) => (v ? "On" : "Off");
    /** Settings › TV Streaming: what the portal shows, the adult PIN, subtitles and audio. */
    let tvTags: { tag: string; count: number; english: boolean }[] | null = null;
    const AUDIO_LANGS: [string, string][] = [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"], ["nl", "Dutch"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["ru", "Russian"], ["ar", "Arabic"]];
    const tvSettingsItems = (): MenuItem[] => {
      const overrides = settings.tvLanguageOverrides ?? {};
      const n = Object.keys(overrides).length;
      return [
        { id: "tv-english", title: "English Only", subtitle: settings.tvEnglishOnly ? "On · channels, films and shows tagged as another language are hidden" : "Off · everything the service lists", iconUrl: "assets/icons/tv-epg.webp", onConfirm: async () => { await save({ tvEnglishOnly: !settings.tvEnglishOnly }); tv.categories = []; tv.items = []; } },
        { id: "tv-languages", title: "Languages", subtitle: n ? `${n} tag${n === 1 ? "" : "s"} set by hand · show or hide each language the provider tags` : "Show or hide each language the provider tags", iconUrl: "assets/icons/tv-epg.webp", onConfirm: () => { tvTags = null; void window.axm.tvLanguages().then((t) => { tvTags = t; xmb.refresh(); }).catch(() => { tvTags = []; xmb.refresh(); }); go("tvlang"); } },
        { id: "tv-adult-block", title: "Adult Content", subtitle: settings.tvAdultBlocked ? `Blocked · ${settings.tvPin ? "behind the PIN" : "no PIN set yet - set one below"} · unlock from the TV Streaming page for one session` : "Shown · adult categories and channels are listed like any other", iconUrl: "assets/icons/tv-epg.webp", onConfirm: async () => {
          if (settings.tvAdultBlocked && !(await askPin("Show Adult Content"))) return;
          await save({ tvAdultBlocked: !settings.tvAdultBlocked });
          tvAdultUnlocked = false;
          tv.categories = []; tv.items = [];
        } },
        { id: "tv-pin", title: settings.tvPin ? "Change PIN" : "Set PIN", subtitle: settings.tvPin ? "4 or more digits · asked before adult content shows" : "Not set · adult content is hidden without one but anyone can unlock it", iconUrl: "assets/icons/tv-epg.webp", onConfirm: async () => {
          if (settings.tvPin && !(await askPin("Current PIN"))) return;
          const a = await askText("New PIN", [{ label: "PIN (digits)", value: "", secret: true }]);
          if (!a) return;
          const pin = a[0].trim();
          if (!/^\d{4,8}$/.test(pin)) { notifier.push("A PIN is 4 to 8 digits", "general"); return; }
          await save({ tvPin: pin });
          notifier.push("PIN set", "general");
        } },
        ...allRootItems().filter((i) => SETTINGS_GROUPS[i.id] === "tv"),
        { id: "tv-audio", title: "Audio Language", subtitle: `${AUDIO_LANGS.find(([c]) => c === (settings.audioLanguage || "en"))?.[1] ?? settings.audioLanguage} · the track picked when a video has more than one`, iconUrl: "assets/icons/tv-epg.webp", onConfirm: () => showOptions("Audio Language", AUDIO_LANGS.map(([code, name]) => ({ label: name, hint: code.toUpperCase(), selected: (settings.audioLanguage || "en") === code, run: async () => { await save({ audioLanguage: code }); mediaViewer.setAudioLanguage(code); } }))) },
      ];
    };
    const tvLanguageItems = (): MenuItem[] => {
      if (!tvTags) return [{ id: "tvlang-busy", title: "Reading the provider's categories…", iconUrl: "assets/icons/tv-epg.webp" }];
      if (!tvTags.length) return [{ id: "tvlang-none", title: "No language tags found", subtitle: "The provider doesn't prefix its categories, so there's nothing to filter by", iconUrl: "assets/icons/tv-epg.webp" }];
      const overrides = settings.tvLanguageOverrides ?? {};
      return tvTags.map((t) => {
        const o = overrides[t.tag];
        const byDefault = t.english || !settings.tvEnglishOnly;
        const shown = o ? o === "show" : byDefault;
        return {
          id: `tvlang-${t.tag}`,
          title: t.tag,
          subtitle: `${shown ? "Shown" : "Hidden"}${o ? " · set by hand" : " · by default"} · ${t.count} categor${t.count === 1 ? "y" : "ies"}`,
          iconUrl: "assets/icons/tv-epg.webp",
          contextHint: o ? "back to default" : undefined,
          onConfirm: async () => { await save({ tvLanguageOverrides: { ...overrides, [t.tag]: shown ? "hide" : "show" } }); tv.categories = []; tv.items = []; },
          onContext: () => { const next = { ...overrides }; delete next[t.tag]; void save({ tvLanguageOverrides: next }).then(() => { tv.categories = []; tv.items = []; }); return true; },
        };
      });
    };

    const toyboxSettingsItems = (): MenuItem[] => {
      const t = settings.toybox;
      void window.axm.toyboxNfcStatus().then((st) => (nfcStatus = st)).catch(() => {});
      return [
        {
          id: "tb-readers",
          title: "NFC Readers",
          subtitle: nfcStatus ? (nfcStatus.readers.length ? nfcStatus.readers.join(", ") : nfcStatus.pcscRunning ? "Listening · no PC/SC reader plugged in" : nfcStatus.lastError ?? "Reader support not running") : "Checking…",
          iconUrl: "assets/icons/toybox.webp",
          onConfirm: async () => {
            const st = await window.axm.toyboxNfcStatus();
            showInfo("NFC Readers", "assets/icons/toybox.webp", null, [
              { label: "Sub-Title", value: st.pcscRunning ? "PC/SC reader service running" : "PC/SC reader service not running" },
              { label: "Readers", value: st.readers.length ? st.readers.join(", ") : "None found - plug in an ACR122U or another PC/SC reader" },
              { label: "Companion", value: st.companionPort ? `Listening on port ${st.companionPort} for the Android companion / portal adapters` : "Off" },
              { label: "Python", value: st.pythonReady ? "Ready" : "Not installed · Settings › System › Install Tools" },
              { label: "Details", value: st.lastError ?? "Amiibo, Skylanders, Disney Infinity and LEGO Dimensions tags are identified on this device; nothing is written to a tag and no dump leaves the machine." },
            ]);
          },
        },
        {
          id: "tb-onselect",
          title: "When Selecting a Game from Ghost",
          subtitle: { launch: "Launch Immediately", navigate: "Navigate to Game", ask: "Ask Every Time" }[t.onSelect],
          iconGlyph: "▶",
          onConfirm: () => showOptions("When Selecting a Game from Ghost", (["launch", "navigate", "ask"] as const).map((v) => ({ label: { launch: "Launch Immediately", navigate: "Navigate to Game", ask: "Ask Every Time" }[v], hint: { launch: "start the game", navigate: "move the cursor to it, like a disc insert", ask: "Ghost asks which" }[v], selected: t.onSelect === v, run: () => saveToybox({ onSelect: v }) }))),
        },
        {
          id: "tb-ingame",
          title: "Toybox Notifications During Gameplay",
          subtitle: { full: "Full Ghost Card", small: "Small Notification", voice: "Voice Only", off: "Off" }[t.inGame],
          iconGlyph: "▭",
          onConfirm: () => showOptions("During Gameplay", (["full", "small", "voice", "off"] as const).map((v) => ({ label: { full: "Full Ghost Card", small: "Small Notification", voice: "Voice Only", off: "Off" }[v], selected: t.inGame === v, run: () => saveToybox({ inGame: v }) }))),
        },
        { id: "tb-speak", title: "Speak Toybox Detections", subtitle: onOff(t.speak), iconGlyph: "♫", onConfirm: () => saveToybox({ speak: !t.speak }) },
        { id: "tb-cards", title: "Show Toybox Detection Cards", subtitle: onOff(t.showCards), iconGlyph: "▭", onConfirm: () => saveToybox({ showCards: !t.showCards }) },
        { id: "tb-art", title: "Character Artwork", subtitle: onOff(t.artwork), iconGlyph: "◈", onConfirm: () => saveToybox({ artwork: !t.artwork }) },
        { id: "tb-focus", title: "Auto Focus New Figure", subtitle: t.autoFocus ? "On · a new figure replaces the card" : "Off · the first figure keeps the card", iconGlyph: "◎", onConfirm: () => saveToybox({ autoFocus: !t.autoFocus }) },
        { id: "tb-games", title: "Suggest Compatible Games", subtitle: onOff(t.suggestGames), iconGlyph: "▶", onConfirm: () => saveToybox({ suggestGames: !t.suggestGames }) },
        { id: "tb-last", title: "Suggest Last Played Game", subtitle: t.suggestLast ? "On · \"Resume with…\"" : "Off", iconGlyph: "↻", onConfirm: () => saveToybox({ suggestLast: !t.suggestLast }) },
        { id: "tb-companion", title: "Companion App", subtitle: t.companion ? `On · phones on this Wi-Fi can send scans${nfcStatus?.companionPort ? ` to port ${nfcStatus.companionPort}` : ""}` : "Off · restart to apply", iconGlyph: "◉", onConfirm: () => saveToybox({ companion: !t.companion }) },
        {
          id: "tb-files",
          title: "Figure Files for Emulators",
          subtitle: "Read-only copies of scanned toys, for Eden / yuzu (Load Amiibo) and RPCS3's portal dialogs",
          iconUrl: "assets/icons/folder.png",
          onConfirm: async () => {
            const dir = await window.axm.toyboxDumpsDir();
            showInfo("Figure Files for Emulators", "assets/icons/toybox.webp", null, [
              { label: "Folder", value: dir },
              { label: "Amiibo", value: "Eden / yuzu / Ryujinx: File › Load Amiibo, pick the figure's .bin here. The copy is made when the amiibo is scanned." },
              { label: "Skylanders", value: "RPCS3: Utilities › Skylanders Portal › Load Slot, pick the .sky here. A real portal plugged into this PC works directly through RPCS3's USB passthrough." },
              { label: "Disney Infinity", value: "RPCS3: Utilities › Infinity Base › Load, pick the .bin here (5 sectors, the layout RPCS3 expects). A real base works through USB passthrough." },
              { label: "LEGO Dimensions", value: "RPCS3: Utilities › Dimensions Toypad, or a real toy pad through USB passthrough. Tags are identified here; RPCS3 makes its own tag files." },
              { label: "Details", value: "Nothing is ever written back to a toy, and these files never leave this machine. The emulators have no way to load a figure from outside their own windows, so this folder is the hand-off." },
            ]);
          },
        },
        {
          id: "tb-test",
          title: "Test a Scan",
          subtitle: "Pretend a toy landed on the reader",
          iconGlyph: "▶",
          onConfirm: () =>
            showOptions("Test a Scan", [
              { label: "Amiibo", run: () => void simulateScan("amiibo") },
              { label: "Skylander", run: () => void simulateScan("skylanders") },
              { label: "Disney Infinity figure", run: () => void simulateScan("disney-infinity") },
              { label: "LEGO Dimensions tag", run: () => void simulateScan("lego-dimensions") },
              { label: "Unknown tag", run: () => void simulateScan("unknown") },
              { label: "Remove the toy", run: () => void window.axm.toyboxSimulateRemoval() },
            ]),
        },
      ];
    };

    // ---- Date and Time ----------------------------------------------------------------
    let clock: ClockInfo | null = null;
    let sysHostName = "";
    void window.axm.hostName().then((h) => (sysHostName = h));
    const dateTimeItems = (): MenuItem[] => [
      { id: "dt-now", title: "Current Date and Time", subtitle: new Date().toLocaleString([], { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: !settings.clock24h }), iconGlyph: "◷" },
      {
        id: "dt-format",
        title: "Time Format",
        subtitle: settings.clock24h ? "24-hour" : "12-hour",
        iconGlyph: "◑",
        onConfirm: async () => {
          settings = await window.axm.setSettings({ clock24h: !settings.clock24h });
          updateClock();
          xmb.refresh();
        },
      },
      {
        id: "dt-zone",
        title: "Time Zone",
        subtitle: clock ? `${clock.timeZone} · UTC${clock.timeZoneOffsetMin >= 0 ? "+" : "-"}${Math.floor(Math.abs(clock.timeZoneOffsetMin) / 60)}:${String(Math.abs(clock.timeZoneOffsetMin) % 60).padStart(2, "0")}` : "…",
        iconGlyph: "⊕",
        onConfirm: async () => {
          const zones = await window.axm.listTimeZones();
          if (zones.length <= 1) return;
          showOptions("Time Zone", zones.map((z) => ({ label: z, selected: clock?.timeZone === z, run: async () => { const ok = await window.axm.setTimeZone(z); notifier.push(ok ? `Time zone set to ${z}` : "Windows needs administrator rights to change the time zone"); clock = await window.axm.getClock(); xmb.refresh(); } })));
        },
      },
      {
        id: "dt-auto",
        title: "Set Automatically via Internet",
        subtitle: clock?.autoTime === null || clock?.autoTime === undefined ? "Managed by the system" : clock.autoTime ? "On · Windows keeps the clock synced" : "Off in Windows",
        iconGlyph: "↻",
        contextHint: "sync now",
        onConfirm: async () => {
          const res = await window.axm.syncClock();
          notifier.push(res.message);
          clock = await window.axm.getClock();
          xmb.refresh();
        },
      },
    ];

    // ---- Power Save ---------------------------------------------------------------------
    let power: PowerSettings | null = null;
    const minutesLabel = (m: number) => (m === 0 ? "Never" : m < 60 ? `${m} min` : `${m / 60} h`);
    const TIMEOUTS = [0, 1, 2, 5, 10, 15, 30, 60];
    const timeoutRow = (id: string, title: string, what: "screen" | "sleep", onBattery: boolean, value: number): MenuItem => ({
      id,
      title,
      subtitle: minutesLabel(value),
      iconGlyph: what === "screen" ? "▭" : "☾",
      onConfirm: () =>
        showOptions(title, TIMEOUTS.map((m) => ({ label: minutesLabel(m), selected: m === value, run: async () => { await window.axm.setPowerTimeout(what, onBattery, m); power = await window.axm.getPowerSettings(); xmb.refresh(); } }))),
    });
    const powerItems = (): MenuItem[] => {
      if (!power) return [{ id: "pw-wait", title: "Reading power settings…", iconGlyph: "…" }];
      const rows: MenuItem[] = [];
      if (power.plans.length) {
        const active = power.plans.find((p) => p.active);
        rows.push({
          id: "pw-plan",
          title: "Power Plan",
          subtitle: active?.name ?? "—",
          iconUrl: "assets/icons/power.png",
          onConfirm: () => showOptions("Power Plan", power!.plans.map((p) => ({ label: p.name, selected: p.active, run: async () => { await window.axm.setPowerPlan(p.guid); power = await window.axm.getPowerSettings(); notifier.push(`Power plan: ${p.name}`); xmb.refresh(); } }))),
        });
      }
      rows.push(
        timeoutRow("pw-screen-dc", "Turn Off Screen (on battery)", "screen", true, power.screenOffBattery),
        timeoutRow("pw-screen-ac", "Turn Off Screen (plugged in)", "screen", false, power.screenOffPlugged),
        timeoutRow("pw-sleep-dc", "Sleep (on battery)", "sleep", true, power.sleepBattery),
        timeoutRow("pw-sleep-ac", "Sleep (plugged in)", "sleep", false, power.sleepPlugged),
        {
          id: "pw-dim",
          title: "Dim Menu When Idle",
          subtitle: settings.menuDimMinutes ? `After ${settings.menuDimMinutes} min` : "Never",
          iconGlyph: "◐",
          onConfirm: () => showOptions("Dim Menu When Idle", [0, 1, 2, 5, 10].map((m) => ({ label: m ? `After ${m} min` : "Never", selected: settings.menuDimMinutes === m, run: async () => { settings = await window.axm.setSettings({ menuDimMinutes: m }); xmb.refresh(); } }))),
        }
      );
      return rows;
    };

    // ---- Chat: the menu's audio output and microphone ---------------------------------
    let audioDevices: MediaDeviceInfo[] = [];
    let micLevel = -1;
    const refreshAudioDevices = async () => {
      try {
        audioDevices = await navigator.mediaDevices.enumerateDevices();
        if (audioDevices.some((d) => d.kind === "audioinput" && !d.label)) {
          // Labels only come once the mic has been allowed once; ask, then re-list.
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          audioDevices = await navigator.mediaDevices.enumerateDevices();
        }
      } catch {
        // no devices, or permission refused: rows say so
      }
    };
    const applyAudioOutput = async (id: string) => {
      const sink = id || "";
      const els = [musicPlayer.element(), document.querySelector("#media-viewer video") as HTMLMediaElement | null];
      for (const el of els) {
        const sinkable = el as (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }) | null;
        await sinkable?.setSinkId?.(sink).catch(() => {});
      }
      audio.setOutputDevice(sink);
    };
    const testMic = async (id: string) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true });
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const started = performance.now();
        const tick = () => {
          an.getByteFrequencyData(buf);
          micLevel = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
          xmb.refresh();
          if (performance.now() - started < 6000) requestAnimationFrame(tick);
          else {
            stream.getTracks().forEach((t) => t.stop());
            void ctx.close();
            micLevel = -1;
            xmb.refresh();
          }
        };
        tick();
      } catch {
        notifier.push("Couldn't open the microphone");
      }
    };
    const chatItems = (): MenuItem[] => {
      const outs = audioDevices.filter((d) => d.kind === "audiooutput");
      const ins = audioDevices.filter((d) => d.kind === "audioinput");
      const outName = outs.find((d) => d.deviceId === settings.audioOutputId)?.label || "System default";
      const inName = ins.find((d) => d.deviceId === settings.audioInputId)?.label || "System default";
      return [
        {
          id: "chat-out",
          title: "Output Device",
          subtitle: `${outName} · menu music, sounds and video`,
          iconGlyph: "◉",
          onConfirm: () => showOptions("Output Device", [{ deviceId: "", label: "System default" } as MediaDeviceInfo, ...outs].map((d) => ({ label: d.label || d.deviceId, selected: (settings.audioOutputId || "") === d.deviceId, run: async () => { settings = await window.axm.setSettings({ audioOutputId: d.deviceId }); await applyAudioOutput(d.deviceId); xmb.refresh(); } }))),
        },
        {
          id: "chat-in",
          title: "Input Device",
          subtitle: `${inName} · microphone`,
          iconGlyph: "◎",
          onConfirm: () => showOptions("Input Device", [{ deviceId: "", label: "System default" } as MediaDeviceInfo, ...ins].map((d) => ({ label: d.label || d.deviceId, selected: (settings.audioInputId || "") === d.deviceId, run: async () => { settings = await window.axm.setSettings({ audioInputId: d.deviceId }); xmb.refresh(); } }))),
        },
        {
          id: "chat-test",
          title: "Microphone Level",
          subtitle: micLevel < 0 ? "A to test for six seconds" : "Speak…",
          iconGlyph: "≋",
          meter: micLevel < 0 ? undefined : Math.min(1, micLevel * 3),
          onConfirm: () => (micLevel < 0 ? testMic(settings.audioInputId) : undefined),
        },
        { id: "chat-note", title: "Windows' own default device is unchanged", subtitle: "These pick where the menu plays and listens; games follow Windows", iconGlyph: "ⓘ" },
      ];
    };

    // ---- Notifications --------------------------------------------------------------------
    const notifyItems = (): MenuItem[] => {
      const n = settings.notifications;
      const setN = async (next: typeof n) => {
        settings = await window.axm.setSettings({ notifications: next });
        notifier.setPrefs(settings.notifications);
        xmb.refresh();
      };
      const kindRow = (key: keyof typeof n.kinds, title: string, subtitle: string): MenuItem => ({
        id: `nt-${key}`,
        title,
        subtitle: `${n.kinds[key] ? "Display" : "Off"} · ${subtitle}`,
        iconGlyph: n.kinds[key] ? "●" : "○",
        onConfirm: () => setN({ ...n, kinds: { ...n.kinds, [key]: !n.kinds[key] } }),
      });
      return [
        { id: "nt-all", title: "Notification Messages", subtitle: n.enabled ? "Display" : "Off", iconGlyph: "▤", onConfirm: () => setN({ ...n, enabled: !n.enabled }) },
        kindRow("transfer", "Copies and Downloads", "when a copy or download finishes"),
        kindRow("install", "Game Installs", "when Steam finishes installing"),
        kindRow("controller", "Controllers", "when a pad connects or changes"),
        kindRow("battery", "Battery", "when the battery runs low"),
        kindRow("general", "System Messages", "settings changes and sign-ins"),
        { id: "nt-test", title: "Show a Test Notification", iconGlyph: "▶", onConfirm: () => notifier.push("This is what a notification looks like") },
        ...notifier.history.slice(0, 10).map((h, i) => ({ id: `nt-h${i}`, title: h.text, subtitle: new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !settings.clock24h }), iconGlyph: "·" })),
      ];
    };

    // ---- Predictive text dictionary --------------------------------------------------------
    const dictionaryItems = (): MenuItem[] => [
      {
        id: "dict-add",
        title: "Add/Edit Term",
        subtitle: "A word the keyboard should offer",
        iconGlyph: "+",
        onConfirm: async () => {
          const answers = await askText("Add Term", [{ label: "Term" }]);
          const term = answers?.[0]?.trim();
          if (!term) return;
          settings = await window.axm.setSettings({ dictionaryTerms: [...new Set([...settings.dictionaryTerms, term])] });
          setDictionary(settings.dictionaryTerms, settings.learnedWords, (w) => void window.axm.setSettings({ learnedWords: w }).then((next) => (settings = next)));
          xmb.refresh();
        },
      },
      {
        id: "dict-clear",
        title: "Delete Predictive Text Dictionary",
        subtitle: `Forget ${settings.learnedWords.length} learnt words (your own terms stay)`,
        iconGlyph: "✕",
        onConfirm: () => showOptions("Delete learnt words?", [{ label: "Yes", run: async () => { settings = await window.axm.setSettings({ learnedWords: [] }); setDictionary(settings.dictionaryTerms, [], (w) => void window.axm.setSettings({ learnedWords: w }).then((next) => (settings = next))); xmb.refresh(); } }, { label: "No" }]),
      },
      ...settings.dictionaryTerms.map((t) => ({
        id: `dict-${t}`,
        title: t,
        iconGlyph: "Aa",
        contextHint: "remove",
        onContext: () => {
          void window.axm.setSettings({ dictionaryTerms: settings.dictionaryTerms.filter((x) => x !== t) }).then((next) => { settings = next; setDictionary(settings.dictionaryTerms, settings.learnedWords, (w) => void window.axm.setSettings({ learnedWords: w }).then((n2) => (settings = n2))); xmb.refresh(); });
          return true;
        },
      })),
    ];

    // ---- Network: Wi-Fi and Bluetooth without leaving the menu ---------------------
    const net = { wifi: [] as WifiNetwork[], bt: [] as BluetoothDevice[], busy: "", status: "" };
    const netHint = () => net.busy || net.status || "Settings › Network";
    const netRefresh = async () => {
      net.busy = "Scanning…";
      xmb.refresh();
      const [wifi, bt] = await Promise.all([window.axm.wifiList().catch(() => []), window.axm.btList().catch(() => [])]);
      net.wifi = wifi;
      net.bt = bt;
      net.busy = "";
      xmb.refresh();
    };
    const netOpen = async () => {
      netView = "root";
      go("network");
      await netRoot();
    };
    const netSay = (message: string) => {
      net.status = message;
      xmb.refresh();
      setTimeout(() => {
        if (net.status === message) {
          net.status = "";
          xmb.refresh();
        }
      }, 6000);
    };
    let netView: "root" | "wifi" | "register" | "registered" = "root";
    let conn: ConnectionStatus | null = null;
    const netRoot = async () => {
      conn = await window.axm.connectionStatus().catch(() => null);
      xmb.refresh();
    };
    const netSub = (v: typeof netView) => {
      netView = v;
      xmb.enterLevel("settings", settingsLevelKey());
      xmb.refresh();
    };
    const networkItems = (): MenuItem[] => {
      if (netView === "wifi") return wifiItems();
      if (netView === "register") return btItems(false);
      if (netView === "registered") return btItems(true);
      const c = conn;
      return [
        {
          id: "net-status",
          title: "Settings and Connection Status List",
          subtitle: c ? (c.connected ? `${c.ssid ?? c.adapter} · ${c.ip ?? ""}` : "Not connected") : "Reading…",
          iconUrl: "assets/icons/network-settings.webp",
          onConfirm: () =>
            showInfo("Settings and Connection Status List", "assets/icons/network-settings.webp", null, [
              { label: "Connection Status", value: c?.connected ? "Connected" : "Not connected" },
              { label: "Connection Method", value: c?.ssid ? "Wireless" : "Wired / other" },
              { label: "SSID", value: c?.ssid ?? "" },
              { label: "Signal Strength", value: c?.signal !== null && c?.signal !== undefined ? `${c.signal}%` : "" },
              { label: "IP Address", value: c?.ip ?? "" },
              { label: "Default Router", value: c?.gateway ?? "" },
              { label: "DNS", value: (c?.dns ?? []).join("\n") },
              { label: "MAC Address", value: c?.mac ?? "" },
              { label: "System Name", value: settings.systemName || sysHostName },
            ]),
        },
        {
          id: "net-internet",
          title: "Internet Connection",
          subtitle: c ? (c.wifiEnabled ? "Enabled" : "Disabled") : "…",
          iconGlyph: "⊕",
          onConfirm: () =>
            showOptions("Internet Connection", [
              { label: "Enabled", selected: !!c?.wifiEnabled, run: async () => { const r = await window.axm.setWifiEnabled(true); notifier.push(r.message); await netRoot(); } },
              { label: "Disabled", selected: c ? !c.wifiEnabled : false, run: async () => { const r = await window.axm.setWifiEnabled(false); notifier.push(r.message); await netRoot(); } },
            ]),
        },
        { id: "net-wifi", title: "Internet Connection Settings", subtitle: "Wi-Fi networks in range · join, disconnect, forget", iconGlyph: "≋", onConfirm: async () => { netSub("wifi"); await netRefresh(); } },
        {
          id: "net-test",
          title: "Internet Connection Test",
          subtitle: "Gateway, DNS, internet, a quick speed read",
          iconGlyph: "✓",
          onConfirm: async () => {
            net.busy = "Testing the connection…";
            xmb.refresh();
            const t = await window.axm.connectionTest().catch(() => null);
            net.busy = "";
            xmb.refresh();
            if (!t) return notifier.push("The test couldn't run");
            showInfo("Internet Connection Test", "assets/icons/network-settings.webp", null, [
              { label: "Obtain IP Address", value: t.ip ? `Succeeded · ${t.ip}` : "Failed" },
              { label: "Router", value: t.gateway === "ok" ? "Succeeded" : t.gateway === "none" ? "No default router" : "Failed" },
              { label: "DNS", value: t.dns === "ok" ? "Succeeded" : "Failed" },
              { label: "Internet Connection", value: t.internet === "ok" ? "Succeeded" : "Failed" },
              { label: "Connection Speed", value: t.mbps !== null ? `${t.mbps} Mbps (download)` : "" },
            ]);
          },
        },
        {
          id: "net-media",
          title: "Media Server Connection",
          subtitle: settings.mediaServerEnabled ? "Enabled · Jellyfin servers are found on the LAN" : "Disabled",
          iconUrl: "assets/icons/jellyfin.svg",
          onConfirm: async () => {
            settings = await window.axm.setSettings({ mediaServerEnabled: !settings.mediaServerEnabled });
            xmb.refresh();
          },
        },
        { id: "net-bt-register", title: "Register Device", subtitle: "Pair a Bluetooth controller, headset or keyboard", iconGlyph: "ᛒ", onConfirm: async () => { netSub("register"); await netRefresh(); } },
        { id: "net-bt-list", title: "Registered Device List", subtitle: "Paired Bluetooth devices", iconGlyph: "≡", onConfirm: async () => { netSub("registered"); await netRefresh(); } },
      ];
    };
    const wifiItems = (): MenuItem[] => {
      const rows: MenuItem[] = [{ id: "net-scan", title: net.busy ? "Scanning…" : "Scan Again", iconGlyph: "↻", onConfirm: () => (net.busy ? undefined : netRefresh()) }];
      if (!net.wifi.length && !net.busy) rows.push({ id: "net-none", title: "No networks found", subtitle: "Is Wi-Fi on?", iconGlyph: "≋" });
      for (const w of net.wifi) {
        const bars = w.signal >= 75 ? "▂▄▆█" : w.signal >= 50 ? "▂▄▆" : w.signal >= 25 ? "▂▄" : "▂";
        rows.push({
          id: `wifi-${w.ssid}`,
          title: w.ssid,
          subtitle: `${bars} ${w.signal}% · ${w.auth || "Open"}${w.connected ? " · Connected" : w.known ? " · Saved" : ""}`,
          iconGlyph: w.connected ? "✓" : "○",
          badge: w.connected ? "CONNECTED" : undefined,
          onConfirm: async () => {
            if (w.connected) return;
            let password: string | null = null;
            if (!w.known && !/open/i.test(w.auth)) {
              const answers = await askText(`Join ${w.ssid}`, [{ label: "Password", secret: true }]);
              if (!answers) return;
              password = answers[0];
            } else if (!w.known) password = "";
            net.busy = `Joining ${w.ssid}…`;
            xmb.refresh();
            const res = await window.axm.wifiConnect(w.ssid, password);
            net.busy = "";
            notifier.push(res.message);
            await netRefresh();
          },
          contextHint: w.connected ? "disconnect" : w.known ? "forget" : undefined,
          onContext: () => {
            if (w.connected) void window.axm.wifiDisconnect().then(() => netRefresh());
            else if (w.known) void window.axm.wifiForget(w.ssid).then(() => netRefresh());
            else return false;
            return true;
          },
        });
      }
      return rows;
    };
    const btItems = (paired: boolean): MenuItem[] => {
      const rows: MenuItem[] = [{ id: "net-scan", title: net.busy ? "Scanning…" : "Scan Again", subtitle: paired ? undefined : "Put the device in pairing mode first", iconGlyph: "↻", onConfirm: () => (net.busy ? undefined : netRefresh()) }];
      const list = net.bt.filter((d) => d.paired === paired);
      if (!list.length && !net.busy) rows.push({ id: "net-none", title: paired ? "No registered devices" : "Nothing new seen", subtitle: paired ? "" : "Put the device in pairing mode, wait a moment, then Scan Again", iconGlyph: "ᛒ" });
      for (const d of list) {
        const glyph = { audio: "♫", controller: "🎮", input: "⌨", other: "•" }[d.kind];
        rows.push({
          id: `bt-${d.id}`,
          title: d.name,
          subtitle: d.connected ? "Connected" : d.paired ? "Registered" : d.canPair ? "A to register" : "Seen · can't pair from here",
          iconGlyph: glyph,
          badge: d.connected ? "CONNECTED" : undefined,
          onConfirm: async () => {
            if (d.paired || !d.canPair) return;
            net.busy = `Registering ${d.name}…`;
            xmb.refresh();
            const res = await window.axm.btPair(d.id);
            net.busy = "";
            notifier.push(res.message);
            await netRefresh();
          },
          contextHint: d.paired ? "remove" : undefined,
          onContext: () => {
            if (!d.paired) return false;
            void window.axm.btUnpair(d.id).then((res) => { notifier.push(res.message); return netRefresh(); });
            return true;
          },
        });
      }
      return rows;
    };

    const aboutItems = (): MenuItem[] => [
      { id: "about-1", title: "A-X-M · Ally XMB Menu", subtitle: "Version 0.2.0 Beta 1 · a PS3-style hub for the ROG Xbox Ally", iconUrl: "assets/icons/boot-logo.png" },
      { id: "about-2", title: "This app was developed using AI.", subtitle: "It's a passion project I've always wanted since the PS3 and PSP, then seeing handhelds.", iconGlyph: "✦" },
      { id: "about-3", title: "I don't care about negative AI comments - move along.", subtitle: "Otherwise, let's bring our dreams to fruition by any means possible.", iconGlyph: "✧" },
      { id: "about-4", title: "User developed with Naha0", subtitle: "github.com/nahalewski/A-X-M", iconUrl: "assets/icons/user.png" },
      { id: "about-5", title: "Thanks to", subtitle: "SteamGridDB · TMDB · MusicBrainz · Cover Art Archive · Jellyfin · the PS3 XMB", iconGlyph: "♥" },
    ];

    // System Information: the PS3's version had the system, then storage. Ours:
    // the device row, then every drive with how full it is.
    let sysHardware: HardwareInfo | null = null;
    const systemItems = (): MenuItem[] => {
      const rows: MenuItem[] = [];
      if (sysHardware) {
        rows.push(
          { id: "sys-device", title: sysHardware.model || sysHardware.deviceName, subtitle: `${sysHardware.cpu} · ${sysHardware.ramGb} GB RAM · ${sysHardware.gpu}${sysHardware.gpuGb ? ` ${sysHardware.gpuGb} GB` : ""}`, iconGlyph: "▣" }
        );
      }
      for (const v of volumes) {
        const used = v.totalBytes ? v.usedBytes / v.totalBytes : 0;
        rows.push({
          id: `vol-${v.drive}`,
          title: `${v.label} (${v.drive})${v.system ? " · System" : ""}`,
          subtitle: `${fmtBytes(v.freeBytes)} free of ${fmtBytes(v.totalBytes)} · ${fmtBytes(v.usedBytes)} used`,
          badge: `${Math.round(used * 100)}% FULL`,
          meter: used,
          iconUrl: v.kind === "removable" ? "assets/icons/hdd.webp" : undefined,
          iconClass: v.kind === "removable" ? "hdd hdd-video" : undefined,
          iconGlyph: v.kind === "network" ? "⇄" : "▬",
        });
      }
      if (rows.length === 0) rows.push({ id: "sys-empty", title: "Reading drives…", iconGlyph: "▬" });
      return rows;
    };

    const monthsItems = (): MenuItem[] =>
      MONTH_NAMES.map((name, month) => {
        const theme = settings.monthlyThemes[month];
        const isNow = month === currentMonthIndex();
        return {
          id: `month-${month}`,
          title: isNow ? `${name} (now)` : name,
          subtitle: `${labelForColor(RIBBON_COLOR_PRESETS, theme.ribbonColor)} on ${labelForColor(
            BACKGROUND_COLOR_PRESETS,
            theme.backgroundColor
          )}`,
          iconGlyph: String(month + 1),
          onConfirm: () => go({ month }),
        };
      });

    const monthEditorItems = (month: number): MenuItem[] => [
      ...ribbonControls(() => monthTarget(month), `month-${month}`, true),
      {
        id: `month-${month}-reset`,
        title: "Reset This Month",
        iconGlyph: "↺",
        onConfirm: () => save(monthTarget(month).write({ ...DEFAULT_MONTH_THEMES[month] })),
      },
    ];

    return {
      id: "settings",
      label: "Settings",
      iconUrl: "assets/icons/settings.png",
      onBack: () => {
        if (view === "root") return false;
        if (view === "system" || view === "controller" || view === "datetime" || view === "power" || view === "chat" || view === "notify" || view === "dictionary") go("sys");
        else if (view === "network" && netView !== "root") netSub("root");
        else if (view === "tvlang") go("tv");
        else if (view === "theme" || view === "about" || view === "display" || view === "audio" || view === "sys" || view === "network" || view === "assistant" || view === "toybox" || view === "companion" || view === "tv") go("root");
        else if (view === "months") go("theme");
        else go("months");
        return true;
      },
      footerHint: () => {
        if (view === "root") return undefined;
        if (view === "theme") return "Settings › Theme";
        if (view === "months") return "Settings › Theme › Months";
        if (view === "system") return "Settings › System Information";
        if (view === "controller") return "Settings › System › Controller";
        if (view === "about") return "Settings › About A-X-M";
        if (view === "display") return "Settings › Display";
        if (view === "audio") return "Settings › Audio";
        if (view === "sys") return "Settings › System";
        if (view === "network") return net.busy || net.status || (netView === "wifi" ? "Settings › Network › Internet Connection Settings" : netView === "register" ? "Settings › Network › Register Device" : netView === "registered" ? "Settings › Network › Registered Device List" : "Settings › Network");
        if (view === "assistant") return "Settings › Assistant";
        if (view === "toybox") return "Settings › Toybox";
        if (view === "companion") return "Settings › Companion Devices";
        if (view === "tv") return "Settings › TV Streaming";
        if (view === "tvlang") return "Settings › TV Streaming › Languages";
        if (view === "datetime") return "Settings › System › Date and Time";
        if (view === "power") return "Settings › System › Power Save";
        if (view === "chat") return "Settings › System › Chat";
        if (view === "notify") return "Settings › System › Notifications";
        if (view === "dictionary") return "Settings › System › Predictive Text Dictionary";
        return `Settings › Theme › ${MONTH_NAMES[view.month]}`;
      },
      getItems: () => {
        if (view === "root") return groupedRoot();
        if (view === "theme") return themeItems();
        if (view === "months") return monthsItems();
        if (view === "system") return systemItems();
        if (view === "controller") return controllerItems();
        if (view === "about") return aboutItems();
        if (view === "display" || view === "audio" || view === "sys") {
          const group = view;
          return allRootItems().filter((i) => SETTINGS_GROUPS[i.id] === group);
        }
        if (view === "network") return networkItems();
        if (view === "assistant") return assistantItems();
        if (view === "toybox") return toyboxSettingsItems();
        if (view === "companion") return companionRows();
        if (view === "tv") return tvSettingsItems();
        if (view === "tvlang") return tvLanguageItems();
        if (view === "datetime") return dateTimeItems();
        if (view === "power") return powerItems();
        if (view === "chat") return chatItems();
        if (view === "notify") return notifyItems();
        if (view === "dictionary") return dictionaryItems();
        return monthEditorItems(view.month);
      },
    };
  }

  // Matches the real XMB running order: Users, Settings, Photo, Music, Video, Game, Network.
  /**
   * Toybox: the toys-to-life collection. The column is the quick-access layer only -
   * a few thousand figures never go in the XMB itself, so this holds counts and
   * shortcuts, and the shelf lives in the full-screen app.
   *
   * Everything here comes from the Toybox service in the main process; the renderer
   * never reads the database files, so a scan, Ghost and this column all agree.
   */
  let toybox: ToyboxSummary | null = null;
  // Which of the per-ecosystem toy box pictures exist (they come from a sprite sheet).
  const toyBoxIcons = new Set<string>();
  for (const [id, src] of Object.entries(TOY_BOXES)) {
    const probe = new Image();
    probe.onload = () => { toyBoxIcons.add(id); xmb.refresh(); };
    probe.src = src;
  }
  const refreshToybox = async () => {
    toybox = await window.axm.toyboxSummary().catch(() => null);
    xmb.refresh();
  };

  /**
   * Retro: console games through emulators, one folder per platform. A row is an
   * ordinary game (launch, Ghost, Toybox and the Y options all apply); what differs
   * is the emulator it runs in, a PS3 disc image that has to be prepared first, and
   * an emulator that isn't installed yet.
   */
  function retroCategory(): Category {
    let platform: RetroPlatform | null = null;
    /** The cartridge drive being browsed, e.g. "N:". */
    let cartridge: string | null = null;
    let emulators: { platform: RetroPlatform; name: string; exe: string | null; winget: string | null; github?: unknown; note?: string }[] = [];
    const refreshEmulators = () => void window.axm.retroEmulators().then((e) => { emulators = e; xmb.refresh(); }).catch(() => {});
    refreshEmulators();
    const retroGames = (p: RetroPlatform) => games.filter((g) => g.source === "retro" && g.platform === p && !g.hidden);
    const emuOf = (p: RetroPlatform) => emulators.find((e) => e.platform === p);
    const offerEmulator = (p: RetroPlatform) => {
      const e = emuOf(p);
      showOptions(`${RETRO_NAMES[p]} needs ${e?.name ?? "an emulator"}`, [
        ...(e?.winget || e?.github ? [{ label: `Install ${e.name}`, hint: e.winget ? "through winget, a few minutes" : "from its GitHub release into C:\\Emulators", run: async () => { notifier.push(`Installing ${e.name}`, "install"); const ok = await window.axm.installEmulator(p); notifier.push(ok ? `${e.name} installed` : `${e.name} didn't install`, "install"); games = await window.axm.getGames(); refreshEmulators(); if (ok) offerShortcut(p, e.name); } }] : []),
        { label: "Where to get it", run: () => showInfo(e?.name ?? "Emulator", `assets/icons/retro-${p}.png`, null, [{ label: "Sub-Title", value: RETRO_NAMES[p] }, { label: "Details", value: EMULATOR_SITES[p] }, ...(e?.note ? [{ label: "Needs", value: e.note }] : []), { label: "Or", value: "Point A-X-M at an existing copy: Settings › System › Emulators" }]) },
        { label: "Not now" },
      ]);
    };
    const rows = (p: RetroPlatform): MenuItem[] =>
      retroGames(p).map((g) => ({
        id: g.id,
        title: g.name,
        subtitle: g.needsPrep ?? (!g.emulator ? `${g.emulatorName ?? "Emulator"} not installed` : undefined),
        iconUrl: g.iconPath ?? RETRO_DISC[p] ?? `assets/icons/retro-${p}.png`,
        iconClass: g.iconPath ? undefined : RETRO_DISC[p] ? `disc${artPending.has(g.id) ? " spinning" : ""}` : undefined,
        backgroundUrl: g.heroPath,
        iconGlyph: sourceGlyph(g.source),
        contextGame: g,
        onConfirm: async () => {
          if (!g.emulator) {
            offerEmulator(p);
            return;
          }
          if (g.needsPrep) {
            const art = g.iconPath ?? `assets/icons/retro-${p}.png`;
            const t = settings.ps3Trim;
            const run = async () => {
              notifier.push(`${g.isoEncrypted ? "Decrypting" : "Extracting"} ${g.name} for RPCS3`, "install", art);
              try {
                const r = await window.axm.preparePs3(g.id, settings.ps3Trim);
                games = await window.axm.getGames();
                xmb.refresh();
                const saved = r.freed > 0 ? ` · ${(r.freed / 1073741824).toFixed(1)} GB trimmed` : "";
                notifier.push(`${g.name} is ready for RPCS3${saved}`, "install", art);
                // The image has done its job; the folder is what RPCS3 boots.
                showOptions(`${g.name} is ready`, [
                  { label: "Delete the disc image", hint: `frees ${(r.isoBytes / 1073741824).toFixed(1)} GB · the extracted game stays`, run: async () => { const ok = await window.axm.deleteDiscImage(g.id); notifier.push(ok ? "Disc image deleted" : "Couldn't delete the image"); games = await window.axm.getGames(); xmb.refresh(); } },
                  { label: "Keep the disc image" },
                ]);
              } catch (e) {
                notifier.push(`${g.name}: ${String((e as Error).message ?? e)}`, "install");
              }
            };
            showOptions(g.name, [
              ...(g.extractedDir
                ? [{ label: "Delete the disc image", hint: "already extracted - the folder game plays; this frees the image's space", run: async () => { const ok = await window.axm.deleteDiscImage(g.id); notifier.push(ok ? "Disc image deleted" : "Couldn't delete the image"); games = await window.axm.getGames(); xmb.refresh(); } }]
                : []),
              {
                label: g.extractedDir ? "Extract again" : g.isoEncrypted ? "Decrypt and extract for RPCS3" : "Extract for RPCS3",
                hint: `${g.isoEncrypted ? "key from the collection or the .dkey beside it · " : ""}into C:\\rpcs3\\games · a few minutes`,
                run,
              },
              {
                label: "Trim while extracting",
                hint: [t.update ? "firmware update" : "", t.dummy ? "dummy / pad files" : "", t.languages ? "other languages" : ""].filter(Boolean).join(", ") || "nothing",
                children: [
                  { label: "Firmware update (PS3_UPDATE)", hint: "always safe to drop", selected: t.update, run: async () => { settings = await window.axm.setSettings({ ps3Trim: { ...t, update: !t.update } }); } },
                  { label: "Dummy and padding files", hint: "only files that are all zeros", selected: t.dummy, run: async () => { settings = await window.axm.setSettings({ ps3Trim: { ...t, dummy: !t.dummy } }); } },
                  { label: "Languages other than English", hint: "by _FRA / _DEU style tags; a few games copy these to the HDD, so test after", selected: t.languages, run: async () => { settings = await window.axm.setSettings({ ps3Trim: { ...t, languages: !t.languages } }); } },
                ],
              },
              { label: "What this does", run: () => showInfo(g.name, art, null, [{ label: "Sub-Title", value: "PlayStation 3 disc image" }, { label: "Details", value: "RPCS3 boots games from a folder, not from a disc image. This decrypts the image with its disc key (the .dkey beside it, or one from the key collection, each checked against the disc itself) and extracts it into RPCS3's games folder. Trimming empties the files you tick, keeping their names so the game still finds them; TRIMMED.txt in the folder lists what went." }]) },
              { label: "Not now" },
            ]);
            return;
          }
          notifier.push(`Starting ${g.name}`, "general", g.iconPath);
          await window.axm.launchGame(g.id);
        },
      }));
    return {
      id: "retro",
      label: "Retro",
      iconUrl: "assets/icons/retro-arcade.png",
      onBack: () => {
        if (!platform && !cartridge) return false;
        platform = null;
        cartridge = null;
        xmb.refresh();
        return true;
      },
      footerHint: () => (cartridge ? `Retro › Cartridge (${cartridge})` : platform ? `Retro › ${RETRO_NAMES[platform]}${emuOf(platform)?.exe ? ` · ${emuOf(platform)!.name}` : ""}` : undefined),
      getItems: () => {
        if (cartridge) {
          const list = RETRO_ORDER.flatMap((p) => rows(p).filter((r) => r.contextGame?.drive?.toUpperCase() === cartridge!.toUpperCase()));
          return list.length ? list : [{ id: "retro-cartridge-empty", title: "No games found", subtitle: `Put console games in ${cartridge}\GAME\ROMS\<PS1, PS2, PS3, PSP, Switch…> on the cartridge`, iconUrl: "assets/icons/cartridge.png", iconClass: "cartridge" }];
        }
        if (platform) {
          const list = rows(platform);
          return list.length ? list : [{ id: `retro-${platform}-empty`, title: "No games found", subtitle: `Put ${RETRO_NAMES[platform]} games in ${(settings.retroFolders[platform] ?? [RETRO_DEFAULTS[platform]]).join(", ")} - or get them from the Store`, iconUrl: `assets/icons/retro-${platform}.png` }];
        }
        const carts = volumes.filter((v) => v.cartridge);
        const cartRows: MenuItem[] = carts.map((v) => {
          const n = games.filter((g) => g.source === "retro" && !g.hidden && g.drive?.toUpperCase() === v.drive.toUpperCase()).length;
          return {
            id: `retro-cartridge-${v.drive}`,
            title: `Cartridge (${v.drive})`,
            subtitle: `${n} game${n === 1 ? "" : "s"} · plugged into the SATA adapter`,
            iconUrl: "assets/icons/cartridge.png",
            iconClass: "cartridge",
            onConfirm: () => {
              cartridge = v.drive;
              xmb.resetSelection("retro");
              xmb.refresh();
            },
          };
        });
        return [...cartRows, ...RETRO_ORDER.map((p) => {
          const n = retroGames(p).length;
          const e = emuOf(p);
          return {
            id: `retro-${p}`,
            title: RETRO_NAMES[p],
            subtitle: `${n} game${n === 1 ? "" : "s"}${e ? ` · ${e.name}${e.exe ? (e.note ? ` · ${e.note}` : "") : " not installed"}` : ""}`,
            iconUrl: `assets/icons/retro-${p}.png`,
            iconClass: "disc",
            onConfirm: () => {
              platform = p;
              xmb.resetSelection("retro");
              xmb.refresh();
            },
          };
        })];
      },
    };
  }

  function toyBoxCategory(): Category {
    const count = (platform: string) => toybox?.stats.byPlatform[platform] ?? 0;
    // Inside a brand: its sub-folders (figures, power discs, vehicles, cards...).
    let brand: { id: ToyPlatform; title: string; kinds: ToyKindRow[] } | null = null;
    const openBrand = async (id: ToyPlatform, title: string) => {
      const kinds = await window.axm.toyboxKinds(id).catch(() => [] as ToyKindRow[]);
      brand = { id, title, kinds };
      xmb.resetSelection("toybox");
      xmb.refresh();
    };
    const brandIcon = (id: string) => (toyBoxIcons.has(id) ? TOY_BOXES[id] : "assets/icons/toybox.webp");

    /** One row per ecosystem, hidden when the database has nothing for it. */
    const platformRow = (id: string, title: string): MenuItem[] => {
      const n = count(id);
      if (n === 0) return [];
      return [
        {
          id: `toybox-${id}`,
          title,
          subtitle: `${n} item${n === 1 ? "" : "s"} · figures, discs, vehicles and more`,
          iconUrl: brandIcon(id),
          onConfirm: () => void openBrand(id as ToyPlatform, title),
        },
      ];
    };
    const brandItems = (): MenuItem[] => {
      const b = brand!;
      const total = b.kinds.reduce((n, k) => n + k.count, 0);
      const ownedAll = b.kinds.reduce((n, k) => n + k.owned, 0);
      return [
        {
          id: `toybox-${b.id}-all`,
          title: `All ${b.title}`,
          subtitle: `${total} items${ownedAll ? ` · ${ownedAll} owned` : ""}`,
          iconUrl: brandIcon(b.id),
          onConfirm: () => openToyShelf({ view: "all", platform: b.id }, b.title),
        },
        ...b.kinds.map((k) => ({
          id: `toybox-${b.id}-${k.kind}`,
          title: k.label,
          subtitle: `${k.count} item${k.count === 1 ? "" : "s"}${k.owned ? ` · ${k.owned} owned` : ""}`,
          iconUrl: k.kind === "figures" || k.kind === "characters" ? brandIcon(b.id) : "assets/icons/folder.png",
          onConfirm: () => openToyShelf({ view: "all", platform: b.id, kind: k.kind }, `${b.title} › ${k.label}`),
        })),
        {
          id: `toybox-${b.id}-owned`,
          title: "My Shelf",
          subtitle: ownedAll ? `${ownedAll} owned` : "Nothing marked owned yet - scan a toy or press X on it in the shelf",
          iconUrl: "assets/icons/toybox.webp",
          onConfirm: () => openToyShelf({ view: "owned", platform: b.id }, `My ${b.title}`),
        },
      ];
    };

    return {
      id: "toybox",
      label: "Toybox",
      iconUrl: "assets/icons/toybox.webp",
      onBack: () => {
        if (!brand) return false;
        brand = null;
        xmb.refresh();
        return true;
      },
      footerHint: () => {
        if (brand) return `Toybox › ${brand.title}`;
        const stats = toybox?.stats;
        if (!stats || stats.total === 0) return undefined;
        return `${stats.total} figures · database ${stats.databaseVersion ?? "?"}`;
      },
      getItems: () => {
        if (brand) return brandItems();
        // No collection database yet: say so plainly rather than showing a shelf
        // with nothing on it and nine rows that all read zero.
        if (!toybox?.hasDatabase) {
          return [
            {
              id: "toybox-no-db",
              title: "Collection database not installed",
              subtitle: "Toybox needs its figure database before it can identify anything",
              iconUrl: "assets/icons/toybox.webp",
            },
            {
              id: "toybox-about",
              title: "About Toybox",
              subtitle: "Credits, data sources and licences",
              iconUrl: "assets/icons/about.webp",
            },
          ];
        }

        const recent = toybox.recent.length;
        const favorites = toybox.favorites.length;
        return [
          {
            id: "toybox-open",
            title: "Open Toybox",
            subtitle: "The collection shelf",
            iconUrl: "assets/icons/toybox.webp",
            onConfirm: () => openToyShelf({ view: "owned", platform: "" }, "My Shelf"),
          },
          {
            id: "toybox-recent",
            title: "Recently Scanned",
            subtitle: recent === 0 ? "Nothing scanned yet" : `${recent} figure${recent === 1 ? "" : "s"}`,
            iconUrl: "assets/icons/toybox.webp",
            onConfirm: () => openToyShelf({ view: "recent", platform: "" }, "Recently Scanned"),
          },
          {
            id: "toybox-favorites",
            title: "Favorites",
            subtitle: favorites === 0 ? "None yet" : `${favorites} figure${favorites === 1 ? "" : "s"}`,
            iconUrl: "assets/icons/toybox.webp",
            onConfirm: () => openToyShelf({ view: "favorites", platform: "" }, "Favourites"),
          },
          ...platformRow("amiibo", "Amiibo"),
          ...platformRow("skylanders", "Skylanders"),
          ...platformRow("disney-infinity", "Disney Infinity"),
          ...platformRow("lego-dimensions", "LEGO Dimensions"),
          {
            id: "toybox-backups",
            title: "Backups",
            subtitle: "Your own tag backups, kept on this machine",
            iconUrl: "assets/icons/folder.png",
          },
          {
            id: "toybox-about",
            title: "About Toybox",
            subtitle: "Credits, data sources and licences",
            iconUrl: "assets/icons/about.webp",
          },
        ];
      },
    };
  }

  /**
   * Store: the column for getting hold of things rather than for what is already
   * installed. Empty until it is pointed at a source, so it shows the same kind of
   * empty state every other column does rather than pretending to have a catalogue.
   */
  function storeCategory(): Category {
    return {
      id: "store",
      label: "Store",
      iconUrl: "assets/icons/store.webp",
      getItems: () => [
        { id: "store-open", title: "Open Store", subtitle: `Your shelf on ${settings.storeRoot} and the emulators that play it`, iconUrl: "assets/icons/store.webp", onConfirm: () => openStore("explore") },
        { id: "store-emulators", title: "Emulators", subtitle: "RPCS3, PCSX2, DuckStation, PPSSPP, Eden, shadPS4, Kyty - install with one press", iconUrl: "assets/icons/retro-ps3.png", iconClass: "disc", onConfirm: () => openStore("emulators") },
        ...RETRO_ORDER.map((p) => ({ id: `store-${p}`, title: RETRO_NAMES[p], subtitle: `${RETRO_NAMES[p]} games on the shelf`, iconUrl: `assets/icons/retro-${p}.png`, iconClass: "disc", onConfirm: () => openStore(p) })),
      ],
    };
  }

  /**
   * The download queue, shown at the foot of every column that can start one.
   *
   * One queue, not six: a rip, a store install and a voice model all go through the
   * same transfer channel, and someone asking "what is downloading" wants the
   * answer, not the answer for this column only. The row names whatever is nearest
   * to finishing so the subtitle is useful at a glance without opening anything.
   */
  const downloadRow = (): MenuItem => {
    const jobs = [...transfers.values()].filter((t) => !t.finished);
    const pct = (t: TransferProgress) => (t.total > 0 ? Math.round((t.done / t.total) * 100) : 0);
    const nearest = jobs.slice().sort((a, b) => pct(b) - pct(a))[0];

    return {
      id: "downloads",
      title: "Downloads",
      subtitle:
        jobs.length === 0
          ? "Nothing downloading"
          : jobs.length === 1
            ? `${nearest.name.split(" · ")[0]} · ${pct(nearest)}%`
            : `${jobs.length} in progress · ${nearest.name.split(" · ")[0]} ${pct(nearest)}%`,
      iconUrl: "assets/icons/download.webp",
      onConfirm: () => {
        if (jobs.length === 0) {
          showInfo("Downloads", undefined, null, [
            { label: "Queue", value: "Nothing is downloading right now" },
          ]);
          return;
        }
        showInfo(
          "Downloads",
          undefined,
          null,
          jobs.map((t) => ({ label: `${pct(t)}%`, value: t.name.split(" · ")[0] }))
        );
      },
    };
  };

  const categories: Category[] = [
    usersCategory(),
    settingsCategory(),
    mediaCategory("photo", "Photo", "assets/icons/photo.png", () => photoListing, (l) => (photoListing = l), (open) => driveRows("photo", open)),
    musicCategory(),
    mediaCategory(
      "video",
      "Video",
      "assets/icons/video.png",
      () => videoListing,
      (l) => (videoListing = l),
      (open) => [tvEntry, jellyfinEntry, ...discRows(["dvd", "bluray"]), ...driveRows("video", open)],
      // One mode slot, two apps: whichever is open answers. TV is checked first
      // because opening it is what set the flag.
      {
        active: () => tv.active || jf.active,
        items: () => (tv.active ? tvMenu() : jfItems()),
        back: () => (tv.active ? tvBack() : jfBack()),
        hint: () => (tv.active ? tvHint() : jfHint()),
      }
    ),
    gamesCategory(),
    retroCategory(),
    toyBoxCategory(),
    storeCategory(),
    browserCategory(),
  ];
  const gameBackground = new GameBackground(document.getElementById("game-bg")!);

  // ---- Wallpaper -----------------------------------------------------------------
  //
  // A picture behind the ribbons, in place of the plain month colour; the game hero
  // still takes over when a game is focused. Shuffle mode draws another picture
  // from the same folder every few minutes.
  const wallpaperEl = document.getElementById("wallpaper")!;
  let wallpaperTimer = 0;
  const applyWallpaper = async () => {
    clearInterval(wallpaperTimer);
    wallpaperTimer = 0;
    const w = settings.wallpaper;
    if (!w) {
      wallpaperEl.classList.remove("visible");
      return;
    }
    const show = (url: string) => {
      wallpaperEl.style.backgroundImage = `url(${JSON.stringify(url)})`;
      wallpaperEl.classList.add("visible");
    };
    show(w.url);
    if (w.mode === "shuffle") {
      const pick = async () => {
        const listing = await window.axm.browseMedia("photo", w.folder);
        const files = listing.entries.filter((e) => e.kind === "file" && e.url);
        if (files.length > 0) show(files[Math.floor(Math.random() * files.length)].url!);
      };
      wallpaperTimer = window.setInterval(() => void pick(), 3 * 60_000);
    }
  };
  const setWallpaper = async (w: Settings["wallpaper"]) => {
    settings = await window.axm.setSettings({ wallpaper: w });
    await applyWallpaper();
    audio.playConfirm();
    xmb.refresh();
  };
  void applyWallpaper();
  const xmb = new Xmb(categories, audio);
  xmb.setOnSelectionChange((item) => gameBackground.show(item?.backgroundUrl));

  // Menu resolution: the main process sets the page zoom so the layout is `target`
  // rows tall; here the frame buffers are scaled to match, so 720p really is 720p.
  const applyResolutionState = (state: ResolutionState) => {
    resolution = state;
    const physical = Math.round(window.innerHeight * (window.devicePixelRatio || 1));
    const scale = state.target && physical ? state.target / physical : 1;
    ribbon.setRenderScale(scale);
    visualizer.setRenderScale(scale);
    applyUpscaling();
    xmb.refresh();
  };
  const applyUpscaling = () => {
    const physical = Math.round(window.innerHeight * (window.devicePixelRatio || 1));
    const below = resolution.target > 0 && physical > 0 && resolution.target < physical;
    document.body.classList.toggle("upscaled", below);
    document.body.classList.toggle("sharpen", settings.menuUpscaling === "sharpen");
    document.body.classList.toggle("sharpen-strong", settings.menuUpscaling === "sharpen-strong");
  };
  window.axm.onResolution((state) => applyResolutionState(state));
  void window.axm.getResolution().then(applyResolutionState);

  // Y on a game: the PS3 sidebar - Play, Lossless Scaling ▸, Change Artwork, Folder,
  // Information.
  const changeArtwork = async (game: GameEntry) => {
        const pickPromise = pickFromGrid(`Artwork for ${game.name}`, []);
        gridPicker.setStatus("Looking up artwork on SteamGridDB…");
        const choices = await window.axm.listArtChoices(game.id);
        if (gridPicker.isOpen()) {
          gridPicker.setChoices(
            choices.map((c) => ({ id: String(c.id), imageUrl: c.thumb })),
            choices.length === 0 ? "No artwork found for this game" : `${choices.length} covers`
          );
        }
        const pick = await pickPromise;
        if (!pick) return;
        const full = choices.find((c) => String(c.id) === pick.id)?.url ?? pick.imageUrl;
        const cached = await window.axm.setGameArt(game.id, full);
        if (cached) {
          game.iconPath = cached;
          audio.playConfirm();
          xmb.refresh();
        }
  };
  /**
   * HD Texture Packs, for a PS1 / PS2 game: the packs the curated list has for its
   * serial, each with Download / Enable / Disable / Delete. The pack lands in
   * ROOT\TEXTURES and is linked into the emulator's own textures folder.
   */
  const textureProgress = new Map<string, string>();
  window.axm.onTextureProgress(({ slug, note }) => textureProgress.set(slug, note));
  const hdTexturePacks = async (game: GameEntry) => {
    const r = await window.axm.texturePacksFor(game.id);
    const platform = game.platform as "ps1" | "ps2";
    if (!r) { notifier.push("Texture packs need a disc image the menu can read"); return; }
    if (!r.status) {
      showInfo(`HD Texture Packs · ${game.name}`, game.iconPath, null, [
        { label: "Serial", value: r.serial ?? "not found in the image" },
        { label: "Packs", value: "None in A-X-M's list for this game yet." },
        { label: "Where to look", value: "Game › About & Credits lists the community collections; a pack you unpack by hand into ROOT\\TEXTURES\\" + platform + "\\<SERIAL>\\<name>\\ can be linked from here once it's added to assets/textures-db." },
      ]);
      return;
    }
    const st = r.status;
    const act = async (fn: () => Promise<{ ok: boolean; message: string }>) => { const x = await fn(); notifier.push(x.message, "install", game.iconPath); void hdTexturePacks(game); };
    showOptions(`HD Texture Packs · ${st.game.title}`, [
      ...st.packs.map(({ pack, slug, installed }) => ({
        label: pack.name,
        hint: [installed ? (installed.enabled ? "ON" : "downloaded") : `${pack.sizeMb ? `${pack.sizeMb >= 1024 ? `${(pack.sizeMb / 1024).toFixed(1)} GB` : `${pack.sizeMb} MB`}` : "size unknown"}`, `by ${pack.author}`, textureProgress.get(slug) ?? ""].filter(Boolean).join(" · "),
        selected: !!installed?.enabled,
        children: [
          ...(!installed ? [{ label: "Download Pack", hint: `${pack.repo} · into ROOT\\TEXTURES\\${platform}\\${st.serial}`, run: () => act(() => window.axm.textureInstall(platform, st.serial, slug)) }] : []),
          ...(installed && !installed.enabled ? [{ label: "Enable Pack", hint: st.emulator.texturesDir ? `links into ${st.emulator.texturesDir}\\${st.serial}\\replacements` : "run the emulator once first", run: () => act(() => window.axm.textureEnable(platform, st.serial, slug)) }] : []),
          ...(installed?.enabled ? [{ label: "Disable Pack", run: () => act(() => window.axm.textureDisable(platform, st.serial, slug)) }] : []),
          ...(installed ? [{ label: "Download again", hint: "refreshes from the source", run: () => act(() => window.axm.textureInstall(platform, st.serial, slug)) }, { label: "Delete Pack", children: [{ label: `Yes, delete ${pack.name}`, run: () => act(() => window.axm.textureDelete(platform, st.serial, slug)) }, { label: "No" }] }] : []),
          { label: "About this pack", run: () => showInfo(pack.name, game.iconPath, null, [{ label: "Author", value: pack.author }, { label: "Source", value: `github.com/${pack.repo}` }, { label: "Size", value: pack.sizeMb ? `about ${pack.sizeMb} MB` : "not listed" }, ...(pack.license ? [{ label: "Licence", value: pack.license }] : []), ...(pack.notes ? [{ label: "Notes", value: pack.notes }] : []), { label: "Serial", value: st.serial }]) },
        ],
      })),
      { label: "Where to find more", run: () => void window.axm.textureDb().then((db) => showInfo("HD Texture Packs", undefined, null, db.moreSources.map((s) => ({ label: s.name, value: s.url })))) },
    ]);
  };

  xmb.setOnGameContext((game) => {
    const profiles: (1 | 2 | 3 | null)[] = [null, 1, 2, 3];
    showOptions(game.name, [
      { label: "Play", run: () => void window.axm.launchGame(game.id) },
      {
        label: "Lossless Scaling",
        hint: game.losslessProfile ? `Profile ${game.losslessProfile}` : "Off",
        children: profiles.map((p) => ({
          label: p ? `Profile ${p}` : "Off",
          selected: game.losslessProfile === p,
          run: async () => {
            settings = await window.axm.setLosslessProfile(game.id, p);
            game.losslessProfile = p;
            xmb.refresh();
          },
        })),
      },
      { label: "Change Artwork…", hint: "SteamGridDB", run: () => changeArtwork(game) },
      ...(game.source === "retro" && (game.platform === "ps1" || game.platform === "ps2") ? [{ label: "HD Texture Packs", hint: game.platform === "ps1" ? "DuckStation" : "PCSX2", run: () => hdTexturePacks(game) }] : []),
      ...(game.installDir && game.source !== "xbox" ? [{ label: "Open Folder", run: () => void window.axm.openFolder(game.installDir) }] : []),
      {
        label: "Information",
        run: () =>
          showInfo(game.name, game.iconPath, game.installDir && game.source !== "xbox" ? game.installDir : null, [
            { label: "Sub-Title", value: game.source === "retro" ? `${RETRO_NAMES[game.platform!] ?? "Retro"} · ${game.emulatorName ?? "emulator"}${game.emulator ? "" : " (not installed)"}` : ({ steam: "Steam", epic: "Epic Games", xbox: "Xbox / Game Pass", generic: "Installed program" }[game.source] ?? game.source) },
            ...(game.romPath ? [{ label: "Image", value: game.romPath }] : []),
            ...(game.needsPrep ? [{ label: "Note", value: game.needsPrep }] : []),
            { label: "Drive", value: game.drive },
            { label: "Folder", value: game.installDir ?? "" },
            { label: "Lossless Scaling", value: game.losslessProfile ? `Profile ${game.losslessProfile}` : "Off" },
            { label: "Artwork", value: game.iconPath ? (game.iconPath.startsWith("http") ? "Steam" : "SteamGridDB / cached") : "None" },
          ]),
      },
    ]);
  });
  // Start on Game - it's a game hub first, whatever the XMB running order is.
  xmb.setActiveCategory("games");
  xmb.init();

  // Now-playing bar, driven by the player's own state changes.
  const npEl = document.getElementById("now-playing")!;
  const npTitle = document.getElementById("np-title")!;
  const npFolder = document.getElementById("np-folder")!;
  const npState = document.getElementById("np-state")!;
  const npIcon = spriteEl("player", "play", "np-spr");
  document.getElementById("np-icon")!.appendChild(npIcon);
  // The cover, when the track has one (embedded, or from the Cover Art Archive).
  const npArt = document.createElement("img");
  npArt.id = "np-art";
  npArt.addEventListener("error", () => npArt.removeAttribute("src"));
  npEl.insertBefore(npArt, npEl.firstChild);
  const npFill = document.getElementById("np-progress-fill")!;
  let lastTrackPath: string | null = null;

  // ---- What is playing, for the companion phone ----------------------------------
  let videoArt: { title: string; art?: string } | null = null;
  /** Where the music comes out: this PC, or a phone that took it over. */
  let audioOutput: "host" | "phone" = "host";
  let phonePlaying = false;
  let lastMediaSent = "";
  let lastMediaAt = 0;
  const publishMedia = (force = false) => {
    const now = Date.now();
    const track = musicPlayer.current();
    const video = mediaViewer.isOpen() ? mediaViewer.current() : null;
    const videoEl = document.querySelector("#media-viewer video") as HTMLVideoElement | null;
    let state: Parameters<typeof window.axm.companionMedia>[0];
    if (video && videoEl) {
      const art = videoArt && videoArt.title === video.name ? videoArt.art : undefined;
      state = { kind: "video", playing: !videoEl.paused && !videoEl.ended, title: video.name, artist: video.filePath.replace(/[\\/][^\\/]*$/, "").split(/[\\/]/).pop(), artworkUrl: art && /^https?:/.test(art) ? art : undefined, positionSeconds: Math.floor(videoEl.currentTime || 0), durationSeconds: isFinite(videoEl.duration) ? Math.floor(videoEl.duration) : undefined };
    } else if (track) {
      state = { kind: "music", output: audioOutput, filePath: track.filePath, playing: audioOutput === "phone" ? phonePlaying : musicPlayer.isPlaying(), title: track.name, artist: track.filePath.replace(/\\[^\\]*$/, "").split("\\").slice(-2, -1)[0], album: track.filePath.replace(/\\[^\\]*$/, "").split("\\").slice(-1)[0], artworkUrl: musicArt.get(track.filePath), positionSeconds: Math.floor(musicPlayer.position()), durationSeconds: Math.floor(musicPlayer.duration()) || undefined };
    } else state = { kind: "none", playing: false };
    const key = JSON.stringify({ ...state, positionSeconds: undefined });
    // Position ticks once a second at most; anything else goes out at once.
    if (!force && key === lastMediaSent && now - lastMediaAt < 1000) return;
    lastMediaSent = key;
    lastMediaAt = now;
    window.axm.companionMedia(state);
  };
  /** Cover art the menu already fetched for a track (Song Information / MusicBrainz). */
  const musicArt = new Map<string, string>();
  setInterval(() => { if (mediaViewer.isOpen()) publishMedia(); }, 1000);
  setInterval(() => { if (!mediaViewer.isOpen() && !musicPlayer.current() && lastMediaSent !== JSON.stringify({ kind: "none", playing: false })) publishMedia(true); }, 2000);

  let artLookup = "";
  /** Lyrics for the Karaoke visualizer: the file's tags name the song, LRCLIB has the words. */
  let lyricsFor = "";
  const fetchLyrics = async (track: { filePath: string; name: string }) => {
    lyricsFor = track.filePath;
    visualizer.setLyrics(null, false, settings.lyricsEnabled ? "Looking for the words…" : track.name);
    if (!settings.lyricsEnabled) return;
    const info = await window.axm.getSongInfo(track.filePath).catch(() => null);
    if (lyricsFor !== track.filePath) return;
    const folders = track.filePath.replace(/\\[^\\]*$/, "").split("\\");
    const artist = info?.artist || folders[folders.length - 2] || "";
    const title = info?.title || track.name.replace(/\.[a-z0-9]+$/i, "").replace(/^\d+\s*[-.]\s*/, "");
    const lyrics = await window.axm.findLyrics(artist, title, info?.album ?? folders[folders.length - 1] ?? "", info?.durationSec || musicPlayer.duration() || 0).catch(() => null);
    if (lyricsFor !== track.filePath) return;
    if (lyrics?.lines.length) visualizer.setLyrics(lyrics.lines, lyrics.synced);
    else visualizer.setLyrics(null, false, `${title} · no lyrics found`);
  };
  visualizer.setPositionSource(() => musicPlayer.position());
  musicPlayer.setOnChange(() => {
    publishMedia();
    const track = musicPlayer.current();
    // The cover for the phone's screen: looked up once per track, in the background.
    if (track && !musicArt.has(track.filePath) && artLookup !== track.filePath) {
      artLookup = track.filePath;
      void window.axm.getSongInfo(track.filePath).then((info) => {
        if (info?.coverUrl) {
          musicArt.set(track.filePath, info.coverUrl);
          publishMedia(true);
          if (musicPlayer.current()?.filePath === track.filePath) npArt.src = info.coverUrl;
        }
      }).catch(() => {});
    }
    if (!track) {
      npEl.classList.add("hidden");
      lastTrackPath = null;
      // Playback has genuinely stopped (end of queue, or the user stopped it) - this
      // is the only point the background visualizer clears. Track-to-track changes
      // keep it up.
      if (visualizer.currentMode() !== "off") clearVisualizer();
      xmb.refresh();
      return;
    }
    npEl.classList.remove("hidden");
    const cover = musicArt.get(track.filePath);
    if (cover) {
      if (npArt.getAttribute("src") !== cover) npArt.src = cover;
    } else if (track.filePath !== lastTrackPath) npArt.removeAttribute("src");
    npTitle.textContent = track.name;
    npFolder.textContent = track.filePath.replace(/\\[^\\]*$/, "").split("\\").slice(-2).join(" - ");
    npState.textContent = musicPlayer.isPlaying() ? "PLAYING" : "PAUSED";
    npIcon.setFrame(musicPlayer.isPlaying() ? "eq" : "pause");
    npFill.style.width = `${musicPlayer.progress() * 100}%`;

    // Only re-render the menu when the track itself changes, not on every tick.
    if (track.filePath !== lastTrackPath) {
      lastTrackPath = track.filePath;
      visualizer.setTrackName(track.name);
      void fetchLyrics(track);
      xmb.refresh();
    }
  });

  // The splash wordmark is the bundled logo; it fades in once it has decoded.
  const bootLogoImg = document.getElementById("boot-logo-img") as HTMLImageElement;
  bootLogoImg.onload = () => bootLogoImg.classList.add("loaded");
  bootLogoImg.src = "assets/icons/boot-logo.png";

  // Box art arrives asynchronously in the background - patch it in as it lands.
  window.axm.onArtUpdated(({ gameId, iconPath, heroPath, searched }) => {
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    if (iconPath) game.iconPath = iconPath;
    if (heroPath) game.heroPath = heroPath;
    if (searched || iconPath) { artPending.delete(gameId); artSearched.add(gameId); }
    // refresh() re-runs the selection callback, so a banner that arrives while its
    // game is already focused still fades in.
    xmb.refresh();
  });

  const gamepad = new GamepadNav((action) => {
    noteInput();
    if (action === "guide") {
      void window.axm.overlayToggle();
      return;
    }
    xmb.handleAction(action);
  });
  gamepad.setDeadZone(settings.gamepadDeadZone);
  gamepad.setSwapConfirm(settings.gamepadProfile === "swapped");
  gamepad.setVibration(settings.gamepadVibration);
  // ---- Ghost: what it can be asked to do ------------------------------------------
  //
  // Built fresh on every utterance so new games, playlists and settings count.
  const settingLabels: { name: string; go: () => void }[] = [];
  const goCategory = (id: string) => {
    xmb.setActiveCategory(id);
    xmb.refresh();
  };
  assistant.setCommands((): Command[] => {
    const cmds: Command[] = [];
    for (const g of games.filter((x) => !x.hidden)) {
      cmds.push({ verbs: ["launch", "start", "play", "open", "run"], name: g.name, reply: `Launching ${g.name}`, weight: 0.2, run: () => { notifier.push(`Starting ${g.name}`, "general", g.iconPath); void window.axm.launchGame(g.id); } });
    }
    for (const pl of settings.playlists) {
      cmds.push({ verbs: ["play", "shuffle", "start"], name: `playlist ${pl.name}`, reply: `Playing ${pl.name}`, weight: 0.3, run: () => {
        const tracks: MusicEntry[] = pl.tracks.map((t) => ({ kind: "track", name: t.name, filePath: t.filePath, url: t.url }));
        if (tracks.length) musicPlayer.play(tracks[0], tracks, settings.musicVolume);
      } });
      cmds.push({ verbs: ["play", "start"], name: pl.name, reply: `Playing ${pl.name}`, run: () => {
        const tracks: MusicEntry[] = pl.tracks.map((t) => ({ kind: "track", name: t.name, filePath: t.filePath, url: t.url }));
        if (tracks.length) musicPlayer.play(tracks[0], tracks, settings.musicVolume);
      } });
    }
    for (const entry of musicListing.entries.filter((e) => e.kind === "track")) {
      cmds.push({ verbs: ["play"], name: entry.name, reply: `Playing ${entry.name}`, run: () => musicPlayer.play(entry, musicListing.entries, settings.musicVolume) });
    }
    const columns: [string, string][] = [["users", "users"], ["settings", "settings"], ["photo", "photo"], ["music", "music"], ["video", "video"], ["games", "game"], ["browser", "network"]];
    for (const [id, name] of columns) {
      cmds.push({ verbs: ["go to", "open", "show", "navigate to", "navigate"], name, reply: `Opening ${name}`, run: () => goCategory(id) });
    }
    for (const sl of settingLabels) cmds.push({ verbs: ["go to", "open", "show", "navigate to", "change", "set"], name: sl.name, reply: `Opening ${sl.name}`, run: sl.go });

    // Pairing, asked for out loud. Ghost answers in his own bubble with the
    // address and the steps, so nobody has to find the Settings screen first -
    // and if a phone is already waiting, he reads out the code it needs.
    cmds.push({
      verbs: ["pair", "connect", "set up", "setup", "link"],
      name: "my phone",
      reply: "Open A-X-M Companion on your phone and tap this machine. I'll show you the code.",
      weight: 0.4,
      run: async () => {
        await refreshCompanion();
        const state = companionState;
        if (!state?.enabled) {
          await window.axm.companionSetEnabled(true);
          await refreshCompanion();
        }
        showInfo("Pair your phone", undefined, null, [
          { label: "1", value: "Put the phone on the same Wi-Fi as this machine" },
          { label: "2", value: "Open A-X-M Companion and tap this machine" },
          { label: "3", value: "A four digit code appears here; type it on the phone" },
          { label: "Address", value: companionState?.addresses.join(", ") || "no network found" },
        ]);
      },
    });
    // The Toybox shelf: "open my shelf", "show my amiibo", "open toybox favourites".
    if (toybox?.hasDatabase) {
      cmds.push({ verbs: ["open", "show", "go to"], name: "my shelf", reply: "Opening your shelf", weight: 0.2, run: () => openToyShelf({ view: "owned", platform: "" }, "My Shelf") });
      cmds.push({ verbs: ["open", "show", "go to"], name: "toybox shelf", reply: "Opening the Toybox shelf", run: () => openToyShelf({ view: "owned", platform: "" }, "My Shelf") });
      cmds.push({ verbs: ["open", "show", "go to"], name: "toybox favourites", reply: "Opening your favourites", run: () => openToyShelf({ view: "favorites", platform: "" }, "Favourites") });
      for (const [id, label] of Object.entries(TOY_PLATFORM_NAMES)) if ((toybox.stats.byPlatform[id] ?? 0) > 0) cmds.push({ verbs: ["open", "show", "go to"], name: `my ${label}`, reply: `Opening your ${label}`, run: () => openToyShelf({ view: "all", platform: id as ToyPlatform }, label) });
    }
    // Discs in the drive: "copy the blu-ray to storage", "rip the dvd", "import the cd", "play the disc".
    for (const d of discs) {
      const where = targetLabel(settings.discTarget);
      const names = d.kind === "audio-cd" ? ["cd", "audio cd", "compact disc", "disc"] : d.kind === "bluray" ? ["blu ray", "bluray", "blue ray", "disc", "movie"] : d.kind === "dvd" ? ["dvd", "disc", "movie"] : [];
      if (d.kind === "dvd" || d.kind === "bluray") names.push(discTitle(d));
      for (const n of names) {
        if (d.kind === "audio-cd") cmds.push({ verbs: ["copy", "import", "rip", "back up", "backup", "save"], name: n, reply: `Importing the CD to ${where} as ${settings.importFormat.toUpperCase()}`, weight: 0.3, run: () => startCdImport(d, settings.discTarget) });
        else if (d.kind === "dvd" || d.kind === "bluray") {
          cmds.push({ verbs: ["copy", "rip", "back up", "backup", "save", "import"], name: n, reply: `Ripping ${discTitle(d)} to ${where}`, weight: 0.3, run: () => void startRip(d, settings.discTarget) });
          cmds.push({ verbs: ["play", "watch", "start"], name: n, reply: discMeta.get(d.drive + d.label)?.backup ? `Playing ${discTitle(d)}` : `${discTitle(d)} isn't ripped yet - rip it first`, weight: 0.25, run: () => playDisc(d) });
        }
      }
    }
    cmds.push(
      { verbs: ["stop", "pause"], name: "music", reply: musicPlayer.current() ? "Pausing" : "Nothing is playing", weight: 0.4, run: () => musicPlayer.togglePause() },
      { verbs: ["next", "skip"], name: "track", reply: "Next track", run: () => musicPlayer.next() },
      { verbs: ["previous", "back"], name: "track", reply: "Previous track", run: () => musicPlayer.previous() },
      { verbs: ["open", "start"], name: "visualizer", reply: "Opening the visualizer", run: () => { if (musicPlayer.current()) enterStage(); } },
      { verbs: ["open", "start", "launch"], name: "remote play", reply: "Starting Remote Play", run: () => goCategory("browser") },
      { verbs: ["open", "show"], name: "browser", reply: "Opening the browser", run: () => goCategory("browser") },
      { verbs: ["quit", "close", "exit"], name: "game", reply: "Quitting the game", run: () => void window.axm.quitRunningGame() },
      { verbs: ["turn off", "shut down", "shutdown"], name: "system", reply: "Turning off - are you sure?", run: () => confirmPower("Turn Off System", "shutdown") },
      { verbs: ["go to", "put", "enter"], name: "sleep", reply: "Going to sleep", run: () => confirmPower("Sleep", "sleep") },
      { verbs: ["volume", "turn volume", "set volume"], name: "up", reply: "Louder", run: () => void window.axm.setSettings({ musicVolume: Math.min(1, settings.musicVolume + 0.25) }).then((n) => { settings = n; audio.setVolumes(n.musicVolume, n.sfxVolume); musicPlayer.setVolume(n.musicVolume); }) },
      { verbs: ["volume", "turn volume", "set volume"], name: "down", reply: "Quieter", run: () => void window.axm.setSettings({ musicVolume: Math.max(0, settings.musicVolume - 0.25) }).then((n) => { settings = n; audio.setVolumes(n.musicVolume, n.sfxVolume); musicPlayer.setVolume(n.musicVolume); }) },
      { verbs: ["what can you do", "help"], name: "help", reply: "Say launch and a game, play and a playlist, go to a column or a setting, copy the disc to storage, next track, quit game, or turn off.", run: () => {} }
    );
    return cmds;
  });
  void applyAssistant();

  gamepad.setOnControllerType((type, model) => {
    for (const t of ["ps", "switch", "kishi"]) document.body.classList.toggle(`pad-${t}`, type === t);
    notifier.push(`${model} connected`, "controller");
  });
  const pollGamepad = (now: number) => {
    gamepad.poll(now);
    requestAnimationFrame(pollGamepad);
  };
  requestAnimationFrame(pollGamepad);

  // Dim the menu after a spell of no input, if asked to; any press wakes it.
  let lastInput = performance.now();
  const noteInput = () => {
    lastInput = performance.now();
    document.body.classList.remove("dimmed");
  };
  document.addEventListener("keydown", noteInput);
  setInterval(() => {
    if (settings.menuDimMinutes > 0 && performance.now() - lastInput > settings.menuDimMinutes * 60_000) document.body.classList.add("dimmed");
  }, 5000);

  audio.playBootThenAmbient();

  const bootSplash = document.getElementById("boot-splash")!;
  setTimeout(() => {
    bootSplash.classList.add("hidden");
    // First boot: no profile yet, so set one up before the menu is used. The sparkle
    // then plays when that finishes; otherwise it plays here, as the menu appears.
    if (!settings.profile) void runProfileSetup(null);
    else if (settings.introSparkleEnabled) playIntroSparkle(document.body);
  }, 1600);

  // Background rescan shortly after boot to pick up anything the first pass missed,
  // and to fill in the media categories without blocking startup on slow drives.
  setTimeout(async () => {
    const [scannedGames, videos, photos, listing, steam, drives] = await Promise.all([
      window.axm.scanGames(),
      window.axm.browseMedia("video", null),
      window.axm.browseMedia("photo", null),
      window.axm.browseMusic(null),
      window.axm.getSteamLibrary(),
      window.axm.getMediaDrives(),
    ]);
    // The Toybox summary is cheap and local, but it has no business holding up the
    // first paint - it lands with the rest of the background scans.
    void refreshToybox();
    games = scannedGames;
    mediaDrives = drives;
    videoListing = videos;
    photoListing = photos;
    musicListing = listing;
    steamLibrary = steam;
    xmb.refresh();
  }, 3000);
}

main().catch((err) => {
  console.error("[A-X-M] fatal error during startup:", err);
});
