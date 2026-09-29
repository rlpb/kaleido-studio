# Contributing

Thanks for taking the time. This is a small project, so the process is short.

## Before you start

Open an issue first for anything larger than a bug fix. It saves you from building something that does not fit, and it saves a review that has to say no.

## Setup

```bash
npm install
npm run dev
```

You need Node.js 22 or newer and an OpenRouter API key to exercise generation. The checks below run without a key.

## Before you open a pull request

```bash
npm run build         # the checks below run against the build
npm run typecheck     # TypeScript, strict
npm run check         # logic, trust boundaries and the live catalog
npm run check:config  # electron-builder configuration
npm run check:ui      # every screen, seven languages, two themes
npm run smoke         # starts the real app and tries to break it
```

All of them must pass; CI runs the same. `npm run check` needs network access, and only reads public OpenRouter catalog routes. `check:ui` and `smoke` open a window, so on a machine with no display run them under `xvfb-run -a` and add `-- --no-sandbox` for the first. A change to what the interface shows needs `npm run shots` afterwards, and the images looked at before they are committed.

## Conventions

- **Language.** Everything in the repository is written in English: code, comments, commit messages, docs. The interface itself is translated: English is the source in `src/lib/locales/en.ts`, and a new string goes into all seven dictionaries, since the other six are typed against it and a missing key fails the build. `README.it.md` is the one Italian document.
- **Commits.** Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `ci:`, `chore:`. The body explains why, not what.
- **Formatting.** 2-space indentation, single quotes, semicolons, 120-column lines. Match the surrounding code.
- **Comments.** Write them where the reason is not obvious from the code. Skip them where it is.

## Adding support for something new

The app deliberately hard-codes no models. If you are adding a field or a capability:

1. Read it from the OpenRouter capability routes rather than listing models by hand.
2. Normalise it into `ParamSpec` in `electron/openrouter.ts`.
3. Add a case to `scripts/selfcheck.mjs` that fails if the API stops providing it.

Never make the cost estimator produce a number it cannot derive from catalog data or a previously observed run. Showing nothing is correct; guessing is not.

## Reporting a bug

Include the mode, the model id, the exact error text and your platform. Network errors carry a cause code such as `ECONNRESET` in the message; keep it, it is the part that identifies the problem.
