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
