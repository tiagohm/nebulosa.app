# Star Detection

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Star detection finds the stars of an image document and measures their position, HFD, SNR, and flux, with an aggregate HFD of the image.
`StarDetectionService` (`api/src/stars.ts`, on its own worker `api/src/stars.worker.ts`) runs either the built-in Nebulosa detector (the toolkit's port of ASTAP's star extraction) or the external ASTAP program.
Images → Star Detection (`web/src/images/StarDetectionPanel.tsx`, store and markers in `web/src/stars/`) runs it by hand, and the Image Inspector derives an image quality summary from it (`web/src/stars/quality.ts`).

## Purpose

An operator judges focus and image quality by the size of the stars, and Auto Focus measures each of its frames the same way.
One service gives both the same measurement, so the HFD Auto Focus measured on a frame is shown with that frame without detecting again.

## Relations

- An analysis job of the [Shared Image](shared-image.md) store; it holds no device.
- [Auto Focus](auto-focus.md) measures its frames through it.
- The ASTAP provider is configured in [External Tools](external-tools.md); the built-in one uses the toolkit (`core`).
- The detector settings are one profile preference shared by every document and by the frames of Auto Focus and Guiding.
- [Streak Detection](streak-detection.md) may use its accepted stars, and the [Star Profile Inspector](star-profile-inspector.md) receives a star it found.
- The markers are an [Overlay](overlay.md); a run never holds the frame a camera tab shows (see [Capture Frames](capture-frames.md)).
- Captures never analyze their frames; [Guiding](guiding.md), the stacking analyses, and the Star Profile Inspector run the toolkit's detector on their own.

## Rules and Limitations

- Runs are explicit: nothing is measured automatically, and no per-frame quality history is kept.
- A provider never falls back to the other, and HFDs of the two providers are not comparable.
- The aggregate HFD is unavailable, never 0, when too few stars are accepted.
- Saturation is not detected; stars near a frame edge, faint stars beside a much brighter neighbor, long trails, and stars under a streak are left out, as ASTAP does.
