# Capture Frames

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Capture frames are the frames every camera operation takes, indexed by physical camera, and the camera tabs of the Images workspace that show them.
`CaptureFrameRegistry` (`api/src/captureframes.ts`) records each frame, its origin operation, its storage state, the latest frame of each camera, and the history of saved frames, without holding pixels.
Camera Acquisition (`api/src/captures.ts`) also feeds a frame sink with each of its light frames and dithers between them (`api/src/dithering.ts`).
The camera tabs (`web/src/images/cameratabs.ts`, `web/src/images/captureframes.ts`, `web/src/images/CaptureFramesCarousel.tsx`) show one frame of a camera at a time.

## Purpose

An operator needs to see what each camera just took and what it saved, whichever operation took it, and to analyze a frame without it being replaced by the next one.
The registry gives every camera one place for its frames, keeps them reachable across reloads, sleeping phones, and restarts, and lets the frames of an operation be inspected beside its results.

## Relations

- Producers: Camera Acquisition, [Auto Focus](auto-focus.md), [TPPA](tppa.md), [iPolar](ipolar.md), [Mount Pointing Model](mount-pointing-model.md), [Target Centering](target-centering.md), [DARV](darv.md), [Flat Wizard](flat-wizard.md), [Dark Library Wizard](dark-library-wizard.md), and [Guiding](guiding.md).
- Frames are documents of the [Shared Image](shared-image.md) store; the registry owns their closing and leases them to clients.
- The analyses and tools of Images run on the frame a camera tab shows; only the operator holds it, so a tab following the latest frame moves on while an analysis of an earlier frame runs.
- [Live Stacking](live-stacking.md) receives Camera Acquisition frames through the frame sink and shows its stacks in the camera tab.
- Each frame records the camera of the [Equipment Catalog](equipment-catalog.md) its device was bound to, which [Image Stacking](image-stacking.md) reads back.
- Saved frames are rows of the operational database (see [Persistence and State](persistence-and-state.md)).
- Camera tabs follow the connected cameras of the watched connection, ordered by their role in the equipment setup of the active profile.
- Dithering is guided through the native [Guiding](guiding.md) session, or moves the mount through the setup's guide output or a small GoTo, reserving the mount and the guide output for the whole capture (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)) and refusing a GoTo that the [Meridian Flip Monitor](meridian-flip-monitor.md) or the pier side says could flip the mount.

## Rules and Limitations

- A frame belongs to a physical camera (connection id + device id), never a role, profile, tool, or operation; a disconnected camera keeps its frames but loses its tab.
- A frame becomes saved only once its write succeeds; saved rows are never pruned and no file is deleted with them.
- After a restart no camera has a latest frame and only saved frames are available; a previewed-only frame can be opened only while it is the latest of its camera or leased.
- Opening a frame never substitutes another one, and the preview may skip frames of a loop.
- Results are keyed by image id, so a frame reopened from its file shows none of the results of its first document.
- A failed dither ends the capture as failed; there is no fallback method or skipped dither, and the sink never commands the camera or fails a capture.
- The setup has no optical train: the focuser belongs to the main camera and the mount to every camera of the connection.
