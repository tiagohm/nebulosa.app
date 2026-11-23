# Shared Image

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The shared image model is the one image store of the server and the documents it holds, which every image feature works on.
`ImageStore` (`api/src/images.ts`, pixels on `api/src/images.worker.ts`, decoding in `api/src/imagedecode.ts`) holds the decoded documents: images opened from a file, camera frames, and the live stack snapshots derived from frames.
The analysis scheduler (`api/src/analysis.ts`, mirrored in the browser by `web/src/analysis.ts`) runs the analysis jobs on those documents.
The Images workspace (`web/src/images/`) shows them in the shared viewer (`web/src/viewer/`).

## Purpose

An operator inspects, analyzes, and saves images whether they come from a file, a camera, or a live stack.
One store addressed by one document id lets every tool and operation share the same pixels and results, so a camera frame is solved, measured, or annotated exactly like a file.

## Relations

- [Capture Frames](capture-frames.md) opens the camera frames of every operation as documents and decides when they close.
- [Live Stacking](live-stacking.md) snapshots are derived documents adopted by the store.
- [Star Detection](star-detection.md), [Streak Detection](streak-detection.md), [Image Statistics](image-statistics.md), [Annotation](annotation.md), and [Plate Solving](plate-solving.md) are analysis jobs of the scheduler.
- The [Star Profile Inspector](star-profile-inspector.md) and the pixel readout of [Image Statistics](image-statistics.md) read small regions of a document without copying it.
- The [Overlay](overlay.md) mechanism draws the results of those analyses over the document they belong to.
- A survey cutout of [Framing](framing.md) is not a document; it is imported into Images only on request.
- Decoding and the analyses use the toolkit (`core`); no device is held and no document is persisted.

## Rules and Limitations

- The scientific image reference is the document id, whatever workspace asked for it; a frame is never identified by camera role, and there is no second analysis path for camera frames.
- Each frame of a loop is its own document, and an analysis stays bound to the id it started on, retaining the document until it ends, whatever newer frame arrives.
- A derived document never changes its source and records its provenance and history.
- Images has no tool that changes pixels: single-image processing is not part of it.
- Analysis results live in memory only, are dropped with their image, and never survive a restart; an equivalent request is answered with a kept result instead of running again.
- A document a page opened belongs to that client and closes once the client stays disconnected past a grace period; a document a service opened is closed by that service.
- Analyses and readouts read the native decoded samples, never the rendered image.
