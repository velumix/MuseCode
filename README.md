<div align="center">
  <img src="src/assets/velum-mark.png" alt="Velum Code's folded blue V" width="112" />
  <h1>Velum Code</h1>
  <p><strong>Your coding agents. One place to build.</strong></p>
  <p>A Windows home for Muse, Codex and Google Antigravity.<br />Created by <a href="https://github.com/velumix"><strong>Velumix</strong></a>.</p>
  <p>
    <a href="https://github.com/velumix/VelumCode/actions/workflows/windows.yml"><img src="https://github.com/velumix/VelumCode/actions/workflows/windows.yml/badge.svg" alt="Windows CI" /></a>
    <a href="https://github.com/velumix/VelumCode/actions/workflows/android.yml"><img src="https://github.com/velumix/VelumCode/actions/workflows/android.yml/badge.svg" alt="Android CI" /></a>
    <img src="https://img.shields.io/badge/Windows-x64-357EF4?style=flat-square" alt="Windows x64" />
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square" alt="Built with Tauri 2" />
    <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square" alt="Built with React 19" />
  </p>
  <p>
    <a href="#get-velumcode"><strong>Get VelumCode</strong></a> ·
    <a href="#why-i-built-it">The story</a> ·
    <a href="docs/development.md">Development guide</a> ·
    <a href="https://github.com/velumix/VelumCode/issues">Feedback &amp; ideas</a>
  </p>
</div>

<p align="center">
  <img src="docs/images/musecode-welcome.png" alt="VelumCode's dark desktop interface, conversation sidebar, and centered composer" width="1200" />
</p>

## Why I built it

I'm **[Velumix](https://github.com/velumix)**, and I built VelumCode because Muse only had a terminal version when I started this project.

I wanted a proper app: something that could live in the Windows tray, keep working after I closed the window, and send me real notifications when it was done. I also wanted a clean, minimal interface that felt good to use every day.

So I made it. **Velum Code is the app I built around that idea.** It started as MuseCode and now brings Muse, OpenAI Codex and Google Antigravity into the same desktop experience: chat, an embedded terminal, background work, native notifications, and phone control. Each CLI provides its own coding agent and account; this repository is my independent desktop app.

## Built for the way I wanted to work

| | What you get |
| :-- | :-- |
| **Close it. Keep working.** | Closing the window sends VelumCode to the tray. Running tasks, terminals, tabs, and drafts stay alive. |
| **Real Windows notifications.** | Background Agent turns notify you when they finish or fail. Open the notification to return to its conversation. |
| **Take the conversation with you.** | Follow live Agent activity, send messages, and stop tasks over private Tailscale or a USB cable. Pairing needs your desktop approval. |
| **Choose the model and depth.** | Model catalogs from your CLIs, reasoning levels for each model, and preferences that carry into new conversations. |
| **Keep what matters.** | A local Markdown memory vault, shared preferences, project notes, and selective recall with a strict context budget. Edit the same notes on desktop, phone, or in Obsidian. |
| **Make it your own.** | A permission-based plugin system, command palette integration, and a small TypeScript SDK. Plugins run on demand in isolated workers. |
| **A quieter workspace.** | Charcoal surfaces, blue accents, readable conversations, and motion that respects reduced-motion preferences. |
| **See what the agent is doing.** | Streaming responses, Markdown and code blocks, tool activity, task lists, and visible errors. |
| **Chat and terminal, together.** | Every tab has an Agent view and an embedded terminal. Switching views preserves both. |
| **Pick up where you left off.** | Tabs, drafts, model choices and recent transcripts restore after quitting or restarting. Continue the same provider conversation. |
| **Keep your hands on the keyboard.** | A command palette, session shortcuts, terminal search, and zoom controls. |

<table>
  <tr>
    <td width="50%"><a href="docs/images/musecode-conversation.png"><img src="docs/images/musecode-conversation.png" alt="A sample conversation in VelumCode" /></a></td>
    <td width="50%"><a href="docs/images/musecode-commands.png"><img src="docs/images/musecode-commands.png" alt="VelumCode's command palette with notification controls" /></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Space for the conversation.</strong></td>
    <td align="center"><strong>Your next action, a few keys away.</strong></td>
  </tr>
</table>

<p align="center"><sub>Actual app interface with sample content. Click a preview to see it at full size.</sub></p>

## Get VelumCode

**You'll need Windows x64 and at least one supported CLI.** Install and sign in to the CLI you want to use, then choose it from **AI provider** in the app.

1. Open [Windows CI](https://github.com/velumix/VelumCode/actions/workflows/windows.yml) and choose the latest successful run.
2. Download **VelumCode-windows-x64** from **Artifacts** and extract the ZIP.
3. Run **Velum Code_0.4.0_x64-setup.exe**, then launch **Velum Code** from your desktop or Start menu.

CI artifacts require a GitHub sign-in and are retained for 14 days. These are unsigned development builds. Install the bundle so Windows can register the app's notification identity and click handler.

Prefer to build it yourself? See [Build from source](#build-from-source) below.

## Providers

| Provider | Command | Account and setup |
| :-- | :-- | :-- |
| **Muse** | `muse` | Your existing Muse CLI installation and account. |
| **Codex · ChatGPT** | `codex` | [Install Codex CLI](https://developers.openai.com/codex/cli/), then sign in with ChatGPT or your existing Codex credentials. |
| **Google Antigravity** | `agy` | [Install Antigravity CLI](https://antigravity.google/docs/getting-started?tab=cli), choose Antigravity, then click **Sign in**. |

Choosing another provider opens a new conversation in the current workspace. Existing
conversations, running tasks and drafts stay with their original provider. Each provider
resumes its own CLI session; Velum Code does not collect API keys.
The embedded Terminal starts that tab's provider for sign-in and interactive approvals.

Choose **Model**, then **Reasoning**, above the conversation. Available models come from
the installed CLI and its signed-in account; reasoning levels depend on the selected model.
The selectors show a concrete model and reasoning level as soon as the catalog loads,
using your saved choices or the provider's available defaults. Models without adjustable
reasoning show **Not adjustable**. **Enter model ID** supports custom aliases.
Your last choices are remembered separately for each provider. In Agent view they apply to
the next message without clearing the conversation or draft. In Terminal view, use **Restart**
to launch with new settings. Paired phones with control access have the same selectors;
view-only phones cannot change them. Refresh the catalog after signing in or updating a CLI.

<p align="center"><img src="docs/images/model-reasoning.png" alt="Model and reasoning dropdowns in Velum Code, showing the levels supported by the selected model" width="1000" /></p>

Antigravity has a dedicated Google sign-in screen. Open the browser from that screen,
copy Google's one-time authorization code, and paste it into **Connect account**.
Keep the screen open while signing in; **Start again** creates a fresh attempt if a
code expires. The app verifies access before showing connected, and leaves credential
storage to the CLI. Codes are never saved in conversations. First-launch theme or
workspace prompts, if present, can be completed in Terminal before signing in.

<p align="center"><img src="docs/images/antigravity-sign-in.png" alt="Antigravity Google sign-in with a dedicated authorization code field" width="360" /></p>

Agent view runs without interactive prompts. Codex uses its workspace-write sandbox with
approvals disabled; Antigravity follows its configured policy and denies requests that need
interactive review. Muse uses its headless auto-resolution behavior. Use Terminal when you
need an approval prompt. **YOLO** explicitly enables each CLI's permission bypass; phone
commands always use standard mode. Streaming detail varies by CLI: Codex may deliver a
complete message at once, while Antigravity and Muse also emit text deltas.

Upgrading from MuseCode keeps settings and phone pairings. The installer migrates the
previous default Windows installation, and the Android APK updates the existing app.

## At home in the tray

| Action | What happens |
| :-- | :-- |
| Close the window or press `Alt+F4` | VelumCode hides to the tray and keeps running. |
| Click the tray icon or launch the desktop shortcut | The same window, conversations, and drafts return. |
| Finish or fail an Agent turn while VelumCode is hidden, minimized, or unfocused | Windows receives a notification for that conversation. |
| Click a notification | VelumCode opens the matching Agent conversation. |
| Toggle the footer bell or tray notification setting | Notifications are muted or enabled; your preference is saved. |
| Choose **Quit Velum Code** from the tray or command palette | The app exits and stops its background work. |

Notification text keeps prompts, answers, and workspace details inside the app. Windows notification settings and Do not disturb still apply. Use **Send a test Windows notification** in the command palette to check your setup.

## Your desktop, from your phone

VelumCode includes an [Android APK](docs/android.md) with a built-in QR scanner, plus a mobile
web app you can add to your home screen. Transfer the APK by Bluetooth, Quick Share, or USB
and open it on your phone to install. Your desktop runs
the agent; your phone shows the same Agent conversations and can send messages or stop work,
including while the desktop window is closed to the tray.

<p align="center"><a href="docs/images/musecode-phone.png"><img src="docs/images/musecode-phone.png" alt="VelumCode's phone interface with a shared conversation and remote message composer" width="320" /></a><br /><sub>Actual phone interface with sample content.</sub></p>

1. Install [Tailscale](https://tailscale.com/download) on your desktop and phone, and connect both to the same network.
2. In VelumCode, choose **Connect phone → Enable remote access**. Enable HTTPS in Tailscale if prompted.
3. Choose **Show pairing code**, then scan it using **Scan desktop QR** in the Android app or your phone camera for the web version.
4. Name the phone and confirm its matching code on your desktop. You can grant control or view-only access.
5. The Android app remembers your connection. For the web version, add VelumCode to your home screen from the browser menu.

**Prefer a cable?** Install the Android APK, enable USB debugging on the phone, and choose
**Connect phone → USB cable → Connect** on the desktop. VelumCode opens on the phone;
approve its matching code to start. Tailscale is optional for USB. See the
[USB setup guide](docs/android.md#connect-over-usb-without-tailscale).

The QR expires after two minutes and can be claimed by one phone. Paired devices appear in
**Connected devices**, where you can disconnect them. Phone logins expire after 90 days.
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) provides private HTTPS
on port **8443**; VelumCode leaves other Serve routes alone and does not enable public Funnel access.

Keep the desktop awake and VelumCode running. Phone controls currently operate on Agent
conversations opened on the desktop, using standard agent permissions. Terminal control,
phone push notifications, and creating workspaces from the phone are not included yet.
Reconnecting or refreshing the phone replays recent activity. Quitting stops running work;
reopening the desktop restores its Agent conversations. See [remote access details](docs/remote-access.md) for setup and troubleshooting.

## Memory that stays useful

Click **Memory** on desktop or phone to save project decisions, working conventions, and preferences. **Remember** on a message opens an editable note. The vault lives in **Documents → Velum Code → Memory**, using ordinary Markdown files that also work in Obsidian.

- **Project notes** stay with their workspace; **shared notes** are available across projects.
- Suggested memories wait in **Review** by default. Settings also offer automatic saving or manual notes only.
- Relevant excerpts are selected locally. The default limit is **3,000 bytes per turn**, including memory instructions; choose 1 KB or 8 KB if needed. Up to four excerpts are added, with unchanged excerpts normally refreshed only after eight turns.
- No embedding service, separate summarization call, or full transcript dump. Notes survive quitting the app and restarting Windows.
- Search, edit, pin, archive, restore, or delete notes from either device. A phone with view-only access cannot change them.

Memory works with **Muse, Codex, and Antigravity in Agent mode**. Automatic suggestions depend on the CLI following the note format; manually saving a note always works. Selected excerpts become context for your chosen provider. [How memory works](docs/memory.md).

<p align="center"><a href="docs/images/memory-desktop.png"><img src="docs/images/memory-desktop.png" alt="Velum Code memory editor with project notes and shared preferences" width="900" /></a><br /><sub>Desktop editor with sample notes. <a href="docs/images/memory-phone.png">See the phone editor.</a></sub></p>

The Android app also restores unsent drafts after reloads and process restarts, retries failed connections when brought back to the foreground, and recovers when Android reclaims its WebView renderer. Draft storage is bounded and cleared when the phone disconnects or its access is revoked. The desktop must remain running to keep a conversation available.

## A board for the work ahead

Open **Kanban** on desktop or phone. Each workspace has its own board with **Backlog**, **In progress**, **Review** and **Done**. Add task details and priorities, search cards, drag them between columns, or use the status menu and reorder button by touch or keyboard.

Boards save to your desktop after every change and survive restarts. Refresh to pick up edits from another screen; stale edits are caught before they overwrite newer work. View-only phones can browse boards. **Work on this** prepares an agent draft with the task details—on desktop, in a new conversation using your selected provider and model. You choose when to send it.

The board loads only when opened, supports up to 300 cards per workspace, and makes no AI requests. [Board details](docs/kanban.md).

<p align="center"><a href="docs/images/kanban-desktop.png"><img src="docs/images/kanban-desktop.png" alt="Velum Code workspace Kanban board with task priorities and agent draft actions" width="900" /></a><br /><sub>One board per workspace. <a href="docs/images/kanban-phone.png">See the phone view.</a></sub></p>

## Small plugins, useful tools

Open **Plugins** in the sidebar and paste a public GitHub repository URL. Review its permissions
and install a pinned commit. **Check for updates** reviews a newer commit while keeping your settings.
Enabled commands also appear in **Ctrl+K**. [**Project tools**](https://github.com/velumix/velum-plugin-project-tools) creates project briefs and
review checklists; results can be added to your draft without sending an AI request.

Plugins have explicit permissions for workspace reads, conversation reads and their own
settings. They cannot access the network, run shell commands, write project files, or inject UI.
Each command gets a fresh worker with a five-second limit. Plugin code stays unloaded while idle.

Want to make one? The [SDK guide](docs/plugins.md) covers the API, starter generator,
TypeScript builds, distribution, and limits. The SDK and working example are in this repository.

<p align="center"><a href="docs/images/plugins.png"><img src="docs/images/plugins.png" alt="Velum Code running the Project tools plugin with a local project brief" width="720" /></a></p>

## Reopen and carry on

Velum saves open Agent tabs, drafts, selected models and recent conversation history locally.
Reopening after Quit or a Windows restart resumes the original CLI conversation when its
provider resume ID is available. A crashed or interrupted turn is marked as stopped and is
never rerun automatically.

Native checkpoints are written approximately once a second and flushed on normal exit.
A crash may lose changes since the last checkpoint. Recovery keeps up to 32 open conversations,
2 MB of recent events per conversation, and drafts up to 64,000 characters each within a shared
storage budget. Older display history may be trimmed; provider context remains in the CLI's
own session. Terminal processes and terminal scrollback are not restored.

Closing a conversation removes Velum's saved transcript and draft for that tab. Provider logs
and memory-vault notes are separate. Recovery files are local plaintext in the app's configuration
directory; this is recovery for open conversations, not a permanent chat archive.

## A few shortcuts worth knowing

| Shortcut | Action |
| :-- | :-- |
| `Ctrl+K` | Open the command palette |
| `Ctrl+T` | Start a new conversation |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch conversations |
| `Ctrl+1` … `Ctrl+9` | Jump to a conversation |
| `Ctrl+L` | Focus the message input |
| `Enter` / `Shift+Enter` | Send / add a new line |
| `Ctrl+F` | Search the terminal |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom the terminal in / out / reset |

## Build from source

Install Node.js 24, rustup, the Windows MSVC build tools, and a supported CLI. The tested Node and Rust versions are pinned in [`.node-version`](.node-version) and [`rust-toolchain.toml`](rust-toolchain.toml).

```powershell
git clone https://github.com/velumix/VelumCode.git
cd VelumCode
npm.cmd ci
npm.cmd run tauri dev
```

Build and install the Windows bundle:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -Build
```

The app uses **Tauri 2 + Rust**, **React 19 + TypeScript**, and **xterm.js over Windows ConPTY**. Chat translates each CLI’s structured output into shared messages, tool cards and turn status. Tray lifetime and notification delivery run in the native backend.

See the [development guide](docs/development.md) for tests, native smoke checks, installer commands, and the project layout. The [0.4.0 QA report](docs/qa-0.4.0.md) records the verified behavior and remaining work; the [brand notes](docs/brand.md) cover the logo and assets.

## Where it stands

Automated checks cover desktop and phone interactions, pairing and access controls, reconnects,
and the native agent runner. Windows smoke tests exercise tray behavior, notifications, and
process cleanup. [Windows CI](https://github.com/velumix/VelumCode/actions/workflows/windows.yml)
checks the code and builds the installer. The optional remote smoke test also exercises the
installed Tailscale connection; see the [development guide](docs/development.md).

There are still a few things I want to improve:

- **Browse older conversations.** Open conversations recover automatically; a searchable archive of closed conversations is not included yet.
- **Interactive approvals in chat.** Chat cannot answer interactive approval prompts; each provider follows the policy described above. The terminal is available for interactive workflows.
- **Easier project switching.** A folder picker, recent workspaces, and clearer project navigation are on the list.

Agent and Terminal are separate conversations within a tab. Terminal work keeps running in the tray, but completion notifications currently come from structured Agent turns. Changing a tab's workspace intentionally starts a fresh session.

---

<p align="center">
  Built by <a href="https://github.com/velumix"><strong>Velumix</strong></a>.<br />
  <sub>Built for the way I wanted to work.</sub>
</p>
