# Architecture

This document maps what Nebulosa already has, where each feature belongs, and the contracts new features must follow. It is the reference for the next deliveries, in this order: Tools, Sky Framing, Capture, then Sequencer. Repository rules (boundaries, style, verification) live in [`AGENTS.md`](../AGENTS.md).

## Architecture Map

| Layer   | Owns                                                                                                                                            | Never owns                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `core/` | Algorithms and device protocols: INDI/Alpaca clients, commanders, orchestration, capture runner, solvers, star detection, ephemerides, eclipses | Application state, HTTP, UI                       |
| `api/`  | Runtime services: connections, devices, operations, image documents, sky queries; HTTP routes and the event WebSocket                           | Presentation state, profiles                      |
| `web/`  | Presentation: workspaces, profiles, selection, view state; mirrors of server state fed by HTTP and events                                       | Operations, device arbitration, scientific pixels |
| `app/`  | Wiring `api` and `web` into one `Bun.serve` and the build                                                                                       | Business logic                                    |

Server state reaches every tab through `GET` snapshots plus the `/api/ws` event stream (`ServerEvent` in `api/src/connection.ts`). A tab refreshes its snapshots on every socket open (`onOpen` in `web/src/main.tsx`), so a reload never loses running work.

## Capability Inventory

Status: **Implemented** (works end to end), **Integration Required** (exists in `core`, not exposed by `api`/`web`), **Partial**, **Planned** (nothing yet).

| Capability                                                                   | Status               | Where                                                                                                             |
| ---------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Shell, routes, workspaces                                                    | Implemented          | `web/src/shell/` (`route.ts`, `workspaces.ts`, `WorkspaceLayout.tsx`)                                             |
| Profiles (versioned, v3)                                                     | Implemented          | `web/src/profile/profile.ts` (`migrate`, `PROFILES_VERSION`); active profile per tab in sessionStorage            |
| Connections (INDI, Alpaca, simulator)                                        | Implemented          | `api/src/connection.ts`, `web/src/connection/`                                                                    |
| Device registry and identity                                                 | Implemented          | `api/src/devices.ts` (`DeviceSummary`: connection id + stable device id)                                          |
| Device capabilities and control states                                       | Implemented          | `api/src/devices.ts` (`DeviceStateMap`, `<type>:updated` events, `GET /api/connections/:id/states`)               |
| Operations and arbitration                                                   | Implemented          | `api/src/operations.ts` (`OperationRegistry`), `web/src/operations.ts`; toolkit `core/src/devices/orchestration/` |
| Mount slew / stop                                                            | Implemented          | `api/src/mounts.ts`, `web/src/sky/mount.ts`                                                                       |
| Mount goto/flip/sync, park, home, track, site, time                          | Implemented          | `api/src/mounts.ts`; manual move is the Capture Mount Nudge; pulse guide in `api/src/guideoutputs.ts`             |
| Focuser, wheel, rotator, cover, flat panel, dew heater, dome, camera cooling | Implemented          | `api/src/{focusers,wheels,rotators,covers,flatpanels,dewheaters,domes,cameras}.ts`, Equipment Control page        |
| Equipment Control (manual device control)                                    | Implemented          | `web/src/equipment-control/`, route `/equipment` opened from Management                                           |
| Camera capture and frames                                                    | Implemented          | `api/src/captures.ts` over `CameraCapturer`; `web/src/capture/CameraCapturePanel.tsx`, `capture.ts`               |
| Image documents (FITS/XISF)                                                  | Implemented          | `api/src/images.ts` + `images.worker.ts`, `web/src/images/images.ts`                                              |
| Display pipeline, derive, save                                               | Implemented          | same as above                                                                                                     |
| Histogram and statistics                                                     | Planned              | Inspector shows a placeholder                                                                                     |
| External tools settings (ASTAP)                                              | Implemented          | `api/src/externaltools.ts`, `web/src/settings/`, route `/settings/external-tools` opened from Management          |
| Plate solving                                                                | Integration Required | `core/src/astrometry/solvers/` (ASTAP, astrometry.net)                                                            |
| Star detection                                                               | Implemented          | `api/src/stars.ts` + `stars.worker.ts`, `web/src/stars/`; Images tool and Capture post-capture analysis           |
| Streak detection                                                             | Integration Required | `core/src/imaging/analysis/streak/`                                                                               |
| WCS                                                                          | Integration Required | `core/src/astrometry/wcs/`                                                                                        |
| Shared image viewer                                                          | Implemented          | `web/src/viewer/` (overlays in image pixels, zoom/pan in `transform.ts`)                                          |
| Overlays                                                                     | Partial              | Reticle (`web/src/viewer/Reticle.tsx`) and star markers (`web/src/stars/StarOverlay.tsx`)                         |
| Planetarium, search, inspector, time, observer                               | Implemented          | `web/src/sky/`, `api/src/sky/`                                                                                    |
| FOV and optical presets                                                      | Implemented          | `web/src/sky/framing.ts` (gnomonic outline, position angle)                                                       |
| HiPS surveys                                                                 | Integration Required | `core/src/adapters/sky/hips2fits.ts`, `core/src/astronomy/sky/spatial/healpix.ts`                                 |
| Eclipses (solar, lunar, maps)                                                | Integration Required | `core/src/astronomy/events/eclipse/`                                                                              |
| Calculator formulas                                                          | Integration Required | `core/src/astronomy/formulas.ts` (pure, importable by `web`)                                                      |
| Alpaca server                                                                | Integration Required | `core/src/devices/alpaca/server.ts`, `discovery.ts`                                                               |
| PHD2 and built-in guider                                                     | Integration Required | `core/src/devices/guiding/phd2.ts`, `core/src/observation/guiding/`                                               |
| Auto focus                                                                   | Implemented          | `api/src/autofocus.ts` over `runAutoFocus`; `web/src/capture/AutoFocusPanel.tsx`, `FocusCurve.tsx`                |
| DARV, TPPA                                                                   | Integration Required | `core/src/observation/alignment/`                                                                                 |
| Flat analysis and exposure                                                   | Integration Required | `core/src/imaging/analysis/flat/` (no wizard flow)                                                                |
| Sequencer                                                                    | Planned              | No engine exists in `core` or `api`                                                                               |
| Notifications                                                                | Planned              | The top bar bell is static                                                                                        |
| Power, weather, safety monitor, GPS devices                                  | Planned              | Toolkit managers only, no commanders; not managed by `api`                                                        |

## Workspace Responsibility Matrix

Each feature has exactly one place in the UI. Workspaces share services, not interfaces.

| Workspace                           | Responsibility                                             | Features                                                                                                                       | Registry                                                                              |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Capture                             | Acquisition and assisted operation of equipment            | Camera Capture, Mount Nudge, Guiding, Auto Focus, DARV, TPPA, Flat Wizard                                                      | `CAPTURE_MODE_DEFINITIONS` (`web/src/capture/modes.ts`)                               |
| Images                              | Documents and hardware-independent image work              | Inspector, Plate Solver, Star Detection, Streak Detection, Processing; later Annotation, Crosshair, Calibrator, ROI, FOV, Grid | `IMAGE_TOOL_DEFINITIONS` (`web/src/images/tools.ts`)                                  |
| Sky                                 | Exploration, planning, contextual mount control            | Planetarium, search, inspector, observer, time, layers, FOV, slew; later Framing with HiPS                                     | panel views in `SkyWorkspace.tsx`                                                     |
| Tools                               | Standalone utilities, no camera or document needed         | Calculator, Solar Eclipse Map, Lunar Eclipse Map, Alpaca Server                                                                | `TOOL_DEFINITIONS` (`web/src/tools/tools.ts`), `/tools/<id>`                          |
| Sequencer                           | Configuring and observing server-run automation            | Planned                                                                                                                        | a future entry in `WORKSPACE_IDS`                                                     |
| Equipment Control (Management page) | Manual control of every device of the profile's connection | Mount, guide output, focuser, filter wheel, rotator, cover, flat panel, dew heater, dome, camera cooling                       | `CONTROLS` (`web/src/equipment-control/DeviceDetail.tsx`), `/equipment[/<device id>]` |

Rules:

- A registry entry without an implementation is **planned**: listed with its reason, never selectable or openable. Placeholder panels are not created.
- Selecting a mode, tool, tab, or profile never starts, stops, or redirects an operation.
- A Capture camera view is a presentation context of a camera role; commands always target the device the setup resolves to (connection id + device id), never the role.

## Shared Image Contracts

There is **one** image store, `ImageStore` in `api/src/images.ts`, and the scientific image reference is its document id.

- An image document is addressed as `/api/images/:id/...` by every operation, whatever workspace requested it. There is no second solver or detector path for Capture.
- Camera frames enter the store as documents of the origin `{ origin: 'capture', connectionId, deviceId, frameId, time, path? }` (`ImageStore.openCapture`), decoded from the bytes the driver sent. A frame is never identified by camera role.
- In loop capture, each frame is its own document. An analysis stays bound to the id it was started on, and a newer frame never changes it. The capture service (`api/src/captures.ts`) keeps the latest frame of each camera and closes the previous one. An analysis retains its document (`ImageStore.retain`/`release`): closing it hides it from every route at once, but its pixels are released only when the last analysis lets it go.
- Analysis results (solution, star list, streaks) are keyed by image id and the parameters applied, and are kept in memory with the document until its pixels are released. Re-running with the same parameters reuses the result.
- A Sky Framing survey image is not an image document. Importing one into Images is an explicit action, available only when the cutout carries usable WCS metadata.

## Overlay Contracts

- Overlays draw through `ImageViewer`'s `overlays(size, view)` callback as SVG in **image pixel coordinates** (origin at the top-left of the first pixel). Zoom, pan, fit, 1:1, and resize are applied by the viewer, so overlays never compute screen coordinates; `view` gives the scale, for sizes constant on screen, and the visible region, to skip what is off screen. Strokes use `vectorEffect="non-scaling-stroke"`. Toolkit results use 0-based pixel indices with integer centres, so a result point (x, y) is drawn at (x + 0.5, y + 0.5).
- An overlay is a pure function of a result and the image shown: it draws only results whose image id matches the displayed image. Hiding an overlay never cancels or deletes the result, and showing one never re-runs the analysis.
- Celestial-coordinate overlays (annotation, grid) require a WCS solution of that same image. Without one they are unavailable, not approximated.
- `ImageViewer`'s `onImageClick(point, view)` reports a click (never a drag or a pinch) in image coordinates; the star markers use it to pick a star. A screen-space layer and other pointer interactions (Crosshair, ROI, Mouse Coordinates) are added with their first consumer, using `toImage`/`pixelAt` from `web/src/viewer/transform.ts`.
- An ROI is a region in image pixels. It never changes a camera's physical subframe unless an explicit, capability-checked command does it.

## Operation Lifecycle Rules

- Every device operation runs under the process-wide `OperationRegistry` (`api/src/operations.ts`). It owns a single `ResourceArbiter` and `OperationCoordinator`, plus a `DeviceLifecycle` that follows every managed device type.
- An operation holds its devices by physical identity (`resourceKey`). A second operation on a held device is refused as busy, whichever service or tab starts it. Disconnecting or removing a device cancels the operations holding it.
- Each start and end is published as `operation:updated` (`OperationRecord`: id, kind, exact devices, state, reason). `GET /api/operations` lists the running ones. The web mirrors them in `web/src/operations.ts`.
- Operations are owned by the server. Switching workspace, profile, camera tab, or mode, collapsing a panel, or unmounting a component never ends one.
- Interruptions are distinct commands, offered only when supported: cancel a pending request, abort an exposure, stop guiding, stop mount motion, stop a persistent service. There is no generic "Cancel".
- Long-lived services (guiding session, Alpaca server, sequencer run) are server objects with explicit start and stop and their own state events. They are not operations of a React screen.
- Existing protocols (PHD2 events, `CameraCapturer` reports) keep their own state machines. The registry tracks what they hold; it does not replace their states.

## Device Resource Matrix

Requirements are declared by each registry; availability is evaluated by `roleAvailability` (`web/src/equipment/availability.ts`): ready, busy, or the role state that prevents use.

| Feature                   | Requires (besides the view's camera)              | Holds                                        | Conflicts with                                                      |
| ------------------------- | ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Camera Capture            | —                                                 | camera                                       | Auto Focus, Flat Wizard, TPPA, DARV, sequencer                      |
| Mount Nudge               | Mount                                             | camera (loop), mount (moves)                 | slew, TPPA, DARV, guiding                                           |
| Guiding                   | a guiding provider (PHD2 manages its own devices) | provider session; mount pulses when built-in | DARV, Mount Nudge, slews without dither settle                      |
| Auto Focus                | Focuser                                           | camera, focuser                              | Camera Capture, sequencer                                           |
| DARV                      | Mount                                             | camera, mount                                | guiding, Mount Nudge                                                |
| TPPA                      | Mount; a plate solver                             | camera, mount                                | Mount Nudge, slew, guiding                                          |
| Flat Wizard               | — (filter wheel and flat panel optional)          | camera; wheel/panel when used                | Camera Capture                                                      |
| Sky slew                  | Mount                                             | mount                                        | any mount operation                                                 |
| Equipment Control motion  | the device shown                                  | the physical device (hardware id)            | any operation of the same physical device                           |
| Equipment Control setting | the device shown                                  | the physical device, for the command only    | any operation of the same physical device; cooling during a capture |

Conflicts are resolved by the arbiter on the server, never only in the browser, because several tabs (and profiles) may address the same device.

## Equipment Control Contract

- The page lists the devices of the active profile's connection only, grouped by hardware id, so the interfaces of one physical device (a flip-flat's cover and flat panel, a mount and its guide output) appear once. Opening it, switching devices, or reloading never connects, disconnects, or commands anything.
- Every command goes through `api` under the shared contract of `api/src/commands.ts`: settings answer 204 once applied, motions answer 202 with an operation id and report their outcome only through `operation:updated`. Durable requests carry a client token, so a repeated request never moves a device twice. Errors carry a stable `code`.
- Stops never wait for a lease: `POST …/stop` cancels the operation of the physical device and sends the commander's `stopMotion`. A filter wheel has no abort. Guide pulse stops never cancel another operation of the mount.
- Manual motion held by a lease (mount nudge, dome rotation) shares `api/src/leases.ts` and `web/src/press.ts`.
- Values shown are those the devices report; forms and sliders only hold pending values until an explicit action.
- Known driver differences: Alpaca mounts expose only Go Home (no find or set home, no set park, no flip); Alpaca domes cannot unpark or rotate manually; Alpaca focusers have no sync or reverse; Alpaca rotators have no home. Pier side and the INDI Alignment Subsystem are reported but have no commander, so they are read-only; power, weather, safety monitor, and GPS devices are not managed. The simulator has no composite cover with a heater; that path is tested with a fake client.

## Sky Framing Integration Contract

- Framing is a view inside Sky. It reuses the selection, the framing center, and the `OpticalPreset` and `resolveFraming` results of `web/src/sky/framing.ts`: angular size, image scale, and position angle measured from north through east.
- Survey images come from `hips2fits` (`core/src/adapters/sky/hips2fits.ts`) through an `api` proxy route that caches cutouts and survey lists and returns the survey's attribution. Network failure leaves the planetarium framing usable.
- The cutout is requested in TAN projection centered on the framing center, with the preset's FOV and rotation, so its pixels match the gnomonic outline drawn by `framePolygon`. The first Framing task is a test that pins the sign convention of the position angle against a cutout's WCS.
- Pixels are not assumed to be linear in RA/Dec. Any overlay on the survey uses the cutout's WCS.

## Tools Integration Contract

- Navigation: Tools → catalog card → `/tools/<id>`, rendered by the tool's `view` inside its own `WorkspaceLayout`. A tool without a view is planned and its URL returns to the catalog.
- Calculator: pure formulas from `nebulosa/src/astronomy/formulas` (already used by Sky framing), grouped by category, with the existing number fields and unit suffixes. No expression engine.
- Eclipse maps: computed in `api` from `core/src/astronomy/events/eclipse/*`, which already produce geographic geometry and SVG paths. A coastline basemap must be chosen in that delivery; no map library is added before that.
- Alpaca Server: an `api` service over `AlpacaServer`, started and stopped explicitly, bound to localhost by default, publishing only an explicit allowlist of devices. Devices imported from Alpaca connections are never exported, to avoid publication loops. Its state is published as events. The Tools view only controls it.

## External Tools Contract

- External programs the backend runs are registered in `api/src/externaltools.ts` with the capabilities their adapters provide. Only ASTAP is registered (plate solving and star detection, through `core/src/astrometry/solvers/astap.ts`); the native `detectStars` and the libastrometry binding are not external tools, and astrometry.net is not registered while no `api` service uses it. No route runs an arbitrary command.
- Settings belong to the server instance, never to a profile or a browser: Management → Settings → External Tools (`/settings/external-tools/<id>`) edits a draft, and only Save writes it, with the revision it was edited from; a save from an outdated revision is refused with 409, and every change is published as `externalTool:updated`.
- With no executable saved, a program is Not Configured and `ExternalToolsStore.resolve` returns undefined, so its services must refuse to run it; no platform default path is assumed. A service resolves the settings once when an operation starts and keeps that snapshot until the operation ends, so a save applies to the next operations without a restart.
- Test checks a draft on the server's filesystem without saving it: the path exists, is a regular file, and may be executed (on Windows any existing file passes); a bare name is looked up on the server's PATH. It never starts the program, so it proves neither that the program runs nor that it analyzes images, and the version is reported as unknown. Only a check of the saved settings becomes the program's latest check, kept in memory until the server restarts.
- There is no authentication: any client that can reach the API can change the executable the server runs and check paths of its filesystem, like `/api/files` lists them. Keep `APP_HOST` on localhost when untrusted clients can reach the network.
- Nothing configured ASTAP before these settings existed, so there is nothing to migrate.

## Star Detection Contract

- One service, `StarDetectionService` (`api/src/stars.ts`), detects the stars of an image document for every consumer: Images → Star Detection (manual runs), Camera Capture's post-capture analysis, and Auto Focus. Results are the toolkit's `DetectedStar` (x, y, HFD, SNR, flux) in 0-based pixel coordinates of the document, origin at the upper-left sample, +X right, +Y down.
- Providers: `builtin` runs `detectStars` on a worker of its own (`api/src/stars.worker.ts`), fed a grayscale copy prepared by the image worker (a CFA mosaic is debayered with its trusted pattern first). `astap` runs `astapDetectStars` on a FITS copy in a per-job temporary directory, with the External Tools settings resolved once per job (or per capture). ASTAP failures are typed (unavailable, timeout, failed); a failure never falls back to the other provider.
- Scheduling is in memory: one built-in detection and one ASTAP process at a time, at most 16 jobs waiting, manual jobs first, capture sessions served in turn. A running built-in detection is cancelled by terminating its worker; ASTAP is killed through its signal. No device is held.
- Accepted stars have finite coordinates inside the image less an edge margin, a finite positive HFD within the limits, and finite positive SNR (at least the minimum) and flux. The aggregate HFD is the median HFD of the accepted stars, in pixels, and is unavailable (never 0) below 3 accepted stars. HFDs of the two providers are computed differently and must not be compared.
- Jobs are published as `stars:updated` without the stars; `GET /api/stars` is the snapshot, `GET /api/stars/:jobId/result` the full result, `POST /api/images/:id/stars` submits a manual detection (an equivalent kept result is answered instead), and `POST /api/stars/:jobId/cancel` cancels. Results are kept per image (8) and in total (256), in memory only, and dropped when the image is released: an expired result answers 404.
- Post-capture analysis is part of `CaptureRequest` (`analysis`), off unless asked. Every Frame decodes each frame as its own document and reserves its capacity before the exposure (`beforeFrame` of `CameraCapturer`), so a lagging analysis holds the next exposure (phase `analysisWait`) on top of the unchanged delay; Latest Frame Only analyzes the previewed frames and skips a waiting one when a newer arrives. Analysis counters are apart from captured and saved frames, failures never fail a capture, and three failures in a row, or ASTAP unable to run, halt the analysis. Stop and Abort act on the acquisition only; accepted analyses finish.
- Auto Focus integration: `StarDetectionService.measure(imageId, request, signal, origin)` resolves to the result of one image, runs with the manual priority, is never replaced by a newer frame, and cancels with its signal; it also takes a preparation resolved once, so a session keeps its ASTAP settings. Auto Focus jobs carry the `autofocus` origin.
- Limitations: results do not survive a restart, and Every Frame gives no exactly-once guarantee after a crash; the built-in HFD is measured inside a 4 px aperture unless the request sets a larger `maximumRadius` (Auto Focus uses 32 px by default), so with the fixed aperture it saturates near 8 px for defocused stars, and the built-in detector returns at most 2000 stars; saturation is not detected; a frame replaced on screen before its result is fetched shows no markers.

## Auto Focus Contract

- `AutoFocusSessions` (`api/src/autofocus.ts`) runs the toolkit's `runAutoFocus` for one camera and one focuser inside a single `focuser.autofocus` operation, which holds both devices for the whole session; the runner nests its focuser lease and the per-frame camera leases in it. The runner owns the sampling, the fitting (Hyperbolic, Parabolic, Trend Lines, and the two combined modes), and the best position; nothing is fitted in `api` or `web`.
- The service supplies the runner with the backlash compensated mover of `FocuserCommands` (plus an optional settle wait), the `CameraCapturer` of the capture service (one FITS frame per position, written to a temporary directory and deleted after it was measured, never saved as a capture), and `StarDetectionService.measure`, whose median HFD of the accepted stars (Multi-Star) is each measurement. The provider and its ASTAP settings are fixed when the session starts; a failed detection is an invalid point of the curve, never a fallback to the other provider.
- The frames take the exposure and camera settings (gain, offset, binning, subframe, readout mode) of the view's Camera Capture form, fitted to the camera's capabilities by `captureRequest`; the Auto Focus form only holds the detection and the routine, and the frame type is always LIGHT. Every frame snoops the focuser of the session and the mount, filter wheel, and rotator of the equipment setup (`AutoFocusRequest.snoop`).
- After the runner moved the focuser to the best focus, one more frame there records the verified HFD, kept apart from the HFD the curve estimated; a session completes only after it. A rejected curve fails without a best focus, and the runner moves the focuser back to the start. A stop, or an Equipment Control stop of the focuser (which cancels the operation holding it), cancels where the session stands and never moves the focuser back.
- Sessions live in memory: the latest of each camera, its measurements (requested and observed position, image id, HFD, star counts), and its curve, sampled from the runner's own regressions (`api/src/autofocus.curve.ts`). `autofocus:updated` events carry summaries; `GET /api/autofocus` and `GET /api/autofocus/:sessionId` are the snapshot and the complete record. Only the latest frame of a session stays open in the image store.
- Limitations: focusers that only move relatively are refused; there is one frame per position and no repeated samples; the runner's sweep starts `initialOffsetSteps` steps out and comes back one step past the start before extending each side, so it is not symmetric; the filter wheel is never moved; the mount is not held, because the arbiter has no shared hold that would refuse GoTo and Nudge while letting tracking and guide pulses run, so a slew during a session goes unnoticed; sessions do not survive a restart. The simulated camera defocuses relative to its ±50000 step travel, so its curves need step sizes in the thousands.

## Capture–Sequencer Compatibility Report

- There is no sequencer engine to integrate. It will be an `api` service composed of the same services Capture uses: capture via `CameraCapturer`, filter, focus, dither, and mount commands through the commanders, all under the `OperationRegistry`.
- Acquisition exists once, in `CameraCapturer`. Camera Capture, Auto Focus, DARV, TPPA, and Flat Wizard must call the same `api` capture service, never their own exposure loops.
- Every acquisition snoops the managed devices of the equipment setup (mount, focuser, filter wheel, rotator; `captureSnoop` in `web/src/capture/capture.ts`) into the frame headers. Requests name them by device id on the camera's connection (`CaptureSnoop`), and `api` resolves the ids to the driver names (`snoopedDevices`); snooped devices are read, never acquired.
- A run resolves its connection and device ids when it starts and keeps them. Changing the active profile in a tab never redirects it.
- The UI observes a run through snapshots and events, never by owning it.

## Persistence and State

| State                                                | Owner                                          |
| ---------------------------------------------------- | ---------------------------------------------- |
| Profiles, presets, panel and view preferences        | browser localStorage, versioned (`profile.ts`) |
| Active profile                                       | sessionStorage per tab                         |
| Route, document view, zoom/pan                       | tab memory                                     |
| Image pixels                                         | `api` image store                              |
| Star detection jobs and results                      | `api` star detection service, memory only      |
| External tool settings                               | `api`, `~/Nebulosa/settings.json`, versioned   |
| Connections, devices, operations, sessions, services | `api`                                          |

Profile format changes add a version and a case in `migrate`; older documents are read, and newer ones are never overwritten.

## Test Baseline

Run before every delivery, as CI does (`.github/workflows/test.yml`):

- `bun fmt --check`, `bun lint` (type-aware and type-checking), `bun test --parallel`, `git diff --check`.
- `bun compile` and a smoke test when `app/`, bundling, or HTML entry points change.
- `api` tests use the `SIMULATOR` connection for devices and fakes only for network services (`mounts.test.ts`, `operations.test.ts`).
- `web` tests are pure store and logic tests with injectable `fetch` and `MemoryStorage`.
- Hardware tests with real motion are run separately and only with explicit authorization.

## Implementation Backlog

| #   | Delivery  | Task                                                                                          | Depends on |
| --- | --------- | --------------------------------------------------------------------------------------------- | ---------- |
| 1   | Tools     | Calculator view (FOV, image scale, sampling) over `formulas.ts`                               | —          |
| 2   | Tools     | Alpaca Server service, routes, events, and view; allowlist and loop prevention                | —          |
| 3   | Tools     | Basemap decision, then the Solar and Lunar Eclipse Map views over `api` eclipse routes        | —          |
| 4   | Framing   | `api` HiPS proxy (surveys, cutout, cache, attribution) and the position angle convention test | —          |
| 5   | Framing   | Framing view in Sky using the presets and the cutout                                          | 4          |
| 6   | Capture   | Capture service over `CameraCapturer` under the registry; frames as `capture` image documents | —          |
| 7   | Capture   | Camera Capture mode panel and viewer frames                                                   | 6          |
| 8   | Images    | Plate solving routes by image id, results keyed by id; overlays (star detection is done)      | —          |
| 9   | Capture   | An `unsupported` availability state in Capture, over the control states (now in `api`)        | —          |
| 10  | Capture   | Mount Nudge, DARV, TPPA, Flat Wizard, Guiding (PHD2)                                          | 6, 8, 9    |
| 11  | Sequencer | Sequencer service and workspace                                                               | 6, 10      |
