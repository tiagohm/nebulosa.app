# Jupiter Observing Planner

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Jupiter Observing Planner predicts, on request and read-only, the view of Jupiter and its Galilean satellites at an instant, their tracks over a period, and their phenomena: Great Red Spot transits, satellite and shadow transits, occultations and eclipses, and mutual events, with their visibility from the active site.
The server is `api/src/jupiter.ts` with `jupiter.astronomy.ts` and `jupiter.store.ts`, and the tool is `web/src/tools/jupiter/`, built on the planetary planner pieces of `web/src/tools/planetary/`.

## Purpose

Planetary observers need to know when the moons, their shadows, and the Great Red Spot cross the disk and whether they can watch it from the site; the planner shows the system as it will look and lists the watchable phenomena.

## Relations

- Hosted by the Tools workspace, with its own clock, never the Sky clock.
- Takes every state from one source of the fast [Ephemeris Chain](ephemeris-chain.md): the kernels of the [SPICE Kernel Library](spice-kernel-library.md) when they hold every Jovian body, else the theories, through the toolkit's Jovian satellite geometry and phenomena.
- Shares its source selection (`api/src/planetary.source.ts`) and its visibility (`api/src/planetary.visibility.ts`) with the [Saturn Observing Planner](saturn-observing-planner.md).
- Judges visibility on the nights of [Astro Weather](astro-weather.md) and the planetary windows of the [Observing Planner](observing-planner.md), from the active site (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)).
- Persists only the Great Red Spot model, one per server, entered by the operator, and publishes its changes (see [Persistence and State](persistence-and-state.md)).
- Opens the [SPICE Kernel Library](spice-kernel-library.md) (Manage Kernels) and the [Sky Map](sky-map.md) (Show in Sky, which sets the Sky clock to the tool's instant and selects Jupiter).

## Rules and Limitations

- Contacts are geocentric and never change with the site; the site only decides what can be watched.
- Horizons is never asked; a kernel computation that misses anything is rerun whole on the theories, so one answer never mixes sources.
- A kernel change during a scan restarts it; nothing partial is answered.
- Without a Great Red Spot model no transit is predicted; the model is never fetched or defaulted, and an old one is marked stale but still used.
- Mutual events carry no photometry, and tracks are for display only, never for contacts.
- Show in Sky is its one change of the Sky clock; nothing here moves the mount, changes a site or the profile, or starts an operation.
