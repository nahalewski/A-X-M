# A-X-M · Ally XMB Menu

A PS3-XMB-style hub for the **ROG Xbox Ally** (and any Windows handheld or PC), built with
Electron + TypeScript. Games, music, photos, video, Jellyfin, a browser and settings in
the cross-media bar you remember, driven from the controller, with the waves and the
sounds.

> **Beta.** First public build. Expect rough edges; issues and ideas are welcome.
> Possible **PSP** and **Android** development coming soon.

![Games column with Hollow Knight focused](docs/screenshots/01-games.jpg)

## Download

From the [Releases](https://github.com/nahalewski/A-X-M/releases) page:

- `A-X-M-Setup-<version>.exe` - installer (NSIS, per-user, no admin needed)
- `A-X-M-<version>-portable.exe` - portable, runs from anywhere (a USB stick, a games drive)
- `A-X-M-<version>-steamdeck-x64.AppImage` - **Steam Deck** (SteamOS / Linux x64): make it
  executable, run it from Desktop Mode, or add it to Steam as a non-Steam game for Game
  Mode. Steam library and SD-card `PHOTO` / `VIDEO` / `MUSIC` / `GAME` folders are found;
  the Windows-only readouts (Wi-Fi / Bluetooth pairing, Xbox / Game Pass, the Anker
  bank, XInput overlay button) stay empty there.

**Runs on:** Windows 10 / 11, x64 (AMD Ryzen Z-series, Intel Core / Core Ultra, any 64-bit
desktop or laptop CPU). ROG Xbox Ally, ROG Ally / Ally X, Legion Go, MSI Claw, Steam Deck on
Windows, and any PC with a WebGL 2 GPU. No ARM64 build yet (Snapdragon X runs it through
Windows' x64 emulation). Full list in [docs/ROADMAP.md](docs/ROADMAP.md).

Windows SmartScreen warns on first run because the build isn't code-signed - *More info › Run anyway*.

## Demo

[▶ Watch the 84-second demo (MP4, 5.5 MB)](docs/A-X-M-demo.mp4) - profile creation, an
avatar, music with the visualizer, a photo, a video, a scroll through the games, and
changing a game's artwork.

## Features

### The menu
- The XMB, in the PS3's running order: **Users · Settings · Photo · Music · Video · Game · Browser**, with
  the sliding category bar, PS3-style icons, the boot sound, the ambient loop (five loops to
  choose from, or off) and the navigation sounds.
- Animated ribbon background over the XMB's own month colours (January grey through
  December red), or a **wallpaper** from your own pictures (one, or a folder shuffled).
- **Controller first**: Xbox pads, the Ally's own controls, PlayStation, Nintendo Switch and
  Razer Kishi pads - the footer hints draw the face button as *your* pad draws it.
- **In-game overlay**: the Guide / PS button (or M1 mapped to a shortcut) brings the menu up
  translucent over whatever's running, and drops it again.
- Runs at the display's refresh rate (60 / 120 / 144 or match display) and at the
  **resolution you pick**: 720p, 800p, 900p, 1080p, 1200p, 1440p, 1600p, 4K, or *Auto*, which
  reads the screen and the GPU. Optional FPS counter and hardware readout.
- First-boot profile with three avatar sources (bundled avatars, SteamGridDB, your game
  icons) and a PS5-style welcome sparkle.
- Wi-Fi, Bluetooth, the Ally's battery and an Anker power bank in the status bar.

### Game
- Scans every drive: Steam, Epic, Xbox / Game Pass, GOG-style folders and any folder you add.
  Only real games show - launchers, redistributables and tools are filtered out.
- Cover art and hero backgrounds from Steam and SteamGridDB; **Change Artwork…** picks any
  cover SteamGridDB has for the game.
- Y on a game: Lossless Scaling profile (1–3), open its folder, change artwork.
- Your Steam library with install state and progress; installs run in the background and
  Steam's dialog is confirmed for you (hands-off, optional).
- **Trophy Collection**: Steam achievements per game (your Steam Web API key) and
  RetroAchievements (sign in once with username + web API key).
- Guide button while a game runs: **Quit Game**, Controller Settings, Turn Off the System.
- Saved Data Utility and Game Data Utility, like the PS3's.
- **HD Texture Packs** (Y on a PS1 / PS2 game): the packs A-X-M's curated list
  (`assets/textures-db/index.json`) has for the game's serial - read from the file name or
  the disc's SYSTEM.CNF - each with Download, Enable, Disable, Delete. A pack lands in
  `ROOT\TEXTURES\<platform>\<SERIAL>\` and is linked into DuckStation's / PCSX2's own
  `textures\<SERIAL>\replacements` folder (the emulator's replacement switch is turned on
  in its ini). **About & Credits** at the bottom of Game names every pack author and the
  community collections to find more.
- **ROOT drive**: with *rootDrive* set (N: by default) the columns list that one drive only,
  laid out as `GAME MUSIC PHOTO VIDEO SAVE TEXTURES PATCHES NFC`; NFC holds the toy
  backups by brand (AMIIBO, SKYLANDERS, DISNEY INFINITY, LEGO DIMENSIONS - each tag copy with
  the figure's picture beside it). Game folders elsewhere (G:\GAMES) still scan.
- **Memory Card Utility**: virtual PlayStation (128 KB) and PlayStation 2 (8 MB, fully
  formatted) memory cards, created from the PS3-style "Select the internal memory card to be
  created" screen and copied straight into DuckStation's and PCSX2's own card folders.
  Lists the saves on each card, imports raw cards, DexDrive dumps, .psu and .psv saves from
  any drive's SAVE folder, exports cards and single saves. Y on a save opens the sidebar:
  **Edit Save › Apollo Cheats** - the verified save-edit patches from
  [Apollo Save Tool](https://github.com/bucanero/apollo-patches), matched to the save's
  title id, region and files (never invented), with option values, *Preview Changes* (every
  byte that would change), *Apply Selected* (a timestamped backup of the whole card first,
  read back and verified, restored on any failure), *Restore Backup* and *Undo Last Edit*;
  **Save Database** - community saves from apollo-saves, downloaded and put on the card; and
  a copy to the phone. The Save Wizard / Game Genie codes and BSD scripts run in a TypeScript
  port of Apollo's engine (GPL-3.0; credited in About & Thanks). Databases update weekly
  or from *Settings › System › Apollo Save Tool* (offline mode, location, clear cache).
- Launcher rows for Steam, Epic Games, Battle.net, GeForce NOW and Xbox Cloud Gaming.

### Retro
- A **Retro** column for console games through emulators: **PS5 · PS4 · PS3 · PS2 · PS1 · PSP ·
  Nintendo Switch**, each with its console as the icon and SteamGridDB box art for the games.
  Folders are `G:\GAMES\PS3` (and PS2, PS1, PSP, PS4, PS5), `K:\Switch Games` and
  `G:\GAMES\SWITCH` by default. Switch updates and DLC are skipped; PS3 folder games read
  their title from PARAM.SFO; RPCS3's own games folder is listed too.
- The emulators: **RPCS3**, **PCSX2**, **DuckStation**, **PPSSPP**, **Eden**, **shadPS4**,
  **Kyty**. A game whose emulator is missing offers to install it - headless, through winget
  or straight from the emulator's GitHub release into `C:\Emulators` - and then asks once
  whether you want a desktop shortcut. PCSX2 and DuckStation still need a BIOS from your own
  console; Eden needs your own keys and firmware; the rows say so.
- **PS3 disc images**: an `.iso` row says whether it is encrypted. *Decrypt and extract for
  RPCS3* finds the disc key (a `.dkey` beside the image, or your own key collection - every
  candidate is proven against the disc's EBOOT before it is used), decrypts it, extracts it
  with 7-Zip into `C:\rpcs3\games`, and offers to delete the image. **Trim while
  extracting** empties the firmware update, all-zero dummy / padding files and (off by
  default) other-language files, keeping the names so the game still finds them, with a
  `TRIMMED.txt` log. The progress toast speaks plainly: *Getting Skylanders ready to play ·
  unlocking the disc · 42%*.
- Every retro game is an ordinary game to the rest of the menu: Ghost launches it, Toybox
  offers it when a matching toy is scanned, the Y options apply.

### Store
- Laid out like a console store page - a tab strip, a page for the selected thing with its
  art, tags, facts and one big button, and a strip of tiles - with nobody's logo but A-X-M's.
  It sells nothing: it is **your own shelf on drive N** (`N:\GAME\ROMS\PS1`, `PS2`, `PS3`,
  `PS4`, `PS5`, `PSP`, `Switch`) and the **Emulators** tab. *Add to Library* copies a
  game into its platform's folder; *Install* fetches an emulator; a PS3 image goes on to the
  Retro column's own decrypt flow.

### Toybox
- A toys-to-life collection - **Amiibo, Skylanders, Disney Infinity, LEGO Dimensions** -
  each brand its own toy box, with sub-folders (Figures, Cards, Power Discs, Play Sets,
  Vehicles, Traps, Legendaries…) and counts of what you own, on a bookshelf drawn from a
  sprite sheet that grows with the collection, from a three-cubby unit to 4x4 units you page
  through. Owned figures get a tick; mark owned / favourite / wanted, filter, search, or say
  "hey ghost, open my shelf". 2,273 figures; the database and artwork are pulled locally by
  the import scripts and never committed (they belong to their publishers).
- **NFC**: put a toy on an **ACR122U** (or scan it with the Android companion, or send it
  from any adapter to `POST http://<pc>:47311/toybox/scan`) and the chime plays, Ghost says
  what it is - *Hulkbuster detected. Would you like to play Disney Infinity 3.0?* - and shows
  a card with the figure's art and the games you have installed. Pick with the d-pad, or just
  talk: "play giants", "the second one", "yes", "not now". Remembers the last game per figure,
  keeps a grace period when a toy is lifted, swaps figures in place, and follows a *during
  gameplay* setting. Amiibo, Skylanders, Disney Infinity (MIFARE Mini) and LEGO Dimensions
  tags are identified on the device; nothing is written to a tag. Read-only copies land
  where Eden (amiibo) and RPCS3 (Skylanders / Infinity) load figures from.

### Music
- Browses your music folder-by-folder, plus any drive's `MUSIC` folder.
- Named **playlists**, **shuffle**, play/pause from anywhere, now-playing bar.
- An **audio CD** in a drive shows as a row: Import to MP3 / AAC / Opus (ffmpeg with libcdio).
- **Song Information** (Y): the file's tags and cover, MusicBrainz artist details, Cover Art
  Archive covers.
- **Twelve visualizers**: the PS3's Spectrum Analyzer, Earth, Line and Waveform; the PSP's
  Rain, Circle and Sparkle; and Tunnel, Terrain, Scope, Pulse and **Karaoke** - all in one
  neon palette. ◀ ▶ switches on the stage; the one you pick stays behind the menu while
  music plays.
- **Karaoke** shows the song's words from [LRCLIB](https://lrclib.net) (no key): the line
  being sung lights up and sweeps with the timing, the next lines wait below; behind the
  menu just the current line shows. *Settings › Audio › Lyrics* turns it off.

### Photo and Video
- In-app viewers: photos zoom, rotate and slideshow; MP4 video with seek. Controls drawn from
  PS-style button sheets.
- **TV Streaming**: an Xtream Codes provider as an app in Video - Live TV, Movies and Series
  in the provider's own categories, played in the menu; the password never reaches the page.
- **Jellyfin**: finds servers on the LAN (or type an address), signs in once, browses your
  libraries with posters and backdrops, plays in the menu (direct play when the browser can,
  HLS transcode when it can't), and **downloads** films and episodes to any drive.
- **Subtitles** for TV Streaming and Jellyfin films and episodes, fetched from
  [SubDL](https://subdl.com) (your own free key) when the video starts and shown over it -
  the right episode picked out of a season pack. *Settings › System › Subtitles* sets the
  language or turns it off; *SubDL Key* holds the key.
- **Information** (Y) on a film or show from TMDB (your own API key).
- A **DVD or Blu-ray** in a drive shows as a row with its disc icon, looked up on TMDB so
  `MARVEL_STUDIOS_DOCTOR_STRANGE` reads *Doctor Strange · 2016* with a poster in Information.
  **Rip** makes an MKV (H.265 10-bit, RF 18 / 19, slow preset, original TrueHD / DTS-HD / AC3
  passed through, every subtitle track kept; DVDs get decomb and auto-anamorphic) with MakeMKV
  and HandBrakeCLI, in the background with a progress bar and notifications at start, half way
  and done. **Play** plays the ripped copy - commercial discs are encrypted, so a disc that
  hasn't been ripped is ripped first and starts when it's done. An **audio CD** imports to MP3 /
  AAC / Opus / FLAC. Where it all goes is *Settings › System › Disc Backup Location*.
  PS1 / PS2 discs show in Game with their own icons.
- **Copy** songs, pictures and videos to any drive's `MUSIC` / `PHOTO` / `VIDEO` folder and
  back to this PC; make folders inside them from the menu. A drive with those folders gets
  its own row, and keeps a greyed row when it's unplugged.

### Browser
- A pop-up browser **inside** the menu (not Edge): D-pad scrolls and moves through history,
  Y reloads, B closes; Google, YouTube TV, Xbox Cloud Gaming and GeForce NOW one press away.

### Companion app
- **A-X-M Companion** (Android, in `companion-android/`) finds the menu on the LAN, pairs with
  a code once, then drives the menu and the media transport from the phone, and scans amiibo
  with the phone's NFC into the same Toybox flow.
- **Memory Card Saves** on the phone: a copy of every save on the cards, refreshed whenever
  one changes (Settings › Companion), kept offline; from the phone, refresh or put a copy
  back on the card, run Apollo Cheats through the same engine the menu uses, undo the last
  edit. The Settings page mirrors the menu's own settings; the Music Library page picks
  songs; a text prompt on the TV is typed on the phone's keyboard.

### Ghost
- The voice assistant. Say "hey ghost", then *launch Batman*, *play playlist chill*, *go to
  network settings*, *copy the Blu-ray to storage*, *open my shelf*, *next track*, *quit
  game*, *turn off*. Offline recognition (Vosk); Ghost only appears while awake, with a
  resizable chat bubble. His **voice is cloned** from one short clip by Chatterbox (MIT)
  running locally - no cloud, no fallback voice, and he doesn't hear himself. Cards with
  artwork and choices answer without the wake word. Menu music ducks while he listens or
  talks.

### Settings
Grouped like a console's:
- **Theme** - monthly XMB colours, ribbon speed / width / colour, visualizer style, welcome
  sparkle, wallpaper.
- **Display** - fullscreen / windowed, background quality, **menu resolution** (720p–4K, auto),
  **menu upscaling** (FSR-style sharpening when rendering below native), refresh rate, FPS
  counter, hardware readout, battery percentage.
- **Audio** - volumes, menu music (five loops or off), navigation sounds, shuffle, music folders.
- **Network** - laid out like the PS3's: Settings and Connection Status List, Internet
  Connection on / off, Internet Connection Settings (Wi-Fi join / forget), Internet
  Connection Test (router, DNS, internet, speed), Media Server Connection, Bluetooth
  Register Device and Registered Device List (discovery best effort, see the roadmap).
- **System** - System Information (device, CPU, RAM, GPU, every drive's used / free space),
  Controller (players 1–4, wired / wireless, battery, A/B profile, dead zone, vibration), Steam
  hands-off install, Steam install drive, in-game menu button, game folders, rescan.
- **Assistant** - **Ghost**, the voice assistant. Say "hey ghost" then *launch Batman*, *play
  playlist chill*, *go to network settings*, *copy the Blu-ray to storage*, *rip the DVD*,
  *import the CD*, *open my shelf*, *next track*, *quit game*, *turn off*. Recognition is Vosk,
  offline; Ghost only appears while awake, with a resizable chat bubble showing what it heard
  and what it answered. Its **voice is cloned** from one short clip (the one that ships, or
  yours) by Chatterbox (Resemble AI, MIT) running in a local Python environment - no cloud, no
  fallback voice: without the engine Ghost answers in text. Menu music ducks while Ghost
  listens or talks.
- **System › Install Tools** fetches everything the rippers and Ghost need on Windows through
  winget - ffmpeg (full build, libcdio), HandBrakeCLI, MakeMKV, Python 3.11 - and then the
  voice engine (a few GB, once, with the CUDA build of torch on NVIDIA machines). It runs by
  itself on the first launch and can be re-run from Settings. MakeMKV's Blu-ray reading needs
  its key (the current beta key is posted on makemkv.com's forum): *Settings › System › MakeMKV
  Key* writes it to MakeMKV's own settings file.
- **About**, Exit.

## Screenshots

| | |
| --- | --- |
| ![Y options panel](docs/screenshots/04-options-panel.jpg) | ![Song information](docs/screenshots/05-song-info.jpg) |
| ![Spectrum Analyzer](docs/screenshots/06-visualizer-bars.jpg) | ![Circle visualizer](docs/screenshots/07-visualizer-circle.jpg) |
| ![Tunnel visualizer](docs/screenshots/08-visualizer-tunnel.jpg) | ![Settings](docs/screenshots/09-settings.jpg) |
| ![Menu at 720p](docs/screenshots/10-720p.jpg) | ![System Information](docs/screenshots/11-system-info.jpg) |
| ![Jellyfin with backdrop](docs/screenshots/13-jellyfin.jpg) | ![Video player](docs/screenshots/14-video-player.jpg) |
| ![Store](docs/screenshots/15-store.jpg) | ![Retro column](docs/screenshots/16-retro.jpg) |
| ![Toybox shelf](docs/screenshots/17-toybox-shelf.jpg) | ![Toybox folders](docs/screenshots/18-toybox-folders.jpg) |
| ![Ghost card after an NFC scan](docs/screenshots/19-ghost-card.jpg) | ![PSP games, with a PS3 disc being readied](docs/screenshots/20-retro-psp.jpg) |

## Resolution and performance

The window always covers the display's physical pixels. **Settings › Menu Resolution** picks
the height the menu is laid out and rendered at: at *720p* on a 1080p screen the layout is
720 rows tall and the ribbon and visualizer draw their frame buffers at 720 rows, then the
compositor scales up - so a weaker GPU does less work and the UI reads larger. *Auto* uses the
native height, stepping down to 1440p or 1080p when the GPU reports little memory. Anything
between 720p and 4K is offered up to the display's own height, which covers the Ally (1080p),
Steam Deck-class 800p panels and 1440p / 4K docks.

**Menu Refresh Rate** caps the ribbon at 60 / 120 / 144 fps or follows the display. The menu
itself is vsync-locked to the panel.

**Menu Upscaling** - *Off*, *Sharpen* (FSR-1-style contrast-adaptive sharpening) or
*Sharpen+* - is applied to the scaled-up background layers when the menu renders below the
panel. It's a sharpening pass, honestly labelled: FSR 3.1 and DLSS need a game engine's
motion vectors and depth buffers (and, for DLSS, NVIDIA's runtime), so they can't be applied to
an Electron window. Games launched from the menu use whatever upscaler they support.

## Bugs and roadmap

Known limits and what's planned are in [docs/ROADMAP.md](docs/ROADMAP.md).

## Run from source

```bash
npm install
npm start
```

`npm start` builds everything and launches the app; `npm run dev` also opens DevTools.

## Build the installer

```bash
npm run package
```

Output goes to `release/` (an NSIS installer). The packaged app never contains your API keys:
SteamGridDB and TMDB keys live only in `%APPDATA%\A-X-M\axm-settings.json`.

## Keys and accounts

- **SteamGridDB** (game art): `gameArtApiKey` in the settings file, or the
  `AXM_STEAMGRIDDB_KEY` environment variable.
- **TMDB** (film / show information): `tmdbApiKey` in the settings file.
- **SubDL** (subtitles): `subdlApiKey` in the settings file, or *Settings › System › SubDL Key*.
- **Jellyfin**: sign in from the Video column; only the access token is kept, never the password.
- MusicBrainz, the Cover Art Archive and LRCLIB need no key.

## Controls

| | Xbox | PlayStation | Nintendo Switch | Keyboard |
| --- | --- | --- | --- | --- |
| Move | D-pad / left stick | D-pad / left stick | D-pad / left stick | Arrows / WASD |
| Select | A | ✕ | A (B with *Swap Confirm* on) | Enter |
| Back | B | ○ | B (A with *Swap Confirm* on) | Esc / Backspace |
| Options | Y | △ | X | Y |
| In-game menu | Guide | PS | Home | Alt+Home (configurable; map M1 to it in Armoury Crate) |
| Ghost card | ↑↓ choose, A pick, B dismiss, Y more | same | same | same |
| Store | ↑↓ tabs / button / tiles, ←→ move, A press, Y info, B back | same | same | same |

Two controllers at once are fine (the Ally's own pad plus a DualSense, say): one press is
one move. The footer draws the glyphs of whichever pad is first.

## Credits

Developed with AI as a passion project - see *Settings › About*. Icons, sounds and sprite
sheets are credited in `assets/THIRD_PARTY_LICENSES.md`. Not affiliated with Sony, ASUS,
Microsoft, Valve, Epic, Jellyfin or TMDB.

## Ribbon background

The animated background is an original real-time effect - no video, no GIF, and no
console firmware assets or shaders. Layered translucent ribbons bend along their
length, twist about their own axis and drift through depth, over a deep gradient
backdrop that cycles colour.

### Dependencies

```bash
npm install three
npm install -D @types/three
```

Nothing else. esbuild already bundles it into `dist/renderer/main.js`.

### Files

| File | What it holds |
| --- | --- |
| `src/background/RibbonBackground.ts` | Public API, animation loop, FPS monitor, WebGL/Canvas selection |
| `src/background/RibbonRenderer.ts` | Three.js scene: ribbon meshes, backdrop quad, camera |
| `src/background/ribbonShaders.ts` | Vertex and fragment GLSL for the ribbons and the backdrop |
| `src/background/ribbonFallback.ts` | Canvas 2D renderer used when WebGL is unavailable |
| `src/background/ribbonTypes.ts` | Options, quality presets, per-layer tuning, backdrop palette |

### Electron integration

It lives entirely in the **renderer** process. It touches WebGL, the DOM and
`requestAnimationFrame`, none of which exist in the main process, and it uses no Node
APIs, so it runs unchanged under `contextIsolation: true` / `nodeIntegration: false`.
It is created in `src/renderer/main.ts` right after settings load:

```ts
const ribbon = new RibbonBackground(document.getElementById("background-layer")!, {
  color: "#ffffff",
  opacity: 0.22,
  speed: 0.25,
  layers: 4,
  quality: settings.backgroundQuality,
  glow: true,
  backdrop: "cycle",
  backdropCycleSeconds: settings.waveColorCycleSeconds,
});
ribbon.start();
```

The full API is `start()`, `stop()`, `resize()`, `destroy()`, plus `setColor`,
`setOpacity`, `setSpeed`, `setLayers`, `setWaveStrength`, `setGlow`, `setQuality`,
`setAnimating`, `setBackdropCycleSeconds`, `setInteractivity`, and the optional
`onNavigate()` / `onSelect()` hooks. `destroy()` removes every listener, disposes the
geometry, materials and GL context, and drops the canvas.

The component needs no explicit cleanup in this app, because the window and the
renderer die together, but `destroy()` is required if you ever rebuild it.

### Layers

The UI stacks as `#background-layer` (0), `#game-bg` (1), `#app` (10),
`#context-modal` (20), `#boot-splash` (30). `#background-layer` is
`pointer-events: none`, so the ribbon never intercepts controller, keyboard or mouse
input. `#app` is the UI layer the component spec calls `#ui-layer`.

### Quality and frame rate

Motion is time-based throughout, driven by the elapsed seconds between frames rather
than a frame count, so 60, 90 and 120 Hz all produce identical speed.

| Preset | Layers | Segments | Max DPR | Glow |
| --- | --- | --- | --- | --- |
| Low | 2 | 48 | 1 | off |
| Medium | 3 | 96 | 1.5 | on |
| High | 5 | 176 | 2 | on |

`quality: "auto"` starts at high and steps down a preset whenever the average stays
below 55 FPS for three seconds. It never steps back up: a machine sitting near the
threshold would otherwise flip presets every few seconds, and that churn is far more
visible than the frame it saves. Settings > Background Quality overrides it.

Rendering pauses entirely while the window is hidden or minimised.

### Tuning

Nearly everything lives in `src/background/ribbonTypes.ts`.

- **Softer**: raise `thickness` in `LAYER_SPECS`, or lower `opacity`. In the fragment
  shader, lowering the `pow(band, 1.35)` exponent widens the falloff.
- **Sharper**: raise that exponent, and raise the `core` multiplier on `uGlow`.
- **Faster or slower**: `setSpeed()` scales everything at once. For a single band,
  change its `speed` in `LAYER_SPECS`.
- **Wider waves**: lower `frequency` for fewer, longer undulations. Raise it for a
  tighter ripple.
- **Taller waves**: raise `amplitude`, or `setWaveStrength()` for all layers. Past
  about 1.6 the bands start colliding.
- **More layered**: add entries to `LAYER_SPECS` and raise `maxLayers` in the quality
  profiles. Keep new layers' `depth` spread out, since that is where the parallax
  comes from.
- **More twist**: raise `TWIST` in `RibbonRenderer.ts`. Zero gives flat stripes.
- **Backdrop**: edit `BACKDROP_PALETTE`, or pass `backdrop: "static"` with
  `backdropColors`, or `backdrop: "none"` to leave the container transparent.

### Interactivity

Navigation boost, selection pulse and pointer parallax are all implemented but
**disabled by default**, as specified. Turn them on with:

```ts
ribbon.setInteractivity({ enabled: true });
```

then call `ribbon.onNavigate()` as the selection moves and `ribbon.onSelect()` when a
game is chosen.

## Menu background

Selecting a game swaps the animated wave for that game's wide hero banner, blurred
and darkened behind the menu, the way a PS3 theme replaces the XMB background.
Moving to another game crossfades; leaving the Game category fades back to the wave.

Steam titles use Steam's own `library_hero.jpg`. Everything else is looked up on
SteamGridDB with the same key as the box art, and cached next to it in
`%APPDATA%\A-X-M\art-cache`. Games with no hero available simply keep the wave.

## Still needed before this is "done"

1. **Verified Lossless Scaling automation** - currently A-X-M just launches LS and lets
   its own per-app auto-scale filters (which you configure inside LS) do the switching.
   Real automatic profile writing needs LS's `Settings.xml` schema verified against an
   actual install before it's safe to touch.
3. Game-cover art for Epic/generic/Xbox entries (Steam already pulls library art from
   Steam's CDN); Xbox tiles use the UWP package logo when one resolves.
