# Artificial Satellites

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Artificial Satellites is a local catalog of Earth satellites with their element sets, the SGP4 predictions made from them, and a tool of the Planning group over both (`api/src/satellites.store.ts`, `satellites.elements.ts`, `satellites.sync.ts`, `satellites.auto.ts`, `satellites.ephemeris.ts`, `web/src/tools/artificialsatellites/`).
The tool lists tonight's visible passes, searches passes, draws ground tracks, and samples ephemerides; the Sky draws satellites as moving bodies and inspects them.

## Purpose

Satellites cross the sky of every night, and the operator wants to know which ones can be seen from the site, when, and where.
The feature keeps the elements locally, predicts from them with the toolkit without asking the network, and says how much each prediction can be trusted.

## Relations

- Stores objects, element sets, group memberships, and the state of each source in the operational database (see [Persistence and State](persistence-and-state.md)); search is always local.
- Downloads GP elements and SATCAT data from CelesTrak, following its usage policy, only when the operator asks or for the groups the operator turned on for automatic downloads, which an in-process schedule runs.
- Imports OMM or TLE element sets the operator provides; every set is validated by the toolkit and identified by its digest.
- Predicts with the toolkit's (`core`) SGP4, frames, and satellite eclipses; the Sun of each prediction comes from the fast [Ephemeris Chain](ephemeris-chain.md) (kernels of the [SPICE Kernel Library](spice-kernel-library.md), else VSOP87E).
- Reads the night of [Astro Weather](astro-weather.md) for Tonight, and draws ground tracks on the [World Map](world-map.md).
- Is a kind of object of the [Sky Map](sky-map.md): searched, located, drawn on its own display layer, and inspected there; the Inspector opens the tool, and the tool hands off to the Sky, setting the Sky clock only on an explicit View in Sky.
- Favorites are a profile preference, shared with the Sky's satellite favorites.
- Predicts for the active profile's observing site and shows its display zone; the tool has no place or zone of its own and keeps its state in the tab.
- Publishes a change event on every new catalog revision, which the web mirrors in `SERVER_STORES`.
- Commands no device and starts no operation; hosted by the Tools workspace (see [Tools Integration](tools-integration.md)).

## Rules and Limitations

- An object is identified by its NORAD catalog number as a decimal string of any length; a group is a membership of its source, never a category, and an object without elements is never predicted.
- The element set used is the one the operator chose, else GP, else imported, and every prediction names it.
- Downloads never happen because a view opens, a selection changes, or time is animated; their intervals and blocks survive restarts, so CelesTrak is never asked too often.
- Every prediction carries a conservative quality from the age of its elements; passes are refused when it is unavailable.
- Positions are geometric, without light time or annual aberration; satellites have no rise, transit, or set, and no brightness is estimated.
- No mount is ever sent to a satellite.
- Not provided: SupGP, the Sky display of a whole group, brightness and flares, conjunction screening, trails over images, solar and lunar transits, and mount tracking.
