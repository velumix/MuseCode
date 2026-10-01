# Data storage and removal

[Documentation](README.md) · [Privacy notice draft](../PRIVACY.md)

Velum's app files, your project files and your provider's files are separate.
Removing one does not erase the others. Do not delete a workspace to clear app
history. Back up anything you want to retain before manually removing files.

## Desktop storage

The native app uses Tauri's application configuration directory for the
identifier `com.velumix.musecode`. On Windows, the standard configuration
location is `%APPDATA%\com.velumix.musecode`. Development/QA sessions can
override this with `MUSE_CODE_CONFIG_DIR`; the override is not a provider setting.

| Location relative to the configuration directory | Contents |
| --- | --- |
| `history/desktop.json` | Open tabs, drafts, queues, provider choices and session recovery metadata |
| `history/<tab-id>.json` | Bounded recent conversation event history |
| `appearance.json` | Theme, layout, typography and workflow preferences |
| `desktop.json` | Desktop notification preferences |
| `agent-tools.json` | Host tool permissions, including separate desktop capture and native input grants |
| `remote.json` | Remote settings, approved devices and hashed login credentials |
| `boards/` | Workspace task boards, including retained trash |
| `bots/` | Bot profiles and instructions |
| `automation.json` | Bot schedules and bounded activity history |
| `plugins/` | Installed plugin manifests/code and private plugin data |

The default memory vault is **Documents\Velum Code\Memory** in the Windows
Documents folder. Windows may redirect Documents into OneDrive. Bot-private
memory is part of the vault and should be reviewed separately from a profile
or board. Use the vault location shown by the app if you have customized it.

Velum stores transcript and memory text without app-level encryption. WebView2
also keeps a browser profile/cache. The browser data directory can differ from
the native configuration directory or be overridden with
`WEBVIEW2_USER_DATA_FOLDER` in development. Do not assume deleting one JSON
file clears every browser copy, provider log or backup.

## Use the available controls

| Goal | Action | What it does not remove |
| --- | --- | --- |
| Clear an open conversation's Velum recovery | Close that conversation | Provider logs/context, saved memory and copied/exported content |
| Stop new queued or scheduled work | Stop active work; pause queues/schedules; use explicit Quit to exit | Work already completed, files already changed or provider records |
| Remove a memory note | Delete it in Memory; archive only hides it | Excerpts already sent to providers or saved in transcripts/backups |
| Stop future memory injection | Change memory preferences; start a fresh provider conversation if you need fresh context | Provider retention or context already sent |
| Remove plugin private data | Uninstall the plugin | Content previously attached to drafts or sent to a provider |
| Remove a phone's access | Disconnect/revoke it on desktop | Screenshots, copied text and data still present on an offline phone |
| Remove a task permanently | Follow the board's Trash controls | Task text already sent to an agent or copied elsewhere |

## Phone storage

Phone drafts persist in IndexedDB, with a localStorage fallback. The phone also
stores an authentication cookie and interface/session choices. API responses
and transcripts are not service-worker cached; interface assets are cached.
That cache policy does not prevent screenshots or browser/operating-system
storage outside Velum's controls.

- **Android:** use **Forget desktop** to clear the remembered address, WebView
  storage, cookies, history and cache. Android's app settings can also clear the
  companion's app storage. Uninstalling removes the app's local installation;
  desktop and provider data remain.
- **Phone web app:** clear the Velum site's data in the browser, including
  cookies, IndexedDB, localStorage and cache/service-worker data. Removing only
  a home-screen icon may leave site data behind.
- Revoke access on desktop as well. Draft clearing on revocation occurs when
  the phone observes that state; clear storage directly on an offline device.

## Full local removal

1. Revoke devices, stop active work and disable/pause automation.
2. Choose **Quit Velum Code**. Check that the app has exited before moving or
   deleting its saved data; a running instance can save files again.
3. Back up selected notes, bot instructions and boards if needed. Uninstall
   Velum using Windows **Installed apps**.
4. Locate the actual Velum configuration directory and remove only the Velum
   data you intend to erase. Check the WebView2 profile separately. Do not remove
   unrelated folders in AppData.
5. Review the memory vault independently. Preserve it if you want your notes.
   Review OneDrive, backup history and recycle-bin copies if those systems apply.
6. Clear phone app/site data and manage provider sessions/accounts using the
   provider's own controls. Uninstalling Velum does not sign you out of its CLIs.

These are user-controlled file operations, not a built-in "delete everywhere"
service. The Publisher cannot remotely erase data from your devices, a provider
or a synchronization service.
