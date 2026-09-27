# Velum Code identity

The folded blue V is a compact, angular mark against quiet charcoal surfaces.
The wordmark uses lowercase velum with a small CODE suffix.

## Assets

- `assets/velum-mark.svg`: editable vector master.
- `src/assets/muse-mark.png`: 256 px UI export; the filename stays stable for existing imports.
- `src-tauri/icons/`: Windows ICO, platform PNGs and other Tauri exports.
- `src-tauri/nsis/`: installer header and sidebar artwork.
- `android/app/src/main/res/drawable-nodpi/muse_mark.png`: Android adaptive icon and welcome mark.
- `public/pwa-192.png`, `public/pwa-512.png`: phone web app icons.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-assets.ps1`
to export every current asset from the SVG with Tauri and System.Drawing.
The old raster M masters remain as historical source material.

## Interaction

Short transitions communicate state, with reduced-motion support. The composer grows
within the window; reading older messages pauses automatic scrolling. Sending returns
to the latest turn. Provider changes create a separate conversation and preserve drafts.

Product names read **Velum Code**. Bundle IDs, the Windows notification identity and
Android signing identity retain their original MuseCode values so upgrades keep user data.
