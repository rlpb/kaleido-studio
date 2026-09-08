# Security Policy

## Supported versions

The latest release is the only supported version.

## Reporting a vulnerability

Report privately through [GitHub Security Advisories](https://github.com/rlpb/kaleido-studio/security/advisories/new). Do not open a public issue for a vulnerability.

Please include reproduction steps and the affected version. Expect an acknowledgement within seven days.

## What this app does with your credentials

- The OpenRouter API key is encrypted with the operating system keychain through Electron `safeStorage` and written to the app data folder. Where no keychain exists, it is stored in plain text and the Settings screen says so explicitly.
- The key is sent to `openrouter.ai` and to nothing else. There is no telemetry, no analytics, and no other network destination.
- The renderer process runs with `contextIsolation`, `sandbox` and no Node integration. It never receives the key; all API calls happen in the main process.
- Library files reach the renderer through a custom protocol that resolves the requested path and refuses anything outside the configured library folder.
- Generated media and the library index stay on the local disk.

## Unsigned builds

Release binaries are not code-signed. Windows SmartScreen and macOS Gatekeeper will warn on first launch. Verify you downloaded from the official releases page.
