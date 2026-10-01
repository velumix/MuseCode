# Troubleshooting and support

[Documentation](README.md)

## Common problems

| Problem | First steps |
| --- | --- |
| Provider missing or signed out | Confirm its CLI is installed and works in a normal terminal. Sign in through the appropriate CLI/app flow, then refresh the catalog. |
| File access fails | Check the selected project folder and access result. Confirm the Windows account and provider policy allow the required operation. Use the [workspace guide](workspace-access-fix.md). |
| A message stays queued | Inspect whether work is active or the queue is paused. Stop/failures/recovery preserve pending work; review it and choose Resume when ready. |
| Status or tok/s is unavailable | Wait for a complete provider turn and inspect any error. Some CLIs do not report every field; unavailable data is not a zero-speed result. See [usage](usage.md). |
| An approval is needed | Use Terminal for an interactive prompt. Headless Standard policies differ by CLI; do not enable YOLO just to dismiss an unexplained error. |
| Work continues after closing the window | Closing hides to tray. Use **Quit Velum Code** to stop background work and exit. |
| Notifications do not arrive | Use the installed Windows bundle, enable app notifications, inspect Windows notification settings/Do not disturb, and send a test notification from the command palette. |
| A phone cannot connect | Keep the desktop awake and app running. Check Tailscale HTTPS or trusted ADB/USB setup, then inspect device approval and expiration. See [remote access](remote-access.md) and [Android](android.md). |
| A correction repeats | Review whether the project lesson was accepted and active. Start a fresh conversation if old context conflicts. Memory supplies context and is not an enforcement mechanism. |
| A plugin fails | Check its approved permissions and installed version. Disable or uninstall it if untrusted; contact its author for plugin-specific behavior. |

## Report a reproducible issue

Use the [Velum Code issue tracker](https://github.com/velumix/VelumCode/issues)
for non-sensitive bugs and feature requests. There is no guaranteed support
response time. Report vulnerabilities through the [security policy](../SECURITY.md).

Include:

- Velum version/build source, Windows version and whether this is the installed
  app or a development build.
- Provider and CLI version, or Android/browser version for phone problems.
- A short description of the expected behavior and what actually happened.
- Minimal reproduction steps, with sensitive names/paths/content removed.
- Relevant screenshots or diagnostics only after reviewing them for secrets.

App diagnostics can help explain setup and activity, but sanitization is not a
guarantee that your own prompts, filenames or logs contain no sensitive data.
Public issues can be read, indexed and copied by others. Do not attach account
codes, API keys, cookies, remote settings files or a private project transcript.
