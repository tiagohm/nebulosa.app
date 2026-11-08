# Calibration Library Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Calibration Library is the single owner of which calibration frames exist, whether they can be combined, and which masters were made of them.
It needs no connection, claims no device, and takes no part in `OperationRegistry`; a wizard only acquires frames, and asks for a master through the same path as a person.
The library lists the masters that match a target (`POST /api/calibration-library/resolve-preview`, metadata only) and never picks one.
Image Stacking calibrates its lights with the masters an operator chose among those and reads them through `pinnedMaster`, which answers a file only while its SHA-256 is the one chosen and it is neither unavailable nor stale, and `lease`, which refuses the deletion of a master (`masterInUse`) while an analysis reads it.

- **Sources.**
  Frames come from three places, always by reference: accepted frames the Dark Library Wizard publishes, registered as they are published with what their plan declares (`registerDark`; the library compares files itself, and a missing file can come back);
  frames the Flat Wizard publishes;
  and directories and files an operator imports.
  An import (`POST /imports` with `{ paths, recursive }`, refused with `404 notFound` when a path cannot be read) is a cancellable scan of headers of directories and single files, each file found once whichever path or name reached it, reviewed before it is committed, that skips `.staging`, `rejected`, and `.flatwizard-*`;
  it may copy files under the library instead.
  Frames are never written, and nothing is inferred from a file or directory name.
  Only an operator deletes: `DELETE /sources/:sourceId` removes one frame and its file, wherever it is, and `DELETE /groups/:groupId` every frame of a group with their files;
  masters made of them stay, a frame whose file cannot be deleted stays, and a frame or group a master is being built from cannot go.
- **Evidence.**
  Every value is `verified` (the file), `planDeclared` (an immutable plan or the wizard session that took it), `operatorDeclared` (an override an operator declared, only over an unknown value), or `unknown`.
  Nothing identifies a physical camera: frames of the same geometry and settings combine whatever camera took them, and the camera name a header or a wizard gives is only shown and filtered by.
  There is no optical train in the application, so a flat groups by `FILTER`, `TELESCOP`, and `FOCALLEN`, and what is missing asks for a review.
- **Compatibility.**
  `calibrationlibrary.compatibility.ts` is pure.
  A versioned key holds every property that must agree per kind; exposures are integer microseconds, so 179.9 s and 180 s never merge.
  Between frames, a known difference blocks, unknown never matches a known value, and a group has an explained state (`ready`, `needsReview`, `incomplete`, `incompatible`, `missingFiles`, `notSupported`), never a score.
  A master matches a target (`matchesTarget`) when every property both know agrees, a dark within 1 °C of the temperatures of the target (of their range when its frames vary, so the lights of a camera whose temperature drifts or oscillates take any dark inside the range they span) and a flat with its filter;
  what either does not know never refuses one, since the operator chooses among those listed.
  There is no closest master, no dark scaling, no temperature interpolation.
- **Products.**
  Every build publishes a new immutable master, however many there are of the same frames and recipe: a `master.fit` in `products/<masterId>/`, and its row, which says everything else about it (recipe, metadata, diagnostics, sources with their digests, dependencies).
  `masterId` is an incremental integer that is never used again (`AUTOINCREMENT`), and with the time it was published tells masters of one group apart; a master keeps the id of the group of its frames, which lists its latest masters.
  `DELETE /masters/:masterId` removes one master with its directory, refused (`masterInUse`) while a master or a job depends on it, which the database enforces too.
  A master is `unavailable` while its file is missing or of another size and `stale` while a master it depends on is unavailable, and returns to the state it was published with once neither holds, checked when the library opens and on every refresh;
  `GET /masters?status=` filters by it, and `?groupId=` by group.
  Dark, bias, and dark-flat masters are Float32 FITS in DN, keep their pedestal, and take no normalization.
  A master flat exists only from flats corrected by a master dark-flat or bias, is dimensionless, has a median of 1 per plane (CFA phase or channel), and is marked `calibratedNormalized`, so no calibrator subtracts a pedestal twice.
  A master in DN must be read with `sampleScale: 'digital'` (see Calibrating a light): the normalized read rescales float data outside 0..1 per image.
  The header is written from metadata, never copied, so no stale `BZERO` reaches it.
- **Jobs.**
  Master builds and import scans are jobs of this process, kept in memory only, with the exact frames a build saw: they survive the tab, never the server, and nothing of them is written but the staging of a running build.
  The latest 100 ended jobs are kept, and older ones forgotten.
  A request always queues a new job (`202` with its `jobId`), and only a repeated token meets the job it started; a completed job names the master it published.
  One master integrates at a time on `calibrationlibrary.worker.ts`, with its own queue instead of `AnalysisScheduler`, which needs an open document.
  A wizard's session end queues automatic jobs, from the frames of one group each and only when every frame is usable and nothing but the temperature asks for a review: `flatSessionEnded` one master flat per completed filter, corrected by the newest matching master dark-flat, else the newest matching master bias (never a stale or unavailable one, and none is queued without one), and `darkSessionEnded`, when the plan asked for masters, one master per complete group.
  An automatic job waits while an operation of a `camera.` kind runs (a capture, a wizard, guiding).
  Progress is a heartbeat: there is no limit on a job, but a worker silent for two minutes is terminated.
  A restart forgets every job, the masters a wizard asked for among them, and removes all staging; nothing asks for them again.
  No route lists, cancels, or retries a master job (the snapshot carries the active ones and the latest of the wizards): a new request builds a master again, and the group shows its latest build;
  only the scan of an import can be cancelled (`/imports/:jobId/cancel`).
  The review of an import pages its candidates (`/imports/:jobId/candidates`, `ImportCandidatePage`), each page also answering `ready`, how many of all of them a commit adds as they are; the roles an operator declares are kept across pages.
- **Memory.**
  A build reads a strip of rows per frame within a budget of 256 MiB (see `api/src/calibrationlibrary.analysis.ts`).
  Tile-compressed FITS and XISF, which have no addressable rows, decode once into a raw spill file in `staging/`, which trades memory for disk; `recipes/validate` reports it.
- **Publication.**
  The worker writes and reads back its file in `staging/<jobId>/`;
  the server compares the sources with what the job saw, takes the next master id and records the master as `publishing` in one transaction, renames the directory into `products/<masterId>/`, and only then makes it `published` with the digests of its sources.
  Deleting a master records it as `deleting` before its directory goes.
  At the next start, a `publishing` master whose `master.fit` has the recorded size and SHA-256 is published and any other is forgotten, its id staying taken;
  a `deleting` one loses its directory and row;
  a directory of `products/` without a row moves to `calibration-library/orphaned/<name>-<uuid>/` and is reported, never adopted nor deleted;
  and all staging is removed.
  A change of a source is seen by size and modification time at publication.
  Files reached through two names are told apart by their device and inode (`fileIdentity`).
- **Persistence.**
  `CalibrationLibraryStore` keeps the frames (`calibration_sources`, with what an operator declared about them) and the masters (`calibration_masters`, `calibration_master_sources`, `calibration_master_dependencies`) in the operational database;
  the products stay files.
  Jobs and what an import found are never written.
  An override, a role, an exclusion, or a deletion changes its rows in one transaction, with no history.
- **Boundaries.**
  `GET /api/calibration-library` (`CalibrationLibrarySnapshot`: an epoch per process, a revision, frames and masters counted by state and role, the camera names, the active jobs, and the latest jobs of the wizards), `calibrationLibrary:changed`, `calibrationLibrary:jobUpdated`, and `calibrationLibrary:masterUpdated` carry ids and no paths, and job errors hold file names or codes, never a filesystem message;
  a path comes only from a detail route.
  Frames with a BITPIX of 64 are `notSupported`.
- **Calibrating a light.**
  Image Stacking, Live Stacking, the guide frames of Guiding, and the frames iPolar solves (a pinned dark, `api/src/calibrationdark.ts`) apply masters;
  any other calibrator reads `/api/calibration-library/masters`, keeps the `masterId` and `contentDigest` it used, reads the file with `sampleScale: 'digital'`, and converts it with `calibrationMasterImage(master, fullScaleDn)` (1 for a flat).
  The recipe is `(light - dark) / flat`, or `(light - bias) / flat`, on the raw mosaic before debayering: a master dark already holds the bias, so no bias is subtracted after it, and a master flat is passed to `calibrate` with `flatRepresentation: 'calibratedNormalized'`, which refuses a dark-flat because the flat already includes it, and with `darkScaling: 'none'`.
  Its dead pixels are not repaired: `invalidFlat: 'passthrough'` leaves those samples without flat correction.
- **Tool.**
  Tools → Calibration Library (`web/src/tools/calibrationlibrary/`, `/tools/calibration-library[/<group id>]`) mirrors the server through `web/src/calibrationlibrary/calibrationlibrary.ts`, a snapshot and the jobs in `SERVER_STORES` and pages fetched by the view, again whenever a change arrives.
  Library shows the coverage of a page of groups by camera name and operating point (a group covered only by a master of its own role), their states, and the latest master of each, a flat group whose frames have several exposures named by their range (`exposures` of its summary), since only a bias corrects them together;
  Frames shows each frame, how each value is known, and the review that declares an unknown value or leaves a frame out, without asking why;
  an import declares the role of a file its header does not say the same way;
  Frames and Masters open a file in Images through `openImage`;
  Masters lists every master, named by its id and the time it was published (`masterName`), with its provenance, and the details of a master list under its state what puts it there (`masterWarnings`: too few frames, what was accepted when building it, a missing file, an unavailable correction).
  The camera filter lists the camera names of the frames.
  Import Frames opens a dialog that adds directories, and files several at a time (the `multiple` file chooser), both choosers starting in the directory listed last (`lastCalibrationDirectory`, view state in localStorage), lists them to remove one, and then scans and reviews them;
  committing adds the frames and closes the dialog.
  A group that needs a review says that what is listed cannot be verified from the files, and that accepting it in Build Master, or declaring the missing values on its frames, is how a master gets built.
  A frame, a group, and a master are deleted after a confirmation.
  Build Master builds a new master on every request, of a dark group as a Dark or a Dark-Flat (`MasterRequest.kind`, for dark-flats a capture recorded as darks; the master keeps its group, and frames of any other role keep theirs), stays busy, with its progress, while the latest build of its group runs, and shows why it failed.
  The build form asks the server to explain every change (`recipes/validate`) and lists only what the recipe adds to the findings of its group, so nothing about compatibility is decided in the tab.
  Viewers read a master through the normalized pipeline, which is for looking at it, not for measuring.
