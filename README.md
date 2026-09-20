# A-X-M (Ally XMB Menu)

PS3-XMB-style game hub launcher for the ROG Xbox Ally, built with Electron + TypeScript.

## Run it

```bash
npm install
npm start
```

`npm start` builds everything and launches the app. Use `npm run dev` to also open DevTools.

## Build a portable .exe

```bash
npm run package
```

Output goes to `release/`.

## What's implemented

- Fullscreen by default, toggle to windowed from Settings (persisted to disk).
- WebGL animated wave background cycling through 8 colors (Settings > Wave Color Speed).
- XMB-style category bar (Games / Settings / Power) with vertical item lists, keyboard
  (arrows/WASD, Enter, Esc, Y) and Xbox-controller (D-pad/stick, A/B/Y) navigation.
- Game scanning across every drive letter: Steam (via `libraryfolders.vdf` + manifests,
  launched through `steam://rungameid/<id>`), Epic Games (via its manifest JSON files,
  launched through the Epic protocol), Xbox/Game Pass UWP titles (via `Get-AppxPackage`
  + manifest lookup, launched through `shell:AppsFolder\...`), and a generic scan of
  `Games`/`GOG Games`/etc. folders on each drive plus any folders you add yourself.
- Y button on a focused game opens a profile picker (None/1/2/3) for Lossless Scaling;
  the choice is remembered per game. See `src/main/losslessScaling.ts` for why this
  intentionally does NOT write Lossless Scaling's own config file yet.
- Boot chime -> ambient menu loop with fade in/out (`src/renderer/audio.ts`) - silently
  no-ops until real audio files are dropped in `assets/sounds/` (see below).
- Runs uncapped by Chromium's internal frame limiter so it tracks the display's native
  refresh rate (120Hz on the Ally) through normal vsync - no tearing hacks.

## Music

The Music category browses the library folder-by-folder, mirroring however it's laid
out on disk (e.g. `Artist / Album / tracks`) rather than flattening everything into one
list. A descends into a folder or plays a track, B goes back up a level, and Y toggles
play/pause. Playing a track queues the rest of its folder so it advances automatically,
and the ambient menu loop fades out while music plays and returns when it stops.

Roots come from `musicFolders` in settings (add one via Settings > Add Music Folder),
falling back to the usual Windows music locations. FLAC, MP3, WAV, OGG, M4A, AAC, WMA
and Opus all play natively.

## Boot logo

The boot splash loads `assets/icons/boot-logo.png` and falls back to plain "A-X-M" text
if that file isn't present.

## Box art

Steam titles pull their art from Steam's CDN. Everything else (Epic, loose exes,
Xbox titles with no package logo) is looked up on [SteamGridDB](https://www.steamgriddb.com),
which needs a free API key. The key is **not** stored in this repo - put it in either:

- the `AXM_STEAMGRIDDB_KEY` environment variable, or
- `gameArtApiKey` in `%APPDATA%\A-X-M\axm-settings.json`

Art is fetched in the background after a scan and cached under
`%APPDATA%\A-X-M\art-cache`, so it only downloads once and works offline after that.
Misses are cached too, so unmatched names aren't retried on every launch. Without a
key the grid just falls back to source letter badges.

## Still needed before this is "done"

1. **Audio assets** - drop these into `assets/sounds/`:
   - `boot.ogg` - short boot stinger, plays once on launch.
   - `ambient.ogg` - loop-friendly ambient pad, fades in after boot and loops until quit.
   UI navigation blips (move/confirm/back/context) are synthesized in-code, so the menu
   has sound even without these two files.
2. **Verified Lossless Scaling automation** - currently A-X-M just launches LS and lets
   its own per-app auto-scale filters (which you configure inside LS) do the switching.
   Real automatic profile writing needs LS's `Settings.xml` schema verified against an
   actual install before it's safe to touch.
3. Game-cover art for Epic/generic/Xbox entries (Steam already pulls library art from
   Steam's CDN); Xbox tiles use the UWP package logo when one resolves.
