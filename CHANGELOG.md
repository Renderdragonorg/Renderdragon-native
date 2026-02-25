# Changelog

## [1.0.9] - 2026-02-24

### Added
- **Window Controls**: Added resizability and movement functionality.
- **Always on Top Setting**: Persistent window level (`pop-up-menu`) to stay above applications like Premiere Pro.
- **Pin Window Setting**: Option to prevent the window from hiding when it loses focus.
- **Live Previews (Autoplay)**: New setting to automatically play video thumbnails in the asset grid for a more dynamic experience.
- **Enhanced Preset Previews**: Added interactive video preview support for Premiere Pro presets (`.prpreset`, `.prfpset`).

### Fixed
- Fixed `ReferenceError: searchTimeout is not defined` in `app.js`.
- Fixed `ReferenceError: audioPlayer is not defined` in `app.js`.
- Fixed `ReferenceError: applyGridColumns is not defined` in `app.js`.
- Fixed `ReferenceError: loadedFonts is not defined` in `app.js`.
- Improved window persistence and Z-order logic for better "Always on Top" stability.

### Changed
- Refactored and cleaned up `app.js`, `styles.css`, and `index.html` (removed comments and unnecessary whitespace).
- Optimized window level and behavior for palette-like performance on Windows.
