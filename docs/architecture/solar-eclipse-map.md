# Solar Eclipse Map

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Solar Eclipse Map is a tool of the Planning group that steps through solar eclipses, maps their central path, limits, and sunrise and sunset curves, and gives their local circumstances for one place (`api/src/solareclipses.ts`, `api/src/solareclipses.map.ts`, `web/src/tools/solareclipse/`).
It is built like the [Lunar Eclipse Map](lunar-eclipse-map.md), with a Local View of the eclipse from the place.

## Purpose

A solar eclipse is seen only from a narrow strip of the Earth, and its type, magnitude, and duration change from place to place.
The tool answers where an eclipse is total, annular, or partial, what the operator's site sees, and when its contacts happen, so an observation or a trip can be planned.

## Relations

- Uses the [Eclipse Ephemeris](eclipse-ephemeris.md) for the eclipse, its id, and the Sun, the Earth, and the Moon, and the eclipse computations of the toolkit (`core`).
- Computes the global map on a worker of its own (`api/src/solareclipses.worker.ts`, embedded by `app/build.ts`) from the Besselian elements the API found, so the worker reads no ephemeris or kernel; local circumstances are computed in the API process on the same ephemeris.
- Draws on the [World Map](world-map.md) and shares its location, time zone, and legend components with the Lunar Eclipse Map (`web/src/tools/eclipse/`).
- Observes from its own location, for the tool only (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)).
- Stateless, read-only queries: no operation, event, device, or persisted data; the tool's state lives in the tab.
- Hosted by the Tools workspace (see [Tools Integration](tools-integration.md)); a URL can name an eclipse, which opens the tool on it, and an unknown one offers the next eclipse instead.

## Rules and Limitations

- The global map depends on neither a contact nor a place, so only the local circumstances change with them.
- Locally, visible means the Sun's center above the 0° horizon, without the site's elevation, terrain, or the lunar limb profile; the map's limits use the toolkit's horizon refraction, as the NASA maps do.
- Global points (the ends of the central path among them) are never the contacts of a place.
- The magnitude is a fraction of the solar diameter, never an obscured area.
- Obscuration zones and an animation of the shadow are not provided.
