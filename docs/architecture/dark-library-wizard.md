# Dark Library Wizard Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `DarkLibraryWizardSessions` (`api/src/darklibrarywizard.ts`) acquires the raw DARK frames of a capture plan for one camera, group after group, until each group has its accepted frames, as one `camera.darkLibraryWizard` operation holding the camera and only the wheel, panel, and cover its protection selected, from start to end, including while it is paused or waits for the operator.
  It is a camera acquisition: browsing, importing, masters, bias, reuse by the Sequencer, and defect maps are not part of it, and no pixel it saves is ever calibrated, debayered, or rewritten.
  A plan records what its frames are for (`purpose: 'darkFlat'`, absent for a dark), since the same light-blocked capture serves both and a driver may write either as DARK, and whether it wants masters (`generateMasters`), both optional fields of the request.
  Every accepted frame is handed to the Calibration Library as soon as it is published (`registerDark`), with what its plan declares about it, and the plan once its session ended, however it ended (`darkSessionEnded`, after the registrations of its frames), which, when the plan asked for masters, may queue one master per complete group (see [Calibration Library Contract](calibration-library.md), Jobs);
  a master that fails never touches the session.
  A group short of its frames stays a state of the library: a provisional master is an operator's decision there.
- A plan is immutable: its groups (exposure in seconds, target temperature in °C or none, accepted frames), the camera settings shared by them (`DarkPlanCapture`: gain, offset, binning, subframe, readout mode), the protection, the thermal protocol, and the rejections allowed per group.
  A group is identified by the exact values of its settings (`darkGroupKey`), never by a rounded label, and groups run so one temperature is finished before the next, keeping the requested order within it (`orderDarkGroups`).
  The physical camera is identified by `hardwareId`, never by a connection id, a role, or a name, and the plan records the camera of the Equipment Catalog the camera is bound to when it is made (`camera.cameraId`), which every frame of it is recorded against; a camera bound to none is refused with 409 `cameraNotCataloged` (see [Equipment Catalog Contract](equipment-catalog.md)).
  Limits of size live in the form (`DARK_LIBRARY_WIZARD_MAXIMUM_*`); the server checks only facts about devices and plans, and the fixed frame type is DARK, the transfer FITS, uncompressed.
- Protection is any combination of a wheel slot (`darkFilter`, 0-based), a closed cover, an unlit panel, and a manual cap.
  Each selected device must be present: one that is missing refuses the start with `protectionUnavailable` instead of becoming manual, and a slot the wheel does not have is refused with `invalidFilterSlot`, because the commander clamps a slot it cannot reach.
  The order is fixed so a cover never moves with a lit panel: `disablingPanel`, `movingDarkFilter`, `closingCover`, each confirmed by the reported state.
  What hardware cannot verify, the manual cap, the opacity of the filter at the slot (its name proves nothing), and an unlit panel when it is the only barrier, is the operator's to ensure before starting: the start, and a resume, are that assertion, and no step asks for it.
  Only `POST /api/dark-library-wizard/:sessionId/continue` with the published `stepId` confirms a step; a stale or repeated one is refused with 409 `staleStep`.
- The verified state is read again synchronously right before every exposure, through the capturer's `beforeExposure` hook, with nothing awaited until the command leaves.
  A device that left it publishes a `protectionLost` step and no frame is taken until it returned.
- Temperature is what the sensor reports.
  A group with a target needs `canSetTemperature` and a thermometer, or the start is refused with `temperatureUnavailable`.
  The cooler is switched on if it can be, the target is commanded once, and the session waits (`cooling`, `stabilizing`) until readings stay inside the tolerance for the hold time, failing with `temperatureTimeout` otherwise.
  The defaults are ±0.5 °C, 120 s, and 30 min.
  A reading stands until the driver changes it, since drivers and the thermometer manager report only changes: silence is recorded as the `age` of the reading and fails nothing, and only a recent Alert does.
  A reading out of tolerance before an exposure repeats the hold without commanding again.
  During an exposure readings are sampled every second into a trace (start, end, extremes, seconds out of tolerance);
  more than 10 % of the exposure out of tolerance rejects the frame (`temperatureExcursion`), less only notes it (`temperatureTransient`, accepted with warnings).
  A group without a target records what the camera reports and claims nothing, and a camera without a thermometer records `temperatureUnverified`.
  The cooler is never switched off, warmed, or given back a setpoint.
- Every exposure goes through the shared `CameraCapturer`, one frame per capture, into the staging directory of its plan, and is measured by `DarkLibraryWizardAnalyzer` (`api/src/darklibrarywizard.analysis.ts`) on a worker of its own (`api/src/darklibrarywizard.worker.ts`, embedded by `app/build.ts`) in the digital numbers of the file.
  `assessDarkFrame` decides it.
  A proven failure rejects it: unreadable, a header that reports another frame type, exposure, gain, offset, or binning, a size off the request by more than 16 pixels (drivers trim) or other than the first frame of its group, non-finite samples.
  A keyword the driver omits is only a note.
  A suspicion of light never rejects a frame: saturation, a level or tile spread above the baseline of the group once it has one, or a level above `m(t₀)·t/t₀` of a shorter exposure at the same operating point, which holds whatever the pedestal is (thresholds in the constants of `api/src/darklibrarywizard.analysis.ts`).
  Amp glow, hot pixels, gradients, and pedestal are the signal a dark records, so no rule uses an absolute brightness or the gradient of one frame.
- Verdicts: `accepted` and `acceptedWithWarnings` count, `rejected` (a proven failure) and `incomplete` (never examined) do not.
  A suspicion on the first frame of a group, when `verifyFirstFrame` is on, and two in a row anywhere, wait in `waitingForDecision` with a `suspectedLight` step: continuing records the frame as acknowledged, and stopping quarantines it.
  Other suspicions are recorded without stopping.
  More than `maximumRejections` rejections fail the session with `verificationFailed`.
  A group completes on accepted frames, never on commanded exposures, and `GET /api/dark-library-wizard/:sessionId` keeps the latest 200 exposures.
- A plan lives in the memory of its session (`DarkCapturePlan` in `api/src/darklibrarywizard.plan.ts`), and nothing of it is written but its frames: they live together in `<directory>/darks/`, whatever the camera, plan, or group, each named by when it was taken, its camera, its role with the exposure and target temperature of its group (or, without a target, the sensor temperature measured during the frame, rounded to whole degrees), and its sequence (`2026-11-03_21-04-05-123_ASI294_DARK_300s_-10C_0001.fit`, `DARKFLAT` for dark-flats);
  the rejected ones in `darks/rejected/`, and the frames being acquired in `darks/.staging/<planId>/`, a directory per session that goes once the session ends with it empty.
  An accepted frame is published without replacing anything (`publishFrame`), and only then counts and is registered in the Calibration Library.
  A frame number is unique in its group.
  Every start makes a new plan, and nothing lists, completes, or reuses one: what was acquired is what the Calibration Library registered.
  Nothing is kept to resume: a plan that ended short of its frames stays that way, a session the server did not finish ends with it and what its staging held stays there uncounted, and the missing frames are a new start.
  Nothing is ever deleted, and nothing starts a device by itself.
- Pausing (`/pause`) takes effect after the current frame was examined and saved, and keeps every device held, reported as the operation's progress, because releasing them would let the protection be undone unnoticed;
  a pause can be withdrawn until then.
  After `/resume` the verified devices are read again before the next exposure and the temperature is confirmed again.
  Stopping (`/stop`) cancels the operation at once, the exposure in flight is lost, and published frames stay.
  A disconnection of a held device cancels the session the same way.
- Once the operation ended (`restoring`), whatever staging holds is quarantined, the panel is confirmed off whatever it was before, the wheel returns to the slot it started at if the session moved it, and the cover opens if the session closed it and the panel is known to be off.
  A cover found closed stays closed.
  A cancelled operation cannot start new work, so each device is taken again only if no other operation took it first; what could not be restored is listed in `cleanupWarnings` and recorded in the plan.
- Session states: `preparing`, `disablingPanel`, `movingDarkFilter`, `closingCover`, `waitingForProtection` (a `protectionLost` step), `cooling`, `stabilizing`, `exposing`, `measuring`, `publishing`, `waitingForDecision`, `paused`, `stopping`, `restoring`, then `completed`, `cancelled`, or `failed`;
  groups go `pending`, `acquiring`, then `completed`, `failed`, or `cancelled`.
- `POST /api/connections/:id/cameras/:deviceId/dark-library-wizard` starts a session (202 with `sessionId`, `operationId`, and `planId`; a repeated token answers the same session).
  Refusals and a failed session carry a `DarkLibraryWizardErrorCode`.
  Sessions live in memory, the latest of each camera: `GET /api/dark-library-wizard` and `GET /api/dark-library-wizard/:sessionId` are the snapshot and the complete record, and `darkLibraryWizard:updated` carries every change, without paths.
  No route lists or reads plans.
- Every examined frame is decoded from staging into the image store and recorded as the latest frame of its camera (origin `darkLibraryWizard`); one that cannot be decoded is reported as `previewError` and is still examined from its file.
- Limitations: an image cannot prove the absence of light, and in the first group of a plan there is no baseline, so only saturation raises a suspicion there;
  a driver that silently stops reporting temperature looks like a stable sensor, and only the age of the reading tells them apart;
  between the end of a session and its restoring, another operation can take a device, which is then reported rather than restored;
  the size checked for a full frame assumes the driver's reported maximum;
  a directory deep enough to pass the 260 characters of a Windows path fails the capture, which is reported and counts nothing;
  the provenance a driver leaves out of a header is kept only in the Calibration Library, since files are never rewritten.
