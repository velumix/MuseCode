# Remote access

VelumCode's phone interface connects to the agent running on your Windows desktop. Use the
[Android APK](android.md) with its built-in QR scanner, or the installable mobile web app.
Install the regular Tailscale app on both devices; VelumCode uses that client's private
network and HTTPS support.

## Connect a phone

1. Sign into Tailscale on both devices. Keep the desktop awake.
2. Open **Connect phone** in VelumCode's footer or command palette. Refresh to check Tailscale.
3. Enable remote access. If Tailscale needs HTTPS enabled for your network, follow its setup
   link and try again. Your tailnet's permissions must allow access to this device on TCP 8443.
4. Show a QR code, scan it in the Android app (or your phone's camera for the web app), and name the phone.
5. Compare the six-digit code on both screens and confirm on the desktop. Uncheck the control
   permission to grant view-only access.
6. If using the web app, use your browser's **Install app** or **Add to Home screen** option. On iOS this is in Safari's
   Share menu. Browser support and installation labels vary.

The QR expires in two minutes. Its invitation is single use: a second phone cannot claim it.
The desktop must approve the first phone before any conversations or commands are available.
The phone stays paired for up to 90 days. Clearing browser storage requires pairing again.

## What works

- View and switch between the desktop's open Agent conversations.
- Read streaming answers, Markdown/code, tools, task checklists, and completion/errors.
- Send messages and stop running turns with the same underlying runner as the desktop.
- Control the agent while the desktop window is hidden in the tray.
- Reconnect after a network interruption or phone sleep and replay recent activity.
- Keep an unsent draft while changing conversations or briefly losing the connection.
- Add the VelumCode icon and standalone interface to the phone's home screen.
- Revoke individual phones, grant view-only access, or switch off remote access entirely.

Phone messages always use standard agent permissions, including when the desktop has selected
YOLO for its own messages. Headless Muse questions still auto-cancel, as they do in desktop
Agent mode. The phone does not offer interactive approvals, terminal access, arbitrary file
browsing, remote workspace creation, or mobile push notifications.

Enter adds a line on the phone. Tap Send (or use Ctrl/Cmd+Enter with a keyboard) to submit.
Messages are never queued offline. If a connection fails while submitting, check the latest
conversation before retrying: the desktop may already have accepted the message.

## Network and credentials

The native HTTP listener binds to an ephemeral **127.0.0.1** port. VelumCode starts an owned
foreground `tailscale serve --yes --https=8443 http://127.0.0.1:<port>` process. Tailscale
terminates TLS and applies tailnet access policy. Closing VelumCode to the tray preserves it;
disabling remote access or quitting terminates the process and its foreground route.
Other routes are not reset or overwritten. An existing route on 8443 must be freed first.
VelumCode never starts Funnel or opens a LAN/public listener.

The QR puts its random invitation in a URL fragment, which is not sent in HTTP URLs. The phone
removes that fragment from the address bar. Pairing binds the invitation to a separate phone
claim; desktop approval issues a device-specific credential. That credential is kept in a
Secure, HttpOnly, SameSite=Strict cookie. Only its SHA-256 hash is saved in the desktop's
`remote.json` settings. The connected-device API never returns credential hashes.

Host checks, same-origin checks, a required request header, bounded JSON bodies, a pairing
attempt limit, and per-device control permissions guard the HTTP API. The mobile origin
does not have Tauri IPC access. Paired phones can see all open Agent conversations, and phones
granted control can ask the agent to act in those sessions, so pair only devices you trust.

Remote access preference and device grants survive an app restart. Conversation replay uses
a bounded in-memory event buffer (up to 8,000 events / 2 MiB per session). Older activity is
marked as truncated. The phone never caches API responses or transcripts in its service
worker; only the interface assets are cached for an offline launch. Drafts and desktop
sessions are not restored after an app exit or reload.

## Troubleshooting

### USB cable

The [Android APK](android.md#connect-over-usb-without-tailscale) also connects over an
authorized ADB USB connection. Choose **Connect phone → USB cable** on the desktop.
This mode binds only `127.0.0.1:43827` and uses ADB reverse forwarding from the same
loopback address on the phone. It does not depend on Tailscale, Wi-Fi, or a public listener.

USB uses a separate HttpOnly, SameSite=Strict cookie without the HTTPS-only Secure flag.
The Android app allows HTTP only for this exact loopback endpoint; Tailscale still requires
HTTPS and its Secure cookie. Pairing invitations and device credentials are scoped to their
transport. Both modes require matching-code approval, hash credentials on disk, enforce
the same request checks, and support immediate revocation.

VelumCode refuses to replace a conflicting ADB forwarding rule. Disconnecting removes only
its own mapping and closes the listener. Quit closes the listener and attempts mapping
cleanup; an interrupted cleanup can leave an inert mapping that is reused on reconnect.
USB is enabled explicitly after each desktop launch. After unplugging, reconnect the cable
and choose **Reconnect**. An unauthorized phone must accept its USB debugging prompt;
an undetected phone may need a data-capable cable or its Windows USB driver.

### Tailscale and pairing

| Symptom | Check |
| --- | --- |
| Tailscale not installed / disconnected | Install the Windows client, sign in, then click Refresh. |
| HTTPS setup needed | Use the setup link in Tailscale's message to enable HTTPS, then retry. |
| Port 8443 is already serving another app | Inspect `tailscale serve status`; move the other service if you want VelumCode to use this port. |
| Phone cannot open the address | Connect its Tailscale app, check tailnet grants/ACLs for TCP 8443, and keep the desktop awake. |
| Pairing expired | Generate a fresh QR code and keep both screens open for confirmation. |
| Reconnecting after Tailscale restarts | Refresh the desktop status and enable remote access again if its Serve process stopped. |
| Phone has no conversations | Open an Agent tab on the desktop. Terminal-only activity is not mirrored. |
| A revoked phone still shows a screen while offline | Once connected, authentication fails and the phone clears its in-memory transcript. It cannot issue commands while offline. |

Useful upstream references: [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve),
[Serve command](https://tailscale.com/docs/reference/tailscale-cli/serve), and
[access control grants](https://tailscale.com/docs/features/access-control/grants).
