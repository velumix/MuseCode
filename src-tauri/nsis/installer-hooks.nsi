; Muse Code — custom NSIS installer hooks.
;
; This file is !included near the top of Tauri's generated installer.nsi,
; BEFORE ${PRODUCTNAME} and friends are defined. Consequences:
;  - Top-level !defines below must use literal text (no ${PRODUCTNAME}).
;  - Inside the NSIS_HOOK_* macros ${PRODUCTNAME} etc. ARE available,
;    because macros expand at their !insertmacro site (after the defines).

; --- Branded wizard pages (literal text only, see note above) ---
!define MUI_WELCOMEPAGE_TITLE "Welcome to Muse Code Setup"
!define MUI_WELCOMEPAGE_TEXT "Muse Code is a desktop companion for the Muse coding agent.$\r$\n$\r$\nThis wizard will install Muse Code on your computer.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_TITLE "Muse Code is installed"
!define MUI_FINISHPAGE_TEXT "Muse Code was installed successfully.$\r$\n$\r$\nKeep $\"Run Muse Code$\" checked and click Finish to launch it."
BrandingText "Muse Code Setup"

!macro NSIS_HOOK_PREINSTALL
  ; No pre-copy steps.
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Native toast identity and COM activation, including Notification Center.
  ; NSIS runs as a 32-bit process; the COM server is the 64-bit app.
  SetRegView 64
  WriteRegStr HKCU "Software\Classes\AppUserModelId\com.velumix.musecode" "DisplayName" "Muse Code"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\com.velumix.musecode" "IconUri" "$INSTDIR\muse-notification.png"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\com.velumix.musecode" "CustomActivator" "{31C4BDC3-41CE-4B6E-99AB-502F4549295F}"
  WriteRegStr HKCU "Software\Classes\CLSID\{31C4BDC3-41CE-4B6E-99AB-502F4549295F}\LocalServer32" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --toast-activated'
  SetRegView lastused
  ; Muse Code v1 hosts the `muse` CLI inside its terminal view, so flag a
  ; missing CLI right after install. /SD IDOK keeps this safe under /S.
  nsExec::ExecToStack 'cmd /c where muse'
  Pop $0 ; exit code ("0" when found)
  Pop $1 ; command output (discarded)
  ${If} $0 != "0"
    MessageBox MB_ICONEXCLAMATION|MB_OK "Muse Code is installed, but the 'muse' command was not found on your PATH.$\r$\n$\r$\nInstall the Muse CLI and make sure 'muse' works in a terminal, then launch Muse Code." /SD IDOK
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The generated uninstaller already confirms a running app instance.
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  SetRegView 64
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\com.velumix.musecode"
  DeleteRegKey HKCU "Software\Classes\CLSID\{31C4BDC3-41CE-4B6E-99AB-502F4549295F}"
  SetRegView lastused
!macroend
