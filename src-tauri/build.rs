fn main() {
    tauri_build::build();
    // HTTP integration tests also link Tauri's Windows asset resolver. Their
    // test executables need Common Controls v6, just like the packaged app.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
        // Tauri already embeds the full application manifest in resource.lib.
        // Suppress the linker's extra copy for the desktop executable only.
        println!("cargo:rustc-link-arg-bin=muse-code-app=/MANIFEST:NO");
    }
}
