<#
.SYNOPSIS
  Export the Velum Code brand master to app icons, frontend assets and NSIS artwork.
.DESCRIPTION
  Uses assets/velum-mark.svg as the vector brand master.
  Run from Windows with Node and the project's Tauri CLI installed.
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$masterPath = Join-Path $projectRoot 'assets/velum-mark.svg'
if (-not (Test-Path -LiteralPath $masterPath)) { throw "Missing brand master: $masterPath" }

Push-Location $projectRoot
try {
  & npx.cmd tauri icon $masterPath
  if ($LASTEXITCODE -ne 0) { throw 'Tauri icon export failed.' }
  New-Item -ItemType Directory -Force -Path 'src/assets', 'public', 'src-tauri/nsis' | Out-Null
  Copy-Item -LiteralPath 'src-tauri/icons/128x128@2x.png' -Destination 'src/assets/muse-mark.png'
  Copy-Item -LiteralPath 'src-tauri/icons/32x32.png' -Destination 'public/muse-icon.png'

  $mark = [Drawing.Image]::FromFile((Join-Path $projectRoot 'src-tauri/icons/icon.png'))
  Copy-Item -LiteralPath 'src/assets/muse-mark.png' -Destination 'android/app/src/main/res/drawable-nodpi/muse_mark.png'
  foreach ($size in @(192, 512)) {
    $pwa = [Drawing.Bitmap]::new($size, $size)
    $g = [Drawing.Graphics]::FromImage($pwa)
    try {
      $g.Clear([Drawing.ColorTranslator]::FromHtml('#191c21'))
      $g.InterpolationMode = 'HighQualityBicubic'
      $g.DrawImage($mark, [int]($size * .12), [int]($size * .12), [int]($size * .76), [int]($size * .76))
      $pwa.Save((Join-Path $projectRoot "public/pwa-$size.png"), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $g.Dispose(); $pwa.Dispose() }
  }
  $ink = [Drawing.ColorTranslator]::FromHtml('#202122')
  $muted = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#afbccc'))
  $blue = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#84baff'))
  try {
    foreach ($kind in @('header', 'sidebar')) {
      if ($kind -eq 'header') { $width = 150; $height = 57 }
      else { $width = 164; $height = 314 }
      $bitmap = [Drawing.Bitmap]::new($width, $height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
      $graphics = [Drawing.Graphics]::FromImage($bitmap)
      $titleFont = [Drawing.Font]::new('Segoe UI', 17, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
      $smallFont = [Drawing.Font]::new('Segoe UI', 10, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
      try {
        $graphics.Clear($ink)
        $graphics.InterpolationMode = 'HighQualityBicubic'
        $graphics.PixelOffsetMode = 'HighQuality'
        $graphics.TextRenderingHint = 'AntiAliasGridFit'
        if ($kind -eq 'header') {
          $graphics.DrawImage($mark, 5, 5, 47, 47)
          $graphics.DrawString('velum', $titleFont, [Drawing.Brushes]::White, 58, 9)
          $graphics.DrawString('C O D E', $smallFont, $muted, 59, 31)
        } else {
          $graphics.DrawImage($mark, 26, 23, 112, 112)
          $graphics.DrawString('velum', $titleFont, [Drawing.Brushes]::White, 24, 153)
          $graphics.DrawString('C O D E', $smallFont, $blue, 25, 181)
          $graphics.DrawString('A little space to', $smallFont, $muted, 24, 256)
          $graphics.DrawString('build something.', $smallFont, $muted, 24, 272)
        }
        $outputPath = Join-Path $projectRoot "src-tauri/nsis/$kind.bmp"
        $bitmap.Save($outputPath, [Drawing.Imaging.ImageFormat]::Bmp)
        Write-Output "Exported $outputPath"
      } finally {
        $titleFont.Dispose()
        $smallFont.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
      }
    }
  } finally {
    $mark.Dispose()
    $muted.Dispose()
    $blue.Dispose()
  }
} finally { Pop-Location }
