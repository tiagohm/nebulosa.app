# Workspace Responsibility Matrix

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Where each feature lives in the UI, and the registry that declares it.

- Each feature has exactly one place in the UI.
- Workspaces share services, not interfaces.
- A registry entry without an implementation is planned: listed with its reason, never selectable or openable, and no placeholder panel is created.
- Selecting a workspace, mode, tool, tab, or profile never starts, stops, or redirects an operation.
- The URL path is the source of truth for navigation (`web/src/shell/route.ts`); the workspaces of the navigation rail are the entries of `WORKSPACE_IDS`.

## Shell

- Responsibility: what every workspace shares, always mounted while navigating.
- Features: the Connections, Equipment Setup, and Profiles modals (modals of the shell, not routes), the observing site menu ([Observing Sites and Time Zones](observing-sites-and-time-zones.md)), the notification bell ([Notifications](notifications.md)), and the status bar, the only global status surface ([UI Structure](ui-and-layout.md)).
- Registry: `WORKSPACES` (`web/src/shell/workspaces.ts`).

## Images

- Responsibility: image documents, image work, and the camera operations of the camera tabs.
- Image tools: Image Inspector ([Image Statistics](image-statistics.md)), [Plate Solving](plate-solving.md), [Star Detection](star-detection.md), [Star Profile Inspector](star-profile-inspector.md), [Streak Detection](streak-detection.md), [Annotation](annotation.md).
- Camera operations: Camera Acquisition ([Capture Frames](capture-frames.md)), [Live Stacking](live-stacking.md), [Auto Focus](auto-focus.md), Mount Nudge, [Guiding](guiding.md), [DARV](darv.md), [TPPA](tppa.md), [iPolar](ipolar.md), Pointing Model Builder ([Mount Pointing Model](mount-pointing-model.md)), [Target Centering](target-centering.md), [Flat Wizard](flat-wizard.md), [Dark Library Wizard](dark-library-wizard.md).
- Registry: `IMAGE_TOOL_DEFINITIONS` (`web/src/images/tools.ts`), whose `category` tells an image tool from a camera operation.

Rules of the workspace:

- Every document is shown by the one shared viewer ([Shared Image](shared-image.md)); display settings, full screen, and save and download are controls of the viewer toolbar for every document, whatever tool is selected, and no panel repeats them.
- An image tool declares its outputs: a new rendering of the document, a new temporary document, or an analysis that leaves the pixels untouched.
- Camera operations are listed only on a camera tab and have no outputs: their frames reach the tab as the camera's latest frame, and a view of a session (such as a focus curve, a guiding graph, or a pointing map) belongs to the bottom area of the tab.
- There is no Capture workspace: acquisition and the assisted operations of equipment are camera operations of the camera tabs.
- The equipment of a camera operation is the `CameraOperationContext` of the tab (`web/src/images/cameracontext.ts`), read from the active equipment setup: the setup's mount for every camera of the connection, the focuser, filter wheel, flat panel, and cover only for the main camera, and the guide output only for the guide camera.
- A missing assignment is reported by the operation's panel, which offers Equipment Setup, never replaced by another connected device.
- The devices a camera operation uses are named as links to their page in Equipment Control.

## Sky

- Responsibility: exploration, planning, and contextual mount control.
- Features: the planetarium, search with favorites, the time bar, and mount center and follow ([Sky Map](sky-map.md)); the panel views Object Inspector (with the inspectors of the [Sun](sun-inspector.md), the [Moon](moon-inspector.md), artificial satellites, and the mount), Observer, Display, and Framing ([Framing](framing.md)).
- Registry: `SkyPanelView` (`web/src/sky/sky.ts`).

## Tools

- Responsibility: standalone utilities that need no camera or document ([Tools Integration](tools-integration.md)).
- Features: [Calculator](calculator.md), [Astronomical Time Converter](astronomical-time-converter.md), [Solar Eclipse Map](solar-eclipse-map.md), [Lunar Eclipse Map](lunar-eclipse-map.md), [Close Approaches](close-approaches.md), [Orbital Mechanics Explorer](orbital-mechanics-explorer.md), [Astro Weather](astro-weather.md), [Meridian Flip](meridian-flip.md), [Observing Planner](observing-planner.md), [Framing](framing.md), [Jupiter Observing Planner](jupiter-observing-planner.md), [Saturn Observing Planner](saturn-observing-planner.md), [Planetary Events](planetary-events.md), [Meteor Showers](meteor-showers.md), [Artificial Satellites](artificial-satellites.md), [Calibration Library](calibration-library.md), [Image Stacking](image-stacking.md), [Mount Remote Control](mount-remote-control.md), Mount Pointing Model ([Mount Pointing Model](mount-pointing-model.md)), [Observatory Cameras](observatory-cameras.md), [SPICE Kernel Library](spice-kernel-library.md); Alpaca Server planned.
- Registry: `TOOL_DEFINITIONS` (`web/src/tools/tools.ts`).

## Sequencer

- Responsibility: configuring and observing server-run automation.
- Features: planned ([Capture–Sequencer Compatibility Report](capture-sequencer-compatibility-report.md)).
- Registry: a future entry of `WORKSPACE_IDS`.

## Equipment Control

- Responsibility: manual control of every device of the profile's connection, a page opened from the Management menu ([Equipment Control](equipment-control.md)).
- Features: the controls of each managed device type, the [INDI Properties](indi-properties.md) of every device the INDI server reports, managed or not, and the [INDI Messages](indi-messages.md) of its drivers.
- Registry: `CONTROLS` (`web/src/equipment-control/DeviceDetail.tsx`).

## Settings

- Responsibility: settings of the server instance and of the active profile, a page opened from the top bar.
- Features: External Tools ([External Tools](external-tools.md)), Observing Sites ([Observing Sites and Time Zones](observing-sites-and-time-zones.md)), Equipment Catalog ([Equipment Catalog](equipment-catalog.md)), and Ephemeris Sources ([Ephemeris Chain](ephemeris-chain.md)), kept by the server instance; Date & Time and Status Bar, kept by the profile.
- Registry: `SETTINGS_SECTION_IDS` (`web/src/shell/route.ts`).

## About

- Responsibility: the identity of the running distribution and the credits of what it uses, shown even when the server cannot be reached.
- Registry: `CREDIT_GROUPS` (`web/src/about/about.ts`) for the credits.
