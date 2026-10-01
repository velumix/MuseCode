# Contributing to Velum Code

## Licensing is still being decided

The main application and plugin SDK do not yet have a project license. Read
[LEGAL.md](LEGAL.md) before assuming this repository grants open source reuse
rights. A contribution is not automatically a copyright assignment, and this
document does not introduce a contributor license agreement.

Before merging outside code, the maintainer must choose a project license and
an inbound contribution policy, confirm the contributor has authority to submit
the work, and preserve any third-party notices. Existing contributors' rights
must be checked before changing the license of their work. Ideas and ordinary
bug reports can still be discussed in the issue tracker; keep them free of
confidential material.

## Workflow

1. Read the [development guide](docs/development.md) and use the pinned tools.
2. Make a focused branch from the intended base. Preserve `.git` and repository
   structure; keep installers, caches, credentials and personal data out of source.
3. Describe the problem and the change. Update the user guide when behavior
   changes, and the privacy notice when storage/network behavior changes.
4. Use the existing checks relevant to the change as described in the development
   guide. Include results and limitations in the review description.
5. For dependency changes, regenerate notices and covered-source artifacts using
   the [legal release guide](docs/legal-release.md). Do not remove upstream rights
   or replace an upstream license with the project's license.

Security problems require the [private reporting process](SECURITY.md).
Non-sensitive bugs and proposals can use the
[issue tracker](https://github.com/velumix/VelumCode/issues).
