import "./types";
import { RibbonBackground } from "../background/RibbonBackground";
import { AudioManager, AMBIENT_TRACKS, AMBIENT_TRACK_IDS } from "./audio";
import { GamepadNav } from "./gamepad";
import { Xmb, Category, MenuItem, sourceGlyph } from "./xmb";
import { MusicPlayer } from "./musicPlayer";
import { MusicVisualizer } from "./visualizer";
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
  DEFAULT_MONTH_THEMES,
  GameEntry,
  LauncherEntry,
  MediaEntry,
  MonthTheme,
  SaveEntry,
  MONTH_NAMES,
  MusicListing,
  Settings,
  ThemeMode,
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

  let games: GameEntry[] = await window.axm.getGames();
  let photos: MediaEntry[] = [];
  let videos: MediaEntry[] = [];
  let musicListing: MusicListing = { path: null, parent: null, title: "Music", entries: [] };
  let saves: SaveEntry[] = [];
  let launchers: LauncherEntry[] = await window.axm.getLaunchers();

  const musicPlayer = new MusicPlayer(audio);
  const visualizer = new MusicVisualizer(document.getElementById("visualizer")!);
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
    xmb.setExternalHandler(stageHandler);
  };

  const leaveStage = () => {
    xmb.setExternalHandler(null);
    visualizer.setMode("background");
    audio.playBack();
    xmb.refresh();
  };

  const clearVisualizer = () => {
    xmb.setExternalHandler(null);
    visualizer.setMode("off");
    visualizer.setTrackName(null);
    applyTheme();
  };

  // ---- Categories ------------------------------------------------------------------

  function usersCategory(): Category {
    return {
      id: "users",
      label: "Users",
      iconUrl: "assets/icons/user.png",
      getItems: () => [
        {
          id: "current-user",
          title: navigator.userAgent.includes("Windows") ? "Signed in" : "User",
          subtitle: "A-X-M",
          iconUrl: "assets/icons/user.png",
        },
      ],
    };
  }

  function browserCategory(): Category {
    return {
      id: "browser",
      label: "Browser",
      iconUrl: "assets/icons/browser.png",
      getItems: () => [
        {
          id: "open-browser",
          title: "Open Web Browser",
          iconUrl: "assets/icons/browser.png",
          onConfirm: () => window.axm.openBrowser("https://www.google.com"),
        },
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
            contextHint: settings.visualizerEnabled ? "visualizer" : undefined,
            onContext: () => {
              if (!settings.visualizerEnabled) return false;
              if (!playing) musicPlayer.play(entry, musicListing.entries, settings.musicVolume);
              enterStage();
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
    let view: "root" | "saves" | "gamedata" = "root";

    const go = (next: typeof view) => {
      view = next;
      xmb.resetSelection("games");
      xmb.refresh();
    };

    const openSaves = async () => {
      saves = await window.axm.getSaves();
      go("saves");
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
      ...launchers
        .filter((l) => l.installed)
        .map((l) => ({
          id: `launcher-${l.id}`,
          title: l.name,
          iconUrl: `assets/icons/${l.id}.png`,
          onConfirm: () => window.axm.openLauncher(l.id),
        })),
      ...gameRows(),
    ];

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
        return undefined;
      },
      getItems: () => {
        if (view === "saves") return savesItems();
        if (view === "gamedata") return gameDataItems();
        return rootItems();
      },
    };
  }

  function mediaCategory(
    id: "video" | "photo" | "music",
    label: string,
    iconUrl: string,
    getList: () => MediaEntry[],
    leading: MenuItem[] = []
  ): Category {
    return {
      id,
      label,
      iconUrl,
      getItems: () => {
        const list = getList();
        if (list.length === 0 && leading.length === 0) {
          return [
            {
              id: `${id}-empty`,
              title: `No ${label.toLowerCase()} found`,
              subtitle: "Add files to your Windows " + label + " folder",
              iconUrl,
            },
          ];
        }
        return [
          ...leading,
          ...list.map((m) => ({
            id: m.id,
            title: m.name,
            iconUrl,
            onConfirm: () => window.axm.openMedia(m.filePath),
          })),
        ];
      },
    };
  }

  // Jellyfin's web client, on its default port. Sits at the top of Video, ahead of
  // the local files, since a media server is where most of the video actually is.
  const jellyfinEntry: MenuItem = {
    id: "jellyfin",
    title: "Jellyfin",
    subtitle: "Media server",
    iconUrl: "assets/icons/jellyfin.svg",
    onConfirm: () => window.axm.openBrowser("http://localhost:8096/"),
  };

  // ---- Settings, with the Theme sub-views ------------------------------------------

  type SettingsView = "root" | "theme" | "months" | { month: number };

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
        subtitle: AMBIENT_TRACKS[settings.ambientTrack].label,
        iconUrl: "assets/icons/music.png",
        onConfirm: async () => {
          const i = AMBIENT_TRACK_IDS.indexOf(settings.ambientTrack);
          const next = AMBIENT_TRACK_IDS[(i + 1) % AMBIENT_TRACK_IDS.length];
          settings = await window.axm.setSettings({ ambientTrack: next });
          audio.setAmbientTrack(settings.ambientTrack);
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
        if (view === "theme") go("root");
        else if (view === "months") go("theme");
        else go("months");
        return true;
      },
      footerHint: () => {
        if (view === "root") return undefined;
        if (view === "theme") return "Settings › Theme";
        if (view === "months") return "Settings › Theme › Months";
        return `Settings › Theme › ${MONTH_NAMES[view.month]}`;
      },
      getItems: () => {
        if (view === "root") return rootItems();
        if (view === "theme") return themeItems();
        if (view === "months") return monthsItems();
        return monthEditorItems(view.month);
      },
    };
  }

  // Matches the real XMB running order: Users, Settings, Photo, Music, Video, Game, Network.
  const categories: Category[] = [
    usersCategory(),
    settingsCategory(),
    mediaCategory("photo", "Photo", "assets/icons/photo.png", () => photos),
    musicCategory(),
    mediaCategory("video", "Video", "assets/icons/video.png", () => videos, [jellyfinEntry]),
    gamesCategory(),
    browserCategory(),
  ];
  const gameBackground = new GameBackground(document.getElementById("game-bg")!);
  const xmb = new Xmb(categories, audio);
  xmb.setOnSelectionChange((item) => gameBackground.show(item?.backgroundUrl));
  // Start on Game - it's a game hub first, whatever the XMB running order is.
  xmb.setActiveCategory("games");
  xmb.init();

  // Now-playing bar, driven by the player's own state changes.
  const npEl = document.getElementById("now-playing")!;
  const npTitle = document.getElementById("np-title")!;
  const npFolder = document.getElementById("np-folder")!;
  const npState = document.getElementById("np-state")!;
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

  const gamepad = new GamepadNav((action) => xmb.handleAction(action));
  const pollGamepad = (now: number) => {
    gamepad.poll(now);
    requestAnimationFrame(pollGamepad);
  };
  requestAnimationFrame(pollGamepad);

  audio.playBootThenAmbient();

  const bootSplash = document.getElementById("boot-splash")!;
  setTimeout(() => bootSplash.classList.add("hidden"), 1600);

  // Background rescan shortly after boot to pick up anything the first pass missed,
  // and to fill in the media categories without blocking startup on slow drives.
  setTimeout(async () => {
    const [scannedGames, scannedVideos, scannedPhotos, listing] = await Promise.all([
      window.axm.scanGames(),
      window.axm.getMedia("video"),
      window.axm.getMedia("photo"),
      window.axm.browseMusic(null),
    ]);
    games = scannedGames;
    videos = scannedVideos;
    photos = scannedPhotos;
    musicListing = listing;
    xmb.refresh();
  }, 3000);
}

main().catch((err) => {
  console.error("[A-X-M] fatal error during startup:", err);
});
