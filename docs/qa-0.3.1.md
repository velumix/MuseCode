# Velum Code 0.3.1 verification

This update finishes the visible rename and adds a dedicated Antigravity sign-in
dialog. OAuth stays with the installed CLI: Velum forwards a one-time code to the
active login process, then verifies account access with `agy models`.

## Checked locally

- 25 browser tests pass, including sign-in focus and accessibility, automatic
  handling of authentication failures, fresh attempts, draft preservation and
  keeping authorization codes out of conversations.
- 49 Rust tests pass. Formatting and Clippy warnings checks are clean.
- Native login tests cover rejected codes, retry, verified success and child
  process cleanup using a controlled CLI fixture.
- Installed Windows tests pass for tray persistence, single-instance reopening,
  native Notification Center delivery and activation, all three providers,
  permissions, Stop and child process cleanup. Desktop and Start menu shortcuts
  point to `velum-code.exe`; the former executable and custom M icon are removed.
- USB integration tests pass pairing, control while the desktop is hidden,
  disconnect/reconnect and revocation. A seeded Muse phone cache is removed;
  offline launch uses Velum Code assets and no API or pairing data is cached.
- The installed Antigravity CLI 1.2.12 reaches the real Google code prompt through
  the bridge. Submitting a deliberately invalid test code reports a failure and
  stops the login process. This test does not sign in to a Google account.
- All 11 Android tests and release lint pass. The signed 0.3.1 APK updates the
  existing Pixel 7 Pro installation without changing its package or signing key.

## Compatibility

The Windows executable is now `velum-code.exe`. Icons, notification resources,
favicon and Android/PWA marks use Velum asset names. The installer removes the
old custom M icon; the phone service worker replaces the former shell cache.
Stable application IDs, phone credentials and signing identities are retained.
Muse remains the name of the original CLI provider.

## Remaining manual check

Complete Google sign-in through the new dialog using a fresh code from that
attempt. Successful account verification and model output still depend on the
user's Google account and provider access. Initial CLI theme/workspace setup, if
required, is completed in Terminal. No saved credentials are read or changed by
the test fixtures.
