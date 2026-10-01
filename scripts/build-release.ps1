<# Build the signed Windows installer using the publisher's local signing key.
   The key and password remain outside the repository and are never printed. #>
param(
  [string]$KeyFile = (Join-Path $env:USERPROFILE '.tauri\velum-code\updater.key'),
  [string]$PasswordFile = (Join-Path $env:USERPROFILE '.tauri\velum-code\updater-password.txt')
)
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Push-Location $releaseRoot
try {
  if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    if (-not (Test-Path -LiteralPath $KeyFile)) { throw 'The publisher signing key is missing. Use tauri.preview.conf.json for an unsigned preview build.' }
    $env:TAURI_SIGNING_PRIVATE_KEY = $KeyFile
    if (Test-Path -LiteralPath $PasswordFile) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [IO.File]::ReadAllText($PasswordFile).Trim() }
  }
  node scripts/release-manifest.mjs --version-only
  if ($LASTEXITCODE -ne 0) { throw 'Release versions do not match.' }
  npm.cmd run tauri -- build --ci --bundles nsis
  if ($LASTEXITCODE -ne 0) { throw "Release build failed with code $LASTEXITCODE." }
  node scripts/release-manifest.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the signed updater feed.' }
} finally {
  $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousPassword
  Pop-Location
}
