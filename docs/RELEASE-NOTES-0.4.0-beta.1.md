# A-X-M 0.4.0 Beta 1

Fourth beta of the Ally XMB Menu - a PS3-XMB-style hub for the ROG Xbox Ally and
any Windows handheld or PC.

**Install:** run `A-X-M-Setup-0.4.0-beta.1.exe`, or the portable `A-X-M-0.4.0-beta.1-portable.exe`
(no install). Windows will warn because the build isn't code-signed - choose *More info › Run anyway*.
On first launch the menu fetches the tools it leans on (ffmpeg, HandBrakeCLI, MakeMKV, Python 3.11,
then Ghost's voice engine) through winget; watch the progress toast, or run it later from
*Settings › System › Install Tools*.

## New since 0.3.0 Beta 1

- **Ghost speaks in a cloned voice** - one short clip (the one that ships, or your own) through
  Chatterbox in a local Python environment. No cloud, no fallback voice; menu music ducks while
  Ghost listens or talks, and Ghost no longer hears himself
- **Ghost cards**: artwork, a name, a question and choices you answer with the d-pad or by
  talking - "play giants", "the second one", "yes", "not now" - without the wake word
- **Toybox**: Amiibo, Skylanders, Disney Infinity and LEGO Dimensions on a bookshelf that grows
  with your collection; owned / favourite / wanted, filter, search, or "hey ghost, open my shelf"
- **NFC detection**: put a toy on an ACR122U (or scan it with the Android companion, or a portal
  adapter) and Ghost says what it is, shows it, and offers the games you have installed - one
  press or one sentence launches it. Remembers the last game per figure, keeps a grace period
  when a toy is lifted, swaps figures in place, and follows a *during gameplay* setting
  (full card / small notification / voice only / off). Read-only copies of scanned toys are
  placed where Eden (amiibo) and RPCS3 (Skylanders / Infinity) load figures from
- **Discs**: a DVD or Blu-ray shows its real title, year and poster; **Rip** makes the library
  MKV (H.265 10-bit, original audio, all subtitles) with progress and notifications at start,
  half way and done; **Play** plays the ripped copy. "Copy the Blu-ray to storage", "rip the
  DVD", "import the CD" work by voice. Disc Backup Location and MakeMKV Key in Settings › System
- **Install Tools** (Settings › System): everything the rippers and Ghost need, one row
- Toybox data: 932 Amiibo, 702 Skylanders (449 with pictures), 320 Disney Infinity, 319 LEGO
  Dimensions - pulled locally, never shipped; the figures belong to their publishers
- Blu-ray disc icon in Video; System Update row at the top of Settings; FLAC playback and
  FLAC CD import; MKV playback with the HEVC decoder enabled; two notification pill styles

## Toybox readers

- **ACR122U** (or any PC/SC reader): plug in, that's it - amiibo (NTAG215), LEGO Dimensions
  (NTAG213, password + TEA), Skylanders (MIFARE 1K, sector 0) and Disney Infinity (MIFARE Mini,
  derived key + AES) are identified on the device. Nothing is written to a tag
- **Companion**: anything on the same Wi-Fi can `POST http://<pc>:47311/toybox/scan`
  with `{ "uid": "...", "ecosystem": "amiibo", "head": "...", "tail": "..." }` (or a `figureId`),
  `/toybox/remove` when the toy is lifted, `GET /toybox/status` to see what's on the pad
- **Real portals / bases / toy pads** plug straight into RPCS3 via its USB passthrough

## Devices

Windows 10 / 11 x64: ROG Xbox Ally, ROG Ally / Ally X, Legion Go, MSI Claw, any x64 PC with a
WebGL 2 GPU. Ghost's voice runs on the CPU anywhere and on the GPU on NVIDIA machines. Steam
Deck: the AppImage runs on SteamOS (tools come from the distro / flatpak there). No ARM64 build.

## Known limits

- Neither RPCS3 nor Eden can be told to load a figure from outside their own windows; A-X-M
  drops the figure file where their Load dialogs look
- MakeMKV's Blu-ray reading needs its key (posted on makemkv.com's forum while it is in beta)
- Ghost's first reply with a new phrase takes a moment on CPU-only machines; every phrase is
  cached afterwards
- Steam has no silent install; the browser's page isn't captured in screenshots; API keys
  (SteamGridDB, TMDB, Steam Web, RetroAchievements) are yours to add
