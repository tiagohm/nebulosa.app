# Architecture

This document maps what Nebulosa already has, where each feature belongs, and the contracts new features must follow.
What is still to deliver is marked Planned, Partial, or Integration Required in the [Capability Inventory](architecture/capability-inventory.md);
the next delivery is the Sequencer, whose composition boundary the [Capture–Sequencer Compatibility Report](architecture/capture-sequencer-compatibility-report.md) fixes.
The core sections below hold what every change needs; each contract and reference is a document of its own under `docs/architecture/`, listed in [Documents](#documents).
Repository rules (boundaries, style, verification) live in [`AGENTS.md`](../AGENTS.md).

Reading order for a new contributor: the [Glossary](#glossary) and the [Architecture Map](#architecture-map), then [Adding a Feature](#adding-a-feature), then the [Workspace Responsibility Matrix](architecture/workspace-responsibility-matrix.md) and [UI and Layout Contracts](architecture/ui-and-layout.md) for anything visible, then the document of each feature the change touches.

## Glossary

- **Connection**: an open INDI, Alpaca, or simulator client on the server (`api/src/connection.ts`), identified by its connection id.
  Saved connections (host, port, type) are workspace data the server keeps for every tab and browser (`api/src/workspace.ts`); open ones are server state shared by every tab.
  A disconnect of a connection still opening cancels the opening, and a connection that finishes opening after the registry was disposed (a server stopping in place) closes at once.
- **Device**: one interface a connection reports (camera, mount, focuser, …), identified by connection id + device id (`DeviceSummary`).
  Several interfaces of one physical device share a hardware id.
- **Profile**: the workspace of an operator: its saved connection, equipment setup, optical presets, and preferences, kept by the server (`api/src/workspace.ts`) for every tab and browser and edited in the tab (`web/src/profile/`), which writes back what changed (`sync.ts`).
  Which profile is active is the tab's own.
- **Equipment setup** and **role**: the assignment, in a profile, of devices of its connection to operational roles (`EquipmentRole` in `web/src/equipment/roles.ts`: `MAIN_CAMERA`, `GUIDE_CAMERA`, `MOUNT`, `FOCUSER`, `FILTER_WHEEL`, `ROTATOR`, `GUIDE_OUTPUT`, `DOME`, `COVER`, `FLAT_PANEL`), edited in the Equipment Setup modal, which connects or disconnects the assigned devices one by one or all at once (Connect all, Disconnect all: `switchSetup`).
  Roles only choose devices in the UI; every command still names the exact device.
  The equipment setup is the absolute source of truth about the setup in use: the devices it assigns are the ones that physically work together, so its `GUIDE_OUTPUT` drives its `MOUNT`, whatever device it is (the mount's own port or the ST4 port of a camera), and its cameras look through or guide for that mount.
  No code second-guesses it: no feature assumes a guide output might move another mount, guesses a wiring, or adds a protection against a setup the operator assigned wrong, and no feature stops using the setup's guide output out of such a doubt;
  a setup assigned wrong is the operator's to fix.
  A feature that moves the mount coordinates exactly the guiding through the setup's guide output, which its request names (`guideOutput`), never every guide output of a connection.
  Every operation that moves the mount through a guide output acquires, atomically in the arbiter, the guide output and the mount it drives (the setup's `MOUNT`, which its request names: `mount`), whatever device sends the pulse, and keeps both until the motion is over: a manual pulse for the pulse, guiding for its whole run (between two pulses too), Mount dithering for the whole capture.
  With the mount's own port the two are one key; with the ST4 port of a camera, or a standalone guider, both are held, and the ST4 port of a camera is held apart from that camera's sensor, which stays free to expose.
  A stop stays a safety command that cancels whatever holds the device.
- **Operation**: a server-owned piece of device work holding devices under the `OperationRegistry` (`OperationKind` in `api/src/operations.ts`), observed through `operation:updated`.
- **Reservation**: a hold of the registry's `ResourceArbiter` on several devices, under which a caller inside the process composes tools (`ToolInvocation`, see [Operation Lifecycle Rules](architecture/operation-lifecycle-rules.md));
  a manual command of a reserved device is refused as busy.
- **Session**: the record of a multi-step operation of one service (a capture, an Auto Focus run, a held mount nudge or dome rotation), with its own events.
- **Image document**: decoded pixels in the server's `ImageStore`, addressed by an image id; files, camera frames, and derived images are all documents.
- **Camera tab**: the permanent tab of Images for one connected camera, showing its frames and hosting its camera operations.
- **Lease**: a hold a client keeps on a server resource (a capture frame's document, a held motion) that the server releases when the client goes away.

## Architecture Map

- **`core/`**
    - Owns: Algorithms and device protocols: INDI/Alpaca clients, commanders, orchestration, capture runner, solvers, star detection, ephemerides, eclipses
    - Never owns: Application state, HTTP, UI
- **`api/`**
    - Owns: Runtime services: connections, devices, operations, image documents, sky queries, the workspace, the operational database; HTTP routes and the event WebSocket
    - Never owns: Presentation state
- **`web/`**
    - Owns: Presentation: workspaces, the active profile, selection, view state; mirrors of server state fed by HTTP and events
    - Never owns: Operations, device arbitration, scientific pixels
- **`app/`**
    - Owns: Wiring `api` and `web` into one `Bun.serve` and the build
    - Never owns: Business logic

Server state reaches every tab through `GET` snapshots plus the `/api/ws` event stream (`ServerEvent` in `api/src/websocket.ts`).
A tab refreshes its snapshots on every socket open (`onOpen` in `web/src/main.tsx`), so a reload never loses running work;
a socket that drops an event under backpressure is closed by the server (`broadcast` of `api/src/websocket.ts`), so its tab reconnects and refreshes instead of mirroring a state that lost an event.
Each web store that mirrors server state is listed once in `SERVER_STORES` (`web/src/main.tsx`) with its event handler and its refresh.
Events keep arriving while a snapshot is fetched, so an event may be applied before the response of an older snapshot: the stores of the open connections (`web/src/connection/connection.ts`), the operations, the captures, the sessions of the camera operations (Auto Focus, TPPA, iPolar, DARV, Flat Wizard, Dark Library Wizard, Guiding, Target Centering), Live Stacking, the held mount nudges and dome rotations (`refreshPressSessions` of `web/src/press.ts`), and the mount pointing models and sessions record, through `SnapshotRefreshes` (`web/src/refresh.ts`), the keys their events change during a refresh, and the snapshot leaves those as the events set them (`merge`), so a session that ended during the request is never shown running again.
The workspace (`WorkspaceSync` of `web/src/profile/sync.ts`) follows the same rule by record: a saved connection, an observing site, or a profile an event changed while `/api/workspace` was read keeps what the event set, and an event received before the first load is applied once the workspace loaded.
The stores of the sessions of the camera operations share one mirror (`web/src/camera/sessions.ts`): the latest session of each camera ordered by its start and revision, the snapshot refresh, the complete record fetched apart when the store's `stale` rule says its summary changed, and the commands sent one at a time per camera;
each store keeps only what its sessions hold and send.
On the server, the services whose session runs under one operation (Auto Focus, TPPA, iPolar, Target Centering, Flat Wizard, Dark Library Wizard, Guiding) keep their sessions in a `CameraSessionRegistry` (`api/src/camerasessions.ts`): the latest session of each camera, adopted in the same synchronous step as its operation starts, so its first published summary names its operation;
the session each start token started, still known after a newer session of its camera replaced it, so a repeated token answers it;
and the publication of a changed summary with its next revision, only while the session is still the latest of its camera.
DARV, which runs an operation per measurement, and the mount pointing sessions, which outlive their pauses without an operation and run one per stretch of work, keep their own.

Two streams are the exception: the INDI property stream of a physical device (`api/src/indi.ts`, see [INDI Properties Contract](architecture/indi-properties.md)) and its INDI message stream (`api/src/indimessages.ts`, see [INDI Messages Contract](architecture/indi-messages.md)) are never broadcast.
A tab asks for one with `indi:subscribe` or `indi:messagesSubscribe` over its own `/api/ws` socket and ends it with `indi:unsubscribe` or `indi:messagesUnsubscribe` (`ClientMessage`, the only messages the server reads from a socket; every socket listener receives each one and handles only its own types);
it receives a full snapshot on that socket, then the changes, so snapshot and changes form one ordered stream without a `GET`;
the subscription belongs to the socket, not to the tab's client id, and ends with it.

The control states of the devices of the active profile's connection are mirrored once in the web, by `controlRuntime` (`web/src/equipment-control/control.ts`), from `GET /api/connections/:id/states` and the `<type>:updated` events.
A view that follows one device, such as the Sky mount (`mountView`), Mount Nudge, the camera capabilities of Camera Acquisition and Auto Focus, or the sensor geometry of the camera roles that Sky Framing and the Calculator use (`CameraCapabilities.sensor`, `liveSensors` of `web/src/sky/sensors.ts`), reads that mirror (`watchedDeviceState`) and never fetches or tracks the device's state apart.

Each `api` service exposes its routes through a `create<Name>Routes(service)` factory in its own module; `api/src/index.ts` only composes the services, spreads their routes, and serves `/api/health` and `/api/ws`.
One route is composed by `app/src/main.ts` instead: `createAboutRoutes` (`api/src/about.ts`) serves the identity of the distribution, which `app` owns (its package version, and the commits and compile time `app/build.ts` inlines into the executable), so `api` never imports `app`.

Every error response of `api` is `{ error, code }` (`ApiError` and `errorResponse` in `api/src/http.ts`): a message meant for people and a stable code a client branches on, never the message.
Each service names its codes in a `<Name>ErrorCode` union (`CommandErrorCode` of `api/src/commands.ts` for the device commands, `StarDetectionErrorCode`, `PlateSolveErrorCode`, `CaptureFrameErrorCode`, …), and a route may add documented fields, such as the current state after a `conflict`.

## Adding a Feature

The path every new capability follows, so it lands in one place and is observable from every tab:

1. **Toolkit first.**
   If the algorithm or protocol is missing, it belongs to `nebulosa.ts` (`core/`), not to this repository.
2. **Server service.**
   A class in its own `api/src/<name>.ts` taking its collaborators in the constructor (devices, client lookup, `OperationRegistry`, `ImageStore`, `ExternalToolsStore`, and `publish` for the events of its operations and sessions or `broadcast` for the others, see [Routes and Events](architecture/routes-and-events.md)), with a `create<Name>Routes(service)` factory beside it, composed in `api/src/index.ts`.
   Device work runs as an operation;
   image analyses use the shared `AnalysisScheduler`, unless the analysis is one short request a person is waiting on (Star Profile Inspector Contract);
   settings that belong to the server instance, and any other state that must survive a restart, are rows of a table of `api/src/database/migrations/0001_initial.sql`, read and written through the `AppDatabase` the store receives (see Central Database), never a file or a database of their own.
   A capability a caller inside the process may compose answers through a typed `admit…` method (`admit`, `admitGoTo`, `admitMove`) taking an optional `ToolInvocation`, returning its identity and end or a `CommandRefusal`, and runs every operation of it under `operations.scope(invocation)` (see [Operation Lifecycle Rules](architecture/operation-lifecycle-rules.md));
   its route only maps that to a `Response`.
3. **Contract.**
   Payload, state, and event types exported from `api/src/index.ts`, which the web imports with `import type { … } from 'api'`; error codes named; the event added to `ServerEvent`.
4. **Web mirror.**
   A `valtio` store fed by a `GET` snapshot and the event, registered once in `SERVER_STORES` (`web/src/main.tsx`), with pure, injectable-`fetch` tests.
5. **One place in the UI.**
   An entry in the registry of its workspace (`IMAGE_TOOL_DEFINITIONS` of `web/src/images/tools.ts`, `TOOL_DEFINITIONS` of `web/src/tools/tools.ts`, `SkyPanelView` of `web/src/sky/sky.ts`, `CONTROLS` of `web/src/equipment-control/DeviceDetail.tsx`, or a new `WORKSPACE_IDS` entry of `web/src/shell/route.ts`), following UI and Layout Contracts.
   A registry entry may exist before its view only as planned.
6. **Preferences.**
   Per-operator form values go into the profile (`ProfileSettings` of `web/src/profile/schema.ts`): a preference the server keeps is a key of `PREFERENCES` in `web/src/profile/sync.ts`, of `ProfilePreferenceKey` in `api/src/workspace.ts`, and of the `CHECK` of `profile_preferences`, and a camera form a key of `CameraSettings` (`schema.ts`), of `CAMERA_FORMS` (`sync.ts`), of `ProfileCameraForm`, and of the `CHECK` of `profile_camera_settings`;
   a field the server never keeps is view state: it says so in `schema.ts` and is a key of `VIEW_FIELDS` and `VIEW_STORAGE` in `web/src/profile/view.ts`.
   A change to the shape of a kept value raises `PROFILE_SETTINGS_VERSION` (an added optional field does not), never a migration; per-device forms are keyed by the device (connection id and device id), never by a role.
7. **Credits.**
   An external service, dataset, published model or method, or program a feature starts using gets its entry in `CREDIT_GROUPS` (`web/src/about/about.ts`), with the license or acknowledgment its publisher asks for.
8. **The documents.**
   The row of the [Capability Inventory](architecture/capability-inventory.md), the rows of the [Workspace Responsibility Matrix](architecture/workspace-responsibility-matrix.md) and the [Device Resource Matrix](architecture/device-resource-matrix.md), the routes and events of [Routes and Events](architecture/routes-and-events.md), and the feature's contract, a document of its own under `docs/architecture/` listed in [Documents](#documents), are updated in the same commit.

## Documents

Every contract and reference below is a document of its own under `docs/architecture/`, in the order a reader usually needs them.

- [Routes and Events](architecture/routes-and-events.md)
- [Capability Inventory](architecture/capability-inventory.md)
- [Workspace Responsibility Matrix](architecture/workspace-responsibility-matrix.md)
- [UI and Layout Contracts](architecture/ui-and-layout.md)
- [Shared Image Contracts](architecture/shared-image.md)
- [Capture Frames Contract](architecture/capture-frames.md)
- [Overlay Contracts](architecture/overlay.md)
- [World Map Contract](architecture/world-map.md)
- [Observing Sites and Time Zones Contract](architecture/observing-sites-and-time-zones.md)
- [Operation Lifecycle Rules](architecture/operation-lifecycle-rules.md)
- [Device Resource Matrix](architecture/device-resource-matrix.md)
- [Equipment Control Contract](architecture/equipment-control.md)
- [INDI Properties Contract](architecture/indi-properties.md)
- [INDI Messages Contract](architecture/indi-messages.md)
- [Sky Map Contract](architecture/sky-map.md)
- [Sun Inspector Contract](architecture/sun-inspector.md)
- [Moon Inspector Contract](architecture/moon-inspector.md)
- [Sky Framing Integration Contract](architecture/sky-framing-integration.md)
- [Tools Integration Contract](architecture/tools-integration.md)
- [Astro Weather Contract](architecture/astro-weather.md)
- [Observing Planner Contract](architecture/observing-planner.md)
- [Jupiter Observing Planner Contract](architecture/jupiter-observing-planner.md)
- [Saturn Observing Planner Contract](architecture/saturn-observing-planner.md)
- [Artificial Satellites Contract](architecture/artificial-satellites.md)
- [SPICE Kernel Library Contract](architecture/spice-kernel-library.md)
- [External Tools Contract](architecture/external-tools.md)
- [Observatory Cameras Contract](architecture/observatory-cameras.md)
- [Star Detection Contract](architecture/star-detection.md)
- [Star Profile Inspector Contract](architecture/star-profile-inspector.md)
- [Streak Detection Contract](architecture/streak-detection.md)
- [Annotation Contract](architecture/annotation.md)
- [Plate Solving Contract](architecture/plate-solving.md)
- [Image Processing Contract](architecture/image-processing.md)
- [Auto Focus Contract](architecture/auto-focus.md)
- [TPPA Contract](architecture/tppa.md)
- [iPolar Contract](architecture/ipolar.md)
- [DARV Contract](architecture/darv.md)
- [Flat Wizard Contract](architecture/flat-wizard.md)
- [Dark Library Wizard Contract](architecture/dark-library-wizard.md)
- [Calibration Library Contract](architecture/calibration-library.md)
- [Image Stacking Contract](architecture/image-stacking.md)
- [Live Stacking Contract](architecture/live-stacking.md)
- [Target Centering Contract](architecture/target-centering.md)
- [Guiding Contract](architecture/guiding.md)
- [Mount Pointing Model Contract](architecture/mount-pointing-model.md)
- [Meridian Flip Monitor Contract](architecture/meridian-flip-monitor.md)
- [Meridian Flip Executor Contract](architecture/meridian-flip-executor.md)
- [Notifications Contract](architecture/notifications.md)
- [Capture–Sequencer Compatibility Report](architecture/capture-sequencer-compatibility-report.md)
- [Persistence and State](architecture/persistence-and-state.md)
- [Test Baseline](architecture/test-baseline.md)
