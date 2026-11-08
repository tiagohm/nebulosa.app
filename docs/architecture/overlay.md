# Overlay Contracts

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- A toggle of the viewer toolbar hides every overlay of a document at once and draws them again as they were (`ImageViewState.overlaysHidden`, tab memory, per document, kept across its frames), changing none of their settings.
  While hidden, a click selects nothing and the measure modes and the drawing actions of the context menu are unavailable, so nothing acts on what cannot be seen; the Guiding star pick stays, and so does the coordinate readout of the status line.
- Overlays draw through `ImageViewer`'s `overlays(size, view)` callback as SVG in **image pixel coordinates** (origin at the top-left of the first pixel).
  Zoom, pan, fit, 1:1, and resize are applied by the viewer, so overlays never compute screen coordinates; `view` gives the scale, for sizes constant on screen, and the visible region, to skip what is off screen.
  The viewer applies zoom and pan to the overlays as an SVG transform on a layer outside the CSS-transformed image, so strokes and dashes use `vectorEffect="non-scaling-stroke"` to keep their width on screen;
  a stroke inside a CSS transform would scale with it.
  Toolkit results use 0-based pixel indices with integer centres, so a result point (x, y) is drawn at (x + 0.5, y + 0.5).
- An overlay is a pure function of a result and the image shown: it draws only results whose image id matches the displayed image.
  Hiding an overlay never cancels or deletes the result, and showing one never re-runs the analysis.
- Celestial-coordinate overlays (annotation, grid) require a WCS solution of that same image: the one `usePlateSolution` selects (the chosen job or the header).
  Without one they are unavailable, not approximated.
  The WCS overlay (`web/src/platesolving/WcsOverlay.tsx`) draws the solved centre and north and east arrows from `web/src/platesolving/wcs.ts` (the toolkit's TAN/TAN-SIP transforms; its comments say why the arrows stay true at and beside a pole and under an inverse SIP that does not close on the forward one);
  the arrows and marker keep their screen size until they would exceed a quarter of the image's smaller side, then shrink with it.
  The RA/Dec grid (`WcsGridOverlay.tsx`, geometry and its tuning in `grid.ts`) is shown per document independently of the centre: it covers the visible part of the image with a margin, chooses its step by the spacing of neighbouring lines on screen (so rotation, SIP, and the convergence of meridians near a pole are followed) and keeps it while still readable, traces each line through the WCS with a bounded chord error, breaks it where the projection fails or jumps, and clips it to the region.
  The geometry is cached per solution while the view stays inside its region and near its zoom, so a pointer move never retraces it.
  Major lines are labelled where they cross the boundary of the visible image, horizontally at a constant screen size, dropping labels that would overlap on their side.
  Meridians and parallels are drawn in one theme color, or each in its own (reddish right ascension, bluish declination), lines and labels alike.
  The passive aids follow the same selected WCS without any request: the status line shows the right ascension, declination, frame, and local pixel scale under the pointer (`WcsCursorStatus`, one unprojection per move, "—" off the image or where the WCS fails);
  `WcsAidsOverlay` draws an optional crosshair, the compact north and east arrows inside the top-right corner of the visible image from the WCS at that point (an arrow that cannot be projected is left out; the orientation mode can draw them at the solved centre instead, or hide them), and the scale bar near the bottom-left corner, exact through the WCS where it is drawn and hidden when the two axis scales differ too much there or it does not fit (`web/src/platesolving/aids.ts`, which gives its lengths and limits).
  Coordinates are written in the profile's format and decimals (`coordinates.ts`), a display choice that claims no accuracy.
  Its `fitsToViewer` is the only place where a FITS pixel (1-based, integer centres) becomes a viewer point (minus half a pixel);
  the TPPA correction guide and the iPolar axis and pole markers, whose geometry the server computes with the toolkit in that convention, convert through it too.
- `ImageViewer`'s `onImageClick(point, view)` reports a click (never a drag or a pinch) in image coordinates; the star markers use it to pick a star.
  The viewer stays unaware of what its consumers draw or measure; its other pointer contracts are generic and optional:
    - `overlays(size, view, cursor)` and `status(cursor)` receive the `ViewerCursor` (image point, zero-based pixel inside the image, viewport point), absent off the viewport, so the status line and overlays follow the pointer without re-rendering their owner.
    - `interaction` (`ViewerInteraction` of `web/src/viewer/interaction.ts`) lets a tool take presses: `onPointerDown` decides on the first pointer whether the tool owns the gesture, otherwise the viewer pans; hovers reach the tool too.
      The pure router `routeGesture` turns a second pointer into a pinch that cancels the tool (`onCancel`), as do `pointercancel` and a lost capture; nothing resumes until every pointer is lifted.
      A press of the pan released within the click tolerance is a click.
      Space held on the focused viewport pans whatever the tool; Escape cancels and Delete or Backspace deletes (`onDelete`) only while the viewport has the focus, so form controls keep their keys.
    - The pointer over the image is a crosshair, whatever the tool, since any point of it can be clicked, read, or drawn from;
      it is the hand of the pan only while the image is being dragged, past the click tolerance so a click never shows it, or while Space is held.
    - `onImageContextMenu(point, client, view)` answers the native `contextmenu` event (a right click, or a long press on touch devices) and returns whether it handled it; otherwise the browser's own menu opens.
    - No screen-space layer exists: an overlay keeps a size constant on screen with `1 / view.scale` and places corner symbols from `view.visible`.
- An ROI is a region in image pixels.
  The statistics area of the Image Inspector is one: Select Area makes `rectangleSelection` (`web/src/viewer/rectangleSelection.ts`) the viewer's `interaction` in place of the astrometric tool, and takes the clicks, while the Inspector is shown and the overlays are visible. A drag from inside the image commits the half-open rectangle of the whole pixels it covers, clamped to the image; a click selects nothing; Escape drops the rectangle in progress, then leaves the mode. The first press holds the frame a camera tab shows.
  It never changes a camera's physical subframe unless an explicit, capability-checked command does it.
