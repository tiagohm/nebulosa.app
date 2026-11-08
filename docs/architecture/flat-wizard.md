# Flat Wizard Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `FlatWizardSessions` (`api/src/flatwizard.ts`) acquires FLAT frames for one camera, filter group after filter group, as one `camera.flatWizard` operation holding the camera, and the assigned filter wheel, flat panel, and dust cover when the request names them, from start to end, including while it waits for the operator.
  Each filter group searches its exposure with trial frames, freezes it, then takes final frames until its count of accepted frames was published.
  The light stays constant within a group: there is no automatic brightness search or sky flat, and the wizard builds no master itself: every published frame is registered in the Calibration Library, with the camera and the filter the file may leave out, and a registration that fails costs the session nothing.
  A session that asks for masters (`generateMasters`, the form's Generate masters after acquisition) hands the frames of every filter it completed to the library once it ended, however it ended (`flatSessionEnded`, after the registrations of its frames), which may queue an automatic master flat per filter (see [Calibration Library Contract](calibration-library.md), Jobs);
  otherwise its flats wait in the library for a person, and a master that cannot start never touches the session.
  Results link to the library and offer **Prepare Matching Dark Flats**, which fills the form of the Dark Library Wizard with one group per exposure saved and moves nothing.
- Every exposure goes through the shared `CameraCapturer` with the camera settings of the request (`FlatWizardCaptureSettings`: gain, offset, binning, subframe, readout mode), frame type FLAT, FITS transfer, and the assigned wheel snooped into the header, written to a staging directory `.flatwizard-<sessionId>` inside `flats/` of the output directory (`directory`, or the default captures directory), where every accepted flat is saved, whatever its camera or filter.
  Frames are measured by `FlatWizardAnalyzer` (`api/src/flatwizard.analysis.ts`) on a worker of its own (`api/src/flatwizard.worker.ts`, embedded by `app/build.ts`) in the digital numbers of the file, never through the normalized documents of the image store.
  Each frame carries the operating point the session commanded that a header may leave out, its readout mode and the origin of its subframe, and the analyzer adds the output bit depth of its file, so the frames of a session can be proven homogeneous.
- Each filter group names a 0-based filter `slot`.
  The filter is named by the name the wheel reports for that slot, or `Filter <slot + 1>` when it reports none or there is no wheel (`filterName`), resolved once when the session starts (`FlatWizardFilterRun.name`);
  that name goes into the file names, the frame context, and every message.
  The filter is selected by moving the wheel to the slot (confirmed by the wheel's reported position), or, without a wheel, by the operator, who puts the filter of that slot in place.
  The light comes from the panel at the group's `brightness` (driver units; absent keeps the reported one) and switched on, both confirmed by the panel's reported state, then `settleTime` seconds when something changed;
  without a panel the operator readies the light.
  A manual step publishes `pending` with a fresh `stepId` (`waitingForFilter`, which also covers a manual light, or `waitingForIllumination`), and only `POST /api/flat-wizard/:sessionId/continue` with that `stepId` resumes it;
  a stale or repeated confirmation is refused with 409 `staleStep`, and nothing else (tab, tool, profile, reconnection) confirms a step.
- Levels are observed DN with an unknown pedestal.
  The plane driving the exposure is the brightest plane of the first usable trial; only it is held to the group's `targetRange`, while every plane is checked for clipping and non-finite samples.
  A trial is `usable`, `clipped` (no observation; the exposure halves, and a clip at the minimum exposure fails), or `noSignal` (fails).
  An out-of-target first observation is followed by a second distinct exposure, never a proportional guess, before `estimateFlatExposure` interpolates or fits an affine response, and levels above the target it cannot explain are taken as saturation and answered with shorter exposures, failing at the minimum exposure (see the search in `api/src/flatwizard.ts`).
  Every exposure the search derives is rounded to whole microseconds, the unit the Calibration Library compares exposures in, so a group, its file names, and its dark-flats share one exact exposure.
  The search fails with an explanation when the target needs an exposure outside the bounds, the estimate is invalid, it would repeat an exposure, or `maximumTrials` is exceeded.
  Trial files are deleted after measurement and never published.
- A final frame is `accepted` when its target and finite-sample checks pass and clipping is not present, even when its absence cannot be proven without `effectiveClip` (the frame then carries `effectiveClipUnknown`);
  `rejected` when a check fails;
  `inconclusive` otherwise.
  An accepted frame is published under `{date}_{time}_{camera}_FLAT_{filter}_{seq}.fit` by a hard link of its original bytes (an exclusive copy where links are unsupported), never replacing an existing file; a rejected or inconclusive one is deleted.
  More than `maximumRejections` rejected or inconclusive frames, or a failed publication, fail the session; published frames always stay.
- Once a group has its frames, `finalizeFlatSequence` evaluates their temporal stability from the retained samples (outliers at 5 robust sigmas); fewer than three frames, or frames the toolkit refuses as one stack, are `notEvaluated`.
  The result only describes the acquisition: no frame is deleted, replaced, or modified for it.
- An assigned dust cover (`cover`, refused with 422 when it cannot open and close) is closed before the first frame (`closingCover`, confirmed by its reported state) and held for the whole session.
  A cover already closed when the session starts stays closed afterwards; one the session closed, or began to close, is opened again once the session ended, however it ended, after the light was switched off.
- A light the session switched on is switched off after the operation ended, with the panel taken again if it is free; otherwise, and likewise for a cover that cannot be opened again, `cleanupWarning` says what was left.
  Stopping (`POST /api/flat-wizard/:sessionId/stop`, 409 `notRunning` once ended) cancels the operation at once: the exposure in flight is aborted and lost, a measurement or a manual step is abandoned, and the request resolves after the devices were released and the light cleanup ran.
  A disconnection of a held device cancels the session the same way.
- Session states: `preparing`, `closingCover`, `waitingForFilter`, `movingFilter`, `waitingForIllumination`, `settingLight`, `settling`, `exposing`, `measuring`, `saving`, `assessingSequence`, `stopping`, then `completed`, `cancelled`, or `failed`;
  filter groups go `pending`, `calibrating`, `acquiring`, then `completed`, `failed`, or `cancelled`, with their counts of trials, accepted, rejected, inconclusive, and failed publications.
- `POST /api/connections/:id/cameras/:deviceId/flat-wizard` starts a session (202 with `sessionId` and `operationId`; a repeated token answers the same session), refused with 404 for an unknown camera, wheel, panel, or cover and 409 when one is disconnected or held, or the camera's session is running.
  Sessions live in memory, the latest of each camera: `GET /api/flat-wizard` and `GET /api/flat-wizard/:sessionId` are the snapshot and the complete record with the latest 200 exposures, and `flatWizard:updated` summaries carry the latest exposure and, while a frame is exposed, its progress as the driver reports it (`exposure`: elapsed and remaining microseconds and percent, cleared once the frame was read).
  File names are published without their directory.
- Every frame is also decoded from its staging file into the image store and recorded in the capture frame registry (origin `flatWizard`, the `frameId` of its exposure in the session; see [Capture Frames Contract](capture-frames.md)), so the camera tab shows it;
  an accepted frame becomes saved under its published file, while trial and rejected frames stay previewed only.
  A frame that cannot be decoded is reported as `previewError` and never fails the session.
- Limitations: without a wheel, the filter name only names the files and the session; it is not written into the FITS header; sessions do not survive a restart.
