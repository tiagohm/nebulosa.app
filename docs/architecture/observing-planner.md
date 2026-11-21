# Observing Planner

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Observing Planner finds and analyzes targets over a night of the active site and keeps the night plans the operator writes.
Targets are catalog objects, the Moon and planets, fixed coordinates, minor bodies by SPK-ID, and meteor shower observations.
For each it gives the windows that meet the constraints of a mode (deep sky, visual, planetary), the reasons when there are none, and a relative score; a plan is an ordered list of items whose schedule it diagnoses.
The server is `api/src/observingplanner.ts` and its siblings (astronomy, minor bodies, schedule, store), and the tool is `web/src/tools/observingplanner/`.

## Purpose

It answers what is worth observing tonight from the site, when, and for how long, and lets the operator draft the night as a plan to read and adjust.

## Relations

- Hosted by the Tools workspace.
- Observes from the active site and shows the profile's display zone; a plan keeps a copy of its site (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)).
- Computes catalog objects, bodies, and coordinates locally from the embedded sky catalog, the toolkit's visibility search and observation score, and the fast [Ephemeris Chain](ephemeris-chain.md) (the kernels of the [SPICE Kernel Library](spice-kernel-library.md) when they cover the night, else the theories).
- Takes its nights from [Astro Weather](astro-weather.md), in process.
- Resolves minor bodies on demand from the kernels or their SBDB orbital elements, asking SBDB and Horizons through the shared JPL queue of the [Sky Map](sky-map.md) only while online.
- Has meteor shower observations analyzed by [Meteor Showers](meteor-showers.md).
- Shares its night geometry with [Planetary Events](planetary-events.md) and the [Jupiter](jupiter-observing-planner.md) and [Saturn](saturn-observing-planner.md) Observing Planners.
- Judges how targets fit a framing of [Framing](framing.md), the Equipment Setup's by default.
- Receives targets from the [Sky Map](sky-map.md) (Add to Observing Planner) and shows them there (Show in Sky).
- Persists the plans and the orbital elements of the minor bodies they name in the database and publishes every plan change (see [Persistence and State](persistence-and-state.md)); everything derived stays in memory.

## Rules and Limitations

- Plans are documents, not runnable sequences: nothing here moves a device, changes the Sky clock, the profile, or a site, or starts an operation.
- Altitudes are geometric: no refraction, horizon mask, or terrain is applied.
- The score is a relative ranking heuristic, never a predicted signal-to-noise ratio, and never makes an unobservable target eligible; the presets are heuristics, not equipment limits.
- A target the catalog or SBDB no longer knows stays unresolved, never replaced by another object or stored coordinates, and a moving body is never treated as fixed.
- A minor body takes one source for the whole night; the two-body orbit of its elements ignores the planets, so no accuracy is promised for it.
- Saved elements let a plan be analyzed offline and after a restart; nothing refreshes them by itself.
- The schedule is only diagnosed: nothing moves, shortens, drops, or reorders an item, priority included, and conflicts may be saved.
- Discovery ranks the catalog in batches, so it is never a global ranking until every batch is read.
