<#
.SYNOPSIS
  Test and build a signed Android APK. Signing material stays outside the repo.
.EXAMPLE
  .\scripts\build-android.ps1
#>
param([switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $env:JAVA_HOME) {
  $env:JAVA_HOME = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'Machine')
  if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'jdk-17*' } | Select-Object -Last 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
  }
}
if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw 'Install JDK 17 and set JAVA_HOME.' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path "$env:ANDROID_HOME\platforms\android-36\android.jar")) { throw 'Install Android SDK platform 36 and build-tools 35.0.0, then set ANDROID_HOME.' }

$priorKeystore = $env:MUSE_ANDROID_KEYSTORE
$priorPassword = $env:MUSE_ANDROID_STORE_PASSWORD
try {
  if (-not $DebugBuild) {
    $signingDir = Join-Path $env:LOCALAPPDATA 'MuseCode\AndroidSigning'
    New-Item -ItemType Directory -Force -Path $signingDir | Out-Null
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @($identity, (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))) {
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
    }
    [System.IO.Directory]::SetAccessControl($signingDir, $acl)
    $credentialPath = Join-Path $signingDir 'password.clixml'
    $env:MUSE_ANDROID_KEYSTORE = Join-Path $signingDir 'musecode.p12'
    if (-not (Test-Path -LiteralPath $credentialPath)) {
      if (Test-Path -LiteralPath $env:MUSE_ANDROID_KEYSTORE) { throw 'Signing key exists but its saved password is missing. Restore it before building an update.' }
      $bytes = New-Object byte[] 32
      $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
      try { $random.GetBytes($bytes) } finally { $random.Dispose() }
      $secure = ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
      $credential = New-Object System.Management.Automation.PSCredential('musecode', $secure)
      $credential | Export-Clixml -LiteralPath $credentialPath
    }
    $credential = Import-Clixml -LiteralPath $credentialPath
    $env:MUSE_ANDROID_STORE_PASSWORD = $credential.GetNetworkCredential().Password
    if (-not (Test-Path -LiteralPath $env:MUSE_ANDROID_KEYSTORE)) {
      & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $env:MUSE_ANDROID_KEYSTORE -storetype PKCS12 `
        -storepass:env MUSE_ANDROID_STORE_PASSWORD -keypass:env MUSE_ANDROID_STORE_PASSWORD `
        -alias musecode -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=MuseCode, O=Velumix'
      if ($LASTEXITCODE -ne 0) { throw 'Could not create the Android signing key.' }
    }
  }
  Push-Location (Join-Path $root 'android')
  try {
    $variant = if ($DebugBuild) { 'Debug' } else { 'Release' }
    & .\gradlew.bat --no-daemon --console=plain :app:testDebugUnitTest ":app:lint$variant" ":app:assemble$variant"
    if ($LASTEXITCODE -ne 0) { throw 'Android checks or build failed.' }
  } finally { Pop-Location }
  $lowerVariant = $variant.ToLowerInvariant()
  $apk = Join-Path $root "android\app\build\outputs\apk\$lowerVariant\app-$lowerVariant.apk"
  & "$env:ANDROID_HOME\build-tools\35.0.0\apksigner.bat" verify --verbose $apk
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
  $outputDir = Join-Path $root 'artifacts\android'
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
  $outputName = if ($DebugBuild) { 'VelumCode-Android-debug.apk' } else { 'VelumCode-0.3.0.apk' }
  $output = Join-Path $outputDir $outputName
  Copy-Item -LiteralPath $apk -Destination $output -Force
  $hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$output.sha256" -Value "$hash  $outputName" -Encoding ascii
  Write-Output "APK ready: $output"
} finally {
  $env:MUSE_ANDROID_KEYSTORE = $priorKeystore
  $env:MUSE_ANDROID_STORE_PASSWORD = $priorPassword
}
