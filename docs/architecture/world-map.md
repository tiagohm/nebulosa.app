# World Map Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `WorldMap` (`web/src/ui/WorldMap.tsx`) draws the basemap `web/assets/world.map.svg` (equirectangular, 2520.631 × 1260.315 map units, longitude −180° at x = 0 and latitude +90° at y = 0) with zoom (wheel, pinch, double click, `+`/`-`, buttons, from the whole map up to `MAX_WORLD_MAP_ZOOM` = 64×) and pan (drag, arrows), and reports a click, never a drag or a pinch, as a geographic position through `onSelect`;
  the owner keeps the selection and passes it back as `selected`, drawn as a marker.
  Geographic positions are degrees, longitude east positive.
  The owner moves the view through the `WorldMapHandle` ref (`centerOn`, `zoomBy`, `reset`).
- The map wraps across the antimeridian by default: the basemap and the children are drawn again one map width west and east, panning east or west never ends, and the smallest zoom fits the map's width.
  The graticule then draws the antimeridian once, at x = 0, as the seam between copies.
  With `wrap={false}` the whole map fits, the view is clamped to it, and the antimeridian is only its border.
- Children are SVG in map units, drawn over the basemap and the graticule: `geoPath` (unwrapped across ±180° by default, or split for a map that does not wrap) and `horizonRegionPath` (where a body is above or below the horizon, from its subpoint: the night side, the visibility of a lunar eclipse), and `smallCircleRegionPath` (a spherical cap around a point, such as a satellite's footprint, closed along the map's edge when it holds a pole) in `web/src/ui/worldmap.geometry.ts` build their path data;
  `splitAtAntimeridian` cuts a line of several turns around the globe (a ground track) into pieces that meet at ±180°, so none is unwrapped over several map widths, and `WorldMapSymbol` places symbols of constant screen size.
  Toolkit eclipse paths fit when projected into the same map units; the API draws them on the degree plane (x = longitude + 180, y = 90 − latitude, in degrees), which `DEGREE_PLANE_TRANSFORM` scales to map units.
  Strokes use `vectorEffect="non-scaling-stroke"`.
- Zoom and pan never re-render React: the view is written to the layers once per animation frame.
  The basemap is a tile pyramid on a `<canvas>` (`web/src/ui/worldmap.tiles.ts`, which documents its levels and sizes), rasterized from the SVG's shapes by a worker (`web/src/ui/worldmap.worker.ts`, started from a Blob of self-contained functions, so it needs OffscreenCanvas 2D in workers), so a frame only draws bitmaps already made and never waits for the thousands of country paths.
  A missing tile is drawn from the matching part of the nearest coarser cached tile and fades in when it arrives; the coarsest levels are fetched first and never evicted, so the map is never blank.
  Borders keep the SVG's width up to a cap (`MAX_BORDER_PIXELS` of the worker); the children are on an SVG layer with the same zoom and pan, which also sets `--world-map-scale` (viewport pixels per map unit).
  Children should be memoized by their owner, since the map renders them again whenever its own props change.
