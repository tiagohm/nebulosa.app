# Star Profile Inspector

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Star Profile Inspector measures the one star an operator points at in an image: its centroid, HFD, FWHM, shape, SNR, cuts, and optionally a Moffat fit.
The server measures it on request (`api/src/starprofile.ts`, on its own worker `api/src/starprofile.worker.ts`, science in `api/src/starprofile.analysis.ts`), and Images → Star Profile Inspector (`web/src/images/StarProfileInspectorPanel.tsx`, store `web/src/stars/starprofile.ts`) shows the marker, preview, and plot.

## Purpose

An operator judges focus, tracking, and optics by looking closely at a single star rather than at the aggregate of a detection.
It is a short, explicit interaction, so it runs only when the operator clicks a star or asks to analyze the selected one.

## Relations

- Reads only a region around the point of a [Shared Image](shared-image.md) document and retains it while measuring; it is not an analysis job: no job, event, or kept result, and no device held.
- The toolkit (`core`) finds the star and measures its profile.
- A star found by [Star Detection](star-detection.md) is sent with the click.
- Widths in arcseconds come from a [Plate Solving](plate-solving.md) solution of the same image.
- The plot and texts of a profile are shared with the [Guiding](guiding.md) panel.
- The marker is an [Overlay](overlay.md); a click never holds the frame a camera tab shows (see [Capture Frames](capture-frames.md)).
- The settings are one profile preference shared by every document.

## Rules and Limitations

- A measurement belongs to the image it measured, lives in tab memory only, and is never stored; a newer one supersedes it.
- The delivered model may differ from the requested one: a rejected Moffat fit falls back to the moments.
- Its HFD is not comparable with the HFD of Star Detection.
- A star beside a much brighter neighbor may be ambiguous, a Moffat fit is often rejected on a faint star, saturation is unknown on a rescaled image, and a mosaic without a trusted pattern is measured as is.
