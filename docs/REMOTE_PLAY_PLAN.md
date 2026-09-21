# A-X-M Remote Play — implementation plan

Streaming the A-X-M menu, and the games launched from it, to the Android
companion app. This is A-X-M's own remote play. It is **not** chiaki-ng, does
not touch chiaki-ng, and does not talk to a PlayStation console — chiaki-ng
stays exactly where it is, as the separate feature that connects to a real PS4
or PS5.

Status: **plan only**. Nothing below is built yet.

---

## 1. The licensing constraint, first

This decides the whole design, so it goes before the architecture.

| Project | Licence |
| --- | --- |
| [LizardByte/Sunshine](https://github.com/LizardByte/Sunshine) (host) | GPL-3.0 |
| [moonlight-stream/moonlight-android](https://github.com/moonlight-stream/moonlight-android) (client) | GPL-3.0 |
| [moonlight-stream/moonlight-common-c](https://github.com/moonlight-stream/moonlight-common-c) (protocol core) | GPL-3.0 |

Copying source from any of them into A-X-M would make A-X-M's remote play
GPL-3.0 and oblige us to publish it under those terms. A-X-M already carries
one GPL-3.0 island on purpose — `src/main/apollo/`, which is a declared port —
but that was a deliberate choice for one feature, not a default.

**What is and is not borrowable:**

- **Protocols, wire formats and packet layouts are not copyrightable.** Writing
  an independent implementation of a documented protocol is legitimate, and is
  exactly what Moonlight itself did with NVIDIA's GameStream.
- **Their source code is copyrightable.** No file, function or block of theirs
  gets pasted into A-X-M.
- **Their design decisions are learnable.** Frame pacing, why they pick the
  buffer sizes they do, how they order NACKs — reading that and then writing our
  own is normal engineering.

**So the rule for this feature:** read Sunshine and Moonlight to understand the
problem, cite them as the reference implementations, write every line
ourselves, and ship none of their code. Credits go in
`assets/THIRD_PARTY_LICENSES.md`, the README, and *Settings › About & Credits*
whether or not a single byte is shared, because they are the reason we know how
to do this at all.

There is a second, easier answer available to us that Sunshine and Moonlight
did not have, and section 4 takes it.

---

## 2. Scope

Two modes, and they are genuinely different problems. Keeping them separate is
the single most important structural decision here.

| | **Menu mode** | **Game mode** |
| --- | --- | --- |
| What is streamed | The A-X-M window | The whole screen, or the game's window |
| Where input goes | A-X-M's own handlers, in-process | The running game, via the OS |
| Needs a driver | No | Yes, a virtual gamepad |
| Works on day one | Yes | No |

Menu mode needs no privileged code at all, because A-X-M already receives
companion input and acts on it. Game mode needs input to reach a process A-X-M
does not own, which is where the real work is.

Out of scope for this plan: streaming to anything but the A-X-M companion app,
streaming over the internet (LAN only to begin with), and multiple simultaneous
viewers.

---

## 3. What already exists

The companion is further along than it looks, and the plan leans on it hard.

| Piece | Where | What it gives remote play |
| --- | --- | --- |
| UDP discovery | `src/main/companion/discovery.ts` | The phone already finds the host on the LAN. |
| Paired WebSocket | `src/main/companion/server.ts` | A live, authenticated, bidirectional channel — this becomes the WebRTC signalling path for free. |
| Device registry | `src/main/companion/registry.ts` | Trusted devices, SHA-256 token hashes, constant-time comparison. Remote play reuses it rather than inventing a second trust model. |
| Input messages | `XmbMessage`, `PointerMessage` in `protocol.ts` | Menu-mode input is **already done**. The phone can drive the XMB today; it just cannot see it. |
| Permissions | `CompanionPermissions` | A per-device `remotePlay` permission slots straight in. |

So menu mode reduces to: *add video and audio to a channel that already carries
input.* That is a much smaller problem than "build remote play".

---

## 4. Transport: WebRTC, not a hand-rolled RTP stack

Sunshine and Moonlight send RTP over raw UDP and implement, themselves:
Reed-Solomon FEC, packet loss recovery, a jitter buffer, congestion control,
bitrate adaptation, encryption, and NAT traversal. That is a great deal of
difficult code, and they need it because they must interoperate with clients
they do not control.

**We control both ends.** Both are Chromium-family or have first-class WebRTC:

- The host is Electron, which is Chromium — WebRTC is built in.
- The Android client can use Google's WebRTC library, which ships as a
  well-maintained AAR and is Apache-2.0 / BSD, not GPL.

Taking WebRTC gives us, already written and battle-tested:

- Congestion control (GCC / transport-cc) and bitrate adaptation
- NACK, RTX and FEC for loss recovery
- A jitter buffer with frame pacing
- DTLS-SRTP encryption, mandatory, not optional
- ICE for NAT traversal, which makes later internet support tractable

The cost is a little less control over the last few milliseconds of latency
than a bespoke UDP stack. For a LAN, with `googCpuOveruseDetection` off and the
degradation preference pinned to maintain-framerate, that trade is clearly
worth it. It also sidesteps the GPL question entirely: we are not
reimplementing Moonlight's transport, we are using a different one.

**Signalling** goes over the existing companion WebSocket. No new port, no new
pairing, no second trust model.

---

## 5. Capture and encode (host)

### Video

Electron's `desktopCapturer` returns a source handle that `getUserMedia` turns
into a `MediaStream`, entirely in JavaScript, with no native module:

```
desktopCapturer.getSources({ types: ["window", "screen"] })
  -> chromeMediaSourceId
  -> navigator.mediaDevices.getUserMedia({ video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId } } })
  -> RTCPeerConnection.addTrack()
```

Chromium encodes with hardware acceleration where the GPU supports it. On the
ROG Xbox Ally that means AMD VCN — H.264 certainly, HEVC and AV1 depending on
the part and the Chromium build.

Menu mode captures the A-X-M window specifically. Game mode captures the
display the game is on, because a fullscreen exclusive game is not reliably
capturable as a window.

### Audio

This is the least certain part of the plan and is flagged as such.

Electron can capture system audio on Windows via `chromeMediaSource: "desktop"`
with an audio constraint, but the behaviour varies by Windows and Chromium
version, and it can come back silent. The plan is:

1. Try the `desktopCapturer` loopback path first.
2. If it yields no audio, fall back to a WASAPI loopback capture in a small
   native helper, or to routing through an existing virtual audio device.

The fallback is real work and is why audio sits in phase 2, not phase 1. Menu
mode can ship muted and still be useful; a game cannot.

---

## 6. Input — the actual hard part

### Menu mode: nothing new needed

The phone already sends `XmbMessage` and `PointerMessage`, and `main.ts`
already routes them into the same handlers a local button press uses. Video is
the only missing half. This is why phase 1 is small.

### Game mode: a virtual gamepad

A running game does not read A-X-M's event handlers. Input has to arrive as
though from a real device. Options, assessed:

| Approach | Licence | Verdict |
| --- | --- | --- |
| [ViGEmBus](https://github.com/nefarius/ViGEmBus) virtual Xbox 360 / DS4 pad | BSD-3-Clause | **Preferred.** Permissive, games see a genuine XInput device, no per-game work. Note: the repository is **archived**, so this is a bet on a stable-but-unmaintained driver. |
| `SendInput` keyboard and mouse | built into Windows | Works for mouse and keyboard, useless for controller-driven games. Worth having as a companion to the above, not a replacement. |
| Windows `Windows.Gaming.Input` | built in | Read-only. Cannot synthesise a device. |
| HIDAPI / custom driver | varies | Writing and signing a kernel driver is far beyond this feature. |

**Decision: ViGEmBus for the pad, `SendInput` for mouse and keyboard.** Its
archived status is a genuine risk and is recorded in section 10. Installing a
kernel-mode driver is also a real ask of the user, so it must be opt-in, clearly
explained, and only prompted for when they first try game mode — never during
A-X-M's own install.

Touch input on the phone maps to a virtual stick and face buttons, with the
existing on-screen controls from the Controls screen reused.

---

## 7. Protocol additions

New message types on the existing companion channel. Version bumps to 2; the
host keeps accepting version 1 so an un-updated phone still works for
everything else.

```ts
// Host -> phone
RemotePlayAvailableMessage   { modes: ("menu" | "game")[]; encoders: string[]; }
RemotePlayOfferMessage       { sdp: string; sessionId: string; }
RemotePlayIceMessage         { candidate: RTCIceCandidateInit; sessionId: string; }
RemotePlayStatsMessage       { fps; bitrateKbps; rttMs; packetsLost; encoder; }
RemotePlayEndedMessage       { sessionId: string; reason: string; }

// Phone -> host
RemotePlayStartMessage       { mode: "menu" | "game"; maxHeight: number; maxFps: number; }
RemotePlayAnswerMessage      { sdp: string; sessionId: string; }
RemotePlayIceMessage         (same shape, other direction)
RemotePlayInputMessage       { pad: GamepadSnapshot; }   // game mode only
RemotePlayStopMessage        { sessionId: string; }
```

`RemotePlayInputMessage` carries a whole pad snapshot rather than deltas:
sticks change every frame anyway, and a lost delta leaves a stuck input, which
is the worst failure mode a controller has.

Input rides a WebRTC **data channel** once the session is up, not the
WebSocket — unreliable-but-unordered with a short `maxRetransmits` beats
TCP head-of-line blocking for something that is superseded 60 times a second.
The WebSocket stays as the control and signalling path.

---

## 8. New files

| File | Responsibility |
| --- | --- |
| `src/main/remoteplay/session.ts` | Session lifecycle, one at a time, cleanup on drop. |
| `src/main/remoteplay/capture.ts` | Picking a source and building the `MediaStream`. |
| `src/main/remoteplay/input.ts` | ViGEm pad and `SendInput`, behind one interface so menu mode can swap in a no-op. |
| `src/main/remoteplay/vigem.ts` | Loading the driver, reporting plainly when it is absent. |
| `src/renderer/remotePlayHost.ts` | The `RTCPeerConnection` — it lives in the renderer because that is where `getUserMedia` and the encoder are. |
| `src/main/companion/protocol.ts` | The message types above. |
| `companion-android/.../RemotePlayScreen.kt` | Surface, decoder, touch and pad input. |
| `companion-android/.../net/WebRtcClient.kt` | Peer connection, signalling over the existing socket. |
| `docs/REMOTE_PLAY.md` | User-facing setup, when it exists. |

Existing files touched: `companion/server.ts` (route the new messages),
`main.ts` (IPC), `preload.ts`, `renderer/types.ts`, the companion `HomeScreen`
(a Remote Play tile), and settings.

---

## 9. Phases

### Phase 1 — Menu mode, video only

Stream the A-X-M window to the phone; drive it with the input path that already
works. No audio, no driver, no native code.

*Done when:* the phone shows the live XMB at 1080p60 on a LAN, and pressing a
direction on the phone moves the menu on both screens with no more lag than the
existing remote already has.

### Phase 2 — Audio, and quality control

System audio, with the fallback in section 5 if loopback comes back silent. A
quality picker (resolution, fps, bitrate) and a stats overlay reporting real
numbers from `getStats()`.

*Done when:* audio is in sync within a frame or two and the numbers shown are
measured, not assumed.

### Phase 3 — Game mode

ViGEm, the opt-in driver install, display capture, and the phone's touch
controls mapped to the virtual pad.

*Done when:* a game launched from the XMB is playable from the phone, and
unplugging the phone mid-game leaves no stuck inputs.

### Phase 4 — Polish

HDR passthrough where the panel and encoder allow, reconnect after a Wi-Fi
drop, and optional internet play through ICE with a relay.

---

## 10. Risks and open questions

Recorded honestly, because several of these could change the plan.

1. **System audio capture may not work through Electron.** The most likely thing
   to force native code into an otherwise pure-JS feature. Phase 2, not 1, for
   exactly this reason.
2. **ViGEmBus is archived.** BSD-3 and widely used, so it will keep working, but
   it is unmaintained. If it breaks on a future Windows build there is no
   upstream to fix it, and the fallback is a signed driver we are not going to
   write. Worth re-checking for a maintained fork before phase 3 starts.
3. **Asking a user to install a kernel driver is a real imposition.** Must be
   opt-in, explained in plain words, and never bundled into A-X-M's own install.
4. **Fullscreen exclusive games may not capture.** Borderless windowed is the
   usual answer; if a game insists on exclusive fullscreen we may have to say so
   rather than silently show a black rectangle.
5. **Latency is unproven.** WebRTC on a LAN should land well under a frame of
   added delay, but that is an expectation, not a measurement. Phase 1 exists
   partly to find out, and if it is bad the transport decision in section 4 is
   the thing to revisit.
6. **The Ally encodes and plays at the same time.** Encoding a game while
   running it costs GPU. Hardware encode keeps that small, but it is not free,
   and the quality picker exists so the user can trade it away.
7. **Battery.** Sustained encode and Wi-Fi will drain a handheld noticeably.

---

## 11. What this deliberately does not do

- It does not touch `src/main/remotePlay.ts`. That is chiaki-ng, for connecting
  to a real PlayStation, and it stays as it is.
- It does not bundle, fork or vendor Sunshine or Moonlight.
- It does not attempt to be GameStream-compatible. A-X-M's phone app is the only
  client, so there is no protocol to interoperate with, and pretending otherwise
  would mean taking on all the constraints Moonlight has for none of the benefit.

---

## 12. Credits

Sunshine and Moonlight are the reason this is a tractable problem. They
documented and proved the whole approach — capture, hardware encode, a
low-latency transport, a virtual pad on the host, frame pacing on the client —
and A-X-M's remote play follows their shape whether or not it shares a line of
their code.

| Project | Licence | Why it is credited |
| --- | --- | --- |
| [LizardByte/Sunshine](https://github.com/LizardByte/Sunshine) | GPL-3.0 | The reference host implementation. Its capture and encode pipeline, and its virtual-input approach on Windows, informed sections 5 and 6. |
| [moonlight-stream/moonlight-android](https://github.com/moonlight-stream/moonlight-android) | GPL-3.0 | The reference Android client. Its decoder setup and frame pacing inform the client side. |
| [moonlight-stream/moonlight-common-c](https://github.com/moonlight-stream/moonlight-common-c) | GPL-3.0 | The protocol core, and the clearest description of what a low-latency game stream actually has to handle. |
| [nefarius/ViGEmBus](https://github.com/nefarius/ViGEmBus) | BSD-3-Clause | The virtual gamepad driver game mode would depend on. |
| [WebRTC](https://webrtc.googlesource.com/src/) | BSD-3-Clause | The transport, via Chromium on the host and the Android WebRTC library on the client. |
| NVIDIA GameStream | — | The original protocol both Sunshine and Moonlight grew from. |

These go into `assets/THIRD_PARTY_LICENSES.md`, the README credits tables, and
*Settings › About & Credits* when the feature is built — and the Sunshine and
Moonlight entries go in even if the final code shares nothing with them.
