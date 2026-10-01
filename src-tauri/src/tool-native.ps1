$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class VelumNative {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Key { public ushort Vk, Scan; public uint Flags, Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint Data,Flags,Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Payload { [FieldOffset(0)] public Key Key; [FieldOffset(0)] public Mouse Mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public Payload Payload; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n,Input[] i,int size);
  public static string Title(IntPtr h) { var s=new StringBuilder(256);GetWindowText(h,s,256);return s.ToString(); }
  public static IntPtr[] Windows() { var list=new List<IntPtr>();EnumWindows((h,p)=>{if(IsWindowVisible(h)&&!IsIconic(h)&&Title(h).Length>0)list.Add(h);return true;},IntPtr.Zero);return list.ToArray(); }
  public static bool KeyPress(ushort key) { var a=new Input[2];for(int i=0;i<2;i++){a[i].Type=1;a[i].Payload.Key.Vk=key;a[i].Payload.Key.Flags=(uint)(i*2);}return SendInput(2,a,Marshal.SizeOf(typeof(Input)))==2; }
  public static bool Text(string s) { foreach(char c in s){var a=new Input[2];for(int i=0;i<2;i++){a[i].Type=1;a[i].Payload.Key.Scan=c;a[i].Payload.Key.Flags=(uint)(4+i*2);}if(SendInput(2,a,Marshal.SizeOf(typeof(Input)))!=2)return false;}return true; }
  public static bool Click() { var a=new Input[2];a[0].Payload.Mouse.Flags=2;a[1].Payload.Mouse.Flags=4;return SendInput(2,a,Marshal.SizeOf(typeof(Input)))==2; }
}
'@
  [void][VelumNative]::SetProcessDpiAwarenessContext([IntPtr](-4))
  $argsData = $request.args
  if ($request.tool -eq 'native_windows') {
    $items = @([VelumNative]::Windows() | Select-Object -First 80 | ForEach-Object {
      $rect = New-Object VelumNative+Rect
      if ([VelumNative]::GetWindowRect($_, [ref]$rect)) { @{ window_id=$_.ToInt64().ToString();title=[VelumNative]::Title($_);width=$rect.Right-$rect.Left;height=$rect.Bottom-$rect.Top } }
    })
    @{ windows=$items } | ConvertTo-Json -Depth 6 -Compress
    exit 0
  }
  $windowValue = 0L
  if (-not [long]::TryParse([string]$argsData.window_id, [ref]$windowValue) -or $windowValue -le 0) { throw 'Invalid window ID' }
  $window = [IntPtr]$windowValue
  if (-not [VelumNative]::IsWindowVisible($window) -or [VelumNative]::IsIconic($window)) { throw 'Window is unavailable or minimized' }
  $rect = New-Object VelumNative+Rect
  if (-not [VelumNative]::GetWindowRect($window, [ref]$rect)) { throw 'Window bounds unavailable' }
  $width=$rect.Right-$rect.Left; $height=$rect.Bottom-$rect.Top
  if ($width -le 0 -or $height -le 0 -or $width -gt 4096 -or $height -gt 4096) { throw 'Window dimensions unavailable or exceed capture limit' }
  if ($request.tool -eq 'native_screenshot') {
    $bitmap = New-Object Drawing.Bitmap($width,$height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $stream = New-Object IO.MemoryStream
    try {
      $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)
      $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
      if ($stream.Length -gt 6MB) { throw 'Screenshot exceeds 6 MiB' }
      @{ image_base64=[Convert]::ToBase64String($stream.ToArray()) } | ConvertTo-Json -Compress
    } finally { $graphics.Dispose();$bitmap.Dispose();$stream.Dispose() }
    exit 0
  }
  if ($request.tool -ne 'native_input') { throw 'Unsupported desktop operation' }
  [void][VelumNative]::SetForegroundWindow($window)
  Start-Sleep -Milliseconds 150
  if ([VelumNative]::GetForegroundWindow() -ne $window) { throw 'Windows did not allow focus. Select the window manually and retry.' }
  $performed=$false
  switch ($argsData.action) {
    'click' {
      if ($null -eq $argsData.x -or $null -eq $argsData.y -or $argsData.x -lt 0 -or $argsData.y -lt 0 -or $argsData.x -ge $width -or $argsData.y -ge $height) { throw 'Click coordinates leave the selected window' }
      if (-not [VelumNative]::SetCursorPos($rect.Left+$argsData.x,$rect.Top+$argsData.y)) { throw 'Cursor movement failed' }
      $performed=[VelumNative]::Click()
    }
    'type' { if ($null -eq $argsData.text -or $argsData.text.Length -gt 4000) { throw 'Text input exceeds 4000 characters' };$performed=[VelumNative]::Text([string]$argsData.text) }
    'press' {
      $keys=@{ Enter=13;Tab=9;Escape=27;Backspace=8;ArrowDown=40;ArrowUp=38;ArrowLeft=37;ArrowRight=39 }
      if (-not $keys.ContainsKey([string]$argsData.key)) { throw 'Unsupported key' }
      $performed=[VelumNative]::KeyPress($keys[[string]$argsData.key])
    }
    default { throw 'Unsupported input operation' }
  }
  if (-not $performed) { throw 'Windows rejected native input (possibly an elevated or protected window)' }
  @{ performed=$true; window_id=$windowValue.ToString() } | ConvertTo-Json -Compress
} catch {
  # Do not return raw PowerShell errors, command text or filesystem paths.
  @{ error='Native operation failed or was blocked. Check the window ID, coordinates, focus and Windows application policy.' } | ConvertTo-Json -Compress
}
