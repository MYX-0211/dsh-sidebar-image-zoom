# Changelog

Notable changes per release. This project follows [Semantic Versioning](https://semver.org/).

## 0.1.0

First release.

- Renderer for `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico` in the right
  sidebar, taking over from the built-in image viewport by registering
  `priority: "extension"` (the built-in one is `priority: "builtin"`, which
  ranks below anything else).
- Pointer-anchored wheel zoom: the pixel under the cursor stays under the
  cursor.
- Drag-to-pan with pointer capture, so the cursor may leave the pane mid-drag.
- Double-click toggles fit ⇄ 1:1; `F`/`Esc` fits, `1` goes to 100%, `+`/`-`
  step the zoom.
- Always-visible control strip with a live percentage readout.
- SVG is claimed for display but left out of `binaryExtensions`, so the
  plain-text renderer stays available for reading vector source.
- Fallbacks instead of a blank pane: unrecognised bytes, a suffix that
  promises a format the bytes are not, and a tab whose content has not
  arrived each report themselves. All of them stay inside the pane.
- Error boundary around the body — a renderer throw would otherwise blank the
  entire sidebar panel.
- Test suite: 30 assertions driving `lib/client.js` verbatim in a real browser
  via `puppeteer-core`. The test image is drawn at run time, so no binary
  fixtures are committed.
