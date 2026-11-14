# iPolar Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `IPolarSessions` (`api/src/ipolar.ts`) runs the toolkit's `runIPolarCalibration` and `runIPolarRefinement` (`core/src/observation/alignment/ipolar.runner.ts`) for one camera inside a single `camera.ipolar` operation.
  The operation holds the camera from the first frame until the session ends, and the mount the request names (the setup's `MOUNT`) for as long, pauses and the wait for the operator included, so nothing can slew it between the frames; it never holds a guide output.
  The toolkit owns the geometry (`ipolar.ts`, `ipolar.geometry.ts`), the quality gates, the motions, and the convergence; nothing is fitted in `api` or `web`.
- The model is a rigid rotation of the camera about the mechanical RA axis in the Earth-fixed frame: each frame's WCS is sampled on a fixed grid of sensor pixels and taken to ITRS at its own mid-exposure instant through ERFA's observed-place chain, so the frames need not overlap, the axis need not be in the image, and the delay between the frames does not bias it.
  The axis is calibrated in the sensor frame, so every later frame of the same sensor geometry measures the error from its own WCS: an adjustment of the base moves the axis, a rotation in RA does not.
- Two modes, chosen in the request (`mode`):
  `manual` needs only the camera: after the first frame the session is `waitingForRotation`, the operator turns the RA axis (DEC, camera, and optics untouched) and sends `POST /api/ipolar/:sessionId/rotation/confirm`, which never moves anything.
  The mount, when the setup has one, is held and only watched: its reported declination and pier side must not change.
  `automatic` needs the setup's mount, equatorial, unparked, able to move west-east and abort, announcing the preset (`ipolarMountRefusal`): the runner turns it in `direction` at `slewRate` with bounded timed motions (at most 30 s each, 180 s in all), each stopped in a `finally`, sized from the rotation fitted so far towards `rotation`.
  Tracking is never started or stopped.
- The second pose is accepted only from the rotation fitted between the solves: 10° to 60° (20° to 40° reported as preferred), an axis within 5° of the pole, a rigid fit, and the same sensor geometry and parity.
  Too little rotation or a poor solve keeps the first frame and asks again (manual) or turns further (automatic), up to 8 candidates; a wrong axis (a DEC move, a wrong blind solve), too much rotation, or a different sensor fails the session.
  Without a mount, the RA-only motion rests on the operator's word, and `calibration.verified` says so.
- Frames take the exposure time of the iPolar form (`IPolarSettings.exposureTime`) and the camera settings of the physical camera shared with Camera Acquisition, snapshotted in the request, as one LIGHT FITS frame each; files are auxiliary, in a temporary directory deleted with the session.
  Each frame is recorded in the capture frame registry (origin `ipolar`) before it is solved with `PlateSolvingService.solve` (origin `ipolar`, with its step: `reference`, `second`, or `refinement`), whose provider is resolved once when the session starts.
  The mount is snooped into the frames only in automatic mode: a mount turned by hand keeps reporting its old pointing, a stale hint.
- The site is the profile's active observing site, sent in the request, never the driver's: in automatic mode a mount reporting a site more than 0.1° or 500 m away adds a warning.
- A master dark of the Calibration Library can be pinned for a session (`dark`: its `masterId`, its `contentDigest`, and `onUnavailable`); none is ever chosen automatically, and the start refuses a dark of another camera of the Equipment Catalog than the one the camera is bound to, or a camera bound to none (see [Equipment Catalog Contract](equipment-catalog.md)); the panel lists only the darks of that camera.
  The start is refused (422) when `pinnedMaster` no longer answers it, and the session holds a `lease` of it until it ends.
  Every frame is checked again: `pinnedMaster`, then `assessDarkForFrame` (`api/src/calibrationdark.ts`) against the frame's own header, which refuses another exposure (exact microseconds), size, channels, CFA or CFA offsets, subframe origin (a known nonzero origin against an unknown one included), BITPIX, and a known different binning, gain, offset, readout mode, camera name, or temperature (beyond 1 °C), and reports what stays unknown as unverified, the camera always.
  A dark that fits is subtracted on the session's worker (`calibrationdark.worker.ts`: light minus dark in digital numbers on the raw mosaic, no scaling, written back in the frame's integer scale, negative values clipped to 0), and the frame is solved from those pixels as `PlateSolvePixels` (fingerprint `dark:<masterId>:<digest>`), while the frame itself stays the one recorded, shown, and solved for (see [Plate Solving Contract](plate-solving.md)).
  A dark that does not fit or fails is reported for that frame (`dark`: `notApplied` or `failed`, with a code and a reason) and the frame is solved without it, with a warning (`continue`), or the session fails (`stop`); the summary carries the outcome of the latest frame, so an earlier frame's never stands for it, and the record the latest 20 (`darkFrames`).
  `refraction` selects the default atmosphere for both the rays and the target (the apparent pole), or the geometric pole.
- After the calibration the session is `readyToRefine`.
  `…/refinement/start` starts or resumes the refinement, which captures and measures every refinement delay, never commanding the mount; `…/refinement/stop` pauses it (`refinementPaused`), keeping the devices.
  Each accepted measurement carries the total error and its on-sky components: azimuth positive when the axis lies east of the pole and altitude positive when it lies above, in either hemisphere; no knob direction is inferred.
  A frame that does not solve or is rejected makes the latest measurement stale (`current: false`) and clears the convergence streak; more than three frames in a row without a solution fail the session, and a sensor-geometry change, an axis jump over 3°, a field jump over 5°, or a mount declination or pier-side change fails it too.
  The convergence (`convergence.converged`) needs three consecutive fresh measurements within `completionThreshold`, a requested target and not an accuracy, and can regress.
- The overlay (`IPolarOverlay`) holds the axis and pole of the latest accepted measurement as projections in FITS 1-based pixels of its frame (`visible`, `offscreen` with the border crossing, or `unprojectable`, never a substitute at the image center), bound to the image id of that frame.
- `POST /api/ipolar/:sessionId/finish` ends a calibrated session as `completed`; `…/stop` (or an Equipment Control stop of either device, or a disconnection) ends it as `cancelled`.
  When the operation ended, the preset an automatic rotation replaced is restored if the mount is free, reported as `slewRateRestored`, with a warning when it could not be.
- `POST /api/connections/:id/cameras/:deviceId/ipolar` starts a session (202 with `sessionId` and `operationId`; a repeated token answers the same session), refused with 404 for an unknown camera or mount, 409 when either is disconnected or held, and 422 (`unsupported`) when the solver is not configured or the automatic rotation cannot run.
  A stage conflict (confirming outside the wait, refining before the calibration, finishing without one) is 409 `notInStage` (`IPolarErrorCode`).
  Sessions live in memory, the latest of each camera: `GET /api/ipolar` and `GET /api/ipolar/:sessionId` are the snapshot and the complete record (poses, rejected candidates, overlay), and `ipolar:updated` carries every change.
  iPolar has no in-process admission: it runs only as a manual operation.
- The web tool is a camera operation of a camera tab (`web/src/images/IPolarTool.tsx`, over `IPolarSections` of `web/src/camera/IPolarPanel.tsx`, store `web/src/camera/ipolar.ts`), its markers drawn by `web/src/camera/IPolarOverlay.tsx` only over the frame they belong to.
- Limitations: two poses cannot prove the motion was pure RA, so a small mixed RA/DEC motion tilts the axis undetected;
  the camera must be rigid with the RA axis, and a DEC, rotator, or camera change needs a new calibration;
  the backend knows no obstacle the driver does not report, so the clearance of an automatic rotation is the operator's;
  refraction uses the default atmosphere;
  whether a dark improves the solves of a given camera has not been measured in the field;
  the precision has not been validated on hardware in the field, and simulated accuracy is necessary, not sufficient;
  sessions do not survive a restart.
