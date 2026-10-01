# Installed documentation update — September 30, 2026

## Build and installation

Velum Code 0.6.2 was rebuilt from source commit
`53454be9393201f7feacb7d83ec59f8ae00c0aad` on
`docs/legal-and-documentation`, then installed with
`scripts/install.ps1 -Build` into `%LOCALAPPDATA%\Velum Code`.

The first attempt was blocked by Windows Application Control at Rust's build
helper (OS error 4551). After the user reported changing that setting, the same
normal build/install command succeeded. The frontend TypeScript/Vite build,
optimized Rust build, NSIS packaging and silent installation all completed.

## Installed-file verification

- All **34 legal resource files** declared in the bundle configuration match
  their repository copies byte for byte, including terms/privacy drafts, full
  notices, dependency inventory, covered-source archives and copyright reports.
- The installed executable matches the freshly built executable except for
  Tauri's expected three-byte NSIS bundle marker (`UNK` to `NSS`).
- `npm run legal:notices:check` passed after packaging.
- `npm run legal:check` passed after installation.

| Artifact | SHA-256 |
| --- | --- |
| NSIS installer | `d156b68be384391329d98e5c51f5d08a0cd93684e9fc8b53992e9cdbf83ee39b` |
| Installed executable | `28adc852efa4d068d1eab8fb70e99ffcb129111258f8423aba8e786cb3baac53` |

The installer and verification manifest are archived in the desktop workspace's
`Builds\Windows\2026-09-30-legal` folder. Earlier build archives are retained.
The app's `legal` installation folder contains the bundled legal material.
User and developer guides remain in the repository's [documentation index](README.md).

## Scope and remaining work

This update installs the documentation and packaging revision. UI/runtime source
is unchanged from the focused-conversation update; application regression tests
and provider calls were not repeated for this installation. The verification
above checks the built/installed files and documentation, not every app behavior.

The terms and privacy notice remain **drafts**. Publisher identity, public
contacts, licensing decisions, legal review and a final acceptance flow are
still required as described in the [release guide](legal-release.md). Installing
this build does not establish agreement to draft terms or legal clearance.
