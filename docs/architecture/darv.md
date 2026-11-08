# DARV Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `DarvSessions` (`api/src/darv.ts`) runs drift alignment for one camera and one mount as a session of measurements.
  Each measurement is its own `mount.darv` operation, which holds both devices only while the toolkit's `runDarv` (`core/src/observation/alignment/darv.runner.ts`) exposes one frame, so the operator turns the knobs between measurements with the devices free.
  The runner owns the slew rate, the timing, and the motions; nothing is timed in `api` or `web`, and nothing is plate solved.
- The operator chooses the axis being adjusted (`azimuth` or `altitude`, which only tells where to point), the direction of the first RA motion (`EAST` or `WEST`), a slew-rate preset the mount announces (applied and confirmed by its echo before the exposure), and the leg duration (the form keeps 5 s to 600 s).
  The exposure is `darvExposureTime`: both legs plus a 3 s lead with the stars still, a 3 s turn budget, and a 3 s trailing margin.
  Once the exposure is seen Busy the runner waits the lead, moves out for the leg duration, stops, moves back for the same time, and stops;
  each motion is a manual motion of the commander shared with Mount Nudge, stopped in a `finally` that waits for the mount to be quiescent.
  A return motion that ended later than the earliest possible end of the shutter (dispatch plus exposure) fails the measurement instead of keeping a truncated trail; a mount that disconnects or stops tracking between legs fails it too.
- The timing measured on the monotonic clock shared with the capturer (lead, outbound, turn, return, trailing, adding up to the exposure) is kept with the measurement and given to the analysis, which excludes the stationary lead and trail from the drift baseline.
- The frame takes the camera settings shared with Camera Acquisition (`CameraSettings.exposure`) without its exposure time, as one LIGHT FITS frame with the mount snooped into the header;
  the file is auxiliary, in a temporary directory deleted with the measurement.
  The frame is recorded in the capture frame registry (origin `darv`; see [Capture Frames Contract](capture-frames.md)) before the devices are released.
- A measurement starts the tracking of a mount that is not tracking inside its operation, before the runner, and the session records it (`trackingStarted`);
  the tracking stays on between measurements, and an open session replaced on the same mount hands it to the new one, while a session on another mount is refused (409 `busy`) until the open one that started tracking is finished, so its tracking can still be stopped.
  `POST /api/darv/:sessionId/finish` takes `{ stopTracking }` (the panel's "Stop the tracking when finishing" checkbox, on by default) and, when set, stops that tracking before the session is published as finished, if the mount is free (`trackingStopped`);
  a repeat or another finish meanwhile is refused with 409.
  Once the operation of a measurement ended, the preset it replaced is restored if the mount is free (`slewRateRestored`), before the end of a failed or aborted one is recorded, and the frame, retained in the image store, is analyzed by `DarvAnalyzer` (`api/src/darv.analysis.ts`): `analyzeDarvImage` on a worker of its own (`api/src/darv.worker.ts`, embedded by `app/build.ts`), one analysis at a time, cancelled by terminating the worker.
  There is no sky transform, so the drift is the unsigned separation rate of the legs across the RA direction, in pixels per second, never a polar error.
  The outcome is `measured` (a drift from unclipped, resolved trails), `limited` (only clipped, saturated, or unresolved trails; no drift is published, never a zero), or `inconclusive` (no pair of legs), with the toolkit's diagnostics and a fit quality that is not a probability.
  Drifts are comparable only between measurements of equal settings.
- Measurement states: `preparing`, `exposing`, `outbound`, `reversing`, `inbound`, `finishing`, `analyzing`, then `ready`, `failed`, or `aborted`; `ready` says the measurement ended, not that the mount is aligned.
  Session states: `measuring`, `idle`, `finished`.
- `POST /api/connections/:id/cameras/:deviceId/darv` starts a session and its first measurement (replacing an idle or finished session of the camera), `POST /api/darv/:sessionId/measurements` repeats one with new settings (both 202 with `sessionId`, `operationId`, and `generation`), `POST /api/darv/:sessionId/abort` aborts the measurement wherever it stands (stopping the mount and discarding the exposure, or cancelling the analysis; an Equipment Control stop or a disconnection aborts it too), and `POST /api/darv/:sessionId/finish` finishes an idle session.
  Starts take a token, so a repeated request answers the same measurement;
  they are refused with 404 for an unknown camera or mount (or session), 422 when the mount is not equatorial, cannot move west-east or abort, lacks the preset, is parked, is not tracking and cannot switch tracking, or tracks at another rate than sidereal, and 409 while the camera's session measures or finishes or a device is disconnected or held.
- Sessions live in memory, the latest of each camera, each with its latest 50 measurements: `GET /api/darv` and `GET /api/darv/:sessionId` are the snapshot and the complete record (the paired trails of each analyzed measurement, in 0-based pixels), and `darv:updated` carries every change.
- Limitations: with equal legs the order of the outer ends is not known, so the drift has no sign and does not say which way to turn a knob;
  the backend knows no obstacle or cable limit, so the direction is the operator's responsibility;
  a measurement runs at a slew-rate preset, not at the guide rate;
  the simulator's slowest preset (0.5°/s) is too fast to show a polar error within a test, so the analysis of real divergence is tested in `core`;
  sessions do not survive a restart.
