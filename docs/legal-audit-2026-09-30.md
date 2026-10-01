# Documentation and legal audit — September 30, 2026

## Scope

Reviewed Velum Code desktop 0.6.2 and Android companion 0.6.1, based on source
commit `f7b9ffb38f1abf53d986477172f14fafbe620c47`. Changes are prepared on
`docs/legal-and-documentation`. This is a source/documentation audit and
dependency notice generation, not an attorney opinion or installed-app test.

## Findings addressed

| Finding | Change |
| --- | --- |
| No clear project license status or user terms/privacy documents | Added explicit legal status, owner-review drafts and required publisher fields |
| No private security-reporting policy | Added reporting guidance; private contact remains visibly pending |
| Docs mixed user guides and historical QA without an entry point | Added an index, getting-started, support and data-controls guides |
| Remote guide incorrectly said drafts and desktop sessions were not restored | Corrected restart recovery, phone draft persistence and offline revocation limits |
| README described an implemented folder picker as future work | Corrected the remaining navigation item |
| No complete Windows dependency notice collection | Added generator, pinned upstream texts, inventory and notices |
| MPL covered source and NSIS LZMA source availability were undocumented | Included original source archives with provenance/checksums and distribution notices |
| Microsoft loader licensing was conflated with Rust bindings | Matched x64 loader bytes to SDK 1.0.3650.58; included its separate license/notices |
| Android notices listed only direct libraries | Generated resolved runtime inventory, inherited POM licensing and packaged archive notices |
| No legal packaging/readiness checks | Added document checks, an explicit final-release gate and CI/package resource configuration |

## Data-flow evidence

Reviewed the native history, preferences, memory, bots, automation, boards,
plugins, remote server and provider handling; frontend Markdown, diagnostics
and phone draft storage; Android permissions, WebView storage, Forget desktop
and backup configuration. The privacy draft describes provider transmission,
plaintext local storage, optional cloud synchronization, queued/scheduled work,
paired-device scope, USB HTTP versus Tailscale HTTPS, external images and runtime
diagnostics. No Velum account, billing system, advertising SDK or Velum-operated
automatic transcript upload was identified in this version.

## Dependency scope and source evidence

- Windows: 111 installed npm non-development packages; 351 Rust normal/build
  dependency packages selected through Windows x64 metadata; three additional
  notice groups for NSIS 3.11, Microsoft WebView2 loader SDK 1.0.3650.58 and
  the pinned Rust 1.98.1 standard library. The original complete standard-library
  copyright/license report is preserved as an accompanying HTML resource.
- Full root and nested license/NOTICE texts are retained. Identical texts are
  reproduced once with per-package SHA-256 references. The generated inventory
  contains no local machine paths.
- Thirteen crates lacked a packaged root notice. Version-pinned upstream
  overrides preserve their license texts. The selectors override uses the full
  MPL 2.0 text; its original source headers accompany the exact crate archive.
- Five original MPL crate archives match their Cargo.lock SHA-256 checksums.
  The original NSIS source archive is included; its COPYING matches the cached
  3.11 toolchain. None of these upstream sources was modified.
- The Rust x64 `WebView2LoaderStatic.lib` hash matches the corresponding file
  in Microsoft's 1.0.3650.58 NuGet package:
  `0659b741bde6348d4c4a6ec4ceb9af50e3d0048ed9cd3c8659bccbb61fde55ee`.
- Android: 48 resolved release runtime artifacts before shrinking; two distinct
  provided license texts, including the full Apache 2.0 license. Maven parent
  POM license inheritance is resolved rather than guessing missing licenses.

These are conservative dependency inventories, not byte-level binary SBOMs or
security audits. SDK-wide notices can mention components not linked into Velum.
The separately installed runtime, CLIs, Tailscale and ADB have their own terms.

## Checks for this change

Completed checks:

- `npm run legal:notices:check`: passed; generated Windows inventory and full
  notice text match locked dependencies and pinned inputs.
- Android `:app:legalNotices`: passed; generated 48 runtime artifact entries.
- `npm run legal:check`: passed; local document links, input fingerprints,
  notice references, covered-source checksums and resource inclusion agree.
- `npm run legal:release`: rejected the current drafts as expected, identifying
  missing identity, contact, license, review and acceptance requirements.

Notice generators run against locked/local dependencies. The Android generator
resolves authoritative published POMs and reads notices from runtime archives.
Documentation checks validate local links, inventory inputs, notice references,
source checksums and Windows resource inclusion. The explicit final release
check must fail while owner/license/contact fields and acceptance remain pending.
No provider requests, application regression tests, installer build or installation
were performed for this documentation change. CI build/artifact edits still need
execution in their intended build environment before relying on a new installer.

## Remaining before final public distribution

- Publisher legal name, location and monitored contact addresses.
- Owner-approved source/SDK license and final executable terms.
- Legal review, appropriate cap/venue wording and actual support-retention policy.
- Final public/offline documents and a legally reviewed acceptance flow.
- Maintainer review of installer components, Android inventory, ownership and
  final packaged artifacts, including notices/source availability.

At completion of this source audit, the installed app had not yet been replaced.
The subsequent [installation record](qa-legal-install-2026-09-30.md) documents the
successful rebuild, replacement and resource verification. Earlier archived
binaries retain their original contents. See the [release guide](legal-release.md).
