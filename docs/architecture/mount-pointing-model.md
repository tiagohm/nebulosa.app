# Mount Pointing Model Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- A model maps the coordinates a mount was commanded to onto the sky position it reached.
  The fit, the prediction, and the inverse correction are the toolkit's (`core/src/observation/mount/pointing.ts`); nothing is fitted in `api` or `web` by other means.
- Frame (`api/src/mountpointing.frames.ts`): a sample holds the exact JNOW values the driver received, as opaque coordinates of the driver, and the plate solved ICRS center reduced to the true apparent topocentric place of the middle of the exposure, without refraction (`apparentFromIcrs`).
  Refraction, the semantics of the driver, and the mechanics of the mount therefore end up in the fit.
  The reduction is not the toolkit's `equatorialFromJ2000`, which the mount manager applies to a J2000 GoTo and which leaves aberration out, so a model of that frame would carry up to about 20″ that drift over the year.
  The error is solved minus command, east and north positive.
- Fitting (`api/src/mountpointing.fit.ts`, `mountpointing.worker.ts`, embedded by `app/build.ts`) runs on a worker of its own, one fit at a time, since the leave-one-out refits take seconds at the sample counts of a run.
  Samples cross as plain numbers, because a toolkit `Time` cannot be cloned.
  Cross terms are off by default, because at one site `sinAlt` is an exact combination of `sinDec` and `cosHA·cosDec`, which leaves the default features singular from about 65 samples on;
  pier terms are used only when the training samples hold both sides.
- Withheld samples never enter a fit.
  They measure it on sky it has not seen, and the offline gate of a revision (`unusable`, `failed`, `passed`) requires a usable model, at least 6 of them, a withheld RMS under 80% of their RMS before correction, and one on each pier side trained.
  These limits are provisional until simulator and real-mount runs justify them.
  A measure a fit cannot give is absent, never zero.
- Persistence (`PointingModelStore` in `api/src/mountpointing.store.ts`): the header of each model is a row of `pointing_models` in the operational database, and its samples, revisions, and verifications are rows of `pointing_samples`, `pointing_revisions`, and `pointing_verifications`, in order, deleted with the model.
  Samples, revisions, and verifications are immutable: a save writes only the rows it adds, and one that would change or remove a row already written is a programming error and is refused whole.
  Every save is one transaction, so saves of a model never interleave, and a save from an outdated revision is refused with its current state.
  The server records an acquisition left `running` or `paused` as `interrupted` when it starts (`startDatabase`): nothing resumes by itself.
  Nothing says a model is active.
  A coefficient that is not finite is read back as `null`.
  An export holds the samples, the plan, and how the latest revision was fitted, never coefficients or a verdict, so an import is fitted and judged again here, and only its version is checked.
- Model library (`api/src/mountpointing.ts`, mirror `web/src/mountpointing/mountpointing.ts`, in `SERVER_STORES`): `GET /api/mount-pointing/models` lists the summaries and the fits;
  `GET …/:modelId` is the complete record, loaded on demand;
  `POST` imports an exchange document;
  `PATCH` renames;
  `DELETE` removes;
  `GET …/:modelId/export` downloads;
  `POST …/:modelId/fit` answers 202 and adds a revision when the worker ends.
  A rename and a fit carry `expectedRevision`, and an outdated one is `409 conflict` with the current summary.
  There is no draft on the server: a draft is the form of a tab until it asks for a fit, and an exclusion is a choice of that fit, so it never changes a sample or an earlier revision.
  A model a session holds, or one already fitting, cannot be fitted, and one a session or an activation holds cannot be removed (`409 busy`).
  Events (`mountPointing:modelUpdated`, `mountPointing:modelRemoved`) carry a sequence per process, and the mirror drops older ones and leaves what an event changed during a refresh.
- Acquisition (`api/src/mountpointing.sessions.ts`): `MountPointingSessions` walks the waypoints of a plan (`planPointingWaypoints`, fixed on the local sky as hour angle and declination, leaving 10° around the poles free), computing the right ascension of each one from the sidereal time of its dispatch.
  Each waypoint is an uncorrected GoTo through the commander under the session's own lease, with `tolerance: 0` so the commander never skips it, and never a Sync;
  a settle wait;
  one temporary LIGHT frame, recorded as the latest frame of the camera (origin `mountPointing`) and deleted once solved;
  and one solve around the J2000 place of the command, with the solver settings resolved for each stretch of work and no hint typed for an image.
  The pier side recorded is the one the mount reported.
  A frame without a solution is exposed again once, without a slew;
  a waypoint without a solution, or whose solution is more than 5° from the command or differs in scale by more than 5% (provisional) from the session's median, is a rejected sample, kept with its reason and out of every fit.
  Solvers report no quality, so `uncertainty` is never set.
  Five waypoints in a row without a sample pause the session.
  A sample is saved before anything moves again.
  `POST /api/connections/:id/cameras/:deviceId/mount-pointing` starts a session (a repeated token answers it);
  `GET /api/mount-pointing/sessions` lists the latest session of each camera, `…/sessions/:sessionId` reads one, and `mountPointing:updated` carries each change.
- Each stretch of work is one `mount.pointingModel` operation holding the camera and the mount.
  `POST …/pause` and `…/stop` answer 202 at once, since a camera may stay held up to `FRAME_TRANSFER_TIMEOUT`, and cancel it, losing the exposure in progress.
  `…/resume` is a new operation with a token, after the mount, its site, and its state are checked again.
  An operation that ended with a mount that is not quiescent leaves the session `blocked`, because a failed stop shows only in text: a resume is refused until the session is stopped.
  A cancel from outside (an Equipment Control stop) or a failure pauses the session with the reason.
  A camera has one session that has not ended; a session owns its model until it ends.
  An interrupted or stopped model is continued by starting a session with its `modelId`, refused for another mount or site, which visits what it misses.
- Admission (`422`): the plate solver configured, a site reported, not parked, `canGoTo`, `canAbort`, tracking or able to track (started inside the operation and stopped at the end unless the request keeps it), not `ALTAZ`, and `UNKNOWN` only with the operator's confirmation, since nothing can prove a mount is equatorial otherwise.
- A run with at least 12 training samples is fitted by itself with Auto when it ends.
  Limitations: the backend knows no obstacle or cable limit the driver does not report, so the sky is the operator's responsibility; sessions do not survive a restart, and their model then reads `interrupted`.
- Images → Pointing Model Builder (`web/src/camera/PointingModelBuilderPanel.tsx`, a camera operation of camera tabs only) acquires samples and never touches a model.
  It requires the camera to be the Main Camera of the setup, so a model belongs to one optical train, and takes the MOUNT of the setup.
  The exposure time is its own form's; the other camera settings are shown and belong to Camera Acquisition, and the solver is shown and belongs to Images → Plate Solver, each with a link that only selects the tool on the same tab.
  Preview Plan asks `POST /api/mount-pointing/plan`; Start asks for confirmation that the mount is clear to move.
  The mirror (`mountPointingRuntime`, the same store as the model library) follows sessions by camera, by revision, leaving what an event changed during a refresh.
- Pointing Map (`web/src/mountpointing/`): one polar map of the local sky, zenith at the center, north up and east to the right, shared by Images and Tools (`PointingMap`, pure geometry in `skymap.ts`), with the waypoints marked by status, the withheld ones as diamonds, and arrows magnified to show the shape of the errors, never their size.
  It is the single `Pointing Map` view of the bottom area of a camera tab, offered once its camera has a session; the diagnostics live inside that view, and Maximize shows the same map in a dialog.
  The training, leave-one-out, and withheld measures are labelled apart, and a measure that does not exist is a dash.
- Tools → Mount Pointing Model (`web/src/tools/mountpointing/`, `/tools/mount-pointing-model`) manages the models of the MOUNT of the active setup, without any camera tab: it lists its models (an explicit choice lists every mount's), shows the map, the measures, and each sample, and refits, imports, exports, renames, and deletes.
  A model of another mount can be read but never used.
  The fit form and the samples left out are a draft of the tab until Fit asks for a revision.
  Build New Model is its only way to Images: it selects the Pointing Model Builder on the tab of the Main Camera, exactly, by `cameraTabKey`, and is disabled with the reason when there is none, never falling back to another camera.
  Images offers the way back once a session has a model.
  Nothing here starts an exposure or moves a mount.
- Verification (`POST /api/mount-pointing/models/:modelId/verify`, from the Pointing Model Builder, since it needs the camera) tests one revision that passed offline on the sky, without activating it: a `mount.pointingVerification` operation visits independent targets from the other pattern of plan, and at each one sends the mount uncorrected and then corrected by that revision alone (`correctedCommand`), solving both, as a session of kind `verification` that cannot be paused.
  It is the only corrected command outside `MountCommands`.
  The result, added to the revision without touching its samples or coefficients, passes with at least 3 targets and a corrected RMS under the uncorrected one.
  A target the revision refuses is skipped with a warning.
- Software correction (`api/src/mountpointing.corrections.ts`): a GoTo of `MountCommands` (the slew route, the goto route and its in-process form `admitGoTo`, `goToNow` of Mount Remote Control, and `goToWithin`, which sends the first slew of a Target Centering session from inside the operation holding the mount) asks `MountCorrections.plan` what to do with its target, once, and synchronously, since `goToNow` is answered at once, so a model in force is held in memory.
  J2000 and galactic targets are reduced to the frame of the samples, and JNOW, ecliptic, and Alt/Az targets are of date already.
  The command comes from `correctPointingCoordinate`, with the model, the support of the target, the expected pier side, the convergence, and the clamp all checked, since an unusable model reports convergence too, and goes with `tolerance: 0`, so the commander never skips a small one.
  The corrected target is checked against the horizon again.
  A target the model cannot speak for, or within 1° of the meridian with pier terms (provisional), is refused with `422 correctionRefused`, and nothing moves.
  `flip` is never corrected.
  Sync, manual motion, guiding, tracking, park, and home are not GoTos.
  Sessions, the corrections of Target Centering, and dithering use the commander directly, so an active model is out of their way by construction, and no flag can turn it on or off from a request.
- Activation (`POST …/models/:modelId/activate`) is explicit and checks everything with the values of that moment: a revision that passed offline, whose latest verification on the sky passed, the same physical mount and site, the mount free, not `ALTAZ`, and the operator's acknowledgment of what cannot be detected (a native pointing model of the mount or driver, and that a mount that reports no type is equatorial).
  One revision is in force per physical mount, in memory only, and replaces the previous one at once; refits add revisions and never touch it, and a model in force cannot be deleted.
  `POST …/mounts/:connectionId/:deviceId/deactivate` is immediate, moves nothing, and works whatever the mount is doing.
  A restart leaves every mount inactive.
- Suspension: a disconnection, a removal, another site by any path, a Sync, a clock sent to the mount, or an admitted INDI write of `ON_COORD_SET`, `EQUATORIAL_EOD_COORD`, `GEOGRAPHIC_COORD`, or `TIME_UTC` suspends the model at once, with the reason.
  A suspended model never resumes by itself, and GoTos then go uncorrected, with the state shown, so a routine Sync does not block the mount.
  `GET /api/mount-pointing/activations` and `mountPointing:activation` carry the state and the latest GoTo, telling the target asked for from the command sent, and whether the mount took another pier side than expected.
- Limitations: Mount Remote Control reports the position of the corrected command, so a client sees the offset;
  a client talking to the driver directly is not corrected;
  a native model or a Sync made outside Nebulosa cannot be detected;
  the host clock defines the sidereal time;
  a model does not improve tracking between GoTos.
