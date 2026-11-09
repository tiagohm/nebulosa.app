# Persistence and State

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Profiles, presets, panel and view preferences: `api`, database (`profiles`, `profile_equipment`, `profile_preferences`, `profile_camera_settings`, `profile_mount_bindings`, `framing_references`);
  the fields `schema.ts` marks as view state in browser storage (`web/src/profile/view.ts`)
- Saved connections and the last highlighted one: `api`, database (`saved_connections`); the highlighted one in tab memory
- Observing sites and the site each profile observes from: `api`, database (`observing_sites`, `profiles.active_site_id`); the site a tool chooses for itself in tab memory
- Active profile: browser storage (`web/src/profile/view.ts`): the tab across its reloads, and the profile used last in the browser for a new tab
- Route: URL path
- Document view, zoom/pan, camera tab presentation, astrometric measurements, markers, and target: tab memory; the tool of each camera tab and the camera tab selected last in browser storage (`web/src/profile/view.ts`)
- Panel sections expanded: browser storage (`web/src/profile/view.ts`)
- `sunState`, `moonState`, `skyImageState`, `closeApproachesState`, `observingPlannerState`, `jupiterPlannerState`, `saturnPlannerState`, `planetaryEventsState`, `artificialSatellitesState`, `skySatelliteState`: tab memory
- Target Centering target being typed: browser storage (`web/src/profile/view.ts`), the tab across its reloads
- Image pixels: `api` image store, memory only
- Star detection, streak detection, plate solving, and annotation jobs and results: `api` analysis services, memory only
- Image processing jobs and unclaimed outputs: `api/src/imageprocessing.ts`, memory only
- Captured frame files: `api`, `captures/` under the data directory by default (`DEFAULT_CAPTURES_DIR`)
- Saved capture frames (metadata, no pixels): `api`, database (`capture_frames`), one row per saved frame, written when its file is
- Capture frame leases: `api`, memory, per client id
- INDI property subscriptions: `api`, memory, per socket
- INDI driver messages of a device (latest 100 per device, while the connection is open): `api`, memory, per connection; the subscriptions per socket
- External tool settings and the nova session: `api`, database (`external_tool_settings`); the nova session in server memory only
- Observatory cameras: definitions, their encrypted RTSP addresses: `api`, database (`observatory_cameras`);
  the key of the addresses in `NEBULOSA_CAMERA_SECRET_KEY` or the credential storage of the operating system, never in the database;
  the gateway process, its paths, the WHEP sessions, and the stream states in server memory only;
  the playback of each camera in tab memory
- Focuser backlash compensation: `api`, database (`focuser_backlash`)
- Guiding calibrations: completed solutions with their measured steps, equipment evidence, mount context, and grade (sessions, events, and telemetry stay in memory): `api`, database (`guiding_calibrations`, `GuidingCalibrationStore` of `api/src/guidingcalibration.store.ts`)
- Mount pointing models: samples, revisions, verifications (no pixels, no active state): `api`, database (`pointing_models`, `pointing_samples`, `pointing_revisions`, `pointing_verifications`); activation in server memory
- Calibration Library: frames and masters (jobs stay in memory): `api`, database (`calibration_sources`, `calibration_masters`, `calibration_master_sources`, `calibration_master_dependencies`);
  `master.fit` under `calibration-library/products/` of the data directory
- Image Stacking: projects with their settings and registration, their light frames by reference with their measurements, cohort decisions, linear masters, color composites (jobs, runs among them, stay in memory): `api`, database (`stack_projects`, `stack_sources`, `stack_cohorts`, `stack_products`, `stack_product_sources`, `stack_composites`, `stack_composite_sources`) and `image-stacking/products/` and `image-stacking/composites/` under the data directory;
  the frames stay where they are
- Live Stacking: saved stacks (sessions, stacks, and queued frames stay in memory): `api`, database (`live_stack_products`, `LiveStackingStore` of `api/src/livestacking.store.ts`) and `live-stacking/products/` under the data directory
- Artificial satellite catalog: objects with their SATCAT metadata, the latest GP and the imported element set of each, group memberships, the download state of each CelesTrak query, and the groups downloaded automatically: `api`, database (`satellite_objects`, `satellite_element_sets`, `satellite_memberships`, `satellite_sources`, `satellite_auto_downloads`, `SatelliteStore` of `api/src/satellites.store.ts`), shared by every profile;
  predictions stay in memory
- Observing Planner night plans: the copied site, the evening, the base constraints, and the ordered items with their requested durations, chosen starts, and constraint replacements, and the SBDB orbital elements of the minor bodies they name (windows, scores, trajectories, and previews stay in memory): `api`, database (`observing_plans`, `observing_plan_items`, `ObservingPlanStore`; `observing_minor_bodies`, `ObservingMinorBodyStore`)
- Meteor shower catalog: the IAU snapshots the operator downloaded (the active one and one previous), the revision, and the outcome of the last refresh (the index, dates, and nights stay in memory): `api`, database (`meteor_catalog_snapshots`, `meteor_catalog_source`, `MeteorShowerStore`); the bundled catalog `api/data/meteor.showers.json.gz`, generated by `bun make:meteors`, embedded in the executable; the curated visual subset in source (`api/src/meteorshowers.visual.ts`)
- Jupiter Observing Planner Great Red Spot model: the System II longitude, its reference instant, the drift, the source label, and the notes (predictions stay in memory): `api`, database (`jupiter_grs_settings`, `JupiterGrsStore`)
- SPICE Kernel Library: SPK files with their provenance, enabled flag, load order, and segments, and the ephemeris policy (acquisition jobs stay in memory): `api`, database (`spice_kernels`, `spice_segments`, `spice_settings`, `SpiceKernelStore`), the files under `spice-kernels/objects/<sha256>.bsp` of the data directory
- Notification history and the read state of each profile: `api`, database (`notifications`, `profile_notification_state`)
- Outcomes of the operations: `api`, database (`operation_runs`), start and end of each operation
- Earth orientation tables of the server: `api`, `iers/` under the data directory (`DEFAULT_IERS_DIRECTORY`), as published by the IERS, refreshed in the background
- Sky catalog: `api/data/sky.catalog.db`, generated by `bun make:catalog`, embedded in the executable
- Moon color maps and surface feature catalog: `web/assets/moon/`, generated by `bun make:moon`, bundled by the web client
- SDO images and the NOAA active region report of the Sun Inspector, forecasts of Astro Weather, and the other caches of `api` (close approach pages, eclipses, ephemerides): `RemoteCache` of `api/src/sky/remote.ts` and `LruCache` of `api/src/lrucache.ts`, memory only
- Connections, devices, operations, sessions, services: `api`, memory only (Mount Remote Control listeners and Meridian Flip Monitors included, never restarted after a restart)

The web keeps only the view state of the tab in browser storage (below), and the server writes no operational state as a file: `api/src/persistence.test.ts` fails when a source of `api` or `web` writes a file atomically, appends to one, opens a database of its own, or uses browser storage outside its allowlist, which says why each exception is not operational state.
The IERS tables, files of an external provider, are written atomically (`writeAtomically` of `api/src/util.ts`, which says what a power loss leaves).
The server opens its operational database (`startDatabase` of `api/src/index.ts`) before anything else and stops, saying why, when it cannot;
opening it creates the Default profile when there is none and records as interrupted the operations and the pointing model acquisitions a previous process left running (or paused).
Then `startStores` opens the Calibration Library, Image Stacking, and Live Stacking in the background, before the server serves.
SIGINT, SIGTERM, and SIGHUP end the process (`app/src/main.ts`) once the running device operations were stopped and the database was closed (`closeDatabase` of `api/src/index.ts`; see [Operation Lifecycle Rules](operation-lifecycle-rules.md));
nothing waits to be written, since every write committed when it was made.
Every durable path of the server derives from the data directory, `NEBULOSA_HOME` or `~/Nebulosa` (`DEFAULT_DATA_DIRECTORY` of `api/src/database/index.ts`);
the auxiliary files of the plate solver, the star detector, and the camera operations go to the system temporary directory.

The workspace (`api/src/workspace.ts`, `GET /api/workspace`) holds the saved connections, the observing sites (a name, a geodetic latitude and longitude in degrees, a height above the ellipsoid in meters, and an IANA time zone), and the profiles: each profile's name, connection, active site, and position, its equipment setup on each saved connection, its preferences (one JSON value per `ProfilePreferenceKey`), the forms of each camera, its Mount Remote Control bindings, and its saved framings.
The server creates the Default profile when it has none, and refuses to delete the last one (`409 lastProfile`).
Deleting a site clears it from every profile that observed from it (`ON DELETE SET NULL`), publishing `observingSite:removed` and then each of those profiles, never choosing another site for them;
a profile cannot select a site that is not saved (`404 notFound`).
Ids are generated by the tab that creates a connection, a site, a profile, or a framing, so the actions of `web/src/profile/profile.ts`, `web/src/location/site.ts`, and `web/src/connection/connection.ts` change the tab at once;
`WorkspaceSync` (`web/src/profile/sync.ts`, which states its delays and write order) compares what the tab holds with what the server last confirmed, unit by unit, and writes each unit that changed, one request at a time, again when the server could not be reached;
the event of a write, which the server publishes before it answers, is compared with the value in flight, so a value is never written twice.
Saved connections, observing sites, profile headers, preferences, and camera forms are written from the revision they were edited from: when another tab saved one first the server answers `409 conflict` with what it kept, the tab shows that, and a toast says so;
equipment setups, bindings, and framings are written as they are, the last write winning.
Every write publishes `savedConnection:updated`, `savedConnection:removed`, `observingSite:updated`, `observingSite:removed`, `profile:updated` (the whole profile), or `profile:removed` once committed, which every tab applies to the units it is not writing, never older than the revision it knows;
a tab reads the workspace again on every socket open.
The shell waits for the first read (`WorkspaceGate`) and never runs on a profile of its own making.
The tab writes nothing else to the server.
The fields `schema.ts` marks as view state (panels, last directories, the time bar, the guiding graph, which framing preset is drawn and from where, the Image Processing pipeline, and the preferences of Close Approaches and Astro Weather) and the active profile are kept in browser storage by `ViewPersistence` (`web/src/profile/view.ts`): `VIEW_STORAGE` lists, for each, the areas it is kept in, `session` for the tab across its reloads and `local` for every tab of the browser across its restarts, read in that order and all written.
The active profile is kept in both, so a reload keeps the profile of the tab and a new tab opens on the one used last.
Five view entries are kept outside the profiles, under one key each (`keepViewEntries`): the panel sections the operator expanded or collapsed (`sections`, `local`), the tool each camera tab shows, by camera tab key, given back to the tab of a camera when it appears (`cameraTools`, `session`), the camera tab selected last, selected again once its camera has a tab after a reload (`activeCameraTab`, `session`), the target being typed in Target Centering for each camera (`centeringTargets`, `session`), and whether the viewer status line reads the samples under the pointer, Inspect Pixels of the Image Inspector (`pixelInspection`, `local`);
a value set in the page before the restore is kept.
Each area holds the active profile id (`nebulosa:activeProfile`), one document per profile (`nebulosa:view:<profileId>`, with `VIEW_VERSION`), and one per view entry (`nebulosa:<entry>`), restored once the workspace is loaded and before the shell renders, written on every change, and removed with its profile;
a document of another version or that cannot be read is ignored and replaced, never migrated, and a storage that cannot be used leaves the view in memory.
A drawn framing applies only to the presets the server kept.
The connection highlighted in the modal starts over on every reload.
Kept values are not migrated while the application is in development: each preference and camera form is written with `PROFILE_SETTINGS_VERSION`, a value of any other version reads as absent, and a change to the shape of what is kept only raises it.
An added optional field reads as its default and raises nothing.

Camera forms belong to the physical camera, never to a camera role: `ProfileSettings.cameras` keeps, per saved connection id and device id (`CameraIdentity`, `profileCamera`), one form per key of `CameraSettings` (`web/src/profile/schema.ts`, which states each field and its unit), each a row of `profile_camera_settings`: the exposure time of Camera Acquisition and the camera settings its other operations share (`exposure`), the rest of the Camera Acquisition form (`acquisition`), the plate solving settings (`plateSolving`), the display settings applied last (`display`), and the forms of Auto Focus (`autoFocus`), TPPA (`tppa`), iPolar (`ipolar`), the Pointing Model Builder (`pointingModel`), Target Centering (`targetCentering`), DARV (`darv`), the Flat Wizard (`flatWizard`), the Dark Library Wizard (`darkLibraryWizard`, whose plan keeps its own copy; no progress is ever kept), Live Stacking (`liveStacking`), and guiding (`guiding`, whose guide frames take the camera settings of the camera's `exposure` without its exposure time).
The guide focal length is the profile's guide telescope (`guideTelescope`, the optics of Equipment Setup beside the telescope).
An operation fits them to the camera when it starts and keeps that snapshot.
A camera of a profile without a saved connection shows the defaults and keeps nothing.

Mount Remote Control bindings belong to the physical mount: `ProfileSettings.mountRemoteControl` keeps, per saved connection id, mount id, and protocol, the host and port a listener was last started with (`mountRemoteBinding`, `setMountRemoteBinding`), `DEFAULT_MOUNT_REMOTE_BINDINGS` before that.
They are preferences only: a running listener lives in `api` memory and is never started, stopped, or rebound by a profile.

Meridian Flip Monitor settings belong to the physical mount too: `ProfileSettings.meridianFlipMonitor` keeps, per saved connection id and mount id, the `MeridianFlipSettings` last applied (`meridianFlipSettings`, `setMeridianFlipSettings`), `DEFAULT_MERIDIAN_FLIP_SETTINGS` before that.
They are the server preference `meridianFlipMonitor` (one value for every mount of the profile).
They are preferences only: a running monitor keeps the settings it was enabled or updated with, a profile never enables, disables, or changes one, and nothing of its state (enablement, context, episode, transitions) is persisted.
The Meridian Flip Executor policy follows the same rule: `ProfileSettings.meridianFlipExecutor` keeps, per saved connection id and mount id, the `MeridianFlipExecutorPolicy` last edited (`meridianFlipExecutorPolicy`, `setMeridianFlipExecutorPolicy`), `DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY` before that, as the server preference `meridianFlipExecutor`;
a profile never arms, disarms, or changes an execution, and no arm or execution is persisted.

The guide pulse settings of the Mount dithers belong to the physical mount as well: `ProfileSettings.mountDither` keeps, per saved connection id and mount id, the `MountDitherSettings` (the guide directions of a positive right ascension and declination offset and the longest pulse, see [Capture Frames Contract](capture-frames.md); `mountDitherSettings`, `setMountDitherSettings`), `DEFAULT_MOUNT_DITHER_SETTINGS` before that, as the server preference `mountDither`.
The rest of the dithering preferences are the `dither` field of the camera's Camera Acquisition form (`CameraDitherSettings`, `ditherSettings`, `setDitherSettings`, `DEFAULT_DITHER_SETTINGS`: off, every 3 frames, Guided).
A running capture keeps the dither of its request; no guiding session id, dither progress, reservation, or pulse barrier is persisted.

The display settings applied last in Images are kept per physical camera, in its `display` form of `ProfileSettings.cameras`, for the frames of its camera tab, and globally in `ProfileSettings.imageDisplay` for every file and derived document (`imageDisplaySettings`, `setImageDisplaySettings`, read and written through `ImagesIo.loadDisplay` and `saveDisplay`).
Only settings a rendering applied are saved, never a popup draft; a camera of another connection than the watched one saves none.

The preferences of the status bar are kept in `ProfileSettings.statusBar`, edited in Settings → Status Bar.
Its `chips` (`statusChipPreferences`, `setStatusChipPreferences`, defaults `DEFAULT_STATUS_CHIPS`: every role shown, with its status and main measurement) say for each role whether it has a chip and which of its `STATUS_CHIP_FIELDS` it shows, kept in display order.
Its `astronomicalClock` says whether the clock is shown, its primary and secondary readings, and whether times of day show seconds (`astronomicalClockPreferences`, `setAstronomicalClockPreferences`, defaults `DEFAULT_ASTRONOMICAL_CLOCK_PREFERENCES`: LAST, no secondary, with seconds), a secondary reading equal to the primary one becoming none.
Its local time reads in the profile's display zone, with no zone of its own, and its samples are never stored.

How the profile shows civil times is kept in `ProfileSettings.dateTime` (`dateTimePreferences`, `setDateTimePreferences`, default `DEFAULT_DATE_TIME_PREFERENCES`: the observing site's zone), edited in Settings → Date & Time: the zone of every civil time the profile shows unless a tool overrides it for itself, the site's, UTC, or the browser's, a server preference (`dateTime`).
The site a profile observes from is its header's `activeSiteId`, written with its name, connection, and position (see [Observing Sites and Time Zones Contract](observing-sites-and-time-zones.md)).

The preferences of Close Approaches are kept in `ProfileSettings.closeApproaches` (`closeApproachPreferences`, `setCloseApproachPreferences`, defaults `DEFAULT_CLOSE_APPROACH_PREFERENCES`: LD, the profile's default zone, Earth, 10 LD): the units and zone override shown, and the target and distance of the last search that ran.
They are view state (`web/src/profile/view.ts`), while the results, the selection, and the dates are tab memory.

The preferences of Astro Weather are kept in `ProfileSettings.astroWeather` (`astroWeatherPreferences`, `setAstroWeatherPreferences`, defaults `DEFAULT_ASTRO_WEATHER_PREFERENCES`: Visual): only the observing mode chosen last, view state (`web/src/profile/view.ts`), while the forecasts, the sites typed in, and the night shown are tab memory.

The notifications a profile read or dismissed are kept in `ProfileSettings.notifications` as lists of notification ids (`markNotificationsRead`, `dismissNotifications`), which the server keeps for every tab and browser of the profile in `profile_notification_state` (`PUT /api/profiles/:id/notifications`).
The lists only grow: a write adds the ids it names to what the server keeps, never unmarks one, and ignores ids the history no longer holds, so the state is written as it is, the last write never losing an id another tab added.
A notification deleted from the history takes its read state with it, and each refresh of the history drops those ids from every profile of the tab too (`pruneNotificationPreferences`), so each list holds at most the 500 retained ids.

The settings of the Image Tools are kept in the profile, never in a document, so the Image Tools all belong to the profile while the Camera Operations belong to the camera and the profile: `ProfileSettings.imageAnnotation` (`annotationPreferences`, `setAnnotationPreferences`, defaults `DEFAULT_ANNOTATION_PREFERENCES`) holds the layers, labels, outlines, motion, density, magnitude limit, and body groups of Annotation, which every document opened next copies and then edits on its own, each edit also reaching the profile;
`imagePlateSolving` (`imagePlateSolving`, `setImagePlateSolving`, defaults `DEFAULT_CAMERA_PLATE_SOLVING`) holds the solver, strategy, downsampling, and scale tolerance shared live by every document outside a camera tab, each keeping its own hints;
and `imageProcessing` (`imageProcessingPipeline`, `setImageProcessingPipeline`) holds, as view state (`web/src/profile/view.ts`), the steps of the pipeline edited last, enabled or not, without their ids, which every document opened next copies under new ids.
Only an edit of the steps replaces it: expanding a card or the operation of the Add selector does not.
Starting from it never runs anything.
What each document shows of its results stays with the document: the visibility of the overlays, the plate solving overlay and grid, the labels and context of a streak detection, and the stars accepted only.
The slew rate of Mount Nudge is the driver's, and is never stored.

The plate solving settings of a camera are kept in its `plateSolving` form of `ProfileSettings.cameras` (`cameraPlateSolving`, `setCameraPlateSolving`, defaults `DEFAULT_CAMERA_PLATE_SOLVING`): provider, strategy, downsampling, and scale tolerance, never hints.
Images → Plate Solver edits them on the camera's tab, and the panels of the operations that solve its frames only show them (`CameraPlateSolvingSection`).

Saved framings are kept in `ProfileSettings.framingReferences` (`saveFramingReference`, `renameFramingReference`, `deleteFramingReference`), at most `FRAMING_REFERENCES_MAXIMUM` (128): a name and a J2000 position with where it came from, never an image, so one outlives every frame and needs no document.
A session receives a copy of the coordinates, so nothing on the server depends on a profile.

The appearance of the astrometric aids of solved images is kept in `ProfileSettings.imageAstrometry` (`imageAstrometrySettings`, `setImageAstrometrySettings`, defaults `DEFAULT_IMAGE_ASTROMETRY` of `web/src/platesolving/preferences.ts`): the coordinate format and decimals, the grid labels, minor lines, opacity (0.15–1), and color (a theme color, or red right ascension and blue declination), the crosshair, the scale bar, and the orientation mode.
Whether a document shows its centre and grid stays in its view state, in tab memory, off by default for the grid.

## Central Database

Persistence lives in a single SQLite database owned by `api`; the items of the list above whose owner names a database table are kept in it.
The database is `AppDatabase` of `api/src/database/index.ts` (its connection, `connection.ts`, and its schema, `migrations.ts` and `migrations/0001_initial.sql`, recorded in `schema_migrations` and synchronized by `baseline.ts` during development), written by the store of each domain, such as `ExternalToolsStore`, `FocuserBacklashStore`, `GuidingCalibrationStore`, `Workspace` (with the notifications each profile read or dismissed), `NotificationService`, `CaptureFrameRegistry`, `OperationRecorder`, `PointingModelStore`, `CalibrationLibraryStore`, `ImageStackingStore`, `LiveStackingStore`, and `SatelliteStore`.

- **One database.**
  `<data directory>/nebulosa.sqlite` (`DEFAULT_DATABASE_FILE`) is the only mutable durable store of the application, owned by `api/src/database/` and opened before any service serves.
  The web reads it through `api` routes and events, and its profiles and saved connections are shared by every tab and browser.
  The sky catalog is a read-only asset, not operational state.
- **What is kept.**
  Only deliberate preferences, reusable configuration, objects an operator created, scientifically relevant records, and useful outcomes, as listed above;
  the satellite catalog keeps its element sets so the catalog, the favorites it names, and the predictions work offline and the fair-use state of each CelesTrak query survives a restart.
  The view state of the tab (above) is kept in browser storage, outside the database; drafts, caches, live device and session state, progress, and telemetry stay in memory and do not survive a reload or a restart.
  Secrets and service sessions, such as the nova session, are never stored.
- **Files.**
  Scientific files stay files (captured frames, dark and flat frames, master FITS, IERS tables, SPK kernels, exports); the database holds their identities and metadata.
  The products of the Calibration Library, Image Stacking, and Live Stacking are written into the `staging/` of their directory and renamed into place;
  the publication or deletion of one is a state of its row (`publication`: `publishing`, `published`, `deleting`), reconciled at start from the directory the row names;
  a directory without a row is never adopted, but moved to the `orphaned/` of its directory, never deleted.
  No JSON or JSONL file is written as operational state.
- **Schema.**
  Tables are `STRICT`, with typed columns for identities, relations, states, and filters, and JSON as text checked by `json_valid` only for variable payloads.
  Times are Unix milliseconds (UTC); every column states its unit.
  Each applied migration is a row of `schema_migrations` with its SHA-256 checksum.
  While the application is in development the schema is one baseline, `0001_initial.sql`, edited in place, and a database whose baseline checksum differs follows it table by table (`synchronizeBaseline`), in one transaction, before any service serves.
  A new table is created and a changed index created again, keeping every row;
  a table whose definition changed is emptied and created again, and one the baseline no longer has is emptied and dropped.
  Emptying a table empties, transitively, the tables that depend on it through a foreign key (`CASCADE`, `RESTRICT`, or `NO ACTION`), while the rows of a `SET NULL` or `SET DEFAULT` dependent stay and lose the reference, as when an operator deletes every row.
  Two directives, a comment of their own in the body of a table, say what its columns do not: `-- @version <n>`, raised when the shape of the data it holds changes (the JSON of a payload), and `-- @clearedWith <table>`, which empties it with that table (`satellite_sources` with `satellite_objects`).
  The server says what it rebuilt, emptied, dropped, created, and reindexed, with a warning when rows were discarded.
  Files of discarded rows stay on the disk: product directories without a row are moved to `orphaned/` at start, and saved frames are no longer listed.
  A database whose baseline cannot be synchronized (the history table changed, a view or trigger, a kept row breaking a constraint) or whose epoch (`PRAGMA user_version`) is not `BASELINE_EPOCH` of `migrations.ts` is deleted (with its `-wal` and `-shm`) and created again, with a warning;
  raising the epoch is the way to create every database again.
  A file that is not a database, a schema of an unknown newer version, a gap in the history, or a SQLite older than 3.38 stops the server, and the file is never deleted.
  Numbered migrations start with the first release.
- **Lifetime.**
  The connection opens on its first use; once `close` ended it (a server stopping, or stopping in place before a hot reload), a use throws until `open` is called again, so a late write of a stopped run never reopens the file behind the next run.
- **Writes.**
  One connection per process, with foreign keys, WAL, `synchronous=FULL`, and exclusive locking in production (`NODE_ENV=production`: `bun start` and the executable), so a second server on the same data directory refuses to start;
  in development (`bun dev`) the lock is shared, so a database browser can read and write the file beside the server, which waits for it (`BUSY_TIMEOUT` of `connection.ts`), and nothing refuses a second server.
  Writes are synchronous transactions that never wait on files or the network; an event is broadcast only after its transaction committed, and a tab that missed it reads the snapshot again on reconnection.
  Edits of a row with a `revision` carry the revision they were made from, and an outdated one answers `409 conflict` with the current value; the workspace units written as they are (above) carry none, the last write winning.
- **Retention.**
  Notifications: 500 records and 30 days, their read state deleted with them.
  Saved frames: every row is kept and paged, the Images workspace showing the newest 20 of each camera first (`FRAMES_PER_SOURCE`) and older ones on request; no file is ever deleted by retention.
  Operation outcomes: 90 days and 10 000 rows.
  Guiding calibrations: the newest 25 of each equipment (`MAX_GUIDING_CALIBRATIONS`), the older ones deleted when one is added.
  Pointing models, the calibration library, the stacking projects, and the saved live stacks: until an operator deletes them.
  Satellite catalog: one GP and one imported element set per object, replaced by newer ones; objects and their metadata are kept when a group stops listing them, and each successful download replaces the membership of its own group only.
- **No import.**
  Nothing of the former storage is read, converted, or deleted: a new database starts with a Default profile and nothing else.
  There is no backup or cleanup command;
  the former files, which the application no longer reads once their domain moved, can be deleted by hand: `settings.json`, `focusers.json`, `capture-frames.json`, `notifications.json`, `pointing-models/`, `dark-library/plans/`, and, under `calibration-library/`, `catalog.sqlite` (with `-wal` and `-shm`), `journal.jsonl`, and the `manifest.json` of each revision.
  Browser storage keys other than those of `ViewPersistence` are no longer read.
