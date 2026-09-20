import "./types";
import { RibbonBackground } from "../background/RibbonBackground";
import { AudioManager, AMBIENT_TRACKS, AMBIENT_TRACK_IDS } from "./audio";
import { GamepadNav } from "./gamepad";
import { Xmb, Category, MenuItem, sourceGlyph, btn } from "./xmb";
import { MusicPlayer } from "./musicPlayer";
import { MusicVisualizer, VISUALIZER_STYLES, VISUALIZER_STYLE_IDS, VisualizerStyle } from "./visualizer";
import { spriteEl, spriteHtml } from "./sprites";
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

  let games: GameEntry[] = await window.axm.getGames();
  // Drives with PHOTO / VIDEO / GAME folders at the root; re-read on each rescan.
  let mediaDrives: MediaDrive[] = await window.axm.getMediaDrives();
  const driveRows = (kind: "photo" | "video" | "game", open: (folder: string) => void): MenuItem[] =>
    mediaDrives
      .filter((d) => d[kind])
      .map((d) => ({
        id: `drive-${kind}-${d.drive}`,
        title: `${d.drive} Drive`,
        subtitle: `${kind.toUpperCase()} folder`,
        iconUrl: "assets/icons/hdd.webp",
        iconClass: `hdd hdd-${kind}`,
        onConfirm: () => open(d[kind]!),
      }));
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
        return `<div class="transfer${p.error ? " error" : ""}"><span>${text}</span><div class="transfer-bar"><div style="width:${pct}%"></div></div></div>`;
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
      `${btn("y")}${spriteHtml("browser", nav?.loading ? "stop" : "reload")}` +
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
    const openFolder = async (dirPath: string | null) => {
      musicListing = await window.axm.browseMusic(dirPath);
      xmb.resetSelection("music");
      xmb.refresh();
    };

    return {
      id: "music",
      label: "Music",
      iconUrl: "assets/icons/music.png",
      onBack: () => {
        if (!musicListing.parent) return false;
        void openFolder(musicListing.parent);
        return true;
      },
      onContext: () => {
        if (!musicPlayer.current()) return false;
        musicPlayer.togglePause();
        return true;
      },
      footerHint: () => (musicListing.path ? musicListing.title : undefined),
      getItems: () => {
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
        return musicListing.entries.map((entry): MenuItem => {
          if (entry.kind === "folder") {
            return {
              id: entry.filePath,
              title: entry.name,
              iconUrl: "assets/icons/folder.png",
              onConfirm: () => openFolder(entry.filePath),
              contextHint: "options",
              onContext: () => {
                void refreshVolumes().then(() => showOptions(entry.name, copyTargets("music", entry.filePath)));
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
                  ...copyTargets("music", entry.filePath),
                ])
              );
              return true;
            },
          };
        });
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
        const badge = g.state === "installed" ? "INSTALLED" : g.state === "installing" ? "INSTALLING…" : undefined;
        return {
          id: `steam-lib-${g.appid}`,
          title: g.name,
          subtitle: g.state === "not-installed" ? "Not installed · A to install" : undefined,
          iconUrl: g.coverUrl,
          iconGlyph: "S",
          badge,
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
          iconUrl: `assets/icons/${l.id}.png`,
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
        if (listing.entries.length === 0 && lead.length === 0) {
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

  type SettingsView = "root" | "theme" | "months" | "system" | { month: number };

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

    const rootItems = (): MenuItem[] => [
      {
        id: "theme",
        title: "Theme",
        subtitle: THEME_MODE_LABELS[settings.themeMode],
        iconGlyph: "❖",
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
        if (view === "theme" || view === "system") go("root");
        else if (view === "months") go("theme");
        else go("months");
        return true;
      },
      footerHint: () => {
        if (view === "root") return undefined;
        if (view === "theme") return "Settings › Theme";
        if (view === "months") return "Settings › Theme › Months";
        if (view === "system") return "Settings › System Information";
        return `Settings › Theme › ${MONTH_NAMES[view.month]}`;
      },
      getItems: () => {
        if (view === "root") return rootItems();
        if (view === "theme") return themeItems();
        if (view === "months") return monthsItems();
        if (view === "system") return systemItems();
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
  const xmb = new Xmb(categories, audio);
  xmb.setOnSelectionChange((item) => gameBackground.show(item?.backgroundUrl));

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

  // Drop any image named assets/icons/boot-logo.* in and it becomes the splash
  // wordmark. The element starts hidden and is only revealed once a file actually
  // decodes, so a missing logo falls back to the A-X-M text instead of a broken
  // image. Setting src from here (rather than in the HTML) means the request only
  // fires once these handlers are attached.
  const bootLogoImg = document.getElementById("boot-logo-img") as HTMLImageElement;
  const logoCandidates = [
    "assets/icons/boot-logo.png",
    "assets/icons/boot-logo.webp",
    "assets/icons/boot-logo.jpg",
    "assets/icons/boot-logo.svg",
  ];
  const tryLogo = (i: number) => {
    if (i >= logoCandidates.length) {
      bootLogoImg.remove();
      return;
    }
    bootLogoImg.onload = () => bootLogoImg.classList.add("loaded");
    bootLogoImg.onerror = () => tryLogo(i + 1);
    bootLogoImg.src = logoCandidates[i];
  };
  tryLogo(0);

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
