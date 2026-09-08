# Kaleido Studio

A desktop app for generating media through OpenRouter. Images, image editing, text-to-video, image-to-video, video upscaling, speech synthesis, music and transcription, in one interface.

Paste your API key on first launch. From there you pick a screen and a model, and generate.

[![build](https://github.com/rlpb/kaleido-studio/actions/workflows/build.yml/badge.svg)](https://github.com/rlpb/kaleido-studio/actions/workflows/build.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![platforms](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-supported-lightgrey)
![electron](https://img.shields.io/badge/Electron-desktop-47848F)

---

## What it does

Eight modes, each backed by an OpenRouter endpoint:

| Mode | Output | Endpoint | Models |
|---|---|---|---|
| Images | Image from a prompt | `POST /api/v1/images` | 50 |
| Edit images | Image from a prompt plus reference images | `POST /api/v1/images` | 49 |
| Text to video | Video from a prompt | `POST /api/v1/videos` | 27 |
| Image to video | Video from an opening and optional closing frame | `POST /api/v1/videos` | 24 |
| Upscale video | Higher resolution version of an existing video | `POST /api/v1/videos` | 1 |
| Speech | Spoken audio from text, with a selectable voice | `POST /api/v1/audio/speech` | 18 |
| Music and audio | An audio track from a description | `POST /api/v1/chat/completions` | 4 |
| Transcription | Text from an audio file, with optional timestamps | `POST /api/v1/audio/transcriptions` | 20 |

Those counts are what the catalog held on the day this was written. The app does not hard-code them: it re-reads the catalog from OpenRouter on every launch, so a model published tomorrow shows up on its own.

## The idea the app is built on

No model is hard-coded. For every endpoint OpenRouter publishes the parameters each model accepts, already typed:

```json
// GET /api/v1/images/models
"supported_parameters": {
  "aspect_ratio": { "type": "enum", "values": ["1:1", "16:9", "9:16", "auto"] },
  "n":            { "type": "range", "min": 1, "max": 1 },
  "input_references": { "type": "range", "min": 0, "max": 5 }
}
```

```json
// GET /api/v1/videos/models
"supported_resolutions": ["768p", "480p"],
"supported_durations":   [5, 6, 7, 8, 9, 10],
"supported_frame_images": ["first_frame", "last_frame"],
"pricing_skus": { "duration_seconds_480p": "0.05", "duration_seconds_768p": "0.08" }
```

Kaleido normalises those three different shapes into one structure and generates the control panel from it. A new model with parameters nobody has seen before gets a correct form without a line of code being touched.

## Costs

The app distinguishes three cases and says which one it is on screen, instead of always showing a number:

- **list price** — video is billed per second of output and the rate is in the catalog, so the estimate is exact arithmetic: rate × duration × count.
- **measured** — other modalities are billed per token, and the token count depends on the result. If the same model and parameters have run before, the app shows what that run actually cost.
- **unknown** — first run of a given shape: the app shows the unit rate and says plainly that the exact figure arrives when the run finishes.

Real cost comes from `usage.cost` in the response, is stored alongside the file, and adds up in the spend counter.

## Things that matter when you actually use it

- A queue with configurable parallelism, live progress and cancellation.
- Batch runs: 1 to 8 executions of the same configuration.
- A library of everything generated, searchable by prompt, model and transcript text, filterable by mode and type, with favourites, per-file cost and disk usage.
- One-click reuse: a result becomes the input of the next mode, a prompt goes back into the box.
- Saved presets per mode, and prompt history.
- Drag and drop files, or pick them from the system dialog.
- Favourite models, catalog search, sorting by price or release date.
- Dark and light themes, `Ctrl+Enter` to generate, `Esc` to close the viewer.
- OpenRouter credit and cumulative spend always visible.

## Key security

The key is encrypted with the operating system keychain through Electron's `safeStorage` (Credential Manager on Windows, Keychain on macOS, `libsecret` on Linux) and stored in the app data folder. It never leaves the machine except towards `openrouter.ai`.

Where no keychain is available Electron does not fail, it degrades silently. Kaleido records that case and labels it in Settings as *stored in plain text*, rather than letting you believe it is encrypted.

The renderer process is isolated (`contextIsolation`, `sandbox`, no Node), never sees the key, and talks only over typed IPC. Library files are served by a custom protocol that rejects any path outside the library folder.

## Install

### Prebuilt packages

Installers for Windows, macOS and Linux are built by the [GitHub Action](.github/workflows/build.yml) and attached to each release.

The builds are unsigned. Windows SmartScreen and macOS Gatekeeper will warn on first launch.

### From source

```bash
git clone https://github.com/rlpb/kaleido-studio.git
cd kaleido-studio
npm install
npm start
```

Requires Node.js 20 or newer.

### Development

```bash
npm run dev           # Vite with hot reload plus Electron
npm run typecheck     # TypeScript in strict mode
npm run check         # checks against the real OpenRouter catalog
npm run check:config  # validates electron-builder.yml offline
npm run dist          # installers for the current operating system
```

## Layout

```
electron/
  main.ts         window, IPC, media protocol, menu
  preload.ts      contextBridge bridge to the renderer
  openrouter.ts   API client and capability normalisation
  jobs.ts         queue, request building, video polling, saving
  store.ts        configuration, encrypted key, presets, observed costs
  library.ts      files on disk and the library index
src/
  screens/        onboarding, studio, library, settings
  components/     model picker, generated form, inputs, media cards, icons
  lib/            shared types, mode definitions, pricing
scripts/
  selfcheck.mjs               checks against the live API
  validate-builder-config.mjs validates the packaging config offline
  make-icon.mjs               generates the app icon
```

## Verification

`npm run check` queries the public OpenRouter catalog, without a key, and asserts that:

- every mode has at least one model;
- every normalised parameter is usable by a form, with non-empty enums and coherent ranges;
- video models expose a duration and a per-second rate;
- the image editing mode only contains models that accept references;
- the list-price estimate equals rate × duration × count;
- a combination that has never run produces no invented number.

That last one matters most: it stops the interface from presenting an estimate where it has no data to make one.

`npm run check:config` validates `electron-builder.yml` against the schema `app-builder-lib` ships, offline, and names the offending key. electron-builder validates its config as the first step of a packaging run, so one unknown key otherwise fails every platform job minutes in, with a message that names the section but not the key.

## Known limits

- No 3D generation, because OpenRouter exposes no models with 3D output.
- Video generation is asynchronous and can take minutes; polling gives up after 20.
- Word-level transcription timestamps depend on the provider and are ignored by those that do not support them.
- Key encryption depends on the system keychain, which is missing on some minimal Linux installs.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

Kaleido Studio is not affiliated with OpenRouter.
