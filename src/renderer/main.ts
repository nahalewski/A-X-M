import "./types";
import { RibbonBackground } from "../background/RibbonBackground";
import { AudioManager, AMBIENT_TRACKS, AMBIENT_TRACK_IDS } from "./audio";
import { GamepadNav } from "./gamepad";
import { Xmb, Category, MenuItem, sourceGlyph, btn } from "./xmb";
import { MusicPlayer } from "./musicPlayer";
import { MusicVisualizer, VISUALIZER_STYLES, VISUALIZER_STYLE_IDS, VisualizerStyle } from "./visualizer";
import { spriteEl, spriteHtml, progressRing } from "./sprites";
import { playIntroSparkle } from "./intro";
import { OptionsPopup, InfoCard, PopupOption } from "./popups";
import { MediaViewer } from "./mediaViewer";
import { GridPicker, GridChoice } from "./gridPicker";
import { TextEntry } from "./textEntry";
import { BatteryIndicators } from "./battery";
import { StatusIcons } from "./statusIcons";
import { Hud } from "./hud";
import { GameBackground } from "./background";
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
      .map((d): MenuItem => ({
        id: `drive-${kind}-${d.drive}`,
        title: `${d.drive} Drive`,
        subtitle: `${kind.toUpperCase()} folder`,
        iconUrl: "assets/icons/hdd.webp",
        iconClass: `hdd hdd-${kind}`,
        onConfirm: () => open(d[kind]!),
      }));
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
  const gridPicker = new GridPicker(document.getElementById("grid-picker")!);
  const textEntry = new TextEntry(document.getElementById("text-entry")!);
  const optionsPopup = new OptionsPopup(document.getElementById("options-popup")!);
  const infoCard = new InfoCard(document.getElementById("info-card")!);

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
  const showOptions = (title: string, options: PopupOption[]) => {
    if (options.length === 0) return;
    optionsPopup.show(title, options, () => popOverlay());
    pushOverlay((a) => optionsPopup.handle(a as Parameters<OptionsPopup["handle"]>[0]));
    audio.playConfirm();
  };
  const showInfo = (title: string, art: string | undefined, load: () => Promise<void>) => {
    infoCard.loading(title, art, () => popOverlay());
    pushOverlay((a) => infoCard.handle(a as Parameters<InfoCard["handle"]>[0]));
    void load();
  };

  // ---- Copy / download targets ----------------------------------------------------
  //
  // Every mounted drive other than the one the file already sits on, plus "this PC"
  // for files that live on an external drive. Refreshed each time a menu asks, so a
  // stick plugged in a moment ago is offered.
  let volumes: VolumeInfo[] = [];
  const refreshVolumes = async () => {
    volumes = await window.axm.getVolumes();
  };
  void refreshVolumes();
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
    if (p.finished) {
      transfers.delete(p.id);
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
        const text = p.error ? `${p.name} — ${p.error}` : `${p.id.startsWith("dl-") ? "Downloading" : "Copying"} ${p.name} → ${p.destination} · ${pct}%`;
        return `<div class="transfer${p.error ? " error" : ""}"><span class="ring" style="background-position:${(Math.round((pct / 100) * 16) * 100) / 16}% 0"></span><div class="transfer-text"><span>${text}</span><div class="transfer-bar"><div style="width:${pct}%"></div></div></div></div>`;
      })
      .join("");
  };

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
  const setOverlayMode = (active: boolean) => {
    overlayActive = active;
    document.body.classList.toggle("overlay", active);
    if (active) {
      ribbon.setRibbonsVisible(false);
      ribbon.setBackdrop("none");
      // Menu music over a game would fight the game's own audio.
      void audio.fadeOutAmbient(300);
    } else {
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
    clockEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  updateClock();
  setInterval(updateClock, 15_000);

  const batteries = new BatteryIndicators(document.getElementById("batteries")!);
  batteries.setPercentVisible(settings.batteryPercentEnabled);
  void batteries.start();
  audio.setSfxEnabled(settings.navSoundsEnabled);
  audio.setAmbientEnabled(settings.menuMusicEnabled);
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
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
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
    return {
      id: "browser",
      label: "Browser",
      iconUrl: "assets/icons/browser.png",
      footerHint: () => (browserOpen ? browserToolbar() : undefined),
      getItems: () => [
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
    let playlistView = false;
    const openFolder = async (dirPath: string | null) => {
      playlistView = false;
      musicListing = await window.axm.browseMusic(dirPath);
      xmb.resetSelection("music");
      xmb.refresh();
    };
    const inPlaylist = (filePath: string) => settings.playlist.some((t) => t.filePath === filePath);
    const togglePlaylist = async (entry: MusicEntry) => {
      const next = inPlaylist(entry.filePath) ? settings.playlist.filter((t) => t.filePath !== entry.filePath) : [...settings.playlist, { kind: "track" as const, name: entry.name, filePath: entry.filePath, url: entry.url ?? "" }];
      settings = await window.axm.setSettings({ playlist: next });
      audio.playConfirm();
      xmb.refresh();
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
      const tracks: MusicEntry[] = settings.playlist.map((t) => ({ kind: "track", name: t.name, filePath: t.filePath, url: t.url }));
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
              { label: "Remove from Playlist", run: () => togglePlaylist(entry) },
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
        if (playlistView) {
          playlistView = false;
          xmb.resetSelection("music");
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
      footerHint: () => (playlistView ? `Playlist · ${settings.playlist.length} songs${settings.musicShuffle ? " · shuffle" : ""}` : musicListing.path ? musicListing.title : undefined),
      getItems: () => {
        if (playlistView) return playlistItems();
        const top: MenuItem[] = [];
        if (!musicListing.path) {
          top.push({
            id: "playlist",
            title: "Playlist",
            subtitle: settings.playlist.length ? `${settings.playlist.length} songs` : "Empty · add songs with Y",
            iconUrl: "assets/icons/music.png",
            onConfirm: () => {
              playlistView = true;
              xmb.resetSelection("music");
              xmb.refresh();
            },
          });
        }
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
                    label: "Song Information",
                    hint: "tags · MusicBrainz",
                    run: () =>
                      showInfo(entry.name, undefined, async () => {
                        const info = await window.axm.getSongInfo(entry.filePath);
                        infoCard.song(info, entry.name);
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
                  { label: inPlaylist(entry.filePath) ? "Remove from Playlist" : "Add to Playlist", run: () => togglePlaylist(entry) },
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
    let view: "root" | "saves" | "gamedata" | "steam" | "drive" = "root";
    let driveFolder = "";

    const go = (next: typeof view) => {
      view = next;
      xmb.resetSelection("games");
      xmb.refresh();
    };

    const openSaves = async () => {
      saves = await window.axm.getSaves();
      go("saves");
    };

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
        if (now < before) games = await window.axm.scanGames();
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
        .filter((g) => !g.hidden)
        .map((g) => ({
          id: g.id,
          title: g.name,
          // Drive and folder live in the Y options view now, not under every row.
          iconUrl: g.iconPath,
          backgroundUrl: g.heroPath,
          iconGlyph: sourceGlyph(g.source),
          badge: g.losslessProfile ? `LS ${g.losslessProfile}` : undefined,
          contextGame: g,
          onConfirm: () => window.axm.launchGame(g.id),
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
        id: "game-data-utility",
        title: "Game Data Utility",
        subtitle: "Installed game files",
        iconUrl: "assets/icons/folder.png",
        onConfirm: () => go("gamedata"),
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
      ...gameRows(),
    ];

    /** Games the scanner found under a drive's GAME folder. */
    const driveItems = (): MenuItem[] => {
      const root = driveFolder.toLowerCase();
      const rows = gameRows().filter((r) => {
        const dir = r.contextGame?.installDir?.toLowerCase() ?? "";
        return dir === root || dir.startsWith(root + "\\");
      });
      if (rows.length === 0) {
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
        go("root");
        return true;
      },
      footerHint: () => {
        if (view === "saves") return "Saved Data Utility";
        if (view === "gamedata") return "Game Data Utility";
        if (view === "drive") return driveFolder;
        if (view === "steam") {
          if (steamInstallHint) return steamInstallHint;
          const installed = steamLibrary.games.filter((g) => g.state === "installed").length;
          return `Steam · ${installed} of ${steamLibrary.games.length} installed`;
        }
        return undefined;
      },
      getItems: () => {
        if (view === "saves") return savesItems();
        if (view === "gamedata") return gameDataItems();
        if (view === "steam") return steamItems();
        if (view === "drive") return driveItems();
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
      xmb.resetSelection(kind);
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
                              { label: "Set as Wallpaper", hint: "this picture", run: () => setWallpaper({ url: entry.url!, filePath: entry.filePath, mode: "single" as const, folder: listing.path }) },
                              { label: "Shuffle Folder as Wallpaper", hint: "changes every few minutes", run: () => setWallpaper({ url: entry.url!, filePath: entry.filePath, mode: "shuffle" as const, folder: listing.path }) },
                            ]
                          : []),
                        ...(kind === "video"
                          ? [
                              {
                                label: "Information",
                                hint: "TMDB",
                                run: () =>
                                  showInfo(entry.name, undefined, async () => {
                                    const info = await window.axm.getScreenInfo(entry.name, "", "auto");
                                    infoCard.screen(info, entry.name);
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
    xmb.resetSelection("video");
    xmb.refresh();
  };

  const jfDiscover = async () => {
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
    const entry = { kind: "file" as const, name: item.name, filePath: item.id, url: item.streamUrl, hls: item.hls };
    mediaViewer.open("video", entry, [entry]);
    pushOverlay((action) => mediaViewer.handle(action as Parameters<MediaViewer["handle"]>[0]));
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

  /** Information (TMDB) and downloads for a Jellyfin row. */
  const jfOptions = (item: JfItem): PopupOption[] => {
    const isShow = ["Series", "Season", "Episode"].includes(item.type);
    const opts: PopupOption[] = [];
    if (["Movie", "Series", "Season", "Episode", "Video"].includes(item.type)) {
      opts.push({
        label: "Information",
        hint: "TMDB",
        run: () =>
          showInfo(item.name, item.imageUrl, async () => {
            const title = item.seriesName ?? item.name;
            const info = await window.axm.getScreenInfo(title, item.year ?? "", isShow ? "tv" : item.type === "Movie" ? "movie" : "auto", item.type === "Movie" || item.type === "Series" ? item.tmdbId : undefined);
            infoCard.screen(info, item.name);
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

  type SettingsView = "root" | "theme" | "months" | "system" | "controller" | "about" | "display" | "audio" | "sys" | "network" | { month: number };
  /** Which group each root row files under; anything unlisted stays at the top level. */
  const SETTINGS_GROUPS: Record<string, "display" | "audio" | "sys" | "theme"> = {
    windowMode: "display", renderResolution: "display", menuUpscaling: "display", targetHz: "display", backgroundQuality: "display",
    fpsCounter: "display", hardwareInfo: "display", batteryPercent: "display",
    musicVolume: "audio", ambientTrack: "audio", sfxVolume: "audio", navSounds: "audio", musicShuffle: "audio", addMusicFolder: "audio",
    "system-info": "sys", controller: "sys", steamHandsOff: "sys", steamInstallDrive: "sys", overlayHotkey: "sys", addFolder: "sys", rescan: "sys",
    "saved-data-utility": "sys", "game-data-utility": "sys", "steam-library": "sys",
    wallpaper: "theme", introSparkle: "theme",
  };

  function settingsCategory(): Category {
    let view: SettingsView = "root";

    const go = (next: SettingsView) => {
      view = next;
      xmb.resetSelection("settings");
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
        {
          id: `${idPrefix}-color`,
          title: "Ribbon Color",
          subtitle: labelForColor(RIBBON_COLOR_PRESETS, target().theme.ribbonColor),
          iconGlyph: "◐",
          onConfirm: () => {
            const { theme, write } = target();
            return save(write({ ...theme, ribbonColor: nextColor(RIBBON_COLOR_PRESETS, theme.ribbonColor) }));
          },
        },
      ];
      if (includeBackground) {
        items.push({
          id: `${idPrefix}-bg`,
          title: "Background Color",
          subtitle: labelForColor(BACKGROUND_COLOR_PRESETS, target().theme.backgroundColor),
          iconGlyph: "■",
          onConfirm: () => {
            const { theme, write } = target();
            return save(
              write({ ...theme, backgroundColor: nextColor(BACKGROUND_COLOR_PRESETS, theme.backgroundColor) })
            );
          },
        });
      }
      return items;
    };

    // The root shows the groups; every original row still exists and is filed into
    // one of them (or stays at the top level, like Theme and About).
    const groupedRoot = (): MenuItem[] => {
      const all = allRootItems();
      const groups: MenuItem[] = [
        { id: "group-display", title: "Display", subtitle: "Fullscreen, resolution, upscaling, refresh rate, readouts", iconUrl: "assets/icons/settings-display.webp", onConfirm: () => go("display") },
        { id: "group-audio", title: "Audio", subtitle: "Volumes, menu music, sounds, shuffle, music folders", iconUrl: "assets/icons/settings-audio.webp", onConfirm: () => go("audio") },
        { id: "group-network", title: "Network", subtitle: "Wi-Fi networks and Bluetooth pairing", iconGlyph: "⌔", onConfirm: () => { void netOpen(); } },
        { id: "group-sys", title: "System", subtitle: "System information, controller, Steam, game folders, in-game menu", iconUrl: "assets/icons/settings-system.webp", onConfirm: () => go("sys") },
      ];
      const top = all.filter((i) => !SETTINGS_GROUPS[i.id]);
      // Theme first, then the groups, then whatever else is unfiled (About, Exit).
      const theme = top.filter((i) => i.id === "theme");
      const rest = top.filter((i) => i.id !== "theme");
      return [...theme, ...groups, ...rest];
    };

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
        onConfirm: () => go("about"),
      },
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
          subtitle: [p.name, link, battery].filter(Boolean).join(" · "),
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
      go("network");
      await netRefresh();
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
    const networkItems = (): MenuItem[] => {
      const rows: MenuItem[] = [];
      rows.push({ id: "net-scan", title: net.busy ? "Scanning…" : "Scan Again", subtitle: "Wi-Fi networks in range and Bluetooth devices Windows can see", iconGlyph: "↻", onConfirm: () => (net.busy ? undefined : netRefresh()) });
      rows.push({ id: "net-wifi-h", title: "Wi-Fi", subtitle: net.wifi.length ? `${net.wifi.length} networks` : net.busy ? "" : "No networks found (is Wi-Fi on?)", iconGlyph: "≋" });
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
            netSay(res.message);
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
      rows.push({ id: "net-bt-h", title: "Bluetooth", subtitle: net.bt.length ? `${net.bt.length} devices · put a new device in pairing mode, then Scan Again` : net.busy ? "" : "Nothing seen · put the device in pairing mode and Scan Again", iconGlyph: "ᛒ" });
      for (const d of net.bt) {
        const glyph = { audio: "♫", controller: "🎮", input: "⌨", other: "•" }[d.kind];
        rows.push({
          id: `bt-${d.id}`,
          title: d.name,
          subtitle: d.connected ? "Connected" : d.paired ? "Paired" : d.canPair ? "Not paired · A to pair" : "Seen · can't pair from here",
          iconGlyph: glyph,
          badge: d.connected ? "CONNECTED" : d.paired ? "PAIRED" : undefined,
          onConfirm: async () => {
            if (d.paired || !d.canPair) return;
            net.busy = `Pairing ${d.name}…`;
            xmb.refresh();
            const res = await window.axm.btPair(d.id);
            net.busy = "";
            netSay(res.message);
            await netRefresh();
          },
          contextHint: d.paired ? "remove" : undefined,
          onContext: () => {
            if (!d.paired) return false;
            net.busy = `Removing ${d.name}…`;
            xmb.refresh();
            void window.axm.btUnpair(d.id).then((res) => {
              net.busy = "";
              netSay(res.message);
              return netRefresh();
            });
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
        if (view === "system" || view === "controller") go("sys");
        else if (view === "theme" || view === "about" || view === "display" || view === "audio" || view === "sys" || view === "network") go("root");
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
        if (view === "network") return netHint();
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
        return monthEditorItems(view.month);
      },
    };
  }

  // Matches the real XMB running order: Users, Settings, Photo, Music, Video, Game, Network.
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
      (open) => [jellyfinEntry, ...driveRows("video", open)],
      { active: () => jf.active, items: jfItems, back: jfBack, hint: jfHint }
    ),
    gamesCategory(),
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

  // Y on a game -> Options -> Change Artwork: every grid SteamGridDB has for it.
  xmb.setGameActions([
    {
      label: "Change Artwork…",
      run: async (game) => {
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
      },
    },
  ]);
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
  const npFill = document.getElementById("np-progress-fill")!;
  let lastTrackPath: string | null = null;

  musicPlayer.setOnChange(() => {
    const track = musicPlayer.current();
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
    npTitle.textContent = track.name;
    npFolder.textContent = track.filePath.replace(/\\[^\\]*$/, "").split("\\").slice(-2).join(" - ");
    npState.textContent = musicPlayer.isPlaying() ? "PLAYING" : "PAUSED";
    npIcon.setFrame(musicPlayer.isPlaying() ? "eq" : "pause");
    npFill.style.width = `${musicPlayer.progress() * 100}%`;

    // Only re-render the menu when the track itself changes, not on every tick.
    if (track.filePath !== lastTrackPath) {
      lastTrackPath = track.filePath;
      visualizer.setTrackName(track.name);
      xmb.refresh();
    }
  });

  // The splash wordmark is the bundled logo; it fades in once it has decoded.
  const bootLogoImg = document.getElementById("boot-logo-img") as HTMLImageElement;
  bootLogoImg.onload = () => bootLogoImg.classList.add("loaded");
  bootLogoImg.src = "assets/icons/boot-logo.png";

  // Box art arrives asynchronously in the background - patch it in as it lands.
  window.axm.onArtUpdated(({ gameId, iconPath, heroPath }) => {
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    if (iconPath) game.iconPath = iconPath;
    if (heroPath) game.heroPath = heroPath;
    // refresh() re-runs the selection callback, so a banner that arrives while its
    // game is already focused still fades in.
    xmb.refresh();
  });

  const gamepad = new GamepadNav((action) => {
    if (action === "guide") {
      void window.axm.overlayToggle();
      return;
    }
    xmb.handleAction(action);
  });
  gamepad.setDeadZone(settings.gamepadDeadZone);
  gamepad.setSwapConfirm(settings.gamepadProfile === "swapped");
  gamepad.setVibration(settings.gamepadVibration);
  gamepad.setOnControllerType((type) => {
    for (const t of ["ps", "switch", "kishi"]) document.body.classList.toggle(`pad-${t}`, type === t);
  });
  const pollGamepad = (now: number) => {
    gamepad.poll(now);
    requestAnimationFrame(pollGamepad);
  };
  requestAnimationFrame(pollGamepad);

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
