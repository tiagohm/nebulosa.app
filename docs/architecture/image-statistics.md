# Image Statistics

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Image statistics measures the original decoded samples of an image document, whole or inside a rectangle: per-plane counts, moments, order statistics, histograms, and a background noise estimate.
`ImageStatisticsService` (`api/src/imagestatistics.ts`) runs the toolkit's scan on the image worker that holds the pixels.
The Histogram and Statistics section of the Image Inspector (`web/src/images/ImageStatisticsSection.tsx`, store `web/src/images/statistics.ts`) shows them, and the pixel readout of the viewer (`web/src/images/PixelCursorStatus.tsx`, samples served by `api/src/imagesamples.ts`), turned on by Inspect Pixels of the viewer toolbar, shows the samples under the pointer.

## Purpose

An operator judges exposure, background, noise, and clipping from the real samples, never from the stretched rendering.
It is the numeric view of an image that the display cannot give.

## Relations

- An analysis job of the [Shared Image](shared-image.md) store, measured in place without copying the image; it holds no device and persists nothing.
- The toolkit (`core`) computes the statistics and the background estimate.
- The statistics area is a region of interest drawn through the [Overlay](overlay.md) mechanism.
- The pixel readout shares the status line with the sky coordinates of [Plate Solving](plate-solving.md).
- On a camera tab it measures the frame shown (see [Capture Frames](capture-frames.md)).

## Rules and Limitations

- Nothing the viewer applies changes what is measured, and values are in the scale of the source, never converted to electrons.
- Planes follow the document: the phases of a trusted CFA mosaic are kept apart, and an untrusted mosaic is measured as one mono plane.
- A count at the representable limit of the source is never labelled saturation.
- The background noise is a spatial estimate of one frame, not a read noise or gain; an unavailable estimate has no value, never 0.
- A scan runs only while the section is open, never for display changes.
- There is no mixed-phase plane, no luminance background, no export, no comparison of documents, and no trend across frames.
