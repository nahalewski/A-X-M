import "./types";
import { WaveBackground } from "./wave";
import { AudioManager, AMBIENT_TRACKS, AMBIENT_TRACK_IDS } from "./audio";
import { GamepadNav } from "./gamepad";
import { Xmb, Category, sourceGlyph } from "./xmb";
import { MusicPlayer } from "./musicPlayer";
import { GameEntry, MediaEntry, MusicListing, Settings } from "./types";

const WAVE_CYCLE_PRESETS = [8, 12, 18, 25, 35];
const VOLUME_PRESETS = [0, 0.25, 0.5, 0.75, 1];

async function main(): Promise<void> {
  const audio = new AudioManager();
  const wave = new WaveBackground(document.getElementById("wave") as HTMLCanvasElement);

  let settings: Settings = await window.axm.getSettings();
  let games: GameEntry[] = await window.axm.getGames();
  let photos: MediaEntry[] = [];
  let videos: MediaEntry[] = [];
  let musicListing: MusicListing = { path: null, parent: null, title: "Music", entries: [] };

  const musicPlayer = new MusicPlayer(audio);

  wave.setCycleSeconds(settings.waveColorCycleSeconds);
  audio.setVolumes(settings.musicVolume, settings.sfxVolume);
  audio.setAmbientTrack(settings.ambientTrack);
  wave.start();

  const clockEl = document.getElementById("clock")!;
  const updateClock = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  updateClock();
  setInterval(updateClock, 15_000);

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
        return musicListing.entries.map((entry) => {
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
          };
        });
      },
    };
  }

  function gamesCategory(): Category {
    return {
      id: "games",
      label: "Game",
      iconUrl: "assets/icons/games.svg",
      getItems: () =>
        games
          .filter((g) => !g.hidden)
          .map((g) => ({
            id: g.id,
            title: g.name,
            subtitle: g.drive,
            iconUrl: g.iconPath,
            iconGlyph: sourceGlyph(g.source),
            badge: g.losslessProfile ? `LS ${g.losslessProfile}` : undefined,
            contextGame: g,
            onConfirm: () => window.axm.launchGame(g.id),
          })),
    };
  }

  function mediaCategory(
    id: "video" | "photo" | "music",
    label: string,
    iconUrl: string,
    getList: () => MediaEntry[]
  ): Category {
    return {
      id,
      label,
      iconUrl,
      getItems: () => {
        const list = getList();
        if (list.length === 0) {
          return [
            {
              id: `${id}-empty`,
              title: `No ${label.toLowerCase()} found`,
              subtitle: "Add files to your Windows " + label + " folder",
              iconUrl,
            },
          ];
        }
        return list.map((m) => ({
          id: m.id,
          title: m.name,
          iconUrl,
          onConfirm: () => window.axm.openMedia(m.filePath),
        }));
      },
    };
  }

  function settingsCategory(): Category {
    const cycleIdx = () => {
      const i = WAVE_CYCLE_PRESETS.indexOf(settings.waveColorCycleSeconds);
      return i === -1 ? 2 : i;
    };
    const musicIdx = () => {
      const i = VOLUME_PRESETS.findIndex((v) => Math.abs(v - settings.musicVolume) < 0.01);
      return i === -1 ? 2 : i;
    };
    const sfxIdx = () => {
      const i = VOLUME_PRESETS.findIndex((v) => Math.abs(v - settings.sfxVolume) < 0.01);
      return i === -1 ? 2 : i;
    };

    return {
      id: "settings",
      label: "Settings",
      iconUrl: "assets/icons/settings.png",
      getItems: () => [
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
          id: "waveSpeed",
          title: "Wave Color Speed",
          subtitle: `${settings.waveColorCycleSeconds}s / color`,
          iconGlyph: "〰",
          onConfirm: async () => {
            const next = WAVE_CYCLE_PRESETS[(cycleIdx() + 1) % WAVE_CYCLE_PRESETS.length];
            settings = await window.axm.setSettings({ waveColorCycleSeconds: next });
            wave.setCycleSeconds(settings.waveColorCycleSeconds);
            xmb.refresh();
          },
        },
        {
          id: "musicVolume",
          title: "Music Volume",
          subtitle: `${Math.round(settings.musicVolume * 100)}%`,
          iconGlyph: "♪",
          onConfirm: async () => {
            const next = VOLUME_PRESETS[(musicIdx() + 1) % VOLUME_PRESETS.length];
            settings = await window.axm.setSettings({ musicVolume: next });
            audio.setVolumes(settings.musicVolume, settings.sfxVolume);
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
            const next = VOLUME_PRESETS[(sfxIdx() + 1) % VOLUME_PRESETS.length];
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
          id: "quit",
          title: "Quit A-X-M",
          iconUrl: "assets/icons/power.png",
          onConfirm: async () => {
            await audio.fadeOutAmbient(800);
            window.axm.quit();
          },
        },
      ],
    };
  }

  // Matches the real XMB running order: Users, Settings, Photo, Music, Video, Game, Network.
  const categories: Category[] = [
    usersCategory(),
    settingsCategory(),
    mediaCategory("photo", "Photo", "assets/icons/photo.png", () => photos),
    musicCategory(),
    mediaCategory("video", "Video", "assets/icons/video.png", () => videos),
    gamesCategory(),
    browserCategory(),
  ];
  const xmb = new Xmb(categories, audio);
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
  window.axm.onArtUpdated(({ gameId, iconPath }) => {
    const game = games.find((g) => g.id === gameId);
    if (!game) return;
    game.iconPath = iconPath;
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
