mod desktop;
mod events;
mod pty;
mod runner;

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
        .manage(AgentState::default())
        .setup(desktop::setup)
        .on_window_event(desktop::close_to_tray)
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            runner::agent_new,
            runner::agent_validate_workspace,
            runner::agent_send,
            runner::agent_stop,
            runner::agent_destroy,
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
                desktop::shutdown(app);
                app.state::<AgentState>().shutdown();
                app.state::<PtyState>().shutdown();
            }
        });
}
