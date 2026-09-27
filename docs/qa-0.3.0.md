# Velum Code 0.3.0 verification

The MuseCode rename adds Muse, OpenAI Codex and Google Antigravity as separate
providers in Agent and Terminal views. Windows and Android retain their existing
application identities, settings paths and signing identity for upgrades.

## Checked locally

- 23 browser tests cover desktop and phone interactions, provider selection,
  draft/session isolation, accessibility, pairing, revocation and reconnects.
- 45 Rust tests pass, with formatting and Clippy warnings checks clean.
- 11 Android tests and release lint pass. The release APK verifies with APK v2
  signing and updates the existing Pixel 7 Pro installation successfully.
- Installed Windows smoke tests pass for real native IPC, both new CLI protocols,
  stdin prompts with shell punctuation, exact conversation resume IDs, failures,
  Stop/process-tree cleanup, explicit permission bypass and embedded terminals.
- Native tray, single-instance reopening, Windows Notification Center delivery,
  notification activation and saved notification preferences pass.
- The USB integration smoke test passes desktop-approved pairing, background
  phone control, reload/replay, disconnect/reconnect and device revocation.
- Codex 0.157.0 completes a real ChatGPT-authenticated request and resumes the
  same conversation on a second request. Antigravity 1.2.12 is installed; its
  unauthenticated error is verified, and its successful stream path is tested
  with protocol fixtures. A Google sign-in is required for a live model call.

## Limits

Provider detail depends on the CLI stream. Codex may deliver complete messages
instead of token deltas. Interactive approval prompts belong in Terminal; phone
commands always use standard permissions. Terminal and Agent conversations are
separate. Explicit Quit and Windows restarts do not restore in-memory tabs yet.

The Tailscale client was stopped during this pass. USB was tested independently;
this report does not claim a new live Tailscale network test.
