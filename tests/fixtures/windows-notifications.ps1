param(
  [ValidateSet('History', 'Activate')][string]$Action = 'History',
  [string]$Conversation
)
$ErrorActionPreference = 'Stop'
$appId = 'com.velumix.musecode'

if ($Action -eq 'History') {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
  $items = @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId) | ForEach-Object {
    [pscustomobject]@{ tag = $_.Tag; group = $_.Group; xml = $_.Content.GetXml() }
  })
  ConvertTo-Json -InputObject $items -Compress
  exit
}

# Exercise the same registered COM interface used by Windows when a toast is
# clicked, without driving unrelated desktop windows or relying on banner timing.
if ($Conversation -notmatch '^[A-Za-z0-9_-]{1,96}$') { throw 'Invalid test conversation id' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("53E31837-6600-4A81-9395-75CFFE746F94"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMuseNotificationActivation {
  void Activate([MarshalAs(UnmanagedType.LPWStr)] string appId,
                [MarshalAs(UnmanagedType.LPWStr)] string arguments,
                IntPtr userData, uint userDataCount);
}
public static class MuseNotificationProbe {
  public static void Activate(string appId, string conversation) {
    var type = Type.GetTypeFromCLSID(new Guid("31C4BDC3-41CE-4B6E-99AB-502F4549295F"));
    var instance = Activator.CreateInstance(type);
    try { ((IMuseNotificationActivation)instance).Activate(appId, "conversation:" + conversation, IntPtr.Zero, 0); }
    finally { Marshal.FinalReleaseComObject(instance); }
  }
}
'@
[MuseNotificationProbe]::Activate($appId, $Conversation)
