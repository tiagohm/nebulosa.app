# Moon Inspector

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Moon Inspector is the Object Inspector of the Moon in the Sky workspace (`web/src/sky/moon/`).
It shows the Moon's appearance (phase, illumination, libration, orientation) as a drawing, its position and visibility, the next principal phases, perigee and apogee, the next lunar eclipse, and physical data.
Its larger view, the Lunar Surface Explorer, names the IAU lunar surface features on the drawing.
The lunar almanac is a stateless computation of `api/src/sky/moon.ts`.

## Purpose

It lets the operator see the Moon as it appears from the site at the Sky's instant, plan around its phases and distance, and identify features on its surface.

## Relations

- A view of the [Sky Map](sky-map.md), whose instant and observer drive it; it has no navigation entry of its own.
- Computes the almanac from the toolkit through the fast [Ephemeris Chain](ephemeris-chain.md): the kernels of the [SPICE Kernel Library](spice-kernel-library.md) when they cover a month on either side of the instant, else the theories.
- Reads the next lunar eclipse and its local visibility from the [Eclipse Ephemeris](eclipse-ephemeris.md) and opens the [Lunar Eclipse Map](lunar-eclipse-map.md) on it.
- Observes from the active site, topocentric with a site and geocentric without one (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)).
- Offers Open in [Framing](framing.md) and the Sky's mount slew.
- Draws the NASA SVS CGI Moon Kit color maps and the USGS Gazetteer of Planetary Nomenclature feature catalog, bundled in `web/assets/moon/` by `bun make:moon` (`bin/src/moon.assets.ts`, catalog schema in `api/src/sky/moon.features.ts`).

## Rules and Limitations

- Its values come from the fast chain and may differ slightly from the Horizons-sourced position of the Sky selection.
- The drawing is illustrative, not photometric, and the color maps are made for appearance, not science.
- Features are center points, never outlines or measured extents, and no elevation is shown.
- The explorer's zoom, filter, search, and selection are presentation state; none changes the observer or the instant.
- The assets change only by running `bun make:moon` again, never at run time; without the feature catalog only the names are missing.
