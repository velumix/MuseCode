# Muse Code identity

The folded M combines creative flow with a compact architectural silhouette. Cobalt and
azure faces give the mark depth while the rest of the interface stays charcoal and quiet.
The wordmark is rendered as text, with a small, spaced CODE suffix.

## Assets and exports

- `assets/muse-mark.png`: preserved 1254 × 1254 transparent master, generated with the
  built-in image generation tool on 2026-09-26. The original alpha channel is retained.
- `assets/icon-source.png`: copy of the master used for platform icon export.
- `src/assets/muse-mark.png`: optimized 256 × 256 UI export, about 40 kB.
- `public/muse-icon.png`: browser/favicon export.
- `src-tauri/icons/`: platform icon exports, including the Windows ICO.
- `src-tauri/nsis/header.bmp` and `sidebar.bmp`: installer artwork using the same mark.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-assets.ps1` to regenerate
the exports from the saved master. This uses the installed Tauri CLI and System.Drawing;
it does not call an image API. The master is not regenerated or overwritten by the script.

## Generation prompt

Tool: built-in `image_gen` (no API/CLI fallback).

> Use case: logo-brand. Asset type: final app brand mark for Muse Code, a premium desktop coding companion with a minimal charcoal and electric-blue interface. Create ONE exceptional, original, instantly recognizable M monogram, no wordmark. The silhouette should be a bold architectural M formed by two interlocking folded ribbon strokes, suggesting creative flow and precise code; a sharp central negative-space valley, confident outer shoulders, softly rounded corners. Strong, simple, continuous silhouette readable at 24 pixels. Rich cobalt and bright azure faces, just a restrained ice-blue edge on the upper fold, polished satin finish with subtle dimensional shading, no metallic chrome. Front-facing, almost flat, symmetrical overall with a clever folded overlap; high-end software identity, sophisticated and memorable, more crafted than a typed M. The mark occupies about 82 percent of the square canvas, perfectly centered with equal optical padding. Transparent background with genuine alpha. No enclosing square or circle, no text, no letters other than the abstract M, no sparkles, no stars, no infinity symbol, no brain, no robot, no circuit lines, no extra decorative objects, no mockup or presentation sheet, no cast shadow outside the silhouette, no glow outside the silhouette. Deliver a crisp high-resolution square isolated logo asset.

## Interaction treatment

Short, quiet motion communicates state: the mode indicator slides between Agent and Terminal,
messages enter with a brief fade, cards lift slightly on hover, buttons have press feedback, and the
command palette opens with a brief fade. The welcome mark animates on entry rather than
moving continuously. Only working indicators loop while a turn is active.

All nonessential motion and hover movement are disabled by `prefers-reduced-motion`.
The message box grows up to a window-relative cap, so Send remains reachable. Reading earlier
messages pauses automatic following; Back to latest resumes it. Sending a message returns to
the current turn. Copy actions show explicit confirmation.
