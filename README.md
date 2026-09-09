<div align="center">

<img src="docs/hero.svg" alt="Kaleido Studio" width="860">

# Kaleido Studio

**Every kind of media, one desktop app.**
Images, video, speech and transcription on OpenRouter, with the controls generated from the live catalog.

[![CI](https://github.com/rlpb/kaleido-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/rlpb/kaleido-studio/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/rlpb/kaleido-studio?display_name=tag&sort=semver)](https://github.com/rlpb/kaleido-studio/releases/latest)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-black.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-blue.svg)](package.json)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#download)

[Download](#download) · [How it works](#how-a-generation-works) · [Costs](#costs) · [Security](#key-security) · [FAQ](#faq) · [Italiano](README.it.md)

</div>

---

## The problem

OpenRouter routes about a hundred media models: image generation and editing,
text-to-video, image-to-video, upscaling, speech, music, transcription. Each one
takes different parameters. One image model accepts an aspect ratio and up to
five reference images, another only a resolution tier. Video models each declare
their own durations, resolutions and whether they can generate audio. New models
appear weekly and old ones change.

Every desktop client for this picks a handful of models, hard-codes their
parameters into a form, and goes stale. You end up back in a terminal writing
curl, or in a web playground with no library and no record of what anything cost.

Kaleido reads the parameters from OpenRouter instead of hard-coding them.

<div align="center">
<img src="docs/screenshot-studio.png" alt="The image generation screen, with controls generated from the model's declared parameters" width="900">
</div>

## What it does

Eight modes, each backed by an OpenRouter endpoint:

| Mode | Output | Endpoint |
|---|---|---|
| Images | Image from a prompt | `POST /api/v1/images` |
| Edit images | Image from a prompt plus reference images | `POST /api/v1/images` |
| Text to video | Video from a prompt | `POST /api/v1/videos` |
| Image to video | Video from an opening and optional closing frame | `POST /api/v1/videos` |
| Upscale video | Higher resolution version of an existing video | `POST /api/v1/videos` |
| Speech | Spoken audio from text, with a selectable voice | `POST /api/v1/audio/speech` |
| Music and audio | An audio track from a description | `POST /api/v1/chat/completions` |
| Transcription | Text from an audio file, with optional timestamps | `POST /api/v1/audio/transcriptions` |

Plus a queue with configurable parallelism, batch runs, a searchable library of
everything generated, saved presets, prompt history, favourite models, dark and
light themes, and seven interface languages. Every run is timed from the moment
the request goes out, so the wait a model costs you is visible next to the price
it costs you.

## The idea it is built on

For every endpoint, OpenRouter publishes the parameters each model accepts,
already typed:

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

Kaleido normalises those three different shapes into one structure and generates
the control panel from it. A new model with parameters nobody has seen before
gets a correct form without a line of code being touched. When a provider adds a
knob, its label falls back to the one the API supplied rather than disappearing.

<div align="center">
<img src="docs/screenshot-models.png" alt="The model picker, listing the catalog read from OpenRouter with each model's live price" width="900">
</div>

## How a generation works

1. You pick a mode, which pins an endpoint and the kind of input it needs.
2. You pick a model. The catalog is re-read from OpenRouter on every launch, so
   the list is what exists today, not what existed when this was written.
3. The panel is built from that model's declared parameters.
4. The request goes out from the main process, never from the interface, so the
   API key never enters the renderer.
5. The result is written to the library with its prompt, its parameters and what
   it actually cost.

Video is asynchronous: Kaleido submits the job, polls until the provider is
done, then downloads the file. Everything else is a single synchronous request.

## Costs

The app distinguishes three cases and says which one it is on screen, instead of
always showing a number.

- **list price** — video is billed per second of output and the rate is in the
  catalog, so the estimate is exact arithmetic: rate × duration × count.
- **measured** — most other modalities are billed per token, and the token count
  depends on the result. If the same model and parameters have run before, the
  app shows what that run actually cost.
- **unknown** — first run of a given shape. The app shows the unit rate and says
  plainly that the exact figure arrives when the run finishes.

Real cost comes from `usage.cost` in the response, is stored with the file, and
adds up in the spend counter. The estimator is deliberately unable to produce a
number it cannot derive from catalog data or a previous measurement, and there
is a check that fails if it ever starts guessing.

### Rates the catalog publishes without a unit

`pricing.prompt` carries two different units and the API names neither. A model
that declares a token context is billed per token: `openai/gpt-4o-mini-transcribe`
declares 128000 and lists `0.00000125`, which is OpenAI's published $1.25 per
million tokens. A model that declares `context_length: 0` is billed by something
else: `microsoft/mai-transcribe-2` declares 0 and lists `0.1`, which OpenRouter's
own model page labels **Audio Hours … /hour**.

No documented route publishes that label. `/api/v1/models`, the `/endpoints`
route and `?include=display_pricing` all omit it. So Kaleido shows those rates at
their own scale with the unit left unnamed, rather than multiplying by a million
and calling the result a token price. Thirty models in the current catalog fall
into this case, and a check fails if any of them is ever labelled per token
again.


## Key security

The key is encrypted with the operating system keychain through Electron's
`safeStorage`: Credential Manager on Windows, Keychain on macOS, `libsecret` on
Linux. It is stored in the app data folder and never leaves the machine except
towards `openrouter.ai`.

Where no keychain is available, Electron does not fail. It degrades silently.
Kaleido records that case and labels it in Settings as *stored in plain text*,
rather than letting you believe it is encrypted.

The renderer runs with `contextIsolation`, `sandbox` and no Node integration. It
never receives the key, and talks to the main process over typed IPC only.
Library files reach it through a custom protocol that resolves the requested
path and refuses anything outside the library folder.

There is no telemetry, no analytics, and no network destination other than
OpenRouter.

## Download

Installers for Windows, macOS and Linux are built by
[CI](.github/workflows/release.yml) and attached to every release.

**[Download the latest release](https://github.com/rlpb/kaleido-studio/releases/latest)**

| Platform | File |
|---|---|
| Windows | `.exe` installer, or the portable build |
| macOS | `.dmg`, Intel and Apple silicon |
| Linux | `.AppImage`, or `.deb` |

The builds are unsigned. Windows SmartScreen and macOS Gatekeeper will warn on
first launch.

You need an [OpenRouter API key](https://openrouter.ai/keys). Paste it on first
launch and nothing else is asked.

### Or run it from source

```bash
git clone https://github.com/rlpb/kaleido-studio.git
cd kaleido-studio
npm install
npm start
```

Node.js 22 or newer. Electron and the tooling require it.

## What Kaleido is not

- Not a model. It carries prompts to OpenRouter and files back.
- Not a proxy or an account. Your key, your credit, your terms with each
  provider.
- Not a video editor. It generates and upscales; it does not cut or composite.
- Not a 3D tool. OpenRouter exposes no models with 3D output.

## FAQ

**Does it work without an OpenRouter account?**
No. The key is the only thing the app asks for, and every generation is billed
to it. Models tagged `free` cost nothing but still need a key.

**Where do my files go?**
Into the app data folder by default, changeable in Settings. Files already
written stay where they are; changing the folder only affects the next ones.

**A generation dies after about a minute. Why?**
Generation requests are silent while the model works, and anything on the path
that drops idle sessions kills them. VPN exit nodes are the common case, and
sixty seconds is a common rule. The app sends TCP keep-alive probes, which
helps against some gateways and not others. If it keeps happening, exclude the
app from your VPN tunnel, or pick a model that answers inside the window. The
error message says which case you are in and how long the connection survived.

**Why does one model refuse my prompt while another accepts it?**
Content filtering is the provider's, not the app's. The refusal is passed
through verbatim.

**Can I use a model that needs an age confirmation?**
Yes, after confirming it once in your
[OpenRouter preferences](https://openrouter.ai/settings/preferences).

**Is the interface available in my language?**
English, Italiano, Español, Français, Deutsch, Português and Русский. First run
follows your operating system. Model names and descriptions stay as the catalog
provides them.

## How it is built

```
electron/
├── main.ts               window, IPC, the media protocol, the menu
├── preload.ts            the contextBridge surface the renderer sees
├── openrouter.ts         API client and capability normalisation
├── keepalive-request.ts  the HTTPS path that can reach setKeepAlive
├── jobs.ts               queue, request building, video polling, saving
├── store.ts              configuration, encrypted key, presets, observed costs
└── library.ts            files on disk and the library index
src/
├── screens/              onboarding, studio, library, settings
├── components/           model picker, generated form, inputs, cards, viewer
└── lib/                  shared types, mode definitions, pricing, i18n
scripts/
├── selfcheck.mjs               checks against the live API
├── validate-builder-config.mjs validates the packaging config offline
└── make-icon.mjs               generates the app icon, no binary in the repo
```

Electron with a React renderer, hand-written CSS, no UI framework. The main
process owns every network call and the key; the renderer owns nothing but
pixels.

## Development

```bash
npm run dev           # Vite with hot reload plus Electron
npm run typecheck     # TypeScript, strict
npm run check         # against the real OpenRouter catalog
npm run check:config  # validates electron-builder.yml offline
npm run dist          # installers for the current operating system
```

`npm run check` queries the public catalog routes without a key and asserts that
every mode has models, that every normalised parameter is usable by a form, that
video models expose a duration and a per-second rate, that the list-price
estimate equals rate × duration × count, that a combination never run produces
no invented number, and that every price carries its currency.

`npm run check:config` validates `electron-builder.yml` against the schema
`app-builder-lib` ships. electron-builder validates its config as the first step
of a packaging run, so one unknown key otherwise fails all three platform jobs
minutes in, with a message naming the section but never the key.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Credits

Kaleido Studio is a face for [OpenRouter](https://openrouter.ai), which does the
hard part: routing to every provider, metering, billing and a single API across
models that agree on very little. The models belong to their vendors and carry
their own terms.

## License

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

You can use, change and redistribute Kaleido Studio, including commercially.
What the licence asks in return is that the copyright notice, the licence and
the NOTICE file travel with it, and that you say what you changed.

---

<div align="center">
<sub>Keywords: OpenRouter desktop app · AI image generator · text to video app ·
image to video · AI speech synthesis · audio transcription · Electron AI client ·
generate images video and audio in one app</sub>
</div>
