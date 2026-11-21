# DARV

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

DARV, the drift alignment method of Robert Vice, measures polar misalignment from the drift between two star trails of one frame, exposed while the mount moves out in RA and back.
The session lives in `api/src/darv.ts`, runs the toolkit's DARV runner (`core/src/observation/alignment/darv.runner.ts`) for each measurement, and analyzes the frame on a worker of its own (`api/src/darv.analysis.ts`).
The web tool is a camera operation of the Images camera tabs (`web/src/images/DarvTool.tsx`, `web/src/camera/DarvPanel.tsx`), with an overlay of the trails it found.

## Purpose

DARV aligns a mount without plate solving, a catalog, or a view of the pole, so it works with any camera that can see stars.
The operator measures, turns a knob, and measures again until the trails stop diverging.

## Relations

- Each measurement is its own manual operation holding the camera and the mount only while one frame is exposed, so the devices are free while the operator turns the knobs (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- Moves the mount with the manual motions of the mount commander shared with Mount Nudge, at a slew-rate preset, and may start the mount's tracking for the session.
- Takes its frame through the shared camera capturer with the camera settings of Camera Acquisition; frames are auxiliary and recorded in the [Capture Frames](capture-frames.md) registry.
- Uses the toolkit's trail analysis; nothing is plate solved.
- An [Equipment Control](equipment-control.md) stop or a disconnection aborts the measurement, and its outcome raises a [notification](notifications.md).

## Rules and Limitations

- The runner owns the timing and the motions; nothing is timed in `api` or `web`.
- The drift is a separation rate in pixels per second, never a polar error, and drifts are comparable only between measurements of equal settings.
- With equal legs the drift has no sign, so it does not say which way to turn a knob.
- A measurement runs at a slew-rate preset, not at the guide rate.
- The backend knows no obstacle or cable limit, so the direction is the operator's responsibility.
- DARV runs only as a manual operation.
- Sessions live in memory and do not survive a restart.
