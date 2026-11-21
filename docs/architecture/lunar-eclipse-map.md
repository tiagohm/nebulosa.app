# Lunar Eclipse Map

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Lunar Eclipse Map is a tool of the Planning group that steps through lunar eclipses, maps where each one is visible, and gives its circumstances for one place (`api/src/lunareclipses.ts`, `web/src/tools/lunareclipse/`).
A Local View draws the eclipse as seen from the place at any instant from the first to the last contact, and the global map follows it.

## Purpose

A lunar eclipse is seen from a whole hemisphere, but whether the Moon is up at each phase depends on the place.
The tool answers when the next eclipse is, whether the operator's site sees it, during which phases, and how high the Moon stands, so an observing night can be planned around it.

## Relations

- Uses the [Eclipse Ephemeris](eclipse-ephemeris.md) for the eclipse, its id, and the Sun, the Earth, and the Moon, and the eclipse computations of the toolkit (`core`).
- Draws on the [World Map](world-map.md); shares its location, time zone, map click, and legend components with the [Solar Eclipse Map](solar-eclipse-map.md) (`web/src/tools/eclipse/`).
- Observes from its own location: the active profile's observing site until another site, typed coordinates, or a map click is chosen, for the tool only (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)).
- Stateless, read-only queries: no operation, event, device, or persisted data; the tool's state lives in the tab.
- Hosted by the Tools workspace (see [Tools Integration](tools-integration.md)); a URL can name an eclipse, which opens the tool on it.

## Rules and Limitations

- An eclipse is named by the instant of its greatest eclipse, resolved again on every request with a tolerance, so a link still names its eclipse after the kernels change.
- It opens on the next eclipse after the real current time, never the Sky simulation clock.
- Visibility is the Moon's center above the geometric horizon without refraction, on the map and locally alike.
- Whole-eclipse visibility zones are not provided: the map shows visibility at one contact or at the instant drawn.
- Skipping eclipses not visible from the place searches a bounded number of eclipses, and never filters the eclipse shown.
