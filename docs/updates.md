# App updates

[Documentation](README.md) · [GitHub releases](https://github.com/velumix/VelumCode/releases)

The installed Windows app checks GitHub 30 seconds after launch and every six
hours while it stays open, including in the tray. **Automatic updates** is on
by default. New stable releases download in the background. The app verifies
the installer's signature against its bundled public key before offering it.
An offline or failed check leaves the current app usable and retries on the
next scheduled check. Startup does not wait for GitHub.

When the download is ready, **Update ready** appears in the footer. Open it,
then choose **Restart to update**. Finish or stop running conversations and
pause pending queues first. Velum saves the desktop, drafts, preferences and
conversation recovery before launching the installer. Terminal sessions close.
The installer keeps app data and reopens the updated app.

In **Settings → Updates**, you can check manually, read release notes, or turn
off automatic checks and downloads. Turning it off does not cancel a download
already in progress. With automatic updates off, **Check for updates** offers
a separate **Download update** action. Downloaded bytes are held for the current
app session; quitting without installing means a later session downloads again.
Debug builds, raw executables, isolated QA instances and the phone
companion do not perform desktop updates.

## First installation

Versions through 0.6.5 do not contain an updater. Install the signed 0.6.6 Windows
bundle once to add it. Afterwards, use the in-app update control. The update
feed only includes published stable GitHub releases; drafts and prereleases
are excluded. Until the first release is published, Settings reports that
the feed is unavailable.

## Publishing a new version

GitHub builds the installer once per release; users download the compiled
installer and do not need Rust, Node or a local checkout.

1. Configure the two GitHub Actions secrets in `velumix/VelumCode` using
   `scripts/configure-github-updates.ps1`: `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The helper reads local files, checks
   the public key against the app configuration and sends secrets over stdin.
2. Keep `package.json`, both npm lockfile version fields, the Cargo package
   version and `src-tauri/tauri.conf.json` at the same version. Refresh bundled
   dependency notices with `npm run legal:notices`. Add release notes under
   `docs/releases/VERSION.md`.
3. Commit the release, create its `vMAJOR.MINOR.PATCH` tag and push that tag.
   The **Windows release** workflow builds and signs the NSIS installer, writes
   `latest.json` and checksums, and creates a GitHub release draft. It can also
   be dispatched manually for an existing version tag.
4. Review the draft and publish it as a stable release. GitHub's
   `releases/latest/download/latest.json` becomes the app's update feed.
   Published release assets are immutable in this workflow; make fixes in a
   new version instead of replacing a published installer.

The workflow creates drafts so publishing remains an intentional action.
The app's check and download are automatic after publication. Updater signing
is separate from Windows Authenticode code signing.

## Local signing

The publisher's signing key is stored outside the repository at
`%USERPROFILE%\.tauri\velum-code\updater.key`, with its password in
`updater-password.txt` beside it. The directory permits only the current user,
SYSTEM and Administrators. Keep a secure backup of both: future updates need
the same signing identity. Only the public key belongs in `tauri.conf.json`.

Run `scripts/build-release.ps1` to build a signed local installer and prepare
the same release assets under ignored `artifacts/release/vVERSION`. The script restores
its signing environment variables after building. Ordinary CI previews use
`src-tauri/tauri.preview.conf.json` to build without publisher secrets.
