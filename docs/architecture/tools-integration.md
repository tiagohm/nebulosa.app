# Tools Integration Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Navigation: Tools → catalog card → `/tools/<id>` (`TOOL_DEFINITIONS` of `web/src/tools/tools.ts`), rendered by the tool's `view` inside its own `WorkspaceLayout`; each card shows an icon of its own, never shared with another tool.
  A tool without a view (the Alpaca Server) is planned and its URL is replaced by the catalog's.
  The catalog shows the tools under the headings of `TOOL_GROUPS`, in the order of a night (Planning, Rig & Observatory, Frames, Reference), each tool in exactly one group.
  A tool whose readiness reports work running on the server (`running`: an enabled Meridian Flip Monitor, an armed or running flip, a Mount Remote Control listener) leaves its group for a first Running group, shown only while one runs (`catalogGroups`); a setup gap, a failing service, and a planned tool are never lifted.
  A card shows the tool's `summary`, one verb phrase of at most 40 characters that fits two lines of the narrowest card and is hidden below `sm`, where the name alone keeps the list short; its full `description`, with the sources and protocols, is the card's tooltip.
  A filter in the workspace actions narrows it to the tools whose name, summary, description, or `keywords` (words never shown: the calculators of the Calculator, common names and abbreviations such as Moon, FOV, or ISS, and the protocols and sources a tool speaks) hold every word typed, ignoring case and accents (`matchesTool`), hides the groups left empty, and opens the only openable tool left with Enter; it is transient view state, cleared when the catalog is left.
  When nothing matches, the catalog names the query, says that plate solving, star detection, focusing, guiding, and polar alignment are in Images and framing and finding objects in Sky, with a link to each, and offers Clear Filter, which keeps the focus in the filter.
  The rail's Tools button reopens the last place shown in Tools, and a tool's header leads its title with `Tools /`, back to the catalog (see [UI and Layout Contracts](ui-and-layout.md)).
  Every openable card is a Tab stop of its own, in reading order; the arrow keys do not move between cards.
  Opening a tool focuses its title (`data-workspace-title`), and returning to the catalog focuses the card of the tool left and restores the catalog's scroll position, kept as tab memory (`catalogMemory`), never persisted.
  The page title names the tool shown (`<tool> · Nebulosa`, `Tools · Nebulosa` for the catalog) and is `Nebulosa` again once Tools is left.
- Readiness (`toolReadiness` of `web/src/tools/readiness.ts`): a card shows one word only by exception, as a `StatusBadge` whose tooltip gives the full reason, and a tool ready to use shows none.
  Where there is no hover to show the tooltip (below `sm`, or a touch screen of any width, `@media (hover: hover)` not matching), the reason is also a caption under the card's name; elsewhere it is visually hidden text of the card, so a screen reader reads it with the card.
  In order: Planned (muted, the tool cannot be opened);
  then what blocks the tool's main job for the active profile, read from the stores of the tab and never second-guessed: Needs mount (muted) for the Meridian Flip Monitor and Mount Remote Control while the profile's `MOUNT` role is not connected, with the reason of `MOUNT_ROLE_BLOCKERS`, Needs site (muted) for Astro Weather without an active observing site, and Needs MediaMTX (muted) or MediaMTX unavailable (warning) for Observatory Cameras by the status of the media gateway;
  then what the tool keeps running on the server for the profile's mount: the Meridian Flip Monitor's running flip step, Armed, or the headline the status bar shows (`meridianFlipHeadline`, its tone kept except that success is shown as active), and Serving (active) while a Mount Remote Control listener runs.
  A blocked tool still opens, into its own setup state.
  A tool that only needs the internet (Astro Weather's forecasts, Close Approaches, Artificial Satellites) and an input that only part of a tool needs (the passes of a satellite) are never marked: the tool shows its own state when opened.
- Contracts: each tool is described by the contract of its feature, listed in the order of `TOOL_GROUPS`.
  A new tool adds its section to the contract of its feature, or a contract of its own under `docs/architecture/`, and its link here.
    - Planning: [Astro Weather](astro-weather.md), [Observing Planner](observing-planner.md), [Framing](framing.md), [Planetary Events](planetary-events.md), [Meteor Showers](meteor-showers.md), [Jupiter Observing Planner](jupiter-observing-planner.md), [Saturn Observing Planner](saturn-observing-planner.md), [Artificial Satellites](artificial-satellites.md), [Close Approaches](close-approaches.md), [Solar Eclipse Map](solar-eclipse-map.md), and [Lunar Eclipse Map](lunar-eclipse-map.md), the two eclipse maps over the [Eclipse Ephemeris](eclipse-ephemeris.md).
    - Rig & Observatory: [Meridian Flip](meridian-flip.md) (over the [Meridian Flip Monitor](meridian-flip-monitor.md) and the [Meridian Flip Executor](meridian-flip-executor.md)), [Mount Remote Control](mount-remote-control.md), [Mount Pointing Model](mount-pointing-model.md), [Observatory Cameras](observatory-cameras.md), and the Alpaca Server, planned below.
    - Frames: [Calibration Library](calibration-library.md) and [Image Stacking](image-stacking.md).
    - Reference: [Calculator](calculator.md), [Astronomical Time Converter](astronomical-time-converter.md) (which also installs the Earth orientation and nutation of the whole server), [Orbital Mechanics Explorer](orbital-mechanics-explorer.md), and [SPICE Kernel Library](spice-kernel-library.md).
- Alpaca Server (planned: a catalog entry without a view, and no `api` service yet): an `api` service over `AlpacaServer` (`core/src/devices/alpaca/server.ts`), started and stopped explicitly, bound to localhost by default, publishing only an explicit allowlist of devices.
  Devices imported from Alpaca connections are never exported, to avoid publication loops.
  Its state is published as events.
  The Tools view only controls it.
