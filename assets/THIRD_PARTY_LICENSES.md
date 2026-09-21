# Third-party assets

## PS3-style icons, sounds, and font

Source: [JMRDev0/XMB-PS3-Icons-Sounds-Pack](https://github.com/JMRDev0/XMB-PS3-Icons-Sounds-Pack)
Author: Justin Rankin (JMRDev)
License: MIT (see below)

An original PS3-XMB-inspired theme pack (not extracted Sony firmware assets), originally
built as a RetroArch XMB overlay. A-X-M uses:

- `sounds/ambient.ogg` (from `bgm.ogg`) - menu background loop
- `sounds/boot.ogg` (from `launch.ogg`) - boot stinger
- `sounds/confirm.ogg` (from `ok.ogg`), `sounds/back.ogg` (from `cancel.ogg`)
- `sounds/context-open.ogg`, `sounds/context-close.ogg` (from `notice.ogg`/`notice_back.ogg`)

The pack's icons are no longer used - see below.

## Supplied by the project owner

- All category icons in `icons/` except `games.svg`: sliced from a single flat
  white-on-transparent icon sheet provided for this project. Provenance and license
  of that sheet have not been verified here; confirm before redistributing.
- `sounds/luminous.mp3` - the "Luminous Ambience" menu loop, from `Luminous_Standby.mp3`.
- `sounds/nav.mp3` - the navigation blip, from `menu navigation sound.mp3`. Replaces
  the pack's `nav-up.ogg`/`nav-down.ogg`, which have been removed.
- `icons/boot-logo.png` - the A-X-M wordmark shown on the boot splash, trimmed to its
  own bounds from the supplied artwork.
- `icons/battery-sprite.webp`, `icons/status-sprite.webp` - battery and Wi-Fi /
  Bluetooth indicators, re-tiled onto exact grids from the supplied sheets.
- `icons/ps-buttons.webp`, `icons/switch-buttons.webp`, `icons/kishi-buttons.webp` -
  the four face buttons cropped from the supplied PlayStation, Nintendo Switch and
  Razer Kishi button sheets, for the footer hints.
- `icons/hdd.webp` - the ROG external drive, cropped from the supplied artwork; shown
  for drives that carry PHOTO / VIDEO / GAME folders. The ROG logo is ASUS's mark.

Same caveat as the icon sheet: provenance not verified here.

## Original to this project

- `icons/games.svg` - a DualShock 3 silhouette drawn for A-X-M, because neither the
  pack nor the supplied sheet has a PS3-shaped controller. Flat white-on-transparent
  to match the rest of the set.
- `fonts/xmb-font.ttf`

```
MIT License

Copyright (c) 2025 Justin Rankin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Libraries bundled into the renderer

- [hls.js](https://github.com/video-dev/hls.js) - Apache License 2.0, Copyright (c)
  2017 Dailymotion. Used to play Jellyfin's HLS transcodes in the built-in viewer.
  Full text: `node_modules/hls.js/LICENSE`.
- [music-metadata](https://github.com/Borewit/music-metadata) - MIT License, Copyright (c)
  2015 Borewit. Reads a track's tags and embedded cover for the Song Information card.
  Full text: `node_modules/music-metadata/LICENSE.txt`.
- [three.js](https://github.com/mrdoob/three.js) - MIT License, Copyright (c) 2010-2024
  three.js authors. Draws the flowing ribbon background; the shaders in
  `src/background/ribbonShaders.ts` are original to this project and run on top of it.
  Full text: `node_modules/three/LICENSE`.
- [vosk-browser](https://github.com/ccoreilly/vosk-browser) - Apache License 2.0,
  Copyright (c) Ciaran O'Reilly, wrapping [Vosk](https://github.com/alphacep/vosk-api)
  (Apache-2.0, Alpha Cephei). Offline speech recognition for Ghost's voice commands;
  nothing is sent anywhere. Full text: `node_modules/vosk-browser/LICENSE`.
- [ws](https://github.com/websockets/ws) - MIT License, Copyright (c) 2011 Einar Otto
  Stangvik and contributors. The WebSocket server the Android companion connects to.
  Full text: `node_modules/ws/LICENSE`.

## Apollo Save Tool (GPL-3.0)

Damian "bucanero" Parrino's Apollo Save Tool is the source of the Memory Card
Utility's cheats and community saves:

- [apollo-lib](https://github.com/bucanero/apollo-lib) - the `.savepatch` format and the
  patch engine. `src/main/apollo/savepatch.ts` and `src/main/apollo/engine.ts` are a
  TypeScript port of its loader and `patches.c` (Save Wizard / Game Genie codes and BSD
  scripts), following the same rules line for line where they are ported and refusing,
  by name, what isn't (Python codes, the game-specific checksums and ciphers, zlib blocks).
- [apollo-patches](https://github.com/bucanero/apollo-patches) - the save-edit / cheat
  database. Downloaded on demand into the user's data folder (`apollo/patches`), never
  bundled; every patch keeps its author line, shown under "About these patches".
- [apollo-saves](https://github.com/bucanero/apollo-saves) - the community save files.
  Listed from the repository tree; a save comes down only when asked for.

All three are GNU General Public License v3.0. The Apollo-derived parts of A-X-M
(`src/main/apollo/`) carry the same licence; see
<https://www.gnu.org/licenses/gpl-3.0.html>. Bruteforce Save Data (aldostools) and the
Save Wizard code format are the lineage of the codes themselves. Ross Ridge's ps2mc /
mymc notes describe the PS2 card filesystem `src/main/ps2card.ts` reads and writes.

## Game information databases

Downloaded on demand into the user's own cache and never bundled, so a GPL-3.0
dataset is not redistributed with A-X-M. Both answer the Information panel's
"who made this, when did it come out" for console games.

- [GameDB-PSX](https://github.com/niemasd/GameDB-PSX),
  [GameDB-PS2](https://github.com/niemasd/GameDB-PS2) and
  [GameDB-PS3](https://github.com/niemasd/GameDB-PS3) - GPL-3.0, Niema Moshiri
  (niemasd), part of [GameDB](https://github.com/niemasd/GameDB). Release data for the
  PlayStation platforms: title, serial, region, publisher, developer, genre and date.
  Their own sources are credited in each repository's README - GameFAQs, Glitchwave,
  MobyGames, PlayStation Datacenter, Redump, ScreenScraper, SerialStation and VGArchive.
- [GameTDB](https://www.gametdb.com) - a community database for the Nintendo platforms,
  read from its published XML dumps. Free for non-commercial use; see the site's terms.

## Toybox figure artwork and NFC data

- [skylandersNFC/LEGO-Dimensions-NFC](https://github.com/skylandersNFC/LEGO-Dimensions-NFC)
  - no licence stated by the repository. LEGO Dimensions figure artwork, keyed by the
  same character id the NFC tags carry. A-X-M uses Chteupnin's set; the repository also
  holds sets by Jeneric, iranzo, Moto28, James Mcat, J1onelonewolf and andromeda.333.
  Fetched into the user's own cache by `scripts/toybox-lego-art.mjs` and never bundled
  or redistributed - LEGO Dimensions characters and marks belong to LEGO and Warner Bros.

## Online services

- [MusicBrainz](https://musicbrainz.org) and the [Cover Art Archive](https://coverartarchive.org)
  supply artist details and covers for songs (CC0 / CC BY-NC-SA data; one request a
  second, as their terms ask).
- [TMDB](https://www.themoviedb.org) supplies film and series details and posters. This
  product uses the TMDB API but is not endorsed or certified by TMDB. The API key is
  the user's own and lives only in the settings file.
- `sounds/boot.ogg` - the boot sound, from the supplied `boot sound.wav`.
- `sounds/moonlit.ogg`, `sounds/dreamy.ogg`, `sounds/midtown.ogg` - three optional menu
  loops, from the supplied f-r-a-g-i-l-e AIFF loops (Freesound ids 862467, 720895,
  720896). Check the Freesound licence of each before redistributing.
- `icons/progress-sprite.webp` - the 20-frame progress ring, re-tiled from the supplied
  sheet. `icons/hdd-off.webp` - the grey ROG drive, for an unplugged drive's row.
- `icons/epic.svg` - a plain badge drawn for the Epic Games Launcher row.
- `icons/settings-theme.webp`, `settings-display.webp`, `settings-audio.webp`,
  `settings-system.webp`, `settings-about.webp` - the Settings group icons, sliced from
  the supplied sheet. `icons/app.png` - the app icon rendered from `app.ico` for Linux.
- `icons/network-settings.webp`, `about.webp`, `store.webp`, `trophy.webp`, `disc-dvd.webp`,
  `disc-bluray.webp`, `disc-ps2.webp`, `disc-ps1.webp` - sliced from the supplied sheet.
  The Blu-ray, PS1 and PS2 marks on them belong to their owners.

## External tools driven from the menu (not bundled)

- [chiaki-ng](https://github.com/streetpea/chiaki-ng) - GPL-3.0 - Remote Play client,
  downloaded into the app's tools folder on first use, with the user's say-so.
- [HandBrakeCLI](https://handbrake.fr) - GPL-2.0 - DVD / MKV to MP4 for Backup.
- [MakeMKV](https://www.makemkv.com) - proprietary, free while in beta - Blu-ray reading.
- ffmpeg with libcdio - GPL/LGPL - audio CD import.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Unlicense - fetches music for Ghost Radio
  and the music search, into the user's own MUSIC folder. Downloaded on first use.
- [FFmpeg](https://ffmpeg.org) - LGPL-2.1+/GPL-2+ - transcoding, thumbnails, tagging and
  joining the optional menu music. Not bundled; found on PATH or fetched on request.

### Emulators

Launched by the menu, never bundled, and each installed by the user or fetched from its
own official release with the user's say-so. A-X-M reads their memory-card folders and
configuration files; it does not include any of their code.

- [DuckStation](https://github.com/stenzek/duckstation) - Stenzek - PlayStation.
  Its `settings.ini` gives the menu the memory-card folder to read and write.
- [PCSX2](https://github.com/PCSX2/pcsx2) - GPL-3.0 - PlayStation 2. Likewise via
  `PCSX2.ini`, including its folder-card format.
- [RPCS3](https://github.com/RPCS3/rpcs3) - GPL-2.0 - PlayStation 3.
- [PPSSPP](https://github.com/hrydgard/ppsspp) - GPL-2.0 - PSP.
- [shadPS4](https://github.com/shadps4-emu/shadPS4) - GPL-2.0 - PlayStation 4.
- [Kyty](https://github.com/InoriRus/Kyty) - PlayStation 5, experimental.
- [Eden](https://git.eden-emu.dev/eden-emu/eden) - GPL-3.0 - Nintendo Switch. Keys and
  firmware are the user's own, from their own console; A-X-M supplies neither.
