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

| Capability                                          | Status               | Where                                                                                                             |
| --------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Shell, routes, workspaces                           | Implemented          | `web/src/shell/` (`route.ts`, `workspaces.ts`, `WorkspaceLayout.tsx`)                                             |
| Profiles (versioned, v3)                            | Implemented          | `web/src/profile/profile.ts` (`migrate`, `PROFILES_VERSION`); active profile per tab in sessionStorage            |
| Connections (INDI, Alpaca, simulator)               | Implemented          | `api/src/connection.ts`, `web/src/connection/`                                                                    |
| Device registry and identity                        | Implemented          | `api/src/devices.ts` (`DeviceSummary`: connection id + stable device id)                                          |
| Device capabilities                                 | Partial              | `MountState` (`canGoTo`, `canAbort`), the camera sensor, and `CameraCapabilities` (`api/src/devices.ts`)          |
| Operations and arbitration                          | Implemented          | `api/src/operations.ts` (`OperationRegistry`), `web/src/operations.ts`; toolkit `core/src/devices/orchestration/` |
| Mount slew / stop                                   | Implemented          | `api/src/mounts.ts`, `web/src/sky/mount.ts`                                                                       |
| Mount sync, park, track, manual move, pulse guide   | Integration Required | `core/src/devices/commanders/mount.ts`, `guideoutput.ts`                                                          |
| Focuser, wheel, rotator, cover, flat panel commands | Integration Required | `core/src/devices/commanders/*`                                                                                   |
| Camera capture and frames                           | Implemented          | `api/src/captures.ts` over `CameraCapturer`; `web/src/capture/CameraCapturePanel.tsx`, `capture.ts`               |
| Image documents (FITS/XISF)                         | Implemented          | `api/src/images.ts` + `images.worker.ts`, `web/src/images/images.ts`                                              |
| Display pipeline, derive, save                      | Implemented          | same as above                                                                                                     |
| Histogram and statistics                            | Planned              | Inspector shows a placeholder                                                                                     |
| Plate solving                                       | Integration Required | `core/src/astrometry/solvers/` (ASTAP, astrometry.net)                                                            |
| Star detection                                      | Integration Required | `core/src/imaging/stars/detector.ts`                                                                              |
| Streak detection                                    | Integration Required | `core/src/imaging/analysis/streak/`                                                                               |
| WCS                                                 | Integration Required | `core/src/astrometry/wcs/`                                                                                        |
| Shared image viewer                                 | Implemented          | `web/src/viewer/` (overlays in image pixels, zoom/pan in `transform.ts`)                                          |
| Overlays                                            | Partial              | Reticle only (`web/src/viewer/Reticle.tsx`)                                                                       |
| Planetarium, search, inspector, time, observer      | Implemented          | `web/src/sky/`, `api/src/sky/`                                                                                    |
| FOV and optical presets                             | Implemented          | `web/src/sky/framing.ts` (gnomonic outline, position angle)                                                       |
| HiPS surveys                                        | Integration Required | `core/src/adapters/sky/hips2fits.ts`, `core/src/astronomy/sky/spatial/healpix.ts`                                 |
| Eclipses (solar, lunar, maps)                       | Integration Required | `core/src/astronomy/events/eclipse/`                                                                              |
| Calculator formulas                                 | Integration Required | `core/src/astronomy/formulas.ts` (pure, importable by `web`)                                                      |
| Alpaca server                                       | Integration Required | `core/src/devices/alpaca/server.ts`, `discovery.ts`                                                               |
| PHD2 and built-in guider                            | Integration Required | `core/src/devices/guiding/phd2.ts`, `core/src/observation/guiding/`                                               |
| Auto focus                                          | Integration Required | `core/src/observation/focus/autofocus.ts`                                                                         |
| DARV, TPPA                                          | Integration Required | `core/src/observation/alignment/`                                                                                 |
| Flat analysis and exposure                          | Integration Required | `core/src/imaging/analysis/flat/` (no wizard flow)                                                                |
| Sequencer                                           | Planned              | No engine exists in `core` or `api`                                                                               |
| Notifications                                       | Planned              | The top bar bell is static                                                                                        |

## Workspace Responsibility Matrix

Each feature has exactly one place in the UI. Workspaces share services, not interfaces.

| Workspace | Responsibility                                     | Features                                                                                                                       | Registry                                                     |
| --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Capture   | Acquisition and assisted operation of equipment    | Camera Capture, Mount Nudge, Guiding, Auto Focus, DARV, TPPA, Flat Wizard                                                      | `CAPTURE_MODE_DEFINITIONS` (`web/src/capture/modes.ts`)      |
| Images    | Documents and hardware-independent image work      | Inspector, Plate Solver, Star Detection, Streak Detection, Processing; later Annotation, Crosshair, Calibrator, ROI, FOV, Grid | `IMAGE_TOOL_DEFINITIONS` (`web/src/images/tools.ts`)         |
| Sky       | Exploration, planning, contextual mount control    | Planetarium, search, inspector, observer, time, layers, FOV, slew; later Framing with HiPS                                     | panel views in `SkyWorkspace.tsx`                            |
| Tools     | Standalone utilities, no camera or document needed | Calculator, Solar Eclipse Map, Lunar Eclipse Map, Alpaca Server                                                                | `TOOL_DEFINITIONS` (`web/src/tools/tools.ts`), `/tools/<id>` |
| Sequencer | Configuring and observing server-run automation    | Planned                                                                                                                        | a future entry in `WORKSPACE_IDS`                            |

Rules:

- A registry entry without an implementation is **planned**: listed with its reason, never selectable or openable. Placeholder panels are not created.
- Selecting a mode, tool, tab, or profile never starts, stops, or redirects an operation.
- A Capture camera view is a presentation context of a camera role; commands always target the device the setup resolves to (connection id + device id), never the role.

## Shared Image Contracts

There is **one** image store, `ImageStore` in `api/src/images.ts`, and the scientific image reference is its document id.

- An image document is addressed as `/api/images/:id/...` by every operation, whatever workspace requested it. There is no second solver or detector path for Capture.
- Camera frames enter the store as documents of the origin `{ origin: 'capture', connectionId, deviceId, frameId, time, path? }` (`ImageStore.openCapture`), decoded from the bytes the driver sent. A frame is never identified by camera role.
- In loop capture, each frame is its own document. An analysis stays bound to the id it was started on, and a newer frame never changes it. The capture service (`api/src/captures.ts`) retains the latest frame of each camera and closes the previous one; pinning a frame for a running analysis is added with the first analysis that needs it.
- Analysis results (solution, star list, streaks) are keyed by image id and the parameters applied, and are kept with the document until it closes. Re-running with the same parameters reuses the result.
- A Sky Framing survey image is not an image document. Importing one into Images is an explicit action, available only when the cutout carries usable WCS metadata.

## Overlay Contracts

- Overlays draw through `ImageViewer`'s `overlays(size)` callback as SVG in **image pixel coordinates** (origin at the top-left of the first pixel). Zoom, pan, fit, 1:1, and resize are applied by the viewer, so overlays never compute screen coordinates. Strokes use `vectorEffect="non-scaling-stroke"`.
- An overlay is a pure function of a result and the image shown: it draws only results whose image id matches the displayed image. Hiding an overlay never cancels or deletes the result, and showing one never re-runs the analysis.
- Celestial-coordinate overlays (annotation, grid) require a WCS solution of that same image. Without one they are unavailable, not approximated.
- A screen-space layer and pointer interaction (Crosshair, ROI, Mouse Coordinates) are added with their first consumer, using `toImage`/`pixelAt` from `web/src/viewer/transform.ts`.
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

| Feature        | Requires (besides the view's camera)              | Holds                                        | Conflicts with                                 |
| -------------- | ------------------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| Camera Capture | —                                                 | camera                                       | Auto Focus, Flat Wizard, TPPA, DARV, sequencer |
| Mount Nudge    | Mount                                             | camera (loop), mount (moves)                 | slew, TPPA, DARV, guiding                      |
| Guiding        | a guiding provider (PHD2 manages its own devices) | provider session; mount pulses when built-in | DARV, Mount Nudge, slews without dither settle |
| Auto Focus     | Focuser                                           | camera, focuser                              | Camera Capture, sequencer                      |
| DARV           | Mount                                             | camera, mount                                | guiding, Mount Nudge                           |
| TPPA           | Mount; a plate solver                             | camera, mount                                | Mount Nudge, slew, guiding                     |
| Flat Wizard    | — (filter wheel and flat panel optional)          | camera; wheel/panel when used                | Camera Capture                                 |
| Sky slew       | Mount                                             | mount                                        | any mount operation                            |

Conflicts are resolved by the arbiter on the server, never only in the browser, because several tabs (and profiles) may address the same device.

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

## Capture–Sequencer Compatibility Report

- There is no sequencer engine to integrate. It will be an `api` service composed of the same services Capture uses: capture via `CameraCapturer`, filter, focus, dither, and mount commands through the commanders, all under the `OperationRegistry`.
- Acquisition exists once, in `CameraCapturer`. Camera Capture, Auto Focus, DARV, TPPA, and Flat Wizard must call the same `api` capture service, never their own exposure loops.
- A run resolves its connection and device ids when it starts and keeps them. Changing the active profile in a tab never redirects it.
- The UI observes a run through snapshots and events, never by owning it.

## Persistence and State

| State                                                | Owner                                          |
| ---------------------------------------------------- | ---------------------------------------------- |
| Profiles, presets, panel and view preferences        | browser localStorage, versioned (`profile.ts`) |
| Active profile                                       | sessionStorage per tab                         |
| Route, document view, zoom/pan                       | tab memory                                     |
| Image pixels and analysis results                    | `api` image store                              |
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
| 8   | Images    | Plate solving and star detection routes by image id, results keyed by id; overlays            | —          |
| 9   | Capture   | Device capabilities in `DeviceSummary`; an `unsupported` availability state                   | —          |
| 10  | Capture   | Mount Nudge, Auto Focus, DARV, TPPA, Flat Wizard, Guiding (PHD2)                              | 6, 8, 9    |
| 11  | Sequencer | Sequencer service and workspace                                                               | 6, 10      |
