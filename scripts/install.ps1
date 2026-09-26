<#
.SYNOPSIS
  Install (or uninstall) Muse Code from the local NSIS bundle.
.DESCRIPTION
  Builds the release installer on demand with -Build (or when the bundle is
  missing), then runs it silently and verifies the install. With -Uninstall,
  removes the app and verifies it is gone.
.EXAMPLE
  .\scripts\install.ps1 -Build
.EXAMPLE
  .\scripts\install.ps1 -Build -Launch
.EXAMPLE
  .\scripts\install.ps1 -Uninstall
#>
param(
  [switch]$Build,
  [switch]$Launch,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$conf = Get-Content (Join-Path $root 'src-tauri\tauri.conf.json') | ConvertFrom-Json
$product = $conf.productName
$version = $conf.version
$installer = Join-Path $root "src-tauri\target\release\bundle\nsis\$product`_$version`_x64-setup.exe"
$installDir = Join-Path $env:LOCALAPPDATA $product
$exe = Join-Path $installDir 'muse-code-app.exe'

if ($Uninstall) {
  $un = Join-Path $installDir 'uninstall.exe'
  if (-not (Test-Path $un)) { throw "Uninstaller not found: $un (is $product installed?)" }
  $p = Start-Process -FilePath $un -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
  if ($p.ExitCode -ne 0) { throw "Uninstaller exited with code $($p.ExitCode)" }
  Start-Sleep -Seconds 2
  if (Test-Path $installDir) { throw "Uninstall verification failed: $installDir still exists" }
  Write-Output "Uninstalled $product $version"
  exit 0
}

if ($Build -or -not (Test-Path $installer)) {
  $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH', 'User')
  Set-Location $root
  # tauri/cargo log progress to stderr; under $ErrorActionPreference='Stop' that
  # is fatal when the caller merges stderr (2>&1). Relax it for this one call;
  # the LASTEXITCODE check below still gates failure.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    npx.cmd tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with code $LASTEXITCODE" }
  } finally {
    $ErrorActionPreference = $prevEap
  }
}
if (-not (Test-Path $installer)) { throw "Installer not found: $installer" }

$proc = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
if ($proc.ExitCode -ne 0) { throw "Installer exited with code $($proc.ExitCode)" }
if (-not (Test-Path $exe)) { throw "Install verification failed: $exe missing" }
Write-Output "Installed $product $version -> $exe"

if ($Launch) {
  Start-Process -FilePath $exe
  Write-Output 'Launched.'
}
