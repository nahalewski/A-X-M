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
