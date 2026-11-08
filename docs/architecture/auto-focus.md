# Auto Focus Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `AutoFocusSessions` (`api/src/autofocus.ts`) runs the toolkit's `runAutoFocus` for one camera and one focuser inside a single `focuser.autofocus` operation, which holds both devices for the whole session;
  the runner nests its focuser lease and the per-frame camera leases in it.
  The runner owns the sampling, the fitting (Hyperbolic, Parabolic, Trend Lines, and the two combined modes), and the best position; nothing is fitted in `api` or `web`.
- The service supplies the runner with the backlash compensated mover of `FocuserCommands` (plus an optional settle wait), the `CameraCapturer` of the capture service (one FITS frame per position, written to a temporary directory and deleted after it was measured, never saved as a capture), and `StarDetectionService.measure`, whose median HFD of the accepted stars (Multi-Star) is each measurement.
  The provider and its ASTAP settings are fixed when the session starts; a failed detection is an invalid point of the curve, never a fallback to the other provider.
- The frames take the exposure time of the Auto Focus form (`AutoFocusSettings.exposureTime`) and the camera settings (gain, offset, binning, subframe, readout mode) of the physical camera shared with Camera Acquisition (`CameraSettings.exposure`, whose exposure time is never sent), fitted to the camera's capabilities by `fitExposure` and snapshotted in the request, so editing them never changes a running session;
  the Auto Focus panel edits the exposure time and the routine, never the camera settings.
  The frame type is always LIGHT, the stars are measured with the profile's star detection request (see [Star Detection Contract](star-detection.md)), and every frame snoops the focuser of the session and the mount, filter wheel, and rotator of the equipment setup (`AutoFocusRequest.snoop`).
- After the runner moved the focuser to the best focus, one more frame there records the verified HFD, kept apart from the HFD the curve estimated; a session completes only after it.
  A rejected curve fails without a best focus, and the runner moves the focuser back to the start.
  A stop, or an Equipment Control stop of the focuser (which cancels the operation holding it), cancels where the session stands.
  When the request sets `restoreOnStop` (the form's default), a stop of `POST /api/autofocus/:sessionId/stop` then moves the focuser back to the start position in an operation of its own, once the session released it and only if it is free (`restoring`, then `cancelled` with `restored`);
  a second stop cancels that move where it stands, and an Equipment Control stop or a disconnection never moves the focuser back.
  While a frame is exposed, the summary carries the driver's countdown as `exposure` (microseconds and percent), cleared once the frame was read.
- Sessions live in memory, the latest of each camera: `GET /api/autofocus` is the snapshot of their summaries, `GET /api/autofocus/:sessionId` the complete record with its measurements (requested and observed position, image id, HFD, star counts) and its curve, sampled from the runner's own regressions (`api/src/autofocus.curve.ts`), and `autofocus:updated` carries every change.
  Each sampled and verification frame is recorded in the capture frame registry before it is measured (origin `autofocus`, the verification numbered after the samples; see [Capture Frames Contract](capture-frames.md)), whose closing the registry owns, so a measurement's image id stays open only while it is the latest frame of its camera or leased;
  the measurement job retains the document until it ends.
- `POST /api/connections/:id/cameras/:deviceId/autofocus` starts a session (202 with `sessionId` and `operationId`; a repeated token answers its session), refused with 404 for an unknown camera or focuser, 409 when either is disconnected or held, and 422 when the focuser cannot move to absolute positions or the detector is ASTAP and it is not configured.
  The route answers through `admit(connectionId, deviceId, request, invocation?)`, the start of a caller inside the process, which answers that `CommandRefusal` or the session and operation ids, `repeated`, and `ended`, the final summary once the session released its devices (after the move back of a stop).
  Under an invocation (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)), the camera and the focuser must be reserved by it, and every operation of the session, the move back included, runs inside the reservation;
  a move back after the reservation was cancelled is refused, and the focuser stays where it stands.
  `interrupt(sessionId)` is the in-process stop.
  A token repeated after a newer session of the camera replaced its own still answers its own session, which `CameraSessionRegistry` remembers by operation (the last 256); the snapshot, the routes of a session id, and the events name only the latest.
- Limitations: focusers that only move relatively are refused;
  there is one frame per position and no repeated samples;
  the runner's sweep starts `initialOffsetSteps` steps out and comes back one step past the start before extending each side, so it is not symmetric;
  the filter wheel is never moved;
  the mount is not held, because the arbiter has no shared hold that would refuse GoTo and Nudge while letting tracking and guide pulses run, so a slew during a session goes unnoticed;
  sessions do not survive a restart.
  The simulated camera defocuses relative to its ±50000 step travel, so its curves need step sizes in the thousands.
