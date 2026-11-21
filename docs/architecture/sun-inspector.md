# Sun Inspector

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Sun Inspector is the Object Inspector of the Sun in the Sky workspace (`web/src/sky/sun/`).
It shows the Sun's position and visibility, the solar almanac of the local day (sunrise, sunset, daylight, twilights, and the astronomical night), the next seasons, the next solar eclipse, physical data, and the latest solar image and active regions.
The almanac is a stateless computation of `api/src/sky/sun.ts`; the observations come from `api/src/sky/sdo.ts` and `api/src/sky/activeregions.ts`.

## Purpose

It tells the operator when the day ends and the night begins at the site, and gives solar observers a current view of the Sun's activity, without leaving the Sky.

## Relations

- A view of the [Sky Map](sky-map.md), whose instant drives the position and the almanac; it has no navigation entry of its own.
- Computes the almanac from the toolkit through the fast [Ephemeris Chain](ephemeris-chain.md): the kernels of the [SPICE Kernel Library](spice-kernel-library.md) when they cover the day, else the theories.
- Reads the latest NASA SDO image and the latest NOAA SWPC active region report, through the shared remote cache of `api/src/remote.ts`.
- Reads the next solar eclipse and its local circumstances from the [Eclipse Ephemeris](eclipse-ephemeris.md) and opens the [Solar Eclipse Map](solar-eclipse-map.md) on it.
- Names the local day in the active site's zone and shows times in the profile's display zone (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)).
- Its almanac convention is the one [Astro Weather](astro-weather.md) uses for its nights.
- Slew to Object is the generic action of the Sky, a mount slew like any other.

## Rules and Limitations

- Three times are kept apart: the position and almanac follow the Sky's instant, the day is the site's civil date of that instant, and the image and report are the latest real observations whatever the clock shows.
- The almanac uses the geometric, geocentric altitude of the Sun's center, so its sunrise and sunset differ by seconds from the rise and set of the Sky's positions.
- A failing observation source shows its last good value marked stale, and never affects the other source or the almanac.
- Nothing refuses pointing the mount at the Sun.
