<# Store the publisher's updater key as encrypted GitHub Actions secrets.
   Run after reviewing the release workflow. No secret is printed or passed
   on the gh command line. Existing secrets are replaced only when invoked. #>
param(
  [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
  [string]$Repository = 'velumix/VelumCode',
  [string]$KeyFile = (Join-Path $env:USERPROFILE '.tauri\velum-code\updater.key'),
  [string]$PasswordFile = (Join-Path $env:USERPROFILE '.tauri\velum-code\updater-password.txt')
)
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$releaseConfig = Get-Content -LiteralPath (Join-Path $releaseRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $KeyFile) -or -not (Test-Path -LiteralPath "$KeyFile.pub")) { throw 'Updater key pair is missing.' }
if (-not (Test-Path -LiteralPath $PasswordFile)) { throw 'Updater key password file is missing.' }
if ([IO.File]::ReadAllText("$KeyFile.pub").Trim() -ne $releaseConfig.plugins.updater.pubkey) { throw 'The signing public key does not match the app configuration.' }
# Redirect the exact files: a PowerShell string pipeline can add a newline to
# the password, making GitHub's signing password differ from the local one.
$githubCli = (Get-Command gh -ErrorAction Stop).Source
$keyProcess = Start-Process -FilePath $githubCli -ArgumentList @('secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY', '--repo', $Repository) -RedirectStandardInput $KeyFile -Wait -PassThru -WindowStyle Hidden
if ($keyProcess.ExitCode -ne 0) { throw 'Could not store the updater key in GitHub Actions secrets.' }
$passwordProcess = Start-Process -FilePath $githubCli -ArgumentList @('secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', '--repo', $Repository) -RedirectStandardInput $PasswordFile -Wait -PassThru -WindowStyle Hidden
if ($passwordProcess.ExitCode -ne 0) { throw 'Could not store the updater password in GitHub Actions secrets.' }
Write-Output "Configured encrypted updater signing secrets for $Repository."
