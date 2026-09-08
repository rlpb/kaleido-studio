# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.2] - 2026-09-08

### Changed

- **One bar instead of two.** The window had a system title bar sitting above
  the app own top strip. The system bar is gone and the caption buttons are
  drawn over the app strip instead, which stays draggable. They are still the
  native buttons, so snapping, maximise and the system menu behave exactly as
  the platform expects. macOS keeps its traffic lights, inset over the sidebar.
  The caption buttons are painted by the system rather than by CSS, so the theme
  is handed to them whenever it changes.
- Removed the library screenshot from the README: it showed generations made
  from Italian prompts, which reads as an accident in an English repository.

## [1.3.0] - 2026-09-08

The interface speaks seven languages, and the repository moved to Apache 2.0.

### Added

- **Seven languages**: English, Italiano, Español, Français, Deutsch, Português,
  Русский. First run follows the operating system locale rather than assuming
  English, and Settings carries a selector listing each language in its own
  name. English is the source dictionary and every other locale is typed
  against it, so a key added and forgotten elsewhere fails the build instead of
  rendering blank.

### Changed

- The cost estimator returns a key plus values rather than a finished English
  sentence, and the price summary takes the translator. The estimate basis
  stays a stable identifier the code can branch on.
- Parameter labels fall back to the label the API supplied when a knob has no
  dictionary entry, which is what happens the day a provider adds one nobody
  has seen.
- Licence moved from MIT to Apache 2.0, with a `NOTICE` naming what this
  depends on but does not distribute.
- `.gitattributes` normalises the repository to LF, which also ends the CRLF
  warning on every commit.

### Not translated, on purpose

Model names, ids and descriptions come from the OpenRouter catalog. Network
diagnostics get quoted verbatim into bug reports and are more useful in one
language.

## [1.2.1] - 2026-09-08

Four defects found by using the app, none of which the checks could have caught,
because each needs a real generation, a real file or a real network.

### Fixed

- **TCP keep-alive probes during a generation.** Generation endpoints are
  synchronous and silent: the request goes out and not a byte crosses the
  connection until the model is done. Anything on the path that drops idle
  sessions kills the request. Neither the global `fetch` nor Electron's
  `net.fetch` exposes the socket, so the long synchronous calls now go through a
  `node:https` path that can reach `setKeepAlive`. Catalog reads answer in under
  a second and stay on fetch.
- **Music models answered `Audio output requires stream: true`.** The response
  is now read as an event stream and reassembled. Chunks are decoded before
  being joined rather than concatenated as base64, because a chunk that is not a
  multiple of three bytes carries padding that would corrupt everything after it.
- **Clearing errors and retrying left dead cards on screen.** Both delete jobs
  in the main process, and neither emitted anything on the per-job channel.
  Removals now broadcast the whole list, which is the only shape that can
  express "gone".
- **Show in folder failed with an Explorer dialog the app could not explain.**
  `shell.showItemInFolder` selects the file but returns nothing at all.
  `shell.openPath` returns the error as a string. Selecting the file is worth
  less than knowing whether the action worked.

## [1.2.0] - 2026-09-08

### Added

- **The viewer walks the whole set.** Arrow keys, `Home`, `End` and on-screen
  chevrons move between results, with a position counter in the header. Opening
  a result and closing it again to see the next one was the most repeated action
  in the app and had no shortcut at all.
- **Wheel zoom up to 8x**, centred on the cursor so the pixel under it stays
  put. Dragging pans, `+` `-` `0` work from the keyboard, and a new result
  always opens fitted rather than inheriting the previous zoom.
- Clicking anywhere closes the viewer, including on the image. That collides
  with dragging a zoomed image, so the two are told apart by pointer travel
  between press and release rather than by carving out a dead region.

### Fixed

- The viewer scrim was 90% black, which left the app behind readable and
  competing with the image. It is now 97% with a blur, and the controls carry
  their own contrast instead of inheriting panel tokens that vanished against it.
- Balances no longer show trailing zeros: `$0.1200` reads as `$0.12`.

## [1.1.0] - 2026-09-08

Everything a reader of this repository sees is now English, including the
product strings.

### Added

- **An inline SVG icon set.** The interface used Unicode glyphs, whose coverage
  differs per platform and per installed font, so the same character rendered as
  a different shape, weight, or a fallback box depending on the machine.

### Fixed

- **Transport failures report what actually failed.** `fetch` collapses every
  one of them into the same "fetch failed" and puts the identifying reason in a
  nested `cause`, which the previous code discarded. Requests now go through one
  helper that unwinds the cause chain, maps the known codes to an explanation,
  and carries an explicit timeout so a hang is distinguishable from a drop.
- The run bar was sticky inside the scrolling panel and drew over whatever field
  sat at the bottom. The panel is now a scroll area plus a fixed footer, which
  cannot overlap by construction.
- Per-token rates are shown per million tokens instead of fifteen decimal
  places.
- A numeric parameter whose minimum equals its maximum is dropped rather than
  rendered as a control nobody can move.

## [1.0.0] - 2026-09-08

First release.

### Added

- Eight modes over five OpenRouter endpoints: image generation and editing,
  text-to-video, image-to-video, video upscaling, speech synthesis, music and
  transcription.
- **No model is hard-coded.** The capability routes are normalised into one
  `ParamSpec` shape and the control panel is generated from it, so a model
  published later gets a correct form with no code change.
- **Cost handling states its own basis.** Video is priced per output second from
  `pricing_skus`, so the estimate is exact arithmetic. Token-billed modalities
  show the real cost measured on the previous identical run, and show nothing at
  all when there is no measurement rather than inventing a figure.
- The API key is encrypted through the OS keychain via `safeStorage`, with the
  degraded case surfaced in the interface instead of silently claimed as
  encrypted.
- A library of everything generated, searchable and filterable, with per-file
  cost and disk usage.
- Installers for Windows, macOS and Linux, built by CI.

[Unreleased]: https://github.com/rlpb/kaleido-studio/compare/v1.3.2...HEAD
[1.3.2]: https://github.com/rlpb/kaleido-studio/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/rlpb/kaleido-studio/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/rlpb/kaleido-studio/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/rlpb/kaleido-studio/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/rlpb/kaleido-studio/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rlpb/kaleido-studio/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rlpb/kaleido-studio/releases/tag/v1.0.0
