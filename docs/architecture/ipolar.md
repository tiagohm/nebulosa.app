# iPolar

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

iPolar measures the polar alignment error by calibrating the mechanical RA axis in the sensor frame from two plate-solved frames taken before and after an RA rotation, then measuring the error from every later frame while the operator adjusts the base.
The session lives in `api/src/ipolar.ts` and runs the toolkit's iPolar runner (`core/src/observation/alignment/`), which owns the geometry, the quality gates, the motions, and the convergence; nothing is fitted in `api` or `web`.
The web tool is a camera operation of the Images camera tabs (`web/src/images/IPolarTool.tsx`, `web/src/camera/IPolarPanel.tsx`), with an overlay of the axis and the pole over the frame it measured.

## Purpose

Polar alignment is the base of tracking and guiding, and many setups cannot see the pole or have a mount without remote control.
iPolar needs neither: the frames need not overlap, the axis need not be in the image, and in manual mode the operator turns the RA axis by hand, so it serves any equatorial mount.

## Relations

- Holds the camera and the setup's mount in one manual operation until the session ends, so nothing slews the mount between the frames; it never holds a guide output (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- In automatic mode it turns the mount with timed manual motions of the mount commander; in manual mode the mount, when the setup has one, is only watched.
- Takes its frames through the shared camera capturer with the camera settings of Camera Acquisition and its own exposure time; frames are auxiliary and recorded in the [Capture Frames](capture-frames.md) registry.
- Solves each frame with [Plate Solving](plate-solving.md), whose settings are fixed when the session starts.
- Takes the Earth and the Sun from the [Ephemeris Chain](ephemeris-chain.md) and the site from the profile's active observing site ([Observing Sites and Time Zones](observing-sites-and-time-zones.md)), never from the driver.
- Can subtract a master dark the operator pins from the [Calibration Library](calibration-library.md), leased for the session and limited to the darks of the camera's [Equipment Catalog](equipment-catalog.md) camera.
- An [Equipment Control](equipment-control.md) stop of either device cancels it, and its outcome raises a [notification](notifications.md).

## Rules and Limitations

- A dark is never chosen automatically, and a frame it does not fit is solved without it or fails the session, as the operator chose.
- iPolar runs only as a manual operation: there is no in-process admission and no reservation.
- Two poses cannot prove the motion was pure RA, so a small mixed RA/DEC motion tilts the axis undetected; without a mount, the RA-only motion rests on the operator's word.
- The camera must be rigid with the RA axis: a DEC, rotator, or camera change needs a new calibration.
- The backend knows no obstacle the driver does not report, so the clearance of an automatic rotation is the operator's.
- The precision has not been validated on hardware in the field.
- Sessions live in memory and do not survive a restart.
