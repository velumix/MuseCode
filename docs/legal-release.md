# Legal release guide

[Documentation](README.md) · [Legal status](../LEGAL.md)

**Current status: reviewable drafts, not a cleared public release or an effective
user agreement.** This guide records the decisions and product work still
needed. It cannot guarantee immunity from claims or replace advice about the
publisher's actual business and markets.

## 1. Confirm the publisher and distribution

Complete [publisher.json](../legal/publisher.json) with:

- The legal person's/company's name, country/state and monitored public legal,
  privacy and security contacts. A GitHub handle is not a substitute for the
  contracting party. Use the same monitored address for multiple roles if appropriate.
- The distribution model and approved application and plugin SDK licenses.
- The effective date and final document version.
- A legally reviewed liability cap/currency, governing-law/venue clause and
  support-report retention policy. If counsel advises omitting a cap or venue
  selection, document that decision and adapt the terms/check accordingly.

Do not derive these facts from the developer's timezone or computer username.
Check authority to license all original code, outside contributions and assets.
Review any employer/client ownership obligations before granting rights.

The repo currently has no project license. Public visibility alone does not
grant general reuse rights; see [GitHub's repository licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).
Choose an open source license only when the owner intends that grant. For a
proprietary app, finalize the executable grant and source/distribution restrictions.
For open source, keep the license's permissions intact and adapt the terms so
they do not narrow those rights. Set package metadata and SDK packaging to match;
include its approved `LICENSE` in a published SDK package. Do not claim ownership
of third-party components or generated output that the publisher does not own.

## 2. Obtain a review for the actual markets

Give a lawyer the terms/privacy drafts, data controls guide, dependency inventory,
distribution plan and feature list. Ask for review of consumer rights, unfair
contract terms, enforceability/acceptance, privacy/controller obligations,
children's access, liability wording and the chosen jurisdictions. Payments,
business hosting, telemetry or advertising need a new review before launch.

Warranty and liability clauses are subject to applicable law. For example,
Australian consumer guarantees have mandatory protections described by the
[ACCC](https://www.accc.gov.au/business/selling-products-and-services/consumer-rights-and-guarantees).
Do not publish a worldwide promise that every user waived every right. The
drafts preserve non-waivable rights and leave the cap and venue undecided.
No arbitration, class-action waiver, broad indemnity or shortened claim period
has been inserted without a jurisdiction-specific decision.

Check whether an appropriate business entity, contracts with contributors,
professional liability/cyber insurance, and a repeatable security process are
appropriate with qualified advisers. None makes the publisher immune from a
claim. Review the Velum name/branding and descriptive use of provider marks;
the documentation makes no trademark-registration or ownership guarantee.

## 3. Match disclosures to behavior

Re-read the source-backed [privacy draft](../PRIVACY.md) whenever a feature changes.
Review local history/memory, provider context, queues, scheduled work, plugins,
paired devices, phone drafts, external images, support reports and runtime
diagnostics. The [FTC's app guidance](https://www.ftc.gov/business-guidance/resources/marketing-your-mobile-app-get-it-right-start)
explains the importance of clear disclosures and honoring privacy promises.

WebView2's SmartScreen and diagnostic behavior requires disclosure independent
of whether Velum has analytics. The draft includes it; see
[Microsoft's WebView2 privacy guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy).
Do not turn "no Velum analytics" into "nothing ever leaves the device".

Before processing support reports, decide who can access them, where they are
stored, a defensible retention period and how requests are handled. Set up the
published email addresses and the promised process. Confirm the actual audience;
an adults-only statement is not, by itself, children's privacy compliance.

## 4. Make the final terms available and implement acceptance

**Not implemented in the current app.** The current NSIS installer has no final
Velum license/terms acceptance page and the app has no versioned acceptance
record. Adding Markdown files does not fix that. Drafts are bundled as clearly
marked review material; do not use them as a binding "I agree" screen.

Once final documents are approved:

1. Make terms/privacy/notices easy to read before download and from an in-app
   **Help / Legal** entry. Provide stable public URLs and offline copies. Put
   phone privacy information where a pairing user can find it.
2. Before the first provider task under the final agreement, present a plainly
   labeled, unchecked acceptance control with visible links to the final terms
   and a clear action such as **I agree and continue**. Let users leave without
   starting agent work. Arrange the installer/first-use flow so silent installs,
   upgrades, tray startup, schedules and phone requests do not imply consent
   that was never given.
3. Record the accepted terms version, document hash, app version, UTC time and
   acceptance action locally. Do not collect additional personal information
   just to make a log. Explain this new record in the final privacy notice and
   have counsel review the evidence process; a local file is not a guaranteed
   identity/signature or an unalterable legal record.
4. Present material agreement changes prospectively and request fresh acceptance
   where required. Preserve the text of previous final versions. Do not label
   an old installation as having accepted a new agreement automatically.
5. Keep acknowledging a privacy notice separate from any consent needed for an
   optional processing purpose. Do not describe all provider processing as
   covered by a single forced privacy checkbox.

The Ninth Circuit's [Berman decision](https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/05/20-16900.pdf)
illustrates why conspicuous notice and an unambiguous acceptance action matter
in the circumstances it considered. It is not a universal enforceability test
or a promise that one checkbox satisfies every jurisdiction.

For an open source distribution, counsel should determine which additional
service terms actually need acceptance. The product flow must preserve the
independent source/component rights granted by the chosen licenses.

## 5. Preserve dependency rights and source availability

Windows notices cover the installed npm non-development set, the Windows Cargo
normal/build dependency closure and pinned installer/SDK/standard-library notices. This is a
conservative package inventory, including host/procedural-macro tools, rather
than a statement that each package was linked into the executable. AND license
expressions and nested notices are retained, including ring and Unicode texts.
Missing packaged license files use exact-version/pinned upstream overrides in
[upstream.json](../legal/upstream.json). Microsoft loader bytes were matched to
the stated SDK; its BSD license and SDK-wide notices are retained separately
from the Rust binding's MIT license.

The pinned Rust standard library's original complete copyright/license report
is also distributed, alongside its license texts. Its report retains the
upstream library's component notices, including portions outside Cargo's app
dependency graph. Review platform SDK/CRT and installer components as part of
the final artifact review.

Unmodified covered-source archives for the five MPL crates and NSIS 3.11 are in
[covered-sources](../legal/covered-sources/README.md). The MPL archives match
Cargo.lock checksums. Source headers are preserved. The full MPL license is in
the notices. MPL's source-availability requirements apply to its covered files;
they do not automatically license the entire Velum project under MPL. See
[Mozilla's MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

The installer uses LZMA. NSIS lists its LZMA component under CPL 1.0, whose
object-code distribution provisions include source availability and upstream
disclaimers. The notices and accompanying complete NSIS source address that
component; review other installer stubs/plugins and any modifications before
declaring the distribution reviewed. See [NSIS's license](https://nsis.sourceforge.io/License).
Update notices/source when the cached toolchain changes. Do not substitute a
generic MIT notice for every component.

Android has its own resolved runtime inventory and bundled notices, including
transitive dependencies, parent-POM license declarations and license/NOTICE
texts present in AAR/JAR archives. The generator currently accepts the audited
Apache 2.0 set and fails on an unknown license so a maintainer can review it.
APK shrinking can remove code; the inventory deliberately includes the set
before shrinking. Android system WebView, provider CLIs, Tailscale, ADB and the
separately installed Microsoft runtime have their own terms and are not silently
claimed as Velum-owned software.

## 6. Generate and check the release files

From the repository root, after installing npm dependencies and fetching the
locked Rust dependencies for Windows:

```powershell
npm.cmd run legal:notices
.\android\gradlew.bat --no-daemon --console=plain -p android -I ..\scripts\legal-android.gradle :app:legalNotices
npm.cmd run legal:notices:check
npm.cmd run legal:check
```

The Windows generator uses offline Cargo metadata. A fresh machine can first
run `cargo fetch --locked --manifest-path src-tauri/Cargo.toml`; npm/Gradle/Cargo
downloads are normal dependency downloads, not uploads of your project.
Android notice generation needs the pinned Java/Android setup in the development
guide. The Android init script generates notices before `preBuild` when enabled
in local/CI build commands.

`legal:check` checks documentation links, lock/build inputs, notice references,
archive checksums and Windows resource inclusion. It allows explicit drafts for
development. It does not certify legal compliance. `legal:notices:check`
regenerates in memory and detects changed/missing notice contents.

Text input fingerprints normalize line endings to LF so Windows and Linux
checkouts agree. Upstream license and archive hashes preserve original bytes;
the repository attributes prevent Git from changing those notice/source files.

Before a public final release:

```powershell
npm.cmd run legal:release
```

This check is **expected to fail now**: identity/contact/license decisions,
legal review and acceptance are unfinished. Set review flags only after the
corresponding work is actually done. Do not bypass the check by merely changing
booleans. Review the final artifact as well as source configuration: installed
Windows bundles must retain `legal/THIRD_PARTY_NOTICES.txt` and covered source;
Android must display its current notices through its existing notices control.
Do not claim acceptance or completed installation testing from a documentation
check.

## 7. Keep it current

Retain each distributed binary/APK, its hashes, notices, covered-source files,
final terms/privacy version and provenance with the release record. CI artifacts
expire after 14 days; they are not a permanent legal or source archive. Provide
covered source directly with the distribution and retain it alongside releases.

Review disclosures and notices when dependencies, providers, permissions,
storage, network requests, remote access or payment features change. Keep
support/security contacts working, handle reports, and describe known limits
truthfully. Never market the app as "impossible to sue", "perfectly secure",
or guaranteed to produce lawful or correct AI output.
