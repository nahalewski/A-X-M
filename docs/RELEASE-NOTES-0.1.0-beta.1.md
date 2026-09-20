# A-X-M 0.1.0 Beta 1

First public build of the Ally XMB Menu - a PS3-XMB-style hub for the ROG Xbox Ally and
any Windows handheld or PC.

**Install:** run `A-X-M-Setup-0.1.0-beta.1.exe` (per-user, no admin). Windows SmartScreen
will warn because the build isn't code-signed - choose *More info › Run anyway*.

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

## Known limits

- Steam has no silent install; "hands-off" confirms Steam's own dialog for you
- Gyro and button remapping aren't exposed to apps by Windows - use Armoury Crate
- The browser's page isn't captured in screenshots (it's a separate web view)
- API keys (SteamGridDB, TMDB) are yours to add in `%APPDATA%\A-X-M\axm-settings.json`

Possible PSP and Android development coming soon.
