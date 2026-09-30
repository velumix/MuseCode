param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
# This reader deliberately omits FileShare.Delete, as some Windows readers do.
# A line on stdin releases the lock; the test controls its lifetime explicitly.
$reader = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
try {
  [Console]::WriteLine('LOCKED')
  [Console]::Out.Flush()
  [Console]::ReadLine() | Out-Null
} finally {
  $reader.Dispose()
}
