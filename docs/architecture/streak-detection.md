# Streak Detection

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Streak detection finds the approximately straight trails of an image document and classifies them from the evidence of that same image.
`StreakDetectionService` (`api/src/streaks.ts`, on its own worker `api/src/streaks.worker.ts`) runs the toolkit's detector and classifier on a full copy of the decoded samples.
Images → Streak Detection (`web/src/images/StreakDetectionPanel.tsx`, store and lines in `web/src/streaks/`) runs it by hand and lists and draws the streaks.

## Purpose

An operator wants to know whether a frame is crossed by satellites, aircraft, meteors, or other trails, and what they likely are.
It answers that on demand without tuning, leaving stars, nebulae, and gradients out.

## Relations

- An analysis job of the [Shared Image](shared-image.md) store; it holds no device.
- The toolkit (`core`) detects and classifies the streaks.
- The classification may use the solution of a [Plate Solving](plate-solving.md) job and the stars of a [Star Detection](star-detection.md) job of the same image, frozen when the job is submitted.
- The detector settings are one profile preference shared by every document.
- The lines are an [Overlay](overlay.md); a run never holds the frame a camera tab shows (see [Capture Frames](capture-frames.md)).

## Rules and Limitations

- Runs are explicit: no capture, sequence, or other analysis starts one.
- Nothing is solved or detected for the classification, and no ephemeris, catalog, prior frame, or network is used.
- A classification is an uncalibrated evidence weight, never a probability, and is kept apart from the detector's confidence.
- The result shown is that of the newest completed detection of the image, so a detection that runs, fails, or is cancelled never takes it or its lines away.
- Only straight lines are found: curved and sparsely dotted trails are missed, trails locked to a pixel row or column or along a frame edge are dropped as artifacts, and the whole image is analyzed without a region or mask.
- There is no satellite or meteor prediction and no classification across frames.
