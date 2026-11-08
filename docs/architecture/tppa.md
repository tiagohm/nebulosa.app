# TPPA Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `TppaSessions` (`api/src/tppa.ts`) runs the toolkit's `acquireThreePointPolarAlignment` and `refineThreePointPolarAlignment` for one camera and one mount inside a single `mount.tppa` operation, which holds both devices from the first frame until the session ends, refinement and pauses included, so no GoTo, nudge, capture, or Auto Focus can come between the poses or the refinement frames.
  The runner owns the RA motions, the acceptance of each pose, the geometry check (`core/src/observation/alignment/tppa.geometry.ts`), and the alignment; nothing is fitted in `api` or `web`.
- The operator chooses the RA direction (`WEST` or `EAST`), a slew-rate preset the mount announces (applied and confirmed by its echo before any motion), the RA rotation aimed at between poses (radians; the form keeps degrees, 6° to 15°), the settle delay, and the refinement delay.
  The motions are timed manual motions of the mount commander shared with Mount Nudge (`MountCommands.commander`): the first lasts 1 s, motions without measurable rotation grow fourfold up to 60 s, and once the mount rotated they are sized from the rotation observed per second;
  each one is stopped in a `finally`, and the stop waits for the mount to be quiescent, escalating to the abort.
  The rotation is measured from the solves (the change of hour angle about the celestial pole), never assumed from the motion time.
- A pose is accepted at 6° of rotation since the previous one, at most 30° from the first, with at least 1° of sky separation;
  a reversed motion, a declination change over 2°, a field within 10° of the pole (the first pose included, before any motion), a pier-side or tracking change, 12 captures without the pose, or an ill-conditioned triple fail the session as `unexpectedState`, never with an estimate.
  The seed pole error is about 2.4·σ/φ² for a solve error σ and a step φ, whatever the declination, which is why the limits are rotations.
- Frames take the exposure time of the TPPA form (`TppaSettings.exposureTime`) and the camera settings of the physical camera shared with Camera Acquisition (`CameraSettings.exposure`, whose exposure time is never sent), snapshotted in the request, as one LIGHT FITS frame each, with the mount snooped into the header;
  files are auxiliary, in a temporary directory deleted with the session.
  Each frame is recorded in the capture frame registry (origin `tppa`; see [Capture Frames Contract](capture-frames.md)) before it is solved with `PlateSolvingService.solve` (origin `tppa`), whose provider and settings are resolved once when the session starts and never fall back to another.
  A frame without a solution is a warning: during acquisition the mount moves further, during refinement three in a row fail the session.
- After the third pose the session is `readyToRefine`.
  `POST /api/tppa/:sessionId/refinement/start` starts (or resumes) the refinement, which captures and solves every refinement delay and feeds `ThreePointPolarAlignment`, never commanding the mount;
  `…/refinement/stop` pauses it (`refinementPaused`), keeping the devices.
  A field that moved more than 5° on the sky between refinement frames means the mount slewed and fails the session.
  Every estimate carries the azimuth, altitude, and total errors and the knob changes inferred, and the overlay of its frame computed by `computeThreePointPolarAlignmentOverlay` with the center of the third pose as the persistent reference.
- `POST /api/tppa/:sessionId/stop` cancels the session wherever it stands (an Equipment Control stop of either device, or a disconnection, does too): `completed` once it had an estimate, `cancelled` before.
  When the operation ended, the preset it replaced is restored if the mount is free, reported as `slewRateRestored`, and, when the request sets `stopTracking`, the tracking it started is stopped, reported as `trackingStopped`, each with a warning when it could not be;
  with `stopTracking` false the tracking is left on.
- `POST /api/connections/:id/cameras/:deviceId/tppa` starts a session (202 with `sessionId` and `operationId`; a repeated token answers the same session), refused with 404 for an unknown camera or mount, 409 when either is disconnected or held, and 422 when the solver is not configured or the mount is not equatorial, cannot move west-east or abort, lacks the preset, reports no site (0, 0), is parked, or is not tracking and cannot switch tracking.
  A mount that is not tracking but can switch it has its tracking started inside the operation before the first frame (`trackingStarted`);
  one that reports track modes and tracks at another rate than sidereal is not refused, but the runner fails the session before any motion.
  Sessions live in memory, the latest of each camera: `GET /api/tppa` and `GET /api/tppa/:sessionId` are the snapshot and the complete record (poses, attempts, initial estimate, overlay), and `tppa:updated` carries every change.
  TPPA has no in-process admission: it runs only as a manual operation, never under a reservation.
  While a frame is exposed, the summary carries the driver's countdown as `exposure` (microseconds and percent), cleared once the frame is solved, through the `captureListener` the toolkit runner gives to every auxiliary capture (`exposureProgressListener` of `api/src/captures.ts`).
- Limitations: the backend knows no obstacle, cable, or mechanical limit the driver does not report, so the direction is the operator's responsibility;
  guiding or dithering by another program during the refinement goes unnoticed;
  refraction uses the default atmosphere;
  only the mount is snooped into the frames;
  sessions do not survive a restart.
