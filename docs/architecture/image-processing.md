# Image Processing

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Image processing applies an ordered pipeline of the toolkit's single-image operations (debayer, background extraction and neutralization, stretch, multiscale transforms, blur, sharpen, cosmetic correction, flips, grayscale) to an image document.
`ImageProcessingService` (`api/src/imageprocessing.ts`, on its own worker `api/src/imageprocessing.worker.ts`) runs the pipeline on a copy and adopts the result as a new derived document.
Images → Image Processing (`web/src/images/ImageProcessingPanel.tsx`, store `web/src/images/imageprocessing.ts`) edits the pipeline of a document and opens its output.

## Purpose

An operator wants to improve or prepare a single image, for viewing, analysis, or saving, without ever losing the original.
It keeps every result as its own document beside the source.

## Relations

- Runs on the analysis queue of the [Shared Image](shared-image.md) store and adopts its output there as a derived document with its provenance; it holds no device.
- The operations and their parameters are the toolkit's (`core`).
- The output is claimed by the client that submitted the job and closes as that client's documents do.
- The pipeline of a document starts from the one of the profile (see [Persistence and State](persistence-and-state.md)); on a camera tab it runs on the frame shown (see [Capture Frames](capture-frames.md)).
- Its output is analyzed and saved like any other document.

## Rules and Limitations

- The source is never changed, and a result is adopted only when every step succeeded.
- What a pipeline can apply is checked against the image when it is submitted; no step is skipped or converted silently.
- One pipeline per source runs at a time, and results are never reused: running again creates another document.
- An output never claimed is closed after a grace period.
- There is no preview, a running pipeline holds several copies of the image, jobs do not survive a restart, and pipelines being edited do not survive a reload.
