# Shared Image Contracts

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

There is **one** image store, `ImageStore` in `api/src/images.ts`, and the scientific image reference is its document id.

- An image document is addressed as `/api/images/:id/...` by every operation, whatever workspace requested it.
  There is no second solver or detector path for camera frames.
- Camera frames enter the store as documents of the origin `{ origin: 'capture', connectionId, deviceId, frameId, time, path? }` (`ImageStore.openCapture`), decoded from the bytes the driver sent.
  A frame is never identified by camera role.
- In loop capture, each frame is its own document.
  An analysis stays bound to the id it was started on, and a newer frame never changes it.
  The capture frame registry (`api/src/captureframes.ts`) keeps the latest frame of each camera open and closes the previous one unless a lease of the Images workspace holds it (see [Capture Frames Contract](capture-frames.md)).
  An analysis retains its document (`ImageStore.retain`/`release`): closing it hides it from every route at once, but its pixels are released only when the last analysis lets it go.
- A derived document is computed from another document and never changes it.
  A live stack snapshot is a derived document too, of provenance `liveStacking` (its session, what it shows, the accepted frames it integrates, and its stacks as they were when it was taken), adopted from a copy of the stacks (see [Live Stacking Contract](live-stacking.md)).
  Its provenance (`processing`) records the steps of the image processing pipeline that computed it (see [Image Processing Contract](image-processing.md)), whose result the store adopts (`ImageStore.adopt`) from a full copy it handed out (`ImageStore.processingImage`).
  It is floating point, keeps the min-max rescale of the source read so a save writes the scale of the source, and records its source, time, and what was applied in HISTORY.
- Analysis jobs, common to star detection, streak detection, image statistics, annotation, and plate solving, and to the scheduling of image processing: an in-memory queue (`AnalysisScheduler` of `api/src/analysis.ts`) run in arrival order under a concurrency limit per provider, at most 16 jobs waiting (`MAX_QUEUED`; beyond it a submission is `503 queueFull`), each job retaining its image until it ends.
  Completed results are kept in memory only, at most 8 per image and 256 in all, dropped when their image is released, and never survive a restart; a result no longer kept answers `404 expired`.
  An equivalent request (the parameters each contract names) is answered with its kept result (200) instead of running again.
  An analysis `<x>` is submitted by `POST /api/images/:id/<x>` (202 with the job; `404 notFound` for an image that is not open), lists the kept completed jobs of an image with `GET /api/images/:id/<x>`, and answers the snapshot of the jobs waiting, running, and recently ended with `GET /api/<x>`, one job with `GET /api/<x>/:jobId`, the full result with `GET /api/<x>/:jobId/result`, and cancels with `POST /api/<x>/:jobId/cancel` (204, or 404 when it is not waiting or running).
  Every change of a job is published as `<x>:updated` without its payload, which is fetched on demand.
  No device is held.
  The web stores of star detection, streak detection, image statistics, plate solving, and annotation mirror their jobs through `trackJob` of `web/src/analysis.ts`: the latest job of each image, a bounded set of fetched results, and a job state that only moves forward, so a snapshot or a submission answer arriving after the events of a job never takes an ended job back.
- An analysis that only reads the samples runs where they are instead of copying them: `ImageStore.statistics` scans an open or retained document on the image worker in slices that yield to renderings and other requests, and a cancel stops it at the next slice (see [Image Statistics Contract](image-statistics.md)).
- An analysis of one spot of an image reads a region instead of the whole image: `ImageStore.detectionRegion` answers the grayscale copy of a rectangle, sample for sample the same as that rectangle of `detectionImage`, without copying the rest of the image, and the `SampleConversion` back to the scale of the source (see their comments in `api/src/images.ts` and `luminanceRegion` of `api/src/imagedecode.ts`).
- A document a page opens from a file (`POST /api/images` with its `client`, `ImageOpenRequest`) or claims from image processing belongs to that client: once the last socket of the client closed and stayed closed for `DOCUMENT_GRACE` (10 min, the grace of the capture frame leases), the store closes it (`ClientPresence` of `api/src/websocket.ts`), so a tab that reloaded or closed leaves no decoded image behind, and a tab that reconnects in time keeps its documents.
  A document a service opened (a camera frame, a live stack snapshot, an unclaimed processing result) is closed by that service.
- A Sky Framing survey image is not an image document.
  Importing one into Images is an explicit action, available only when the cutout carries usable WCS metadata.
