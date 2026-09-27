# VelumCode for Android

The Android companion is an installable APK with VelumCode's icon, an offline-capable QR
scanner, and a private WebView for the desktop's existing phone interface. It supports
Android 8 and newer, including Pixel 7 Pro and Pixel 9. The desktop runs your selected coding agent; the APK does not run a local
agent or replace the Tailscale VPN app.

## Install on a Pixel

1. Transfer `VelumCode-0.3.0.apk` to the phone using Bluetooth, Quick Share, or USB.
2. Open the received APK in Files. Allow **Install unknown apps** for the app opening it
   if Android asks, then install VelumCode. You can turn that permission off afterward.
3. For wireless access, install the official Tailscale Android app and connect it to the desktop's tailnet. For USB, use the steps below instead.
4. Open **Connect phone** in desktop VelumCode, enable remote access, and show a fresh QR.
5. Open the VelumCode Android app, tap **Scan desktop QR**, and allow camera access.
6. Name the phone and approve the matching six-digit code on the desktop.

The APK has its own cookie store. Pair it once even if you already paired Chrome. It
remembers the desktop and login for later launches. If you forget the desktop, clear app
data, or uninstall, pair again. Use **Connected devices** on the desktop to revoke access.

The top-right connection menu has reload, scan, enter-link, Tailscale, and forget controls.
Camera permission is only used by the native scanner; nothing is uploaded by the scanner.
The entry screen explains how to reconnect when the desktop or Tailscale is unavailable.
The same [remote access limits](remote-access.md) apply, including no Android push
notifications yet. Android can reclaim a background app, which loses an unsent draft.

## Connect over USB without Tailscale

1. Install the APK on the phone and [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) on Windows. VelumCode finds ADB in the standard Android SDK location, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or `PATH`.
2. On the Pixel, open **Settings → About phone**, tap **Build number** seven times, then enable **Settings → System → Developer options → USB debugging**.
3. Plug in a USB data cable, unlock the phone, and allow USB debugging for this computer.
4. In desktop VelumCode, open **Connect phone → USB cable**, then choose **Connect** beside the phone. The Android app opens automatically.
5. Name the phone, tap **Pair with desktop**, and approve the matching code on the desktop.

The cable carries the same live conversations, send, and stop controls. Wi-Fi and Tailscale
are unnecessary. The desktop can stay in its tray. After unplugging, restarting ADB, or
restarting VelumCode, reconnect the cable and choose **Reconnect** (or **Connect**) in the
desktop panel. A paired phone keeps its login; USB and Tailscale logins are separate.
Choose **Disconnect USB** to stop the cable connection, or revoke its paired device to
remove its saved access. USB debugging authorizes this computer for Android development
commands; only allow computers you trust.

## Build from source

Use JDK 17 and Android SDK platform 36 / build-tools 35.0.0. Point `JAVA_HOME` and
`ANDROID_HOME` at those installations. The checked-in Gradle 8.13 wrapper verifies its
distribution checksum; Android Gradle Plugin is pinned to 8.13.2.

On Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1
```

This runs Android unit tests and lint, creates a release APK, verifies its signature,
and writes `artifacts/android/VelumCode-0.3.0.apk` plus a SHA-256 file. The first build
creates an RSA signing key in `%LOCALAPPDATA%\MuseCode\AndroidSigning`, outside the repo.
The directory is limited to the current Windows user and SYSTEM; its saved password is
protected by Windows DPAPI. Keep this signing material safe: future updates need the same
key. A machine/account migration requires securely exporting and restoring the key and
password; copying the DPAPI file to another account does not recover its password.

For a debug build on any supported host:

```sh
cd android
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

The Android CI artifact is a **debug preview** with a separate application ID, so it does
not overwrite the locally signed app. CI debug keys are temporary; previews from different
runs may need the previous preview uninstalled. Keep using the locally signed APK for
updates that preserve pairing. No private signing material is uploaded to GitHub.

## Connection boundaries

Only HTTPS addresses of the form `device.tailnet.ts.net:8443` can be saved as desktops.
QR invitations stay in memory; only the origin is saved in preferences. Desktop cookies
remain in the app's private WebView store and are excluded from Android backup/transfer.
SSL failures are never bypassed. Cleartext, mixed content, file/content access, third-party
cookies, web camera/microphone permissions, and a native JavaScript bridge are disabled.
Off-origin links open in the system browser only after a user gesture. Remote content
cannot choose a new in-app desktop or call Android APIs.

The scanner uses [ZXing Android Embedded](https://github.com/journeyapps/zxing-android-embedded)
under Apache 2.0. Third-party license text is included in the APK's assets.
