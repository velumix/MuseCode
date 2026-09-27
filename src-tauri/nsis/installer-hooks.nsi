; Velum Code custom NSIS installer hooks.
;
; This file is !included near the top of Tauri's generated installer.nsi,
; BEFORE ${PRODUCTNAME} and friends are defined. Consequences:
;  - Top-level !defines below must use literal text (no ${PRODUCTNAME}).
;  - Inside the NSIS_HOOK_* macros ${PRODUCTNAME} etc. ARE available,
;    because macros expand at their !insertmacro site (after the defines).

; --- Branded wizard pages (literal text only, see note above) ---
!define MUI_WELCOMEPAGE_TITLE "Welcome to Velum Code Setup"
!define MUI_WELCOMEPAGE_TEXT "Velum Code is a desktop home for Muse, Codex and Antigravity.$\r$\n$\r$\nThis wizard will install Velum Code on your computer.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_TITLE "Velum Code is installed"
!define MUI_FINISHPAGE_TEXT "Velum Code was installed successfully.$\r$\n$\r$\nKeep $\"Run Velum Code$\" checked and click Finish to launch it."
BrandingText "Velum Code Setup"

!macro NSIS_HOOK_PREINSTALL
  ; Keep the stable app identity/data, while removing the old product entry
  ; and shortcuts. The previous uninstaller retains app data in silent mode.
  IfFileExists "$LOCALAPPDATA\Muse Code\uninstall.exe" 0 velum_migration_done
  ExecWait '"$LOCALAPPDATA\Muse Code\uninstall.exe" /S _?=$LOCALAPPDATA\Muse Code' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Close Muse Code and run this installer again." /SD IDOK
    Abort
  ${EndIf}
  Delete "$LOCALAPPDATA\Muse Code\uninstall.exe"
  RMDir "$LOCALAPPDATA\Muse Code"
  velum_migration_done:
  ; This orphaned custom icon was not owned by the old uninstaller.
  Delete "$LOCALAPPDATA\Muse Code\muse-folded-m.ico"
  RMDir "$LOCALAPPDATA\Muse Code"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Silent upgrades keep old resource files unless explicitly removed.
  Delete "$INSTDIR\muse-notification.png"
  ; Native toast identity and COM activation, including Notification Center.
  ; NSIS runs as a 32-bit process; the COM server is the 64-bit app.
  SetRegView 64
  WriteRegStr HKCU "Software\Classes\AppUserModelId\com.velumix.musecode" "DisplayName" "Velum Code"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\com.velumix.musecode" "IconUri" "$INSTDIR\velum-notification.png"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\com.velumix.musecode" "CustomActivator" "{31C4BDC3-41CE-4B6E-99AB-502F4549295F}"
  WriteRegStr HKCU "Software\Classes\CLSID\{31C4BDC3-41CE-4B6E-99AB-502F4549295F}\LocalServer32" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --toast-activated'
  SetRegView lastused
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
