# Overlay

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The overlay mechanism lets image tools draw over a document and take pointer input from it without the viewer knowing what they draw or measure.
`ImageViewer` (`web/src/viewer/ImageViewer.tsx`, gestures in `web/src/viewer/interaction.ts`) hands its consumers SVG layers in image pixel coordinates, clicks, gestures, a context menu, and a status line, and applies zoom and pan itself.
The celestial-coordinate overlays and aids (centre and orientation, the RA/Dec grid, the coordinate readout, the scale bar) live in `web/src/platesolving/`, and the rectangle selection of a region of interest in `web/src/viewer/rectangleSelection.ts`.

## Purpose

An operator judges an analysis by seeing it on the image: stars, streaks, catalog objects, measurements, and correction guides.
A single mechanism keeps every tool's drawings aligned with the pixels at any zoom and keeps the viewer generic, so a new tool adds an overlay instead of changing the viewer.

## Relations

- Hosted by the viewer of the Images workspace and of the tools that show an image there (see [Shared Image](shared-image.md)).
- Drawn by [Star Detection](star-detection.md), [Star Profile Inspector](star-profile-inspector.md), [Streak Detection](streak-detection.md), [Annotation](annotation.md), the measurements, markers, and target offset of [Plate Solving](plate-solving.md), the statistics area of [Image Statistics](image-statistics.md), the correction guide of [TPPA](tppa.md), and the markers of [iPolar](ipolar.md).
- The star pick of [Guiding](guiding.md) takes its clicks from the viewer.
- The celestial overlays use the plate solution of the same image selected by [Plate Solving](plate-solving.md), projected with the toolkit's WCS transforms, and write coordinates in the format of the profile.

## Rules and Limitations

- An overlay is a pure function of a result and the image shown: it draws only results of the displayed image id; hiding it never cancels or deletes the result, and showing it never runs an analysis.
- Celestial-coordinate overlays need a WCS of that same image; without one they are unavailable, never approximated.
- Toolkit results are 0-based pixels with integer centres; `fitsToViewer` of `web/src/platesolving/wcs.ts` is the only conversion from a FITS pixel to a viewer point.
- Hiding every overlay of a document also disables clicks, measure modes, and drawing actions, so nothing acts on what cannot be seen; the Guiding star pick and the coordinate readout stay.
- A region of interest is a region in image pixels and never changes a camera's physical subframe.
- There is no screen-space layer: sizes constant on screen are derived from the view scale.
