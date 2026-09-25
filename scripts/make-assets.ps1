<#
.SYNOPSIS
  Generate Muse Code brand assets: app icon source + NSIS installer bitmaps.
.DESCRIPTION
  Draws everything with System.Drawing so the assets are reproducible without
  image tools. Outputs:
    assets/icon-source.png        1024px source for `tauri icon`
    src-tauri/nsis/header.bmp     150x57 NSIS header image
    src-tauri/nsis/sidebar.bmp    164x314 NSIS sidebar image
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$assets = Join-Path $root 'assets'
$nsis = Join-Path $root 'src-tauri\nsis'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
New-Item -ItemType Directory -Force -Path $nsis | Out-Null

function New-RoundedPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
  $p = New-Object Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-PromptPen($color, [float]$width) {
  $pen = New-Object Drawing.Pen($color, $width)
  $pen.StartCap = 'Round'
  $pen.EndCap = 'Round'
  $pen.LineJoin = 'Round'
  return $pen
}

function Draw-Glyph($g, $pen, [int]$x, [int]$y, [int]$s) {
  # Chevron + underscore prompt mark inside a $s-wide box at ($x,$y).
  $pts = [Drawing.Point[]]@(
    [Drawing.Point]::new($x + [int]($s * 0.22), $y + [int]($s * 0.28)),
    [Drawing.Point]::new($x + [int]($s * 0.42), $y + [int]($s * 0.50)),
    [Drawing.Point]::new($x + [int]($s * 0.22), $y + [int]($s * 0.72))
  )
  $g.DrawLines($pen, $pts)
  $g.DrawLine($pen, $x + [int]($s * 0.52), $y + [int]($s * 0.72), $x + [int]($s * 0.78), $y + [int]($s * 0.72))
}

$amber = [Drawing.ColorTranslator]::FromHtml('#d9a648')
$ink = [Drawing.ColorTranslator]::FromHtml('#14100a')
$bg = [Drawing.ColorTranslator]::FromHtml('#0c0f13')
$amberBrush = New-Object Drawing.SolidBrush($amber)

# --- 1024px app icon source (transparent background) ---
$size = 1024
$bmp = New-Object Drawing.Bitmap($size, $size)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.FillPath($amberBrush, (New-RoundedPath 64 64 ($size - 128) ($size - 128) 220))
$pen = New-PromptPen $ink 92
Draw-Glyph $g $pen 64 64 ($size - 128)
$pen.Dispose(); $g.Dispose()
$iconSrc = Join-Path $assets 'icon-source.png'
$bmp.Save($iconSrc, 'Png')
$bmp.Dispose()
Write-Output "wrote $iconSrc"

# --- 150x57 NSIS header image ---
$hb = New-Object Drawing.Bitmap(150, 57, 'Format24bppRgb')
$g = [Drawing.Graphics]::FromImage($hb)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAlias'
$g.Clear($bg)
$g.FillPath($amberBrush, (New-RoundedPath 6 6 45 45 9))
$pen = New-PromptPen $ink 6
Draw-Glyph $g $pen 6 6 45
$pen.Dispose()
$font = New-Object Drawing.Font('Segoe UI', 13, ([Drawing.FontStyle]::Bold))
$g.DrawString('Muse Code', $font, [Drawing.Brushes]::White, 60, 12)
$font.Dispose(); $g.Dispose()
$header = Join-Path $nsis 'header.bmp'
$hb.Save($header, 'Bmp')
$hb.Dispose()
Write-Output "wrote $header"

# --- 164x314 NSIS sidebar image ---
$sb = New-Object Drawing.Bitmap(164, 314, 'Format24bppRgb')
$g = [Drawing.Graphics]::FromImage($sb)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAlias'
$g.Clear($bg)
$g.FillPath($amberBrush, (New-RoundedPath 52 28 60 60 14))
$pen = New-PromptPen $ink 8
Draw-Glyph $g $pen 52 28 60
$pen.Dispose()
$titleFont = New-Object Drawing.Font('Segoe UI', 13, ([Drawing.FontStyle]::Bold))
$g.DrawString('Muse Code', $titleFont, [Drawing.Brushes]::White, 18, 108)
$titleFont.Dispose()
$subFont = New-Object Drawing.Font('Segoe UI', 9)
$gray = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#8a94a3'))
$g.DrawString('Desktop companion', $subFont, $gray, 18, 148)
$g.DrawString('for the Muse agent', $subFont, $gray, 18, 170)
$subFont.Dispose(); $gray.Dispose(); $g.Dispose()
$sidebar = Join-Path $nsis 'sidebar.bmp'
$sb.Save($sidebar, 'Bmp')
$sb.Dispose()
Write-Output "wrote $sidebar"

$amberBrush.Dispose()
