# TPPA

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

TPPA (Three-Point Polar Alignment) measures the polar alignment error of an equatorial mount from three plate-solved frames taken at different RA positions, then keeps measuring while the operator turns the knobs.
The session lives in `api/src/tppa.ts` and runs the toolkit's TPPA runner (`core/src/observation/alignment/`), which owns the RA motions, the acceptance of each pose, the geometry check, and the alignment.
The web tool is a camera operation of the Images camera tabs (`web/src/images/TppaTool.tsx`, `web/src/camera/TppaPanel.tsx`), with an overlay over the frame it measured.

## Purpose

An accurate polar alignment is the base of tracking, guiding, and long exposures.
TPPA measures it with the imaging camera itself, giving the azimuth and altitude errors and the knob changes inferred, refreshed as the operator adjusts.

## Relations

- Holds the camera and the mount in one manual operation from the first frame until the session ends, refinement and pauses included, so no GoTo, nudge, capture, or Auto Focus comes between the poses (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- Moves the mount with the timed manual motions of the mount commander shared with Mount Nudge, and may start the mount's tracking.
- Takes its frames through the shared camera capturer with the camera settings of Camera Acquisition and its own exposure time; frames are auxiliary and recorded in the [Capture Frames](capture-frames.md) registry.
- Solves each frame with [Plate Solving](plate-solving.md), whose settings are fixed when the session starts.
- An [Equipment Control](equipment-control.md) stop of either device cancels it, and its outcome raises a [notification](notifications.md).

## Rules and Limitations

- Nothing is fitted in `api` or `web`; the rotation is measured from the solves, never assumed from the motion time.
- A session fails rather than give an estimate from a bad geometry, a declination or pier-side change, or a field near the pole.
- TPPA runs only as a manual operation: there is no in-process admission and no reservation.
- The backend knows no obstacle or cable limit the driver does not report, so the RA direction is the operator's responsibility.
- Guiding or dithering by another program during the refinement goes unnoticed, and refraction uses the default atmosphere.
- Sessions live in memory and do not survive a restart.
