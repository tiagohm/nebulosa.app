# Target Centering Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `TargetCenteringSessions` (`api/src/targetcentering.ts`) brings a fixed J2000 target to the center of one camera, or measures how far it is, inside one `mount.targetCentering` operation: the root holds the camera and a child the mount, both until the end, so nothing comes between an exposure and its correction.
  The toolkit's `centerTarget` (`core/src/observation/mount/centering.ts`) owns the loop: exposure, solve, measurement, correction, settle.
  Nothing is measured or corrected in `api` or `web` by other means, and a position is verified only by a solution of a frame taken after the last motion, within the tolerance.
  An accepted slew or a solve of an earlier position never proves it.
- Modes (`TargetCenteringRequest.mode`): `center` slews to the target and corrects;
  `recenter` slews only when the position the mount reports is farther from the target than `maximumCorrection`, and otherwise measures first;
  `verifyOnly` measures, commanding the mount nothing, tracking included, and repeats only a frame without a solution.
  The request carries the target whole, so a run never depends on a profile, and a later Sequencer can send the same request.
  A target is J2000 (ICRS) radians; time-dependent targets have no place in it.
- First slew and corrections: the first slew goes through `MountCommands.goToWithin`, with the refusals of the goto route and the single correction of the model in force, and the summary records the model and revision (`model`).
  Each later correction is the residual measured on the sky, applied from the position the mount reports with the commander directly, so a model is applied once and never stacked.
  No lock is needed: an activation needs the mount free, and a deactivation or suspension during a session has nothing to reach.
  Sync is never used, because the commander's Sync neither waits for its echo nor suspends a model.
- Motion checks: the admission (`422`, `409`) asks for a configured solver and, except for `verifyOnly`, `canGoTo`, `canAbort`, a reported site, an unparked mount, tracking or the ability to track (started inside the operation, left on after a success, and stopped after a failure or a stop when the mount is free), and a target above the horizon of the site the mount reports when the session starts.
  Before each correction the toolkit asks the session, and a correction is refused (`refusal`, moving nothing) for a parked mount, a pier side that changed (when the mount reports one), a distance over `maximumCorrection` (`tooLarge`: centering again is the way past it, since no approval is asked mid-run), or a destination below that horizon.
  A centering never starts a flip of its own accord beyond what a GoTo of the driver does.
  The horizon is geometric at 0°, and nothing is known of obstacles, cables, or the limits of the mount.
- Budgets (`TargetCenteringRequest`): `maximumFrames` caps every exposure, failed solves included; `maximumCorrections` caps the motions apart from them, and `noSolutionRetries` the frames repeated at one position, without a motion.
  Two corrections in a row that did not get closer end the session (provisional).
  A correction allows 60 s (provisional), and a first slew 5 min, since the commander ends a slew only after seeing it, and a motion of arcseconds might never show on a real driver.
- Frames take the exposure time of the request and the camera settings of the physical camera, snapshotted in it, as one LIGHT FITS frame each with the mount snooped into the header;
  files are auxiliary, in a temporary directory deleted with the session.
  Each frame is recorded in the capture frame registry as the latest frame of its camera (origin `targetCentering`, frame id `sessionId:n`) before it is solved with `PlateSolvingService.solve` (origin `targetCentering`), whose provider and settings are resolved once when the session starts and never fall back to another.
  Once the mount was sent to the target, an assisted search hints the target; before that the header hints it, since the position of a mount is never a hint.
  `blindRetry` searches the same frame again over the whole sky with the same provider.
  A frame says what became of it (`outcome`): `solved`, `noSolution`, `invalid`, `timeout`, or `failed`; only a solve past its timeout ends the session by itself.
- Outcome: `completed` with `positionVerified`; a `verifyOnly` that measured the target out of tolerance is `completed` with `positionVerified: false`, a result and not a failure, while a `center` or `recenter` that ends out of tolerance is `failed`.
  `cancelled` follows `POST /api/target-centering/:sessionId/stop` (which answers 202 at once, since a camera may stay held up to `FRAME_TRANSFER_TIMEOUT`, and again for an ended session) or a stop of either device.
  An operation that ended with the mount not quiescent leaves the session `blocked`, with its camera free for no other session until the stop dismisses it.
  `readyForImaging` is what a later automation reads.
- Guiding: the session guiding through the guide output of the request (the setup's `GUIDE_OUTPUT`, which drives the mount; without one, no guiding moves the mount and none is touched) is stopped by the operation before it takes the mount (`guiding: 'coordinate'`, the form's default), which needs the operation to exist first, so the root holds the camera while guiding stops, and restored once the operation released the mount (step `restoringGuiding`), whatever the session ended in, unless it is `blocked`;
  the restored guiding reuses its calibration, derived for where the mount points now, unless it does not apply there.
  Guiding the owner paused, or that is calibrating, is never taken over, and neither `guiding: 'requireIdle'` nor a `verifyOnly`, which moves nothing, touches any: they answer `409 guidingActive`.
  `GuidingSessions.hold` keeps guiding through that guide output from starting until the operation ends.
  The outcome is `guidingRestoration`: `notNeeded`, `restored`, `failed`, or `externallyChanged` when someone else commanded that session meanwhile, which leaves it as it is.
  A position verified with guiding not restored stays verified, but `readyForImaging` is false and the operator is warned, so an automation must not go on as if the whole workflow succeeded.
- Sessions live in memory, the latest of each camera.
  `targetCentering:updated` carries summaries, without any WCS, with a monotonic `revision`; `GET /api/target-centering` is the snapshot and `GET /api/target-centering/:sessionId` the complete record, with the solution of each attempt.
  The start, `POST /api/connections/:id/cameras/:deviceId/target-centering`, takes a token, so a repeated request answers the same session.
- Images → Target Centering (`web/src/camera/TargetCenteringPanel.tsx`, a camera operation of camera tabs only, with any camera of the connection and the MOUNT of the setup) holds Center, Recenter, and Verify Only as actions of one tool.
  The target is explicit and always shown: right ascension and declination typed in J2000, the catalog object selected in Sky (`catalogTarget`, shared with Target Offset; its J2000 position at epoch J2000.0, without proper motion, and solar-system bodies, minor bodies, constellations, and the mount are refused with the reason), or a saved framing.
  Nothing replaces it with where the mount points or with the latest solved center.
  Recenter is disabled, with the reason, until a saved framing is selected.
  Center and Recenter ask for a confirmation that names the mount and the target; Verify Only, which commands nothing, asks for none, and starting any of them is the only thing here that commands a device.
  The exposure time is the form's;
  the other camera settings are shown and belong to Camera Acquisition (`CameraAcquisitionSection`, the Acquisition section of every camera operation that takes frames), and the solver is shown and belongs to Images → Plate Solver, each with a link that only selects the tool on the same tab.
  The mirror (`targetCenteringRuntime`, in `SERVER_STORES`) follows sessions by camera, by revision, leaving what an event changed during a refresh, and fetches the complete record when a new solution or an end is reported.
  While a session runs the panel shows what it applied, whichever tab started it, and a blocked session offers Dismiss.
  Diagnostics, collapsed, lists each attempt and draws them around the target on a bullseye, north up and east to the left as the sky looks, to the scale of its rings, so nothing is magnified without saying so.
  On the frame a session measured, the viewer draws the target with `TargetOffsetOverlay` from the solution of that attempt, matched by image id, never from the solution chosen for manual inspection; it needs nothing from Target Offset's own target.
- A caller inside the process admits a session with `admit(connectionId, deviceId, request, invocation)`, which answers a `CommandRefusal` (with `guidingActive` among its codes) or the session and operation ids and `ended`, the final summary once guiding was restored (a blocked session ends only once dismissed).
  Under an invocation, the camera and the mount must be reserved by it (a mount a guiding run holds counts once it is reserved), and the root, its motion, and the tracking stop after a failure run inside the reservation;
  the session still suspends and restores guiding itself, so a caller never reimplements that.
  `interrupt(sessionId)` is the in-process stop.
- Limitations: proper motion and solar-system bodies are not followed; sessions do not survive a restart, and nothing resends a motion after one; a session does not save its frames; only the position is centered, never the orientation.
