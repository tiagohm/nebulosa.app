# Streak Detection Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- One service, `StreakDetectionService` (`api/src/streaks.ts`, analysis jobs of the [Shared Image Contracts](shared-image.md) with routes `/api/images/:id/streaks` and `/api/streaks` and event `streaks:updated`), detects the approximately straight streaks of an image document for Images → Streak Detection (manual runs only; no capture, sequence, or other analysis starts one).
  It runs the toolkit's `detectStreaks` on a worker of its own (`api/src/streaks.worker.ts`), fed `ImageStore.processingImage`: a full copy of the decoded samples in their own precision and layout, mono, RGB, or a CFA mosaic with its trusted pattern, never the debayered luminance copy of Star Detection nor anything the viewer applies (debayering, stretch, inversion, zoom).
  The toolkit reduces the copy to one luminance plane (the mean of the channels, a 2×2 superpixel of a mosaic, binned further above about 4 Mpx) and needs no tuning: its only setting is `minLength` (40 px by default), and every threshold is in units of the noise and texture of the image.
  Round and thick sources (stars, galaxy cores, the Moon) are masked; a line is a streak only when it is a ridge brighter than both of its sides (an edge is not), its contrast stands out from the noise and from parallel lines around it (nebulae, clouds, and banding do not), it is uniform along its length (a chain of stars is not), and it is at least 8 times longer than its FWHM.
- A `Streak` is in 0-based pixel coordinates of the received image (origin at the upper-left sample, +X right, +Y down), even on a binned plane; its axial angle is in radians in [0, π), shown in degrees.
  The whole image is analyzed (no ROI), and the saturation level is never sent: the toolkit compares it with normalized samples, so the saturation fraction stays absent, never 0.
  Photometry is in normalized sample units; the SNR is the detection significance of the streak.
- The worker then classifies the streaks with `classifyStreaks`, from evidence of the same image only: its samples, its exposure and DATE-OBS, its WCS, and the accepted stars of a star detection.
  The WCS is the solution of the completed plate solving job of the image the request names (`plateSolveJobId`), else the valid WCS of its header;
  the stars are those of the completed star detection job of the image the request names (`starDetectionJobId`).
  The service resolves them through `PlateSolvingService.result`/`solutions` and `StarDetectionService.result` when the job is submitted and freezes them, so a later solve or detection never changes a job;
  a named job unknown, no longer kept, of another image, or without a solution is refused (422 `contextUnavailable`).
  Nothing is solved or detected for the classification, and no ephemeris, radiant, tracking quality, prior frame, network, or catalog is used.
  Each job publishes the sources it used (`context`).
- A classification is the toolkit's uncalibrated evidence weight: `unknown` unless the evidence singles out a class, and never shown as a probability.
  It is kept apart from the detector's `confidence`, by index in `classifications`.
  A classification that throws leaves the streaks unclassified (`classified: false`, a warning) instead of failing the job.
- One detection runs at a time.
  An equivalent request (image, every detector setting, context job ids) is answered with the job still waiting or running (202), or with its kept result.
  A running detection is cancelled, or stopped after 120 s (`timeout`), by terminating its worker.
  The settings are not validated by the API: a detection the toolkit throws on fails as `detectionFailed` with its reason;
  the web form keeps the minimum length within 8–100000 px.
- The detector settings are one profile preference, `ProfileSettings.streakDetection` (`streakDetectionSettings`, `setStreakDetectionSettings`), shared by every document and editable before a camera tab has a frame.
  Whether the next detection uses the plate solution shown and the latest stars of the image, how the lines are drawn, and the selected streak belong to the document view (`ImageStreaksState`).
  Run Detection holds the frame a camera tab shows.
  The lines (`web/src/streaks/StreakOverlay.tsx`) are drawn only over the image their result measured, without arrows;
  a click on a line (within 8 screen pixels) or a row of the list selects the same streak, and the selection of a camera tab is cleared when another frame is committed.
- Limitations: a straight-line model, so curved trails are not reported, nor dotted trails whose gaps fill more than half of their length;
  a trail locked to a pixel row or column (within 3° and explained by it) or running along a frame edge is dropped as a sensor or readout artifact, and the part of a trail crossing a masked bright object is not measured;
  there is no ROI, mask (`createStreakMask`), reclassification of a kept result, satellite or solar-system prediction, meteor radiant, tracking quality, or classification across frames.
