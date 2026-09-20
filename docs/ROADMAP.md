# A-X-M - known bugs and what's next

Kept honest and current. If something here is fixed or shipped, it moves.

## Known bugs and limits (0.2.0 Beta 1)

- **Bluetooth discovery is best effort.** Pairing works for devices Windows has already
  seen (pairing mode, then *Scan Again*), but the menu can't run a live scan: that needs a
  WinRT `DeviceWatcher`, which can't be driven from PowerShell 5.1. Devices that need a PIN
  can't be paired from the menu yet.
- **Wi-Fi** is netsh-based: WPA2/WPA3-Personal and open networks only; no enterprise (802.1X)
  networks, no captive-portal handling.
- **Steam installs** can't be silent (Steam has no such command). "Hands-off" confirms Steam's
  own dialog by sending Enter to it, which fails if Steam's window title changes or a
  space / EULA prompt appears; the dialog then stays up for you.
- **Anker power bank**: the level only reads once the bank is paired in Windows; A-X-M can't
  pair it itself (see Bluetooth above).
- **Gyro / motion and button remapping** aren't exposed to apps by Windows' controller API;
  use Armoury Crate or DS4Windows.
- **Xbox / Game Pass titles** launch but their install folders can't be opened (WindowsApps is
  ACL-locked), so they're missing from Game Data Utility.
- **Menu upscaling** is a sharpening pass, not FSR or DLSS - those need a game engine's motion
  vectors and depth (and NVIDIA's runtime) and can't be applied to an Electron window.
- **Jellyfin**: series with many seasons list slowly (one request per level); Live TV and
  music libraries browse but only video items play in the menu.
- **In-menu browser** pages aren't captured in screenshots and don't receive controller input
  beyond scroll / back / forward / reload (no on-page focus navigation yet).
- **Ultrawide** layouts leave the items column far from the categories; 16:9 and 16:10 are
  what it's tuned for.
- **First-run scan** on a machine with many drives can take a few seconds before games
  appear; the menu is usable meanwhile.
- The app **isn't code-signed**; SmartScreen warns on first run.

## Next

- Proper Bluetooth scanning (a small native helper for `DeviceWatcher`) and PIN pairing
- On-page controller navigation in the browser (focus rings, virtual cursor)
- Trophies / achievements column (Steam achievements, RetroAchievements)
- Friends / online presence (Steam friends) in the Users column
- Emulator front-end: RetroArch / ROM folders with box art, per-core settings
- Store column: Steam store, Epic free games, Game Pass catalogue inside the menu
- Per-game controller and TDP / power profiles (Armoury Crate hooks where possible)
- PS3-style dynamic themes (full theme packs: icons, sounds, waves) and a theme importer
- Photo slideshow music, video thumbnails, folder art
- Podcasts / internet radio, Spotify / Tidal connect
- Cloud saves status and backup to a drive
- Screenshot / clip gallery from Xbox Game Bar captures
- Sleep / power menu (sleep, restart, shut down) and battery-saver profiles
- Multiple profiles with their own settings, and a lock (PIN) per profile
- Localisation
- **PSP** (homebrew menu, in planning) and **Android** (handheld launcher) builds

## Devices and processors this build runs on

- Windows 10 / 11, **x64** only (the installer and portable EXE are 64-bit; no ARM64 build
  yet - Snapdragon X machines run it through Windows' x64 emulation).
- Tested on: ROG Xbox Ally (Ryzen Z2 A), ROG Ally / Ally X (Ryzen Z1 / Z1 Extreme), a
  desktop with a Ryzen 7 9700X + RTX 3080 (development machine).
- Should run on: Legion Go / Go S, MSI Claw (Intel Core Ultra), Steam Deck on Windows, and
  any x64 PC with a GPU that does WebGL 2 (Intel UHD onwards).
- Handheld screens: 1280×800, 1920×1080 and 1920×1200 panels are laid out for; 1440p and
  4K docks are covered by the Menu Resolution setting.
