# Saturn Observing Planner

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Saturn Observing Planner predicts, on request and read-only, the geometry of Saturn's disk and rings at an instant and over years, the view of the rings and seven major moons, the moons' tracks and greatest separations, and their phenomena (transits, shadow transits, occultations, eclipses, and mutual events) with their visibility from the active site.
The server is `api/src/saturn.ts` with `saturn.astronomy.ts` and `saturn.events.ts`, and the tool is `web/src/tools/saturn/`, built on the planetary planner pieces of `web/src/tools/planetary/`.

## Purpose

It shows how the rings open and close and when the moons can be seen crossing the disk or each other, so the operator can plan Saturn sessions and ring-plane events.

## Relations

- Hosted by the Tools workspace, with its own clock, never the Sky clock.
- Takes its states from the fast [Ephemeris Chain](ephemeris-chain.md): the kernels of the [SPICE Kernel Library](spice-kernel-library.md) when they hold every body of the scope, else the theories, through the toolkit's Saturn ring and satellite geometry and phenomena; the rings and the moons choose their source apart.
- Shares its source selection and visibility with the [Jupiter Observing Planner](jupiter-observing-planner.md), and judges visibility on the nights of [Astro Weather](astro-weather.md) from the active site (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)).
- Reads everything again when the kernel generation changes.
- Opens the [SPICE Kernel Library](spice-kernel-library.md) (Manage Kernels) and the [Sky Map](sky-map.md) (Show in Sky, which sets the Sky clock to the tool's instant and selects Saturn).
- Stores nothing and publishes no event.

## Rules and Limitations

- Contacts are geocentric and never change with the site; a drawing never joins two sources.
- Hyperion is not planned.
- Ring occultations, ring shadows, the rings' optical depth, and photometry are not modeled: a phenomenon the rings may hide is flagged as uncertain, never claimed as a ring occultation.
- A kernel change during a scan restarts it; nothing partial is answered.
- Show in Sky is its one change of the Sky clock; nothing here moves the mount, changes a site or the profile, or starts an operation.
