# Capability Inventory

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The status of every capability of Nebulosa, with the document that describes it.

Status:

- **Implemented**: works end to end.
- **Partial**: works, with the gap its line names.
- **Planned**: nothing exists yet.
- **Integration Required**: exists in `core`, not exposed by `api` and `web`.

Shell and workspace:

- **Shell, routes, workspaces, status bar**: Implemented ([UI Structure](ui-and-layout.md)).
- **About page**: Implemented.
- **Profiles**: Implemented ([Persistence and State](persistence-and-state.md)).
- **Connections (INDI, Alpaca, simulator)**: Implemented; the Alpaca servers on the network of the Nebulosa server can be discovered (IPv4 broadcast only).
- **Equipment Setup**: Implemented.
- **Equipment Catalog**: Implemented ([Equipment Catalog](equipment-catalog.md)).
- **Observing sites**: Implemented ([Observing Sites and Time Zones](observing-sites-and-time-zones.md)).
- **Server file browser**: Implemented.
- **External tools settings**: Implemented ([External Tools](external-tools.md)).
- **Notifications**: Implemented ([Notifications](notifications.md)).

Devices and operations:

- **Device registry and identity**: Implemented.
- **Device capabilities and control states**: Implemented ([Equipment Control](equipment-control.md)).
- **Operations and arbitration**: Implemented ([Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- **Equipment Control (manual device control)**: Implemented ([Equipment Control](equipment-control.md)).
- **Mount commands**: Implemented ([Equipment Control](equipment-control.md)).
- **Focuser, wheel, rotator, cover, flat panel, dew heater, dome, camera cooling**: Implemented ([Equipment Control](equipment-control.md)).
- **Focuser backlash compensation**: Implemented ([Equipment Control](equipment-control.md)).
- **INDI properties**: Implemented ([INDI Properties](indi-properties.md)).
- **INDI messages**: Implemented ([INDI Messages](indi-messages.md)).
- **Mount pointing model**: Implemented ([Mount Pointing Model](mount-pointing-model.md)).
- **Mount remote control (LX200, Stellarium)**: Implemented ([Mount Remote Control](mount-remote-control.md)).
- **Meridian flip and mount limits**: Partial, the mount limits of the toolkit are not integrated ([Meridian Flip](meridian-flip.md), [Meridian Flip Monitor](meridian-flip-monitor.md), [Meridian Flip Executor](meridian-flip-executor.md)).
- **Observatory cameras**: Implemented ([Observatory Cameras](observatory-cameras.md)).
- **Alpaca server**: Integration Required, no `api` service and the Tools entry is planned.
- **PHD2 guiding**: Integration Required.
- **Power, weather, safety monitor, GPS devices**: Integration Required, not managed by `api`; their INDI vectors are reachable through [INDI Properties](indi-properties.md).

Images and camera operations:

- **Image documents (FITS, XISF)**: Implemented ([Shared Image](shared-image.md)).
- **Shared image viewer**: Implemented ([Shared Image](shared-image.md)).
- **Display pipeline, save and download**: Implemented ([Shared Image](shared-image.md)).
- **Overlays**: Partial, no region of interest overlay ([Overlays](overlay.md)).
- **Camera capture and frames**: Implemented ([Capture Frames](capture-frames.md)).
- **Camera tabs in Images**: Implemented ([Capture Frames](capture-frames.md)).
- **Open files restored after a reload**: Implemented ([Open Images](open-images.md)).
- **Histogram and statistics**: Implemented ([Image Statistics](image-statistics.md)).
- **Star detection**: Implemented ([Star Detection](star-detection.md)).
- **Star Profile Inspector**: Implemented ([Star Profile Inspector](star-profile-inspector.md)).
- **Streak detection**: Implemented ([Streak Detection](streak-detection.md)).
- **Image annotation**: Implemented ([Annotation](annotation.md)).
- **Plate solving and WCS**: Implemented ([Plate Solving](plate-solving.md)).
- **Image processing**: Integration Required, the toolkit's single-image operations are not exposed; planned as a tool of Tools.
- **Auto focus**: Implemented ([Auto Focus](auto-focus.md)).
- **TPPA**: Implemented ([TPPA](tppa.md)).
- **iPolar**: Implemented ([iPolar](ipolar.md)).
- **DARV**: Implemented ([DARV](darv.md)).
- **Flat analysis and exposure**: Implemented ([Flat Wizard](flat-wizard.md)).
- **Dark acquisition**: Implemented ([Dark Library Wizard](dark-library-wizard.md)).
- **Live stacking**: Implemented ([Live Stacking](live-stacking.md)).
- **Target Centering**: Implemented ([Target Centering](target-centering.md)).
- **Native guiding**: Implemented ([Guiding](guiding.md)).
- **Calibration library**: Implemented ([Calibration Library](calibration-library.md)).
- **Image stacking**: Implemented ([Image Stacking](image-stacking.md)).
- **Sequencer**: Planned, no engine exists in `core` or `api` ([Capture–Sequencer Compatibility Report](capture-sequencer-compatibility-report.md)).
- **Mosaic planning and night scheduling**: Integration Required.

Sky, ephemerides, and planning:

- **Planetarium, search, inspector, time, observer, favorites**: Implemented ([Sky Map](sky-map.md)).
- **Sun Inspector**: Implemented ([Sun Inspector](sun-inspector.md)).
- **Moon Inspector**: Implemented ([Moon Inspector](moon-inspector.md)).
- **Framings**: Implemented ([Framing](framing.md)).
- **HiPS surveys**: Partial, only the hips2fits cutouts of the Framing preview; HEALPix tiles are not read ([Framing](framing.md)).
- **Solar-system ephemerides**: Implemented ([Ephemeris Chain](ephemeris-chain.md)).
- **SPICE Kernel Library**: Implemented ([SPICE Kernel Library](spice-kernel-library.md)).
- **Lunar eclipses and map**: Implemented ([Lunar Eclipse Map](lunar-eclipse-map.md), [Eclipse Ephemeris](eclipse-ephemeris.md)).
- **Solar eclipses and map**: Implemented ([Solar Eclipse Map](solar-eclipse-map.md), [Eclipse Ephemeris](eclipse-ephemeris.md)).
- **Calculator formulas**: Implemented ([Calculator](calculator.md)).
- **Astronomical time conversion**: Implemented ([Astronomical Time Converter](astronomical-time-converter.md)).
- **Close approaches of small bodies**: Implemented ([Close Approaches](close-approaches.md)).
- **Two-body orbital mechanics**: Implemented ([Orbital Mechanics Explorer](orbital-mechanics-explorer.md)).
- **Astro Weather**: Implemented ([Astro Weather](astro-weather.md)).
- **Observing Planner**: Implemented ([Observing Planner](observing-planner.md)).
- **Jupiter Observing Planner**: Implemented ([Jupiter Observing Planner](jupiter-observing-planner.md)).
- **Saturn Observing Planner**: Implemented ([Saturn Observing Planner](saturn-observing-planner.md)).
- **Planetary Events**: Implemented ([Planetary Events](planetary-events.md)).
- **Meteor Showers**: Implemented ([Meteor Showers](meteor-showers.md)).
- **Artificial satellites**: Partial, mount tracking, brightness, and screening are not provided ([Artificial Satellites](artificial-satellites.md)).
- **World map**: Implemented ([World Map](world-map.md)).
- **Tools catalog**: Implemented ([Tools Integration](tools-integration.md)).
