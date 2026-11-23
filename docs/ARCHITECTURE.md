# Architecture

This document explains what Nebulosa is made of, why each part exists, and how the parts relate.
It holds the core every change needs (the glossary, the layer map, the shared rules, how a feature is added) and an index of the documents under `docs/architecture/`, one per feature or cross-cutting reference.
What each document holds, and when a change updates it, is ruled by the Architecture Reference of [`AGENTS.md`](../AGENTS.md): what a feature is, why it exists, its relations, and its rules and limitations, never layout, styles, routes, payloads, constants, or other detail the code already states.

Reading order for a new contributor: the [Glossary](#glossary), the [Architecture Map](#architecture-map), and the [Shared Rules](#shared-rules), then [Adding a Feature](#adding-a-feature), then the [Workspace Responsibility Matrix](architecture/workspace-responsibility-matrix.md) and the document of each feature the change touches.

## Glossary

- **Connection**: an open INDI, Alpaca, or simulator client on the server (`api/src/connection.ts`).
  Saved connections are workspace data the server keeps; open ones are server state shared by every tab.
- **Device**: one interface a connection reports (camera, mount, focuser, …), identified by connection id and device id.
  Several interfaces of one physical device share a hardware id.
- **Profile**: the workspace of an operator: its saved connection, equipment setup, and preferences, kept by the server (`api/src/workspace.ts`) for every tab and browser and edited in the tab (`web/src/profile/`).
  Which profile is active is the tab's own.
- **Equipment setup** and **role**: the assignment, in a profile, of devices of its connection to operational roles (`EquipmentRole` in `web/src/equipment/roles.ts`: main and guide camera, mount, focuser, filter wheel, rotator, guide output, dome, cover, flat panel).
  Roles only choose devices in the UI; every command still names the exact device.
- **Equipment Catalog**: the physical cameras and telescopes of the workspace, and the binding of each camera device to one of them (see [Equipment Catalog](architecture/equipment-catalog.md)).
- **Operation**: a server-owned piece of device work holding devices under the `OperationRegistry` (`api/src/operations.ts`), observed by every tab.
- **Reservation**: a hold on several devices under which a caller inside the process composes tools (see [Operation Lifecycle Rules](architecture/operation-lifecycle-rules.md)); a manual command of a reserved device is refused as busy.
- **Session**: the record of a multi-step operation of one service (a capture, an Auto Focus run, a held mount nudge), with its own events.
- **Image document**: decoded pixels in the server's `ImageStore`, addressed by an image id; files, camera frames, and derived images are all documents.
- **Camera tab**: the permanent tab of Images for one connected camera, showing its frames and hosting its camera operations.
- **Lease**: a hold a client keeps on a server resource (a capture frame's document, a held motion) that the server releases when the client goes away.

## Architecture Map

- **`core/`** (the `nebulosa` toolkit): algorithms and device protocols (INDI and Alpaca clients, orchestration, the capture runner, solvers, star detection, ephemerides); never application state, HTTP, or UI.
- **`api/`**: runtime services (connections, devices, operations, image documents, sky queries, the workspace, the operational database), their HTTP routes, and the event WebSocket; never presentation state.
- **`web/`**: presentation (workspaces, the active profile, selection, view state) and mirrors of server state fed by HTTP and events; never operations, device arbitration, or scientific pixels.
- **`app/`**: wires `api` and `web` into one `Bun.serve` and owns the build; never business logic.
- **`bin/`**: development scripts that generate the bundled catalogs and assets; nothing imports it.

## Shared Rules

- **The server owns the work.**
  Device work, sessions, and image analyses run on the server, so they survive a reload and every tab sees the same state.
  A tab mirrors server state from `GET` snapshots plus the `/api/ws` event stream and refreshes its snapshots whenever its socket opens (see [Routes and Events](architecture/routes-and-events.md)).
- **One device, one holder.**
  Every operation acquires the devices it moves through the arbiter, and a manual command of a held device is refused as busy; a stop stays a safety command that cancels whatever holds the device (see [Operation Lifecycle Rules](architecture/operation-lifecycle-rules.md) and the [Device Resource Matrix](architecture/device-resource-matrix.md)).
- **The equipment setup is the source of truth.**
  The devices it assigns are the ones that physically work together: its guide output drives its mount, whatever device it is, and its cameras look through or guide for that mount.
  No feature second-guesses it, guesses a wiring, or adds protection against a setup assigned wrong; that is the operator's to fix.
  A feature that moves the mount through a guide output holds both the guide output and the setup's mount until the motion is over.
- **One place in the UI.**
  Each feature has exactly one home in one workspace; workspaces share services, not interfaces (see the [Workspace Responsibility Matrix](architecture/workspace-responsibility-matrix.md) and [UI Structure](architecture/ui-and-layout.md)).
- **One operational database.**
  State that must survive a restart lives in the central database under the data directory, never in files or databases of a service's own; in development a change of a stored shape discards the old data instead of migrating it (see [Persistence and State](architecture/persistence-and-state.md)).
- **Computation stays where it belongs.**
  Algorithms and protocols belong to the toolkit, their use to `api`, and the web never runs toolkit code that needs Bun, the filesystem, or native libraries.

## Adding a Feature

1. **Toolkit first.**
   A missing algorithm or protocol belongs to `nebulosa.ts` (`core/`), not to this repository.
2. **Server service.**
   A class in its own `api/src/<name>.ts` taking its collaborators in the constructor, with a `create<Name>Routes(service)` factory composed in `api/src/index.ts`.
   Device work runs as an operation; a capability other tools may compose admits a `ToolInvocation` (see [Operation Lifecycle Rules](architecture/operation-lifecycle-rules.md)); persisted state goes into the central database.
3. **Contract.**
   Payload, state, and event types exported from `api/src/index.ts`, imported by the web with `import type`.
4. **Web mirror.**
   A `valtio` store fed by a snapshot and the events, registered once in `SERVER_STORES` (`web/src/main.tsx`).
5. **One place in the UI.**
   An entry in the registry of its workspace (see the [Workspace Responsibility Matrix](architecture/workspace-responsibility-matrix.md)).
6. **Preferences.**
   Per-operator form values go into the profile; per-device forms are keyed by the device, never by a role (see [Persistence and State](architecture/persistence-and-state.md)).
7. **Credits.**
   An external service, dataset, published method, protocol, or bundled program it starts using gets its entry in `CREDIT_GROUPS` (`web/src/about/about.ts`).
8. **The documents.**
   A document of its own under `docs/architecture/`, listed below, its line in the [Capability Inventory](architecture/capability-inventory.md), and its place in the [Workspace Responsibility Matrix](architecture/workspace-responsibility-matrix.md) and, when it holds devices, the [Device Resource Matrix](architecture/device-resource-matrix.md).

## Documents

### Foundations

- [Capability Inventory](architecture/capability-inventory.md)
- [Workspace Responsibility Matrix](architecture/workspace-responsibility-matrix.md)
- [UI Structure](architecture/ui-and-layout.md)
- [Routes and Events](architecture/routes-and-events.md)
- [Operation Lifecycle Rules](architecture/operation-lifecycle-rules.md)
- [Device Resource Matrix](architecture/device-resource-matrix.md)
- [Persistence and State](architecture/persistence-and-state.md)
- [Test Baseline](architecture/test-baseline.md)

### Equipment

- [Equipment Catalog](architecture/equipment-catalog.md)
- [Equipment Control](architecture/equipment-control.md)
- [INDI Properties](architecture/indi-properties.md)
- [INDI Messages](architecture/indi-messages.md)
- [External Tools](architecture/external-tools.md)
- [Observatory Cameras](architecture/observatory-cameras.md)
- [Notifications](architecture/notifications.md)

### Images

- [Shared Image](architecture/shared-image.md)
- [Overlay](architecture/overlay.md)
- [Capture Frames](architecture/capture-frames.md)
- [Open Images](architecture/open-images.md)
- [Star Detection](architecture/star-detection.md)
- [Star Profile Inspector](architecture/star-profile-inspector.md)
- [Streak Detection](architecture/streak-detection.md)
- [Image Statistics](architecture/image-statistics.md)
- [Annotation](architecture/annotation.md)
- [Plate Solving](architecture/plate-solving.md)

### Camera Operations

- [Auto Focus](architecture/auto-focus.md)
- [TPPA](architecture/tppa.md)
- [iPolar](architecture/ipolar.md)
- [DARV](architecture/darv.md)
- [Flat Wizard](architecture/flat-wizard.md)
- [Dark Library Wizard](architecture/dark-library-wizard.md)
- [Live Stacking](architecture/live-stacking.md)
- [Target Centering](architecture/target-centering.md)
- [Guiding](architecture/guiding.md)

### Mount

- [Mount Pointing Model](architecture/mount-pointing-model.md)
- [Meridian Flip Monitor](architecture/meridian-flip-monitor.md)
- [Meridian Flip Executor](architecture/meridian-flip-executor.md)
- [Meridian Flip](architecture/meridian-flip.md)
- [Mount Remote Control](architecture/mount-remote-control.md)

### Calibration and Stacking

- [Calibration Library](architecture/calibration-library.md)
- [Image Stacking](architecture/image-stacking.md)

### Sky

- [Sky Map](architecture/sky-map.md)
- [Sun Inspector](architecture/sun-inspector.md)
- [Moon Inspector](architecture/moon-inspector.md)
- [Framing](architecture/framing.md)
- [World Map](architecture/world-map.md)
- [Observing Sites and Time Zones](architecture/observing-sites-and-time-zones.md)

### Ephemerides and Planning

- [Ephemeris Chain](architecture/ephemeris-chain.md)
- [SPICE Kernel Library](architecture/spice-kernel-library.md)
- [Eclipse Ephemeris](architecture/eclipse-ephemeris.md)
- [Solar Eclipse Map](architecture/solar-eclipse-map.md)
- [Lunar Eclipse Map](architecture/lunar-eclipse-map.md)
- [Close Approaches](architecture/close-approaches.md)
- [Planetary Events](architecture/planetary-events.md)
- [Meteor Showers](architecture/meteor-showers.md)
- [Artificial Satellites](architecture/artificial-satellites.md)
- [Orbital Mechanics Explorer](architecture/orbital-mechanics-explorer.md)
- [Observing Planner](architecture/observing-planner.md)
- [Jupiter Observing Planner](architecture/jupiter-observing-planner.md)
- [Saturn Observing Planner](architecture/saturn-observing-planner.md)
- [Astro Weather](architecture/astro-weather.md)
- [Calculator](architecture/calculator.md)
- [Astronomical Time Converter](architecture/astronomical-time-converter.md)
- [Tools Integration](architecture/tools-integration.md)

### Sequencer

- [Capture–Sequencer Compatibility Report](architecture/capture-sequencer-compatibility-report.md)
