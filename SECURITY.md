# Security Policy

## Supported versions

The latest release is the only supported version.

## Reporting a vulnerability

Report privately through [GitHub Security Advisories](https://github.com/rlpb/kaleido-studio/security/advisories/new). Do not open a public issue for a vulnerability.

Please include reproduction steps and the affected version. Expect an acknowledgement within seven days.

## Verifying a download

Release binaries are not code-signed, so Windows SmartScreen and macOS Gatekeeper warn on first launch. Two things replace what a signature would have told you, and both can be checked without trusting the release page.

**Where it was built.** Every installer carries a build-provenance attestation, signed with a short-lived certificate GitHub issues to the workflow run that made it. It states which repository, which workflow and which commit produced the exact bytes you have:

```bash
gh attestation verify "Kaleido.Studio-<version>-x64.exe" --repo rlpb/kaleido-studio
```

**That the file is intact.** Each release also lists a SHA-256 checksum for every installer in `SHA256SUMS.txt`:

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

Installers are built only by the release workflow, from a tagged commit, and never on a developer machine. The workflow refuses to publish unless the fuse settings below hold in the built binary and the packaged application starts and passes its own checks on Windows, macOS and Linux.

## What this app does with your credentials

- The OpenRouter API key is encrypted with the operating system keychain through Electron `safeStorage` and written to the app data folder. Where no keychain exists, it is stored in plain text and the Settings screen says so explicitly.
- The key is sent to `openrouter.ai` and to nothing else. There is no telemetry, no analytics, and no other network destination.
- The renderer process runs with `contextIsolation`, `sandbox` and no Node integration. It never receives the key; all API calls happen in the main process.
- Generated media and the library index stay on the local disk.

## What the interface may ask of the main process

The renderer is treated as untrusted input to the main process, so that a flaw in the interface cannot become a flaw on your machine.

- Every IPC handler answers only the main frame of the application window, showing the application's own page.
- The window cannot navigate anywhere else, including by redirect, and refuses every browser permission except copying text to the clipboard.
- A file is opened, revealed or copied only if it lies inside the library folder, and opening is further limited to media file types. The extension of a saved file comes from a fixed table, never from the media type a provider declares.
- A generation reads a local file as input only if you chose it through a file dialog or dropped it on the window, or if it is already in the library.
- The library folder changes only through the folder dialog. Every other setting is validated against what it can be.
- Library files reach the renderer through a custom protocol that resolves the requested path and refuses anything outside the library folder, and anything you have not chosen as an input.
- The configuration and the library index are written through a temporary file and a rename. A file that cannot be parsed is set aside under a name that says so, never read as empty and overwritten.

## Hardening of the packaged application

The Electron fuses of the built binary are set at build time and read back from the binary by CI on every build:

| Fuse | State | Effect |
|---|---|---|
| `RunAsNode` | off | The executable cannot be used as a general Node interpreter through `ELECTRON_RUN_AS_NODE`. |
| `EnableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` in the environment is ignored. |
| `EnableNodeCliInspectArguments` | off | `--inspect` and its relatives are ignored. |
| `OnlyLoadAppFromAsar` | on | Application code is loaded from `app.asar` and from nowhere else. |
| `EnableEmbeddedAsarIntegrityValidation` | on | `app.asar` is checked against a digest embedded at build time. A single changed byte prevents the application from starting. |

## Supply chain

- The application has two runtime dependencies, React and React DOM. Everything else is build tooling.
- `npm audit` runs on every push, and Dependabot, secret scanning with push protection, and security updates are enabled on the repository.
- The release workflow uses only actions published by GitHub. The step that publishes uses the GitHub CLI already on the runner, not a third-party action.
- The workflow token is read-only. Only the job that publishes is granted write access to the repository, and the permission to sign an attestation.
- The repository is scanned on every push for credentials, for absolute paths carrying a user name, and for text that is not English, in the working tree and in the whole history.

## Known limits

- The builds are not code-signed, for the reason above.
- The page is served from `file://`, so the `GrantFileProtocolExtraPrivileges` fuse stays on. Turning it off first requires serving the page from a custom protocol.
