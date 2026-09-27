mod desktop;
mod events;
mod history;
mod kanban;
mod memory;
mod plugin_github;
mod plugins;
mod provider_auth;
mod provider_events;
mod provider_models;
mod providers;
mod pty;
mod remote;
mod remote_auth;
mod runner;
mod session_log;
mod storage;
mod tailscale;
mod usb;

use pty::PtyState;
use runner::AgentState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show(app, None)
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(PtyState::default())
        .manage(provider_auth::AuthState::default())
        .manage(AgentState::default())
        .manage(session_log::SessionLog::default())
        .setup(|app| {
            memory::setup(app.handle());
            plugins::setup(app.handle());
            kanban::setup(app.handle());
            history::setup(app.handle());
            desktop::setup(app)?;
            remote::setup(app)
        })
        .on_window_event(desktop::close_to_tray)
        .invoke_handler(tauri::generate_handler![
            memory::memory_request,
            kanban::kanban_request,
            memory::memory_open,
            plugins::plugins_list,
            plugins::plugins_preview,
            plugins::plugins_install,
            plugins::plugins_enable,
            plugins::plugins_remove,
            plugins::plugins_source,
            plugins::plugins_call,
            history::history_forget,
            history::history_desktop_save,
            history::history_draft_save,
            history::history_desktop_load,
            pty::pty_spawn,
            providers::provider_status,
            provider_models::provider_models,
            runner::agent_configure,
            provider_auth::antigravity_login_start,
            provider_auth::antigravity_login_status,
            provider_auth::antigravity_login_submit,
            provider_auth::antigravity_login_cancel,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            runner::agent_new,
            runner::agent_validate_workspace,
            runner::agent_send,
            runner::agent_stop,
            runner::agent_destroy,
            remote::remote_status,
            remote::remote_usb_devices,
            remote::remote_usb_connect,
            remote::remote_usb_disconnect,
            remote::remote_check_tailscale,
            remote::remote_enable,
            remote::remote_pair,
            remote::remote_approve,
            remote::remote_cancel_pairing,
            remote::remote_revoke,
            desktop::desktop_status,
            desktop::desktop_set_notifications,
            desktop::desktop_test_notification,
            desktop::desktop_take_navigation,
            desktop::desktop_show,
            desktop::desktop_quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                remote::shutdown(app);
                desktop::shutdown(app);
                app.state::<AgentState>().shutdown();
                history::shutdown(app);
                app.state::<PtyState>().shutdown();
                app.state::<provider_auth::AuthState>().shutdown();
            }
        });
}
