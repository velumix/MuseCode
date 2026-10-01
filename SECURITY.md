# Security policy

## Report a vulnerability privately

**Private contact pending: [SECURITY_CONTACT_EMAIL].** The publisher must provide
and monitor a private contact before a public release uses this policy.

If GitHub's **Report a vulnerability** option is available for this repository,
use it. Otherwise, open a public issue containing only a request for a private
security contact, without exploit details, private transcripts or credentials.
Do not post tokens, pairing credentials, workspace files or a working exploit
in a public issue.

Include the affected app/CLI version, operating system, affected feature,
reproduction steps, expected behavior and a minimal example with secrets
removed. State whether the problem concerns Velum, a plugin, a provider CLI
or a third-party runtime. Report independently owned components to their
maintainers as appropriate. No response-time commitment or bounty is currently
offered; a future program requires separate published terms.

## Current support scope

Reports should be reproduced against the latest available development build.
Version 0.6.2 is the version reviewed for the current documentation. No long-term
support or security update period has been promised. CI artifacts are unsigned
development builds; verify their source and provenance before installation.

## Security boundaries

- AI providers and the embedded terminal can execute code with the permissions
  of their processes. Standard mode varies by CLI. YOLO can bypass provider
  approvals and sandboxing. Use scoped workspaces and backups.
- Saved conversation, memory and configuration text is not encrypted by Velum.
  Protect the device and any synchronized copies.
- Phone pairing needs desktop approval. View-only access still exposes content.
  Control access can start agent work. Revoke untrusted devices promptly.
- Tailscale uses private HTTPS. USB forwarding uses exact loopback HTTP through
  ADB and relies on trusted USB debugging access.
- Plugin permissions and worker isolation are intended access boundaries, not
  a guarantee that untrusted code is harmless. Listings are not security audits.
- External Markdown images can contact their host during display. Microsoft
  WebView2 has its own diagnostics and SmartScreen behavior.

See [privacy](PRIVACY.md), [data controls](docs/data-controls.md) and
[remote access](docs/remote-access.md) for the actual controls and limits.
