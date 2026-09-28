import { expect, type Page } from "@playwright/test";
// Exercise the real React UI and xterm with a controlled IPC boundary.
// Native process/CLI behavior is covered separately; no provider calls here.
export async function boot(page: Page, delay = 0) {
  await page.addInitScript(
    ({ delay }) => {
      const w = window as any;
      w.isTauri = true;
      const callbacks = new Map();
      const listeners = new Map();
      let serial = 0;
      const api = (w.qa = {
        calls: [] as any[],
        sessions: new Map(),
        failSend: false,
        antigravityInstalled: false,
        auth: {
          phase: "code",
          url: "https://accounts.google.com/o/oauth2/auth?state=fixture&code_challenge=test",
          message:
            "Sign in with Google, then paste the code from your browser.",
        },
        remote: {
          enabled: false,
          url: null as string | null,
          error: null,
          devices: [] as any[],
          pending: null as any,
          usb: null as any,
          tailscale: {
            installed: true,
            connected: true,
            hostname: "desktop.tail.ts.net",
            message: "Connected to your private network.",
          },
        },
        desktop: { notifications_enabled: true, last_error: null },
        pendingNavigation: null as string | null,
        emit(event: string, payload: unknown) {
          for (const [id, entry] of listeners) {
            if (entry.event === event)
              callbacks.get(entry.handler)?.({ event, id, payload });
          }
        },
        agent(event: unknown) {
          const last = api.calls
            .filter((c: any) => c.cmd === "agent_send")
            .at(-1);
          api.emit("agent-event", { id: last.args.id, event });
        },
        listenerCount() {
          return listeners.size;
        },
      });
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(fn: unknown) {
          const id = ++serial;
          callbacks.set(id, fn);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(cmd: string, args: any = {}) {
          api.calls.push({ cmd, args });
          if(cmd==='bots_request'){
            const q=args.request;let profiles=JSON.parse(localStorage.getItem('qa-bots')||'[]');
            if(q.action==='save'){if(api.botConflict)throw 'This bot was edited elsewhere. Reload before saving.';profiles=[...profiles.filter((b:any)=>b.id!==q.profile.id),{...q.profile,revision:`r${++serial}`}];}
            if(q.action==='delete')profiles=profiles.filter((b:any)=>b.id!==q.id);
            localStorage.setItem('qa-bots',JSON.stringify(profiles));return {profiles,root:'C:\\Bots',warnings:[]};
          }
          if(cmd==='automation_request'){
            const q=args.request;api.jobs||={enabled:true,jobs:[],runs:[],warning:null};
            if(q.action==='preview'){if(q.timezone==='invalid')throw 'Choose an IANA timezone';return {times:[1800000000,1800000900,1800001800]};}
            if(q.action==='configure')api.jobs.enabled=q.enabled;
            const job=api.jobs.jobs.find((j:any)=>j.id===q.id);
            if(q.action==='pause')job.paused=q.paused;
            if(q.action==='run')job.status='running';
            if(q.action==='stop'){job.status='cancelled';job.paused=true;}
            return structuredClone(api.jobs);
          }
          if (cmd === "kanban_request") {
            const key = `qa-board:${args.workspace}`;
            const board = JSON.parse(localStorage.getItem(key) || '{"revision":0,"cards":[]}');
            const q = args.request;
            board.trash ||= [];
            if(q.action !== "load") {
              if(api.boardConflict || board.revision !== q.revision) throw "This board changed on another screen. Refresh the board before trying again. Your unsaved card is still here.";
              if(q.action === "save") { const index=board.cards.findIndex((c:any)=>c.id===q.card.id);if(index<0)board.cards.push(q.card);else board.cards[index]=q.card; }
              if(q.action === "delete") {board.trash.unshift({card:board.cards.find((c:any)=>c.id===q.id),deleted_at:Date.now()/1000});board.cards=board.cards.filter((c:any)=>c.id!==q.id);}
              if(q.action === "restore") {const card=board.trash.find((e:any)=>e.card.id===q.id).card;if(card.assignment)card.assignment.automatic=false;card.last_run=null;board.cards.push(card);board.trash=board.trash.filter((e:any)=>e.card.id!==q.id);}
              if(q.action === "purge")board.trash=board.trash.filter((e:any)=>e.card.id!==q.id);
              if(q.action === "move") {const c=board.cards.find((c:any)=>c.id===q.id);board.cards=board.cards.filter((c:any)=>c.id!==q.id);c.column=q.column;const i=q.before?board.cards.findIndex((c:any)=>c.id===q.before):board.cards.length;board.cards.splice(i,0,c);}
              board.revision++;localStorage.setItem(key,JSON.stringify(board));
            }
            return structuredClone(board);
          }
          if (cmd === "memory_request" || cmd==='bots_memory') {
            const key=cmd==='bots_memory'?`memory:${args.id}`:'memory';
            api[key] ||= {
              root: "C:\\Documents\\Velum Code\\Memory",
              settings: {
                enabled: true,
                capture: "review",
                budget_bytes: 3000,
              },
              notes: [],
              warning: null,
            };
            const q = args.request,
              m = api[key];
            if (q.action === "configure") m.settings = q.settings;
            if (q.action === "delete")
              m.notes = m.notes.filter((n: any) => n.id !== q.id);
            if (q.action === "save") {
              if (api.holdMemorySave) await new Promise<void>(resolve => { api.releaseMemorySave = resolve; });
              if (api.memoryConflict)
                throw "This note changed elsewhere. Refresh to load the latest copy before saving.";
              const note = {
                ...q,
                id: q.id || `note-${++serial}`,
                revision: `r-${serial}`,
                source: "Saved by you",
                created_at: 1,
                updated_at: 1,
              };
              m.notes = [...m.notes.filter((n: any) => n.id !== note.id), note];
            }
            return structuredClone(m);
          }
          if (cmd === "provider_models")
            return api.failModels
              ? { models: [], notice: "Sign in to load models." }
              : {
                  models: [
                    {
                      id: `${args.provider}-deep`,
                      label: "Deep model",
                      description: "Complex work",
                      efforts: ["low", "high", "max"],
                      default_effort: "high",
                    },
                    {
                      id: `${args.provider}-fast`,
                      label: "Fast model",
                      description: "Quick work",
                      efforts: ["low"],
                      default_effort: "low",
                    },
                    {
                      id: `${args.provider}-basic`,
                      label: "Basic model",
                      description: "No reasoning controls",
                      efforts: [],
                      default_effort: "",
                    },
                  ],
                  notice: null,
                  defaults: api.modelDefaults,
                };
          if (cmd === "agent_configure") {
            if (api.failConfigure) throw "Wait for the current response.";
            api.emit("agent-options", {
              tab_id: args.tabId,
              options: args.options,
            });
            return;
          }
          if (cmd === "provider_status")
            return ["muse", "codex", "antigravity"].map((id) => ({
              id,
              installed: id !== "antigravity" || api.antigravityInstalled,
              setup_url:
                "https://antigravity.google/docs/getting-started?tab=cli",
            }));
          if (cmd === "antigravity_login_status") return { ...api.auth };
          if (cmd === "antigravity_login_submit") {
            api.auth = {
              phase: "complete",
              url: "",
              message: "Antigravity is connected.",
            };
            return;
          }
          if (cmd === "remote_status" || cmd === "remote_check_tailscale")
            return { ...api.remote };
          if (cmd === "remote_usb_devices")
            return [
              { serial: "PIXEL_TEST", name: "Pixel 7 Pro", authorized: true },
              { serial: "LOCKED", name: "Android phone", authorized: false },
            ];
          if (cmd === "remote_usb_connect") {
            api.remote.usb = {
              serial: args.serial,
              name: "Pixel 7 Pro",
              authorized: true,
            };
            return { ...api.remote };
          }
          if (cmd === "remote_usb_disconnect") {
            api.remote.usb = null;
            return { ...api.remote };
          }
          if (cmd === "remote_enable") {
            api.remote.enabled = args.enabled;
            api.remote.url = args.enabled
              ? "https://desktop.tail.ts.net:8443"
              : null;
            return { ...api.remote };
          }
          if (cmd === "remote_pair")
            return {
              url: "https://desktop.tail.ts.net:8443/#pair=test",
              code: "482196",
              expires_at: Math.floor(Date.now() / 1000) + 120,
              svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/></svg>',
            };
          if (cmd === "remote_approve") {
            api.remote.devices.push({
              id: "phone",
              name: api.remote.pending.name,
              control: args.control,
              created_at: Math.floor(Date.now() / 1000),
            });
            api.remote.pending = null;
            return;
          }
          if (cmd === "remote_cancel_pairing") {
            api.remote.pending = null;
            return;
          }
          if (cmd === "remote_revoke") {
            api.remote.devices = api.remote.devices.filter(
              (d: any) => d.id !== args.id,
            );
            return;
          }
          if (cmd === "desktop_status") return api.desktop;
          if (cmd === "desktop_set_notifications") {
            api.desktop.notifications_enabled = args.enabled;
            return { ...api.desktop };
          }
          if (cmd === "desktop_take_navigation") {
            const id = api.pendingNavigation;
            api.pendingNavigation = null;
            return id;
          }
          if (cmd === "plugin:event|listen") {
            if (delay) await new Promise((r) => setTimeout(r, delay));
            const id = ++serial;
            listeners.set(id, args);
            return id;
          }
          if (cmd === "plugin:event|unlisten") {
            listeners.delete(args.eventId);
            return;
          }
          if (cmd === "agent_validate_workspace") {
            if (args.workspace?.includes('denied')) throw 'Velum cannot list this folder. Check Windows folder access.';
            if (args.workspace?.includes("missing"))
              throw "workspace is not a directory";
            return args.workspace || "C:\\QA";
          }
          if (cmd === 'workspace_pick') return api.pickedFolder || null;
          if (cmd === 'workspace_check') return {path:args.workspace,checked_at:1800000001,readable:true,writable:!api.readOnlyFolder,message:api.readOnlyFolder ? 'Folder listing works; creating a file failed. Read-only work is still available.' : 'Folder listing and temporary-file creation passed.'};
          if (cmd === 'app_diagnostics') {
            if (api.failDiagnostics) throw 'Diagnostics unavailable';
            return {app:'Velum Code',version:'0.6.1',host_os:'windows',checked_at:1800000000,workspace:{path:'<selected-project>',directory_listing:true,git_repository:true,write_access:'not checked',message:'Folder listing passed. Write access and CLI tool permissions have not been tested.'},providers:[{provider:'muse',installed:true,authentication:'not checked',tool_connections:'not checked'},{provider:'antigravity',installed:true,authentication:'not checked',tool_connections:'not checked'}],memory:{readable:true,enabled:true,notes:2,budget_bytes:3000,capture:'review'},sessions:{active:0,failed:0,blocked:0}};
          }
          if (cmd === "agent_new") {
            if (delay) await new Promise((r) => setTimeout(r, delay));
            if (args.workspace?.includes("missing"))
              throw "workspace is not a directory";
            api.sessions.set(args.id, "agent");
            const bot=JSON.parse(localStorage.getItem('qa-bots')||'[]').find((b:any)=>b.id===args.botId);
            if(bot)api.emit('agent-event',{id:args.id,event:{kind:'bot_identity',bot}});
            return {
              id: args.id,
              session_id: `native-${args.id}`,
              workspace: args.workspace || "C:\\QA",
            };
          }
          if (cmd === "agent_send") {
            if (api.failSend) throw "Could not launch muse";
            return { id: args.id, turn_id: "turn" };
          }
          if (cmd === "agent_stop") {
            api.emit("agent-event", {
              id: args.id,
              event: { kind: "turn_end", status: "cancelled" },
            });
            return;
          }
          if (cmd === "agent_destroy" || cmd === "pty_kill") {
            api.sessions.delete(args.id);
            return;
          }
          if (cmd === "pty_spawn") {
            api.sessions.set(args.id, "terminal");
            setTimeout(
              () =>
                api.emit("pty-data", {
                  id: args.id,
                  data: "hello terminal\r\nsearch target\r\n",
                }),
              30,
            );
            return { id: args.id, backend: "fixture muse" };
          }
          if (cmd === "plugin:window|is_maximized") return false;
        },
      };
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener(_event: string, id: number) {
          listeners.delete(id);
        },
      };
    },
    { delay },
  );
  await page.goto("/");
  await expect(page.locator(".chat-wrap:not(.hidden) textarea")).toBeEnabled();
  await expect(page.locator(".model-controls")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
