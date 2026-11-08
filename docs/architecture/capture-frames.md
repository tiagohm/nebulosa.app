# Capture Frames Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `CaptureFrameRegistry` (`api/src/captureframes.ts`) indexes the frames of Camera Capture, Auto Focus, TPPA, Mount Pointing, Target Centering, DARV, Flat Wizard, Dark Library Wizard, and Guiding by physical camera (connection id + device id, never a role, profile, tool, or operation).
  A frame is identified by its `frameId` (`sessionId:generation`, the session that took it and the frame number within it), the acquisition, and its `origin` (`capture`, `autofocus`, `tppa`, `mountPointing`, `targetCentering`, `darv`, `flatWizard`, `darkLibraryWizard`, or `guiding`) names the operation that took it;
  its `imageId` is only the document currently holding its pixels, and a saved frame reopened from its file gets a new one.
  Frames are ordered by a registry-wide `sequence`, never by time, and every change carries a `revision` so a late event never replaces a newer state.
  Every producer shares one latest frame per camera, ordered by the order the registry received them, never by their session numbering, and a write completing late never takes the latest frame back.
  Auto Focus records every sampled and verification frame it decoded, before it is measured and whether or not an HFD could be measured;
  its files are auxiliary and deleted, so its frames are never saved, and only become the latest frame and then transient frames.
  TPPA records its poses and refinement frames the same way, before they are solved, Mount Pointing each sample frame, Target Centering each frame it measures, and DARV the frame of each measurement, before it is analyzed.
  Guiding records only the newest guide frame it previewed, which is never saved.
  Flat Wizard records every trial and final frame from its staging file before it is measured;
  an accepted frame becomes saved through `published()`, the only change of a frame's path, which names the final file it was published under (a frame the registry does not know is recorded from that file), while trial and rejected frames stay previewed only and become transient.
  Dark Library Wizard does the same with every frame it examines, an accepted frame becoming saved through `published()` once it was committed to its plan; the 20 saved frames are only a recent history, and the plan is the ledger of a run.
  `written()` only records the outcome of a write to the path a frame already names.
- Each camera keeps two collections with separate retention: its **latest** frame, the newest one the preview decoded since the server started (previewed only, being saved, or saved), and its **saved** frames, those whose file was written, the only history, of which the newest `FRAMES_PER_SOURCE` (20) are listed first and older ones by pages.
  A frame joins the saved frames only once its write succeeds (a failed write never does), so any number of previewed-only frames never evicts a saved one, and a previewed-only latest frame takes no saved slot;
  a saved latest frame is also the newest saved frame.
  A former latest frame that was not saved is kept in memory as a **transient** frame (at most 20 per camera), never listed nor persisted, only so its state can still be asked for.
- The registry never holds pixels.
  A frame is `memory` while its document is open, `file` when its saved file exists (opened as a new `file` document on demand), `saving` while its file is written and its document closed, or `unavailable` (`expired`, `fileMissing`, `saveFailed`, `restarted`).
  A saved frame the preview skipped is recorded from its file; a skipped frame that was only previewed is not.
  Opening never substitutes another frame.
- The registry owns the closing of capture documents, Auto Focus frames included: the latest previewed frame of each camera stays open, an older one only while a lease holds it.
  `POST /api/capture-frames/frames/:frameId/open` leases the document for a client (the id a page opens `/api/ws?client=<id>` with, `clientId` of `web/src/events.ts`, generated on load since Images documents do not survive a reload);
  `DELETE /api/capture-frames/leases/:lease` releases it.
  At most `MAX_LEASED_FRAMES` (16) documents are kept open by leases besides the latest frames; beyond that an open is refused with `limit`.
  Refusals carry the codes `notFound`, `expired`, `fileMissing`, `saveFailed`, `saving`, `limit`, and `unreadable`.
- When the last socket of a client closes, its leases are released after `LEASE_GRACE` (10 min), so a phone whose screen locked finds its frames again;
  a tab that reopens its socket sends the leases it still uses to `PUT /api/capture-frames/clients/:client/leases`, which releases the others and answers the lost ones;
  a page that unloads releases all of its leases with a beacon (`POST` on the same route).
- `GET /api/capture-frames` is the snapshot of the cameras (with an `epoch` per server run): each camera gives its `latestFrameId`, its `latestAvailableFrameId` (the latest frame, or the newest saved frame whose file exists when the latest cannot be opened or there is none), `latestRestored` (no latest frame since the server started), and `count` of saved frames, every row the database keeps for it.
  `GET /api/capture-frames/sources/:connectionId/:deviceId` gives a page of the saved `frames`, newest first, empty for a camera without frames: the first one with the `latest` frame and the saved frames the registry remembers, and each later one, asked with `?before=` the `next` cursor of the previous page (`&limit=`, 20 by default, at most `MAX_FRAME_PAGE` = 200), the older saved frames read from the database;
  `next` is absent on the last page.
  An older saved frame listed or opened is kept in memory like the others, at most 200 per camera besides those with an open document, so it opens, leases, and reports its state the same way.
  `GET /api/capture-frames/frames/:frameId` gives one frame (latest, saved, transient, or older saved).
  Changes are published as `captureFrame:updated` (frame and camera) and `captureSource:updated` (connection state); neither carries pixels or server paths, only file names.
  A disconnected camera keeps its frames.
- The metadata of every saved frame is a row of `capture_frames` in the operational database (identity, origin, acquisition, size, and path, never pixels), written in the same step that makes the frame saved and deleted when its write is later reported failed;
  previewed-only frames have no row.
  The registry-wide `sequence` continues from the highest row.
  Rows are never pruned and no file is ever deleted with them; a row that cannot be written is reported on the console and never fails the capture.
  After a restart no frame is in memory and no camera has a latest frame: the newest 20 saved frames of each camera are read again, available when their file still exists, and previewed-only ones are gone.
  No directory is scanned.
- Images has a permanent **camera tab** for each connected camera of the profile's watched connection (`deviceState` of `web/src/equipment/equipment.ts`, `reconcileCameraTabs` in `web/src/images/cameratabs.ts`), keyed by connection id + device id, ordered by the role of the camera in the equipment setup of the active profile (the Main Camera, then the Guide Camera, then the others) and then by camera name and id, before the closable file and derived tabs;
  cameras of the same name get the start of their id.
  It is created and removed with the camera, never closed by the operator (`isClosable`: no close button, middle click, or Delete), and switching profile or connection changes the camera tabs.
  A camera that disconnects loses its tab and lease;
  its zoom, pan, display settings, and tool are kept in memory and given back when it reconnects, and the tool of each camera tab and the camera tab selected last also come back after a reload of the tab (see [Persistence and State](persistence-and-state.md)).
- A camera tab shows one frame at a time by its selection: `latest`, the camera's latest available frame (after a restart, the newest saved frame, labelled Latest saved), followed as each newer frame in memory arrives, only the newest of those arriving while one opens being shown;
  `saved`, a saved frame, which new frames never replace;
  `liveStack`, a snapshot of a stack or a color composition of the Live Stacking session of the camera (`showLiveStack`), asked for again when its stacks grow (`followLiveStacks`) and replaced by the latest frame when the session closes, while the frame under it keeps its lease (see [Live Stacking Contract](live-stacking.md));
  or `inspect`, the frame held when Run Detection or Solve Image starts on a followed frame, or a star of it is inspected (`holdCameraFrame`), so the result stays on the frame analyzed.
  Return to Latest follows the camera again without replaying the frames in between, and a capture accepted from the Camera Acquisition panel of the tab does the same for an `inspect` frame (`releaseCameraFrame`), so the tab shows what the capture takes;
  a `saved` frame stays selected.
  A selected frame that cannot be opened keeps the frame shown with the error and never falls back to another frame.
- Showing a frame is one transaction (`showCameraFrame` in `web/src/images/cameratabs.ts`, which states its steps): the frame is leased and rendered with the tab's applied display settings (settings being applied meanwhile become the applied ones and are saved) while the previous frame stays shown;
  then the frame, its document, and its renderings are committed together, zoom and pan are adapted to its size (`adaptView` in `web/src/viewer/transform.ts`), the selected star, the star of the Star Profile Inspector, and the solution are cleared, and the previous lease is released.
  A frame asked for later supersedes one still opening, whose lease and renderings are released.
  Settings being edited in a popup of the viewer toolbar are never applied by a frame change.
  Overlays and results follow the image id of the frame shown, and the Image Inspector shows its camera, connection, origin, frame, storage state, and why it is shown, with the session of an Auto Focus, TPPA, Mount Pointing, or DARV frame and what it was taken for: the measurement or verification and the focuser position its Auto Focus session recorded (`autoFocusFrameFocus`; nothing when not recorded yet), the TPPA step, or the DARV measurement and its result.
  A frame without a known star detection fetches the jobs kept for its image (`GET /api/images/:id/stars`), so the measurements of Auto Focus are shown without a new detection.
- Below the viewer of a camera tab, the capture frames carousel (`web/src/images/CaptureFramesCarousel.tsx`) shows the Latest card first (the latest available frame, Latest saved after a restart, marked New while another card is selected and a newer frame exists), then the saved frames newest first, without the frame Latest already shows.
  Cards show metadata only (a generation number, a label, Latest, Latest saved, or Saved, then time, exposure, a floppy disk icon once the frame's file is written, the Latest card included, a state only while loading, failed, or missing, and a tooltip with id, size, file, and availability; the selected card is marked by its outline alone) and an icon in the area reserved for a future thumbnail;
  no pixels are loaded for them, and the saved frames of a camera are fetched when its tab is shown, and an Older frames card at the end of the strip fetches the next page of older ones while the camera has some (`loadOlderFrames`);
  once one was fetched, the frames of the camera are kept whole, and before that a frame pushed out of the first page becomes the cursor of the older ones.
  A saved frame that cannot be opened shows why and cannot be selected.
  Arrow keys, Home, and End move between cards, Enter or Space selects one; selecting a card only opens and renders its frame, never an analysis.
  The toolbar hides and shows the carousel without changing the selection.
  Neither a card nor the viewer toolbar numbers a frame: `frame.sequence` only orders the frames of the whole registry and grows with gaps, since revisions take from the same counter, so it means nothing to the user.
  `generation` counts within a session and reads "Frame of session" in the Image Inspector.
- On every socket open the snapshot is fetched first (a camera an event of the same server run made newer is kept), then the leases of the camera tabs are reconciled and each tab shows its selection again: a lost lease reopens the same saved or held frame from its file, or the latest one;
  without a frame to show, the tab keeps its pixels and says the frame is no longer available.
- A fixed or loop LIGHT capture dithers between its frames when its request asks for it (`CaptureRequest.dither`, a frozen snapshot; absent, or on a single exposure or another frame type, it never dithers).
  The capture keeps the cadence: it dithers before the frame that follows each `everyFrames` frames taken, after the frame sink's gate and the inter-frame delay, so the delay is followed by the dither and its settle;
  never before the first frame, after the last, during an exposure, or after a stop or an abort.
  The dithering service (`CaptureDithering`, `api/src/dithering.ts`) prepares the method the request names when the capture is admitted, refusing it before anything starts, and runs each dither with a token of the capture and the frame, so a repeated boundary never dithers twice;
  there is no fallback to another method and no skipped dither: a failed dither ends the capture as failed with its reason, the frames already taken kept.
  The session publishes the `dithering` phase and `dither` (completed dithers, whether a mechanical settle runs, the error that ended it), and the capture ends, releasing what its dithers held, only once nothing they commanded still moves.
  **Guided**: the dithers are commands of the named native guiding session (`admitDither` through `GuidingSessions.claimDither`), which must be guiding when the capture starts;
  the claim keeps the manual Dither and any other claimant refused as busy for the whole capture, while the corrections go on;
  each dither resolves with the outcome of its exact command once the guider settled (amount, RA only, and settle of the guide camera's Guiding form).
  Nothing physical is held for them, so a stop or an abort ends the capture at once while the guider finishes its own settle.
  A Target Centering hold on the guiding session's connection fails the capture at its next dither.
  **Mount**: the toolkit's `MountDitherer`, one per capture so its pattern (random, spiral, golden, or grid) runs across it, moves an unguided mount by an angle on the sky (arcseconds in the request) with one timed pulse per axis through the guide output the request names (the setup's `GUIDE_OUTPUT`, which drives the mount whether it is the mount's own port or a camera's ST4; the guide rates of that output and the guide directions of a positive RA and DEC offset, East and North by the nominal convention of the mount's commands unless the operator reversed one for that mount, turn the angle into pulses, and a pulse longer than the request's limit fails without moving; no calibration measures those directions, so a reversed one moves the mount the other way, the offsets are then the intended ones and not the physical motion, and Spiral and Grid come out mirrored, which the panel warns about), or with a small exact GoTo of a tracking, unparked mount (never corrected by a pointing model) that cannot flip it, then waits a fixed mechanical settle, which measures nothing.
  The request names the setup's guide output for a GoTo too, whenever the setup has one.
  The capture is refused while guiding through that guide output runs (`409 guidingActive`) or while another operation holds the mount or the guide output;
  the ST4 port of the camera it captures with is reserved and pulsed like any other guide output, since the capture holds only that camera's sensor;
  otherwise the mount and the guide output are reserved for the whole capture (or must already be reserved by the caller's invocation, which is then reused), so every manual command of them is refused as busy until the capture ends, and guiding through the guide output is held off.
  Each dither runs as a root of that reservation beside the capture; a stop or an abort cancels it, and the end of the capture waits for the motion to drain and for the observed end of its pulses before the reservation is given back.
  A mount lost between two dithers fails the next one as `disconnected`.
  A GoTo dither never flips a German equatorial mount knowingly, from evidence and never the time alone: the capture is refused (`409 meridianFlip`), and a dither fails without moving (through the toolkit's `beforeSlew` on its exact target), while the Meridian Flip Monitor of the mount reports a flip candidate or while the pier side the geometry expects for the target (its hour angle at the mount's site by the host clock) differs from the one the mount reports;
  a mount other than altazimuth or fork that reports no pier side or no site is refused for GoTo dithers (`422 unsupported`), since a flip could not be ruled out.
  A GoTo after which the mount reports another pier side fails the capture, since the field turned.
  Pulses never flip a mount and are not checked.
  A dither near the celestial pole whose disc contains it fails without moving.
  Dither outcomes stay in the session and never enter the frame headers.
- Besides the lossy preview, `CameraCaptures.listenFrames(sink)` (`api/src/captures.ts`) feeds one `CaptureFrameSink` with every LIGHT frame of Camera Acquisition exactly once, identified by its `frameId`: `captured` as each frame is decoded, before the preview may drop it, with an owned copy of its bytes for Preview Only and none for Preview + Save, whose file follows with `saved` once its write completed or `saveFailed`, and `captureEnded` when the session ends.
  The sink is also asked through the `beforeFrame` gate of the toolkit capturer before each frame is prepared, so it can hold the next exposure back (never the one in flight);
  the gate settles on stop, abort, or failure of the capture and never ends it.
  Frames of other frame types and of the composite operations (Auto Focus, TPPA, DARV, the wizards, Target Centering, Mount Pointing) never reach it, nor guide frames.
  A sink never commands the camera, and its failures are logged and never fail the capture.
- Limitations: a previewed-only frame can be opened only while it is the latest of its camera or leased;
  a tab asleep for longer than the grace period may lose such frames;
  analysis results are keyed by image id, so a frame reopened from its file shows none of the results of its first document;
  Latest is the latest frame the preview decoded, and a loop may skip frames between two previews;
  only the cameras of the watched connection have tabs, so the frames of another connection's cameras are not shown;
  a disconnected camera has no tab, so its saved frames are reachable again only once it reconnects;
  the setup has no optical train, so the focuser and mount of a camera tab follow a fixed rule (the FOCUSER only for the MAIN_CAMERA, the MOUNT for every camera of the connection).
