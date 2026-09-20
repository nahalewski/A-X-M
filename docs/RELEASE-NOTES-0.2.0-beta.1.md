# A-X-M 0.2.0 Beta 1

Second beta of the Ally XMB Menu - a PS3-XMB-style hub for the ROG Xbox Ally and
any Windows handheld or PC.

**Install:** run `A-X-M-Setup-0.2.0-beta.1.exe`, or the portable `A-X-M-0.2.0-beta.1-portable.exe` (no install) (per-user, no admin). Windows SmartScreen
will warn because the build isn't code-signed - choose *More info › Run anyway*.

## New since 0.1.0 Beta 1

- Settings grouped into Theme, Display, Audio, Network and System
- **Network**: Wi-Fi join / disconnect / forget and Bluetooth pair / remove inside the menu
- **Menu Upscaling** (FSR-style sharpening when rendering below native) next to Menu Resolution
- Progress ring rebuilt with all 17 steps from the new sheet
- Portable EXE alongside the installer, and a **Steam Deck** AppImage (SteamOS / Linux x64)
- Boot splash uses the logo only

## What's in

- The XMB: Users, Settings, Photo, Music, Video, Game, Browser - PS3 running order, sliding
  category bar, the waves, boot sound, five menu loops, navigation sounds
- Games from Steam, Epic, Xbox / Game Pass and plain folders on every drive; SteamGridDB art
  and hero backgrounds; Change Artwork; Lossless Scaling profiles; Steam library with
  background installs; Saved Data / Game Data utilities; launcher rows
- In-game overlay on the Guide / PS button (or M1 mapped to a shortcut)
- Music with playlist, shuffle, Song Information (tags + MusicBrainz + Cover Art Archive)
  and eleven visualizers (PS3, PSP and four new neon ones)
- Photos and video in the menu; wallpaper from your pictures; Jellyfin browsing, playback
  and downloads; TMDB information on films and shows
- Copy media to and from any drive's MUSIC / PHOTO / VIDEO folder; make folders there
- Pop-up browser inside the menu
- Settings: monthly XMB colours, menu resolution (720p–4K, auto), refresh rate, FPS counter,
  hardware info, System Information (drives), Controller (players, battery, dead zone,
  vibration), About
- Controller glyphs for Xbox, PlayStation, Switch and Kishi pads; Wi-Fi, Bluetooth, Ally and
  Anker battery in the status bar

## Devices

Windows 10 / 11 x64: ROG Xbox Ally, ROG Ally / Ally X, Legion Go, MSI Claw, any x64 PC with a
WebGL 2 GPU. Steam Deck: the AppImage runs on SteamOS (Desktop Mode, or add it to Steam as a
non-Steam game for Game Mode) - untested on real Deck hardware so far. No ARM64 build yet.

## Known limits

- Steam has no silent install; "hands-off" confirms Steam's own dialog for you
- Gyro and button remapping aren't exposed to apps by Windows - use Armoury Crate
- The browser's page isn't captured in screenshots (it's a separate web view)
- API keys (SteamGridDB, TMDB) are yours to add in `%APPDATA%\A-X-M\axm-settings.json`

Possible PSP and Android development coming soon.
