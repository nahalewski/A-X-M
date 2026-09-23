# A-X-M 0.6.2 Beta 1

Next beta of the Ally XMB Menu, a PS3-XMB-style hub for the ROG Xbox Ally and
any Windows handheld or PC. It rolls up everything since 0.4.0 Beta 1. The
0.5.1 and 0.6.1 builds were never tagged.

**Install:** run `A-X-M-Setup-0.6.2-beta.1.exe`, or the portable `A-X-M-0.6.2-beta.1-portable.exe`
(no install). On the Steam Deck, use the AppImage. Windows will warn because the build isn't
code-signed - choose *More info › Run anyway*. `build-all.bat` builds all three packages;
`build-all.bat bump` steps the version first.

## New since 0.4.0 Beta 1

- **A-X-M Companion (Android)**: finds the PC on its own, pairs with a code, and drives the
  menu as if it were local. It has now-playing with artwork and scrubbing, can play audio
  on the phone, and offers a music library browser, a live keyboard for prompts on the TV,
  and a mirror of the menu's settings. Pair it from *Settings › Companion Devices* or by
  saying "pair my phone"
- **Retro column**: PS3 / PS2 / PS1 / PSP / Switch (plus PS4 / PS5) through their emulators,
  and headless emulator installs. PS3 discs are decrypted, extracted and trimmed in the
  menu. Emulators are found wherever they are installed
- **ROOT drive**: one drive laid out as GAME, MUSIC, PHOTO, VIDEO, SAVE, TEXTURES, PATCHES and
  NFC. It is the only place retro games and media are read from
- **Memory Card Utility with Apollo Save Tool**: virtual PS1 / PS2 cards, a full PS2 card
  filesystem, import / export, and Apollo cheats, community saves and backups with undo.
  Card files are identified by content, not extension, and the phone keeps a copy of every save
- **Game Information**: year, publisher, developer and genre from GameDB (PlayStation) and
  GameTDB (Nintendo), with region-aware matching
- **HD Texture Packs** for PS1 / PS2: download, enable, disable, delete from the Y sidebar
- **PC games**: install from disc images in `GAME\PCISO` (Inno / NSIS / InstallShield run
  silently), and move, copy or uninstall from the Y sidebar. Moves check free space and
  verify the copy first, and Steam / Epic are told where the game went
- **Cartridge drive**: its games join the scan, and its window cycles their artwork
- **TV Streaming**: Xtream sign-in, browse and watch inside Video, per-language filters,
  PIN-locked adult content, audio language, SubDL subtitles
- **Music**: Ghost Radio, music search, a download queue, and a Karaoke visualizer with
  LRCLIB lyrics
- **Console boot / launch sounds and launch screens** (PlayStation and Nintendo), used only
  when you supply the files in `BOOT` on the ROOT drive
- **Artwork**: retro games show their platform's disc (spinning while art is looked up),
  lookups try the natural name ("The Legend of Dragoon"), misses are forgotten after a week,
  and PS3 games fall back to their own ICON0. LEGO Dimensions figure artwork covers 315 of 319
- **Keys** live in `apis/apis.json` (gitignored; `apis.example.json` is the template).
  Channel logos you supply in `network logos` override the provider's
- Full credits in the README and *Settings › About & Credits*
- Fixes: one press is one move with two controllers connected; the PS3 decrypted
  intermediate is never stranded; settings survive a torn file

## Known limits

- Wii, Wii U, DS and DSi launch artwork is in place, but the scanner doesn't know those
  platforms yet
- GOG, Ubisoft, EA and Amazon games can be copied but not moved; the launcher needs
  re-pointing. Xbox / Microsoft Store games are handled in Windows' own Apps settings
- PS3 entries in GameDB carry little more than a title
- API keys (SteamGridDB, TMDB, Steam Web, RetroAchievements, SubDL) are yours to add
