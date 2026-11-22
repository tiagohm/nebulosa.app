# Guiding

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Guiding is native autoguiding, without any PHD2 process: one guide camera loops exposures, a guide star is tracked, and corrections are pulsed through a guide output (the mount, or the ST4 port of a camera).
The session lives in `api/src/guiding.ts`, decodes and measures its frames on a worker of its own (`api/src/guiding.worker.ts`), and runs the toolkit's interactive guiding session (`core/src/observation/guiding/`), which owns the states, the tracking, the calibration, the controller, the pulses, dithering, and the settle.
Saved calibrations live in `api/src/guidingcalibration.store.ts`.
The web tool is a camera operation of the Images camera tabs (`web/src/images/GuidingTool.tsx`, `web/src/camera/GuidingPanel.tsx`, store `web/src/camera/guiding.ts`), with the guiding graphs under the camera tab and the calibration review.

## Purpose

Long exposures need the mount to follow the sky more precisely than its tracking can, and dithering between frames needs a guider that moves the lock and settles.
Guiding is what keeps every long light frame sharp, and the capture, centering, and meridian flip workflows coordinate with it.

## Relations

- The guide camera is held for the whole session; while guiding, a run also holds the guide output and the mount it drives (the setup's mount), so no GoTo, nudge, or manual pulse moves the mount between two corrections (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- Pulses go through the guide output commander, so ending a run waits for the observed end of every pulse.
- Detects the stars of its frames with the toolkit detector, or with ASTAP through [External Tools](external-tools.md) (see [Star Detection](star-detection.md)).
- Can subtract a master dark of the [Calibration Library](calibration-library.md), chosen among those of the guide camera's [Equipment Catalog](equipment-catalog.md) camera or pinned by the operator, and leased while used.
- Saves every completed calibration in the database and restores a matching one at Start Guiding, derived for where the mount points now (see [Persistence and State](persistence-and-state.md)).
- Records the newest frame in the [Capture Frames](capture-frames.md) registry so the camera tab shows it, never saved.
- Camera Acquisition claims the dither commands of a session to dither between its frames.
- [Target Centering](target-centering.md) and the [Meridian Flip Executor](meridian-flip-executor.md) hold guiding through a guide output and suspend and restore it around a motion of its mount, handing the guide output and the mount to their reservation with no gap.
- Its events raise [notifications](notifications.md).

## Rules and Limitations

- The Equipment Setup says which mount a guide output drives; services that move a mount coordinate with the guiding of exactly the setup's guide output, since a guide output on a camera's ST4 port shares no device with the mount.
- Losing the guide camera, the guide output, or the mount ends the session; a reconnected device needs a new session.
- A slew commanded elsewhere stops guiding unless the request says otherwise, and guiding never starts again by itself.
- A calibration that fails releases the guide output and the mount, and the session keeps looping; it keeps the failed calibration, with the progress of its legs, until another calibration starts or one is solved or restored. A settle that fails while guiding keeps them held.
- A caller inside the process can admit a session under a reservation that holds the guide camera and the guide output; every command of the session then runs inside it, whoever sends it.
- The controller and tracking settings are fixed when the session starts; only the exposure changes on a running session.
- A mount that reports no side of the pier never has a calibration restored or derived, so it calibrates again after every motion.
- Sessions, events, and telemetry live in memory and do not survive a restart; only the saved calibrations persist.
