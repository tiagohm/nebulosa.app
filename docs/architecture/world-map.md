# World Map

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The World Map is a shared component of `web` (`web/src/ui/WorldMap.tsx`) that draws the bundled basemap `web/assets/world.map.svg` with zoom and pan, reports clicks as geographic positions, and draws its owner's layers over it.
`web/src/ui/worldmap.geometry.ts` builds those layers (paths, the region where a body is above or below the horizon, spherical caps, ground tracks), and the basemap is rasterized into tiles by a worker (`web/src/ui/worldmap.tiles.ts`, `worldmap.worker.ts`).

## Purpose

Several features need to pick a place on the Earth or show where something happens on it; the World Map gives them one map with the same projection, gestures, and geometry.

## Relations

- Used by the observing site editor (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)), the [Solar Eclipse Map](solar-eclipse-map.md), the [Lunar Eclipse Map](lunar-eclipse-map.md), and the ground track of [Artificial Satellites](artificial-satellites.md).
- Draws the toolkit's eclipse paths, which the API gives on a degree plane scaled to the map's units.
- Asks no API and stores nothing.

## Rules and Limitations

- The owner keeps the selection and moves the view; the map only reports clicks on the map, never drags or clicks off it.
- Geographic positions are degrees, longitude east positive.
- The map wraps across the antimeridian by default, drawing every layer in each copy, so a region on a wrapping map is cut at the antimeridian.
- The tiles need OffscreenCanvas 2D in workers.
- Owners should memoize their layers, since the map renders them again whenever its own props change.
