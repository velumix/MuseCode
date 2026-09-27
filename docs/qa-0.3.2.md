# Velum Code 0.3.2 checks

Checked on Windows with Muse 1.4.0, Codex 0.157.0, Antigravity 1.2.12, and a Pixel 7 Pro.

## Model and reasoning controls

- Model lists are read from the installed CLI. Muse uses its server protocol, Codex uses App Server, and Antigravity uses `agy models`.
- Reasoning menus contain the selected model's reported levels. Unknown/custom models retain the CLI's reasoning default.
- Agent changes apply to the next turn, including resumed conversations. Drafts, transcript, workspace and session identity survive changes.
- Preferences are stored separately for each provider and used by new conversations.
- Terminal settings apply on explicit Restart. Selecting a model never interrupts an existing terminal process.
- Desktop and phone share session options. Phone changes update the desktop, and view-only/offline phones cannot edit settings.
- Model discovery has bounded output and timeouts. Failures show a notice and keep default/custom model selection available.

## Verification

- 31 browser tests, including keyboard navigation, accessibility, provider isolation, persisted settings, failed updates, terminal restart behavior, phone edits and view-only access.
- 52 Rust tests, including catalog parsing, option validation, argument construction and remote authorization.
- Rust formatting and Clippy with warnings treated as errors.
- Native Windows checks with deterministic CLI fixtures: model catalogs, selected options on fresh/resumed turns and ConPTY launches, process cleanup, tray behavior and Antigravity sign-in.
- USB integration checks: phone model/effort changes update the actual desktop session; background sending, stopping, reconnecting and revocation still work.
- Real installed Muse and Codex catalogs loaded successfully through the native backend. Their available model and reasoning menus were exercised without sending a paid prompt.
- Android unit tests and release lint passed; the signed APK updated the existing Pixel installation to 0.3.2.
- The 0.3.2 Windows installer was installed and checked again: real Notification Center delivery, click activation, tray lifetime and all three CLI integrations passed.
- Installed phone-shell checks passed for USB control, migration from the old offline cache, current branding while offline and keeping private API data out of the cache.

## Limits

Antigravity still needs the user's Google sign-in before its real model catalog is available. Its successful authentication and model selection paths were tested with protocol fixtures; this does not claim the user's account is connected. Custom model IDs are checked for safe argument syntax, then accepted or rejected by the CLI. Providers decide which models and reasoning levels an account can use.
