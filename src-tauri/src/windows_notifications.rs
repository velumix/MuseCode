//! Native Windows toasts with a COM activator, so Notification Center clicks
//! work after the popup times out. Installer hooks register the same identity.
use std::ffi::c_void;
use tauri::{AppHandle, Manager};
use windows::{
    core::{implement, IUnknown, Interface, Ref, BOOL, GUID, HRESULT, HSTRING, PCWSTR},
    Data::Xml::Dom::XmlDocument,
    Win32::{
        Foundation::{CLASS_E_NOAGGREGATION, E_POINTER},
        System::Com::{
            CoInitializeEx, CoRegisterClassObject, CoRevokeClassObject, CoUninitialize,
            IClassFactory, IClassFactory_Impl, CLSCTX_LOCAL_SERVER, COINIT_MULTITHREADED,
            REGCLS_MULTIPLEUSE,
        },
        UI::Notifications::{
            INotificationActivationCallback, INotificationActivationCallback_Impl,
            NOTIFICATION_USER_INPUT_DATA,
        },
    },
    UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager},
};

const APP_ID: &str = "com.velumix.musecode";
const ACTIVATOR: GUID = GUID::from_u128(0x31c4bdc3_41ce_4b6e_99ab_502f4549295f);
const GROUP: &str = "MuseCode";

struct ComApartment(bool);
impl ComApartment {
    fn enter() -> windows::core::Result<Self> {
        // Notification delivery runs on CLI reader threads as well as Tauri
        // workers. Balance only our own successful COM initialization.
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if result == HRESULT(0x80010106u32 as i32) {
            return Ok(Self(false));
        }
        result.ok()?;
        Ok(Self(true))
    }
}
impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

pub(super) fn navigation_id(argument: &str) -> Option<String> {
    let id = argument.strip_prefix("conversation:")?;
    (!id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
    .then(|| id.to_owned())
}

#[implement(INotificationActivationCallback)]
struct Activator {
    app: AppHandle,
}
impl INotificationActivationCallback_Impl for Activator_Impl {
    fn Activate(
        &self,
        app_id: &PCWSTR,
        arguments: &PCWSTR,
        _data: *const NOTIFICATION_USER_INPUT_DATA,
        _count: u32,
    ) -> windows::core::Result<()> {
        // These strings are supplied by the Windows notification platform.
        if app_id.is_null() || arguments.is_null() {
            return Ok(());
        }
        if unsafe { app_id.to_string()? } != APP_ID {
            return Ok(());
        }
        let argument = unsafe { arguments.to_string()? };
        if argument == "open" || navigation_id(&argument).is_some() {
            super::show(&self.app, navigation_id(&argument));
        }
        Ok(())
    }
}

#[implement(IClassFactory)]
struct ActivatorFactory {
    app: AppHandle,
}
impl IClassFactory_Impl for ActivatorFactory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<'_, IUnknown>,
        iid: *const GUID,
        object: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        if object.is_null() || iid.is_null() {
            return Err(E_POINTER.into());
        }
        // COM requires an initialized out pointer even when construction fails.
        unsafe {
            *object = std::ptr::null_mut();
        }
        if outer.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let activator: INotificationActivationCallback = Activator {
            app: self.app.clone(),
        }
        .into();
        unsafe { activator.query(iid, object).ok() }
    }
    fn LockServer(&self, _lock: BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}

pub(super) fn register_activator(app: &AppHandle) -> windows::core::Result<u32> {
    // Tauri/WebView2 has already initialized COM on this main UI thread.
    let factory: IClassFactory = ActivatorFactory { app: app.clone() }.into();
    unsafe {
        CoRegisterClassObject(
            &ACTIVATOR,
            &factory,
            CLSCTX_LOCAL_SERVER,
            REGCLS_MULTIPLEUSE,
        )
    }
}
pub(super) fn unregister_activator(cookie: u32) {
    let _ = unsafe { CoRevokeClassObject(cookie) };
}

fn xml_escape(value: &str) -> String {
    let mut result = String::new();
    for ch in value.chars() {
        match ch {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&apos;"),
            '\t' | '\n' | '\r' => result.push(ch),
            ch if ch >= ' ' && ch != '\u{fffe}' && ch != '\u{ffff}' => result.push(ch),
            _ => {}
        }
    }
    result
}

fn check_setting(setting: windows::core::Result<NotificationSetting>) -> Result<(), String> {
    match setting {
        Ok(NotificationSetting::Enabled) => Ok(()),
        // Unpackaged apps have no notification settings record until their
        // first Show. Windows still applies global/user policy to that Show.
        Err(error) if error.code() == HRESULT(0x80070490u32 as i32) => Ok(()),
        Err(error) => Err(format!("Could not read Windows notification settings: {error}")),
        Ok(_) => Err("Windows notifications are disabled for Muse Code. Enable them in Settings > System > Notifications.".into()),
    }
}

pub(super) fn send(
    app: &AppHandle,
    title: &str,
    body: &str,
    tab_id: Option<&str>,
) -> Result<(), String> {
    let _apartment = ComApartment::enter().map_err(|e| e.to_string())?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID))
        .map_err(|e| e.to_string())?;
    check_setting(notifier.Setting())?;
    let icon_path = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("notification-icon.png");
    let icon_bytes = include_bytes!("../icons/128x128.png");
    if std::fs::read(&icon_path).ok().as_deref() != Some(icon_bytes) {
        if let Some(parent) = icon_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&icon_path, icon_bytes).map_err(|e| e.to_string())?;
    }
    let icon_uri = tauri::Url::from_file_path(&icon_path)
        .map_err(|_| "The notification icon path is invalid")?;
    let argument = tab_id
        .map(|id| format!("conversation:{id}"))
        .unwrap_or_else(|| "open".into());
    let xml = format!(
        r#"<toast launch="{}"><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text><image placement="appLogoOverride" src="{}"/></binding></visual><actions><action content="Open Muse" arguments="{}" activationType="foreground"/></actions></toast>"#,
        xml_escape(&argument),
        xml_escape(title),
        xml_escape(body),
        xml_escape(icon_uri.as_str()),
        xml_escape(&argument)
    );
    let document = XmlDocument::new().map_err(|e| e.to_string())?;
    document
        .LoadXml(&HSTRING::from(xml))
        .map_err(|e| e.to_string())?;
    let toast = ToastNotification::CreateToastNotification(&document).map_err(|e| e.to_string())?;
    // Stable, short tags replace prior results from the same conversation.
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    argument.hash(&mut hash);
    toast
        .SetTag(&HSTRING::from(format!("{:016x}", hash.finish())))
        .map_err(|e| e.to_string())?;
    toast
        .SetGroup(&HSTRING::from(GROUP))
        .map_err(|e| e.to_string())?;
    notifier
        .Show(&toast)
        .map_err(|e| format!("Windows couldn't show the notification: {e}"))
}

pub(super) fn clear() -> windows::core::Result<()> {
    let _apartment = ComApartment::enter()?;
    ToastNotificationManager::History()?.ClearWithId(&HSTRING::from(APP_ID))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_notification_is_allowed_without_bypassing_known_windows_blocks() {
        assert!(check_setting(Ok(NotificationSetting::Enabled)).is_ok());
        assert!(check_setting(Err(HRESULT(0x80070490u32 as i32).into())).is_ok());
        assert!(check_setting(Ok(NotificationSetting::DisabledForApplication)).is_err());
        assert!(check_setting(Ok(NotificationSetting::DisabledForUser)).is_err());
        assert!(check_setting(Ok(NotificationSetting::DisabledByGroupPolicy)).is_err());
        assert!(check_setting(Err(E_POINTER.into())).is_err());
    }
    #[test]
    fn activations_accept_only_conversation_identifiers() {
        assert_eq!(
            navigation_id("conversation:abc-123_X"),
            Some("abc-123_X".into())
        );
        for invalid in [
            "open",
            "conversation:",
            "conversation:../file",
            "conversation:a&b",
            "https://example.com",
            "conversation:a b",
        ] {
            assert_eq!(navigation_id(invalid), None);
        }
        assert!(navigation_id(&format!("conversation:{}", "a".repeat(97))).is_none());
    }
    #[test]
    fn toast_xml_escapes_markup_and_removes_invalid_controls() {
        assert_eq!(xml_escape("<&\"'>\0"), "&lt;&amp;&quot;&apos;&gt;");
        assert_eq!(xml_escape("你好\nMuse"), "你好\nMuse");
    }
}
