# Covered third-party source

These original, unmodified archives accompany Velum's Windows distribution.
They provide source for the included MPL 2.0 crates and NSIS 3.11, including
its CPL 1.0 LZMA component. Source notices and licenses remain applicable.
They do not establish a license for Velum-owned application code.

Exact versions, SHA-256 hashes and upstream download locations are recorded
in [the inventory](../dependencies.json) and [pinned provenance](../upstream.json).
The Rust archives were checked against `src-tauri/Cargo.lock`. The NSIS source
archive came from the project's official SourceForge release; its `COPYING`
matches the cached 3.11 toolchain's notice.

## Read or extract

`.crate` files are gzip-compressed tar archives. NSIS source is a bzip2-compressed
tar archive. Use a tar-compatible archive program. For example, from this folder:

```powershell
tar -tf selectors-0.36.1.crate
tar -xf selectors-0.36.1.crate
tar -tf nsis-3.11-src.tar.bz2
tar -xf nsis-3.11-src.tar.bz2
```

Extract into an empty folder when inspecting source. Each crate retains its
original source headers; the full MPL 2.0 text is also reproduced in the
accompanying third-party notices. Unmodified source is provided directly with
the distribution, without requiring an account or a request to the Publisher.

The inventory includes build/host dependencies conservatively. Inclusion of
a source archive does not imply that every file in it was linked into Velum.
When dependencies or the installer toolchain change, replace the affected
archives and regenerate notices before distributing that build.
