# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.1] - 2026-09-08

An audit pass over the repository, the code and every screen. Four defects, all
found by looking rather than by a failing check.

### Fixed

- **Rates lost their magnitude.** Trimming trailing zeros ate the integer part
  too, so a transcription model billed at $100000 per million tokens displayed
  as $1, and $50 as $5. Every price in the catalog that day happened to end in
  a digit other than zero, which is why it stayed hidden.
- **A zero cost printed the English word** under a translated label, because
  the formatter hard-coded it. It takes the translator now.
- **Job progress reached the queue in English** while the rest of the interface
  was translated. The runner emits a key and values instead of a sentence.
- **The language field showed an English placeholder** above its own Italian
  help, which said the same thing. Placeholders are translated, and the
  duplicate help is gone.
- Italian typos where apostrophes had been dropped.


### Changed

- **Node 22 is the floor now.** Electron 44 and concurrently 10 both declare
  it, so the workflows, the engines field and the docs moved together rather
  than leaving a version nobody actually supports written in three places.
- Electron 41 to 44, concurrently 9 to 10, and the GitHub actions to their
  current majors, which also ends the Node 20 deprecation warning on every run.
- `download-artifact` was still on v4 while `upload-artifact` had moved to v7.
  The two majors have to match or the publish job finds nothing to attach.
### Removed

- A library reader nothing read, an IPC handler the preload never exposed, and
  three exports used only inside their own module.
- The generated app icon is no longer committed. The build produces it, which
  is what the README already said.

### Added

- `engines`, `homepage` and `bugs` in package.json.
- Checks for the two pricing defects above, each verified by reintroducing the
  bug and watching the check fail.

## [1.4.0] - 2026-09-08

### Fixed

- **The balance shown ignored the spend limit on the key.** Two ceilings apply
  at once, the credit on the account and the limit set on the key, and the app
  showed only the first. A key with 25 cents left read as forty dollars, right
  up until a provider refused the request for lack of balance. The smaller of
  the two is shown now, labelled as the key balance when that is the one
  biting, with both figures broken out in Settings.
- **A model with no published price was labelled free.** All-zero pricing is not
  a price of zero: google/lyria-3-pro-preview lists {"prompt":"0",
  "completion":"0"} and bills real money per generation. Free is now claimed only
  for the ":free" model ids, which is the one thing that supports it; everything
  else at zero reads as price not published, and says plainly that it may still
  bill. The self-check refuses any other model marked free.

## [1.3.3] - 2026-09-08

### Fixed

- **Dialogs no longer left an opaque rectangle over their own blur.** The caption
  buttons are painted by the system on top of everything, including a scrim, so
  a full-screen overlay produced a bright block floating in the corner. Overlays
  now begin below the title bar, which stays a bar instead of becoming a cut-out.

### Changed

- README screenshots retaken with the integrated title bar, and a shot of the
  model picker added: it shows the catalog read live from OpenRouter with each
  model price, which is the claim the rest of the page makes in prose.

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

## [1.3.1] - 2026-09-08

### Changed

- The README opens on what the project is for rather than on a feature list,
  with real screenshots of the running app, an Italian translation alongside,
  and a hand-drawn SVG hero.
- CI and releases are separate workflows. The single one rebuilt installers on
  every push and published them only on a tag, which made the release path
  something that had never run before it mattered. The release job now refuses a
  tag whose version disagrees with package.json and takes its notes from the
  changelog section for that version.

### Fixed

- A field cut by the edge of the scrolling panel read as a broken layout rather
  than as more content below. The boundary above the run bar is marked now.
- A patch had stripped the dollar sign from the model price, which read as a
  bare "9.58". The self-check asserts that every price the interface shows
  carries a currency.

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

[Unreleased]: https://github.com/rlpb/kaleido-studio/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/rlpb/kaleido-studio/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/rlpb/kaleido-studio/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/rlpb/kaleido-studio/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/rlpb/kaleido-studio/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/rlpb/kaleido-studio/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/rlpb/kaleido-studio/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/rlpb/kaleido-studio/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/rlpb/kaleido-studio/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rlpb/kaleido-studio/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rlpb/kaleido-studio/releases/tag/v1.0.0
