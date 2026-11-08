# Live Stacking Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Live Stacking integrates the light frames of Camera Acquisition as they arrive, into online stacks a camera tab shows and an operator saves.
It is a server-owned analysis session, not an operation: it never commands a device, holds none in `OperationRegistry`, and never stops or slows Camera Acquisition beyond the gate below.
It covers the session of a camera (`api/src/livestacking.ts`), the grouping policy (`livestacking.groups.ts`), the engine of fields and stacks (`livestacking.engine.ts`, on `livestacking.worker.ts`), and the saved stacks (`livestacking.store.ts`).

- **Session.**
  One session per exact camera (connection id + device id), never a role, profile, or tab, started with `POST /api/connections/:id/cameras/:deviceId/live-stacking` (`LiveStackingStartRequest`: a token, the recipe, the calibration): `201` when started, `200` with the session its token already started, `409 sessionConflict` while another session of the camera runs;
  a stopped or failed one is closed first.
  It spans any number of captures and changes of filter, settings, or output mode, and outlives tabs and sockets.
  Its state is `waiting` or `processing` while it admits frames, `paused` (arrivals skipped, admitted frames still integrated), `stopping` (no arrival admitted, the admitted ones integrated), `stopped` (its stacks viewable and saveable until `DELETE /sessions/:sessionId` closes it), or `failed` (its worker failed and its stacks are lost, so a view or a save answers `409 workerFailed`).
  `GET /sessions/:sessionId` reads a session, and `POST /sessions/:sessionId/<command>` sends `pause` (of a running session), `resume` (of a paused one), `stop`, `abort`, or `reset` (not of a failed one), a command out of its state answering `409 invalidState`: `abort` skips the queued frames as aborted, completes the one being integrated, and keeps the stacks;
  `reset` discards the stacks and fields and keeps integrating the admitted frames.
  A restart forgets every session.
- **Frames.**
  The capture service feeds every LIGHT frame of Camera Acquisition to the session of its camera through its frame sink (see [Capture Frames Contract](capture-frames.md)), deduplicated by capture session and generation, never by name, time, or document.
  Preview Only frames are copied once and queued in memory;
  Preview + Save frames queue only their identity until their write succeeded, then are read from their file, never from a partial one, and fail to be delivered when the write fails or their capture ends first.
  Every received frame ends in exactly one of `accepted` (into one stack), `rejected` (read and refused: too few stars, poor quality, no matching or confirmed field, too little overlap, a failed normalization, an incompatible grid, no memory left, chosen masters unavailable, incompatible, or unreadable, an unreadable frame), `skipped` (on purpose: paused, aborted, not a light, an unclassified filter, unknown metadata, no masters chosen), or `deliveryFailed` (its write failed, its pixels or file never came, the backlog limit, the worker failed, the session failed);
  `received = queued + processing + held + accepted + rejected + skipped + deliveryFailed` always.
  Frames are only counted: why each one ended is not kept or served.
- **Backpressure.**
  At most `MAX_PENDING_PAYLOADS` (2) Preview Only frames of a camera are held in memory, the one being integrated included: while the queue is full, the `beforeFrame` gate of the capture waits before the next exposure is prepared (never during one), and a stop, an abort, a pause, a failure, or the end of either side releases it.
  Saved frames queue at most `MAX_SAVED_BACKLOG` (1000) identities; beyond either limit a frame fails to be delivered.
  Frames are integrated one at a time, in order, on a worker per session (`WorkerProcessor`), which is terminated when an integration or an export stalls past `INTEGRATION_STALL_TIMEOUT` (120 s) or crashes: the session fails, its pending frames fail to be delivered, and the capture goes on.
  Measured on a 4-core Intel Core i5-6500T, a 16-bit frame calibrated with a dark and a flat integrates in 0.45 s at 1 MP mono, 10 s at 26 MP mono, and 5.5 s as an 11.7 MP mosaic (star detection is 65 to 85% of it), and a 26 MP mono export takes 5.6 s: the queue of two keeps the camera busy whenever a frame integrates faster than the next one is exposed, the saved backlog is at most 2.8 hours of integration at 26 MP, and the stall timeout leaves ten times the slowest request.
- **Grouping.**
  The header of each frame decides its group (`inspectHeader` of the Calibration Library): the filter is exactly its `FILTER`, trimmed, as Image Stacking keeps it (None without a filter wheel snooped into the capture; unclassified, and skipped, when one was snooped but the header names none);
  a frame that is not a light, or whose size or exposure is unknown, is skipped.
  A segment is the filter, the acquisition cohort (`cohortKeyOf`: camera, geometry, sample type, CFA layout, binning, gain, offset, readout mode, exposure in integer microseconds, unknowns never matching known values) and the calibration policy (`segmentKeyOf`);
  temperature is not keyed.
  A field is one pointing and its grid: its reference is the first frame of its geometry (`geometryKeyOf`) with at least the minimum stars, and every stack of the field is resampled onto it (`LiveStackingField` of the toolkit), so stacks of different filters on one field can be composed.
  A frame joins the stack of its segment on the field it registers onto, the most recently used first;
  a frame that registers onto none is held, and a new field starts only once `FIELD_CONFIRMATION_FRAMES` (3) held frames register onto one another, or when an operator asks for one (`POST /sessions/:sessionId/fields`);
  otherwise the held frames are rejected (`unconfirmedField`, `fieldMismatch`).
  A field is never replaced or moved.
- **Integration.**
  Each stack is a toolkit `LiveStacker` on its field, whose photometric reference is its own first frame, so a filter is never normalized to another;
  its recipe (`LiveStackingRecipe`: `average` by default or `weighted-average` with a frame weighting, `background-scale` normalization, `bilinear` resampling, the minimum stars and overlap, optional HFD and SNR limits) is locked into the stacks of the session, and its sums are Float64.
  A rejected frame changes no stack.
  Quality only gates through the stars and the registration by default, so a dim narrowband frame is kept.
- **Calibration.**
  The masters an operator chose for a filter (`LiveStackingCalibration.filters`, by exact filter name) are pinned by id and content: for each frame, `pinnedMaster` must still return them and `matchesTarget` must accept them for that frame (a dark within 1 °C of its temperature and of its exact exposure), else the frame is rejected;
  they are leased while it is read and applied as Image Stacking does (`calibrateLight`: `(light - dark) / flat`, a bias only without a dark, the unusable pixels of a flat masked).
  The Calibration Library never chooses: a filter without masters is integrated uncalibrated, in stacks of its own, or skipped (`otherwise`).
  Changing the masters (`PUT /sessions/:sessionId/calibration`) starts other stacks for the frames that follow; no stack is ever recalibrated or mixes calibrated and uncalibrated frames.
- **Memory.**
  The engine reports the bytes it retains (field references, stacks by `liveStackerMemoryBytes`, held frames, the masters read), and every new field, stack, or held frame is refused with `capacityExceeded` when every session together, with their queued frames, would exceed `DEFAULT_LIVE_STACKING_MEMORY_BUDGET` (4 GiB);
  nothing is ever evicted.
  The retained bytes match `liveStackerMemoryBytes` with the reference and masters exactly: a 26 MP mono field retains 1170 MiB for its first stack with a dark and a flat and 846 MiB for each other filter, so the budget holds four 26 MP mono filters of one field, or one 26 MP color stack of a one-shot-color camera with the candidates of a new field.
  It bounds retained memory only: the transient work of a 26 MP frame, snapshot, or composition peaks 1.0 to 1.4 GiB above it, and the snapshot documents of the image store are not counted.
- **Views.**
  `POST /sessions/:sessionId/views` with a stack (`{ cohortId }`) or a composition (`{ composition }`: mono stacks of one field mixed as Image Stacking composes masters, `mixChannelRows` and `blendLuminanceRows`) answers a snapshot as a derived document of the image store (provenance `liveStacking`), with the header of a saved stack (the camera and settings of its first frame, `NCOMBINE`, `TOTALEXP`, and the method and masters in `HISTORY`; pixels no frame covered are 0 instead of NaN), so a save from the viewer toolbar writes what it integrates, taken again only when its stacks changed and the previous one is older than `SNAPSHOT_INTERVAL` (1.5 s);
  a session keeps at most four such documents open.
  A snapshot runs on the worker between integrations: a mono stack takes 20 ms at 1 MP and 0.45 s at 26 MP, a composition of two stacks with a luminance 0.13 s and 3.2 s, so a color view of frames slower than the interval takes about a third of the worker.
  Snapshots are linear: display stretches never change a stack or a save.
- **Saving.**
  `POST /sessions/:sessionId/exports` with a stack or a composition writes one consistent revision as a linear Float32 FITS (the frame being integrated ends first and no other starts until it is written, so its frames, exposure, and header describe its pixels) (`stack.fit`, NaN where no frame covered a pixel; a stack also `coverage.fit`) whose header records the accepted frames, total exposure, method, and masters, in `live-stacking/staging/<id>/`, records it as publishing in `live_stack_products`, renames it into `live-stacking/products/<id>/`, and marks it published;
  Preview Only sessions save the same way and keep no light frame.
  `GET /api/live-stacking/products[/:productId]` lists them and gives the paths to open in Images; `DELETE` removes one.
  At start, interrupted publications are finished or forgotten, directories without a row are moved to `live-stacking/orphaned/`, and staging is cleared.
- **Boundaries.**
  `GET /api/live-stacking` (`LiveStackingSnapshot`: an epoch per process, a revision, every session, and the memory in use) and `liveStacking:updated` (a session), `liveStacking:closed`, and `liveStacking:products` carry no pixels and no paths;
  a client drops an event or snapshot of an older revision.
- **Tool.**
  Images → Live Stacking of a camera tab (see [Workspace Responsibility Matrix](workspace-responsibility-matrix.md)) mirrors the sessions through `web/src/camera/livestacking.ts` in `SERVER_STORES`: a session by revision, forgotten with an older epoch, and the saved stacks on demand.
  A color preset is resolved by `presetSources` of `web/src/tools/imagestacking/presets.ts`, shared with Image Stacking: the most recently updated mono stack of each filter of one field, filters recognized by their canonical names.
- Limitations: a session survives no restart and recovers nothing;
  frames received before a session started are not replayed;
  a stack is calibrated only with masters chosen before its frames arrive;
  held candidates of a new field and the masters read count against the memory budget;
  a color stack of a one-shot-color camera cannot be composed with mono stacks.
