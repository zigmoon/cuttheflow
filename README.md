# CUT THE FLOW

**A desktop video editor whose export is computed by ffmpeg, not by your GPU.**

Multitrack editing in a local studio window, one deterministic render engine for
Windows, macOS and Linux — the same project produces the same file everywhere.

![CUT THE FLOW studio](docs/screenshot.png)

---

## Why another editor

Browser editors encode with WebCodecs. That works, until it doesn't: Safari and
Firefox have no H.264 encoder, the realtime fallback stretches long edits, a
background tab freezes the export, and the output depends on the machine's GPU.

CUT THE FLOW keeps the pleasant part — timeline, trim, snap, effects,
transitions, shapes, live preview — and hands the rendering to **ffmpeg**, driven
by a Rust engine with a single, testable synchronisation model.

| | Browser engine | This engine |
|---|---|---|
| Encoder | WebCodecs / GPU | ffmpeg, fixed settings |
| Long edits | realtime fallback, drifts | frame-exact |
| Background tab | export stalls | unaffected |
| Same file on every OS | no | **yes** |
| Verifiable output | hard | measured on every build |

The measurements, not the claims: see [Verification](#verification).

---

## What it does

**Timeline**
- video and audio tracks, add as many as you need
- drag from the media panel, trim either edge, snap to clips / playhead / zero
- split at the playhead (`S`), duplicate (`Ctrl+D`), delete (`Del`)

**Clips**
- name, start, duration, source in-point, volume, fade in / out
- scale, position, rotation, opacity
- mute the sound of a video clip without detaching it

**Effects** — per clip, rendered by ffmpeg, never spilling onto the neighbour:
blur, sharpen, vignette, grain, brightness, black and white, sepia, warm, cool,
invert, mirror, flip, pixelate.

**Transitions** — between adjacent clips on the same track: fade from background,
or cross dissolve. A dissolve moves the window *and* the source in-point by the
same amount, bounded by the handles that actually exist; when there are none it
falls back to a fade instead of producing a broken join.

**Shapes and text** — rectangles, rounded rectangles, ellipses and text clips,
rasterised once and looped.

**Export** — MP4 (H.264 + AAC), WebM (VP9 + Opus), MP3. Resolution, frame rate
and quality are chosen at export time; the rest of the project is untouched.

**Studio**
- dark by default, light available, both remembered
- English by default, French in Preferences — the project is never modified
- panel toggles, resizable timeline, zoom, fit to window
- drop files straight from the desktop onto the window
- full keyboard map (`?`)

---

## Install

Each release ships one self-contained binary: the interface is embedded, there is
nothing to install beside it.

| Platform | File |
|---|---|
| Windows 10/11 (x64) | `cuttheflow-windows-x86_64.exe` |
| Linux x86-64 (static, musl) | `cuttheflow-linux-x86_64` |
| Linux ARM64 (static, musl) | `cuttheflow-linux-aarch64` |
| macOS Apple Silicon | `cuttheflow-macos-arm64` |
| macOS Intel | `cuttheflow-macos-x86_64` |

Then:

```bash
./cuttheflow                 # opens the studio on http://127.0.0.1:7317/
```

**ffmpeg is required** (it is not bundled — licence and size). The engine looks
for it in `CTF_FFMPEG` / `CTF_FFPROBE`, next to the executable, then in `PATH`.
`cuttheflow doctor` tells you what it found:

```
$ cuttheflow doctor
CUT THE FLOW — moteur prêt
  interface : http://127.0.0.1:7317/
  données   : ~/.local/share/cuttheflow
  ffmpeg    : ffmpeg version 7.1
  police    : /usr/share/fonts/.../DejaVuSans.ttf
```

macOS builds are always signed ad-hoc (mandatory on Apple Silicon). They are
also signed with a Developer ID and notarised when the release secrets are
configured; otherwise the binaries run normally, simply without notarisation.

---

## Command line

```bash
cuttheflow                       # serve + open the studio
cuttheflow serve --port 7317 --no-open
cuttheflow doctor                # ffmpeg, encoders, font
cuttheflow probe film.mp4        # metadata as JSON
cuttheflow export project.json --out edit.mp4 --format mp4 --crf 18
```

---

## Build from source

Requirements: Rust 1.80+, Node 20+, ffmpeg.

```bash
# interface
cd astro
npm ci
npm run check        # 0 error expected
npm run build        # → astro/dist, embedded at compile time

# engine + binary
cd ../rust
cargo build --release -p ctf-app
```

`crates/ctf-app/build.rs` reads `astro/dist` **at compile time**. If it is
missing, the binary still builds and serves a page explaining what to run.

### All three platforms

| Platform | Target | Where |
|---|---|---|
| Windows | `x86_64-pc-windows-gnullvm` (LLVM-MinGW, no MSVC needed) | local + CI |
| Linux x86-64 | `x86_64-unknown-linux-musl` (static) | local + CI |
| Linux ARM64 | `aarch64-unknown-linux-musl` (static) | local + CI |
| macOS Apple Silicon | `aarch64-apple-darwin` | CI (`macos-15`) |
| macOS Intel | `x86_64-apple-darwin` | CI (`macos-15-intel`) |

macOS cannot be linked from Windows (Apple SDK): the workflow in
`.github/workflows/build.yml` handles it, signs, optionally notarises, and
attaches the binaries to a release when a `v*` tag is pushed.

```powershell
# Windows host: Windows + Linux static binaries, packaged in rust/dist
powershell -ExecutionPolicy Bypass -File rust/scripts/build.ps1
```

---

## Architecture

```
astro/                    interface (static build, no server of its own)
  src/pages/index.astro   markup only
  src/styles/studio.css   design tokens, light + dark
  src/scripts/editor.ts   state, import, panels, export, shortcuts
  src/scripts/state.ts    model mirror of ctf-core (µs, rational fps)
  src/scripts/preview.ts  canvas composition, approximate effects, audio
  src/scripts/timeline.ts DOM rendering, drag, trim, playhead
  src/scripts/i18n.ts     EN (canonical) + FR
rust/
  crates/ctf-core         model, probe, transition plan, filter graph (pure)
  crates/ctf-engine       ffmpeg execution: shapes, mixdown, composition
  crates/ctf-app          binary: CLI, local HTTP server, embedded UI
  scripts/verify-export.mjs   45-check export bench
  scripts/build.ps1           Windows + Linux release build
v1/                       the browser-only editor (previous generation)
docs/                     audit report, v2 decisions, screenshot
```

**The interface encodes nothing.** It sends the project to the engine and plays
the result; that is what makes the output identical on every machine.

**Audio is mixed first**, in float PCM at 48 kHz, of exactly the timeline
duration: each clip is delayed by a sample count, then summed with
`amix=normalize=0` over a silence bed. `apad` was tried and rejected — it
produced 13 s or 14 s depending on the run.

**Video is composed second**, one input per clip: `trim` on the source,
`setpts=PTS+start/TB` to place it, `fps` to impose the frame rate, then `overlay`
gated on the clip window. Placing `setpts` after `overlay` would show the wrong
source time — that is the whole trick.

**The project never carries file paths.** The server resolves each `media.id`
through its own registry, so a forged project cannot read an arbitrary file. The
server listens on `127.0.0.1` and refuses foreign origins.

---

## Verification

The bench replays a reference edit (13 s, five clips: video, image, text, two
audio tracks with 880/1500/1200 Hz beacons) and inspects the files with ffmpeg.

| Check | Result |
|---|---|
| Frames | **390 / 390** |
| Video / audio duration | **13.000 s / 13.000 s** |
| Audio sync, MP4 (start and end of each beacon) | **0 ms** |
| Sync WebM − MP4, MP3 − MP4 | **0 ms** |
| Black frames at cuts | none (min luminance 67/255) |
| Frame fidelity vs source | 0 differing frames out of 177 |
| Total | **45 / 45** |

```bash
cd rust
cargo test --workspace                # 31 unit tests
node scripts/verify-export.mjs        # 45 ffmpeg checks
```

Interface: `npm run check` → 0 error, 0 warning. Effects and transitions were
verified on real pixels (sepia `44,39,30`; ellipse `#F0F0F2`; a 0.5 s dissolve
reading `29,29,29` → `121,13,68` → `201,0,102`, i.e. the two sources really
mixed).

---

## Project format

JSON, times in **microseconds**, frame rate as a rational (`30000/1001`).

```jsonc
{
  "version": 1, "width": 1920, "height": 1080,
  "fps": { "num": 30, "den": 1 },
  "tracks": [{ "kind": "video", "clips": [{
    "type": "video", "start_us": 0, "duration_us": 6000000,
    "source_start_us": 0, "volume": 1, "scale": 1, "x": 0.5, "y": 0.5,
    "rotation": 0, "opacity": 1,
    "effects": [{ "name": "sepia", "amount": 1 }],
    "transition": { "kind": "dissolve", "duration_us": 500000 }
  }]}]
}
```

`Project::validate` checks everything before rendering: unique ids, durations,
fades, effect names, transition bounds, colours, media types, even dimensions.

---

## Limits (v2.2)

- No subtitles, 4K proxies or undo history yet — the model and the engine are
  already shaped for them.
- The preview approximates grain and pixelation; the export is exact. Effects
  that change geometry (mirror, flip, rotation) are faithful in both.
- ffmpeg is not bundled.
- The local server has no authentication: it is meant for `127.0.0.1`.

---

## The previous generation: `v1/`

`v1/` holds the browser-only editor that came before: one `index.html`, a large
`js/app.js`, WebCodecs-based export engines, a service worker, a PWA manifest.
It is kept here — not somewhere else — because it is the same product, and
because it is the reference the Rust engine was measured against.

It still works and passes its own **29/29** browser bench
(`v1/tools/regression/montage.cjs`, real Chrome + ffmpeg). During the audit that
led to v2, its dead export path (2 305 lines) and three never-loaded engines
were removed, and the audit report is in
[`docs/AUDIT-COMPLET-2026-10-20.md`](docs/AUDIT-COMPLET-2026-10-20.md).

Nothing in `astro/` or `rust/` imports from `v1/`: the two generations are
independent, and v1 is not built by the release workflow.

---

## License

Proprietary — see [LICENSE](LICENSE). © Zigmoon.
