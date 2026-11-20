# Lunar Eclipse Map Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Lunar Eclipse Map tool of the Planning group and its routes.

- Lunar eclipses (`api/src/lunareclipses.ts`): stateless, read-only queries, never operations or events.
  The id, the degree plane, and the location parameters are the eclipse conventions of `api/src/eclipses.ts` (see [Eclipse Ephemeris Contract](eclipse-ephemeris.md)).
  An eclipse is named by its id, the Unix milliseconds of its greatest eclipse, resolved again on every request, so nothing is stored per client:
  an id names the eclipse whose greatest eclipse is within 60 s of it (`ID_MATCH_TOLERANCE`), so an id taken while another source was in force still names its eclipse, answered with its id on the current source, and an id that names no eclipse is `404 notFound`.
  Stepping right after the kernels change, from an id of the previous source, may return the eclipse it names once more, with its new id.
  `GET /api/eclipses/lunar` steps to the next or previous eclipse from an instant, strictly, so stepping from an id never returns the same eclipse;
  with a place, it skips eclipses whose Moon stays below its horizon, trying 24 eclipses at most (`MAX_VISIBLE_SCAN`, `404 notFound` beyond) and letting the event loop run between them.
  `/:id/map` answers the contact times, sublunar points, and per-contact moonrise/moonset lines and above-horizon regions as SVG path data on a degree plane (x = longitude + 180, y = 90 − latitude);
  `/:id/local` answers the circumstances of a place (visibility over the whole eclipse, contact altitudes, azimuths, P and Z angles, magnitudes, durations), the stretches between P1 and P4 with the Moon up (`windows`, each flagged by whether it starts at a moonrise or ends at a moonset rather than at a contact, found with the toolkit's `searchIntervals` over `moonAltitudeAt` at a 10-minute step, so a grazing stretch shorter than that may be missed though visibility counts it), and the Local View's shapes with the Moon's altitude, azimuth, and side of the horizon at the instant drawn;
  at a fraction of the eclipse it also answers the global map at that instant (`view.map`: moonrise/moonset line, Moon-up region, and sublunar point, from the toolkit's `computeLunarEclipseMapInstant`, drawn like the contacts).
  Times are Unix milliseconds (UTC, converted from the toolkit's TT), angles degrees, durations seconds; contacts an eclipse lacks are absent.
  Visibility is the Moon's center at or above the geometric 0° horizon without refraction, on the map and locally alike.
  Whole-eclipse visibility zones on the map are not provided: the map shows visibility at one contact or at the instant the Local View draws.
- Lunar Eclipse Map (`web/src/tools/lunareclipse/`): its state is a tab-lived valtio proxy (`lunarEclipseState`), never persisted, so leaving and reopening the tool keeps the eclipse, the place, and the presentation.
  It opens on the next eclipse after the real current time, never the Sky simulation clock, unless its URL names an eclipse, and observes from its own `ToolLocation`: the active profile's observing site until another saved site, coordinates typed in, or a click on the map is chosen, for the tool only, never the profile;
  a click gives coordinates at 0 m in the zone of the coordinates before, or UTC after a site.
  Only a new longitude or latitude asks for the local circumstances again; a click asks only for them; choosing a contact or a Local View presentation asks only for them again, and zooming or panning asks for nothing.
  Stale answers are discarded through request guards.
  While a new place's circumstances load, the previous place's stay in the panel, faded (`isStaleLocal`, `LocalContent`), so its sections, its scroll, and the Local View's zoom hold; they are dropped if the new request fails.
  The Local View pans and zooms like the Jupiter and Saturn viewers (`EclipseLocalViewSurface` over `PanZoomSurface`: a drag pans, a pinch or the wheel with Ctrl or ⌘ zooms, and buttons zoom in and out, show the Sun, or the Moon at the contact drawn, close up, and show the whole diagram), with strokes that keep their width; the zoom is transient React state, kept across contacts and places and reset only when another eclipse is shown.
  Under the Local View a slider draws it anywhere from C1 to C4 (P1 to P4 on the lunar map) with the time drawn beside it: `/:id/local` takes in `event` a contact or a fraction of the local eclipse in [0, 1] (0 and 1 being the outer contacts themselves) and answers the instant drawn (`view.time`), from the toolkit's `computeLocalSolarEclipseInstant` and `computeLocalLunarEclipseInstant`; the fraction (`viewFraction`, tab memory) is kept for another place or eclipse, and choosing a contact returns to it.
  Times show the date and the zone's name, in the zone `resolveDisplayZone` gives for the tool's `DisplayZoneOverride` (tab memory) and its location, whose change asks for nothing.
  On the lunar map the Local View's slider moves the map with it: between the contacts the map draws the region where the Moon is up, the moonrise/moonset line, and the sublunar point at the instant drawn (`view.map`), and the toolbar's contact picker reads Between contacts; choosing a contact returns both to it.
  Each moonrise/moonset line is named by its contact where it crosses the equator, names of close contacts stacked; each eclipse shown is framed on the map (`moonUpBounds`: the hemisphere where the Moon is up at greatest eclipse, widened to the place), Frame the eclipse frames it again, and a place chosen off screen is brought into view, as on the solar map.
  Visibility leads with what the place sees (`visibilityHeadline`, which tells a penumbral eclipse seen in part as such), then the moonrise or moonset during the eclipse with the phase it falls in (`phaseAt`), how long the Moon is up, and the Moon's altitude and azimuth at MAX; a penumbral eclipse adds how faint it is.
  The Local View gives the Moon's altitude and azimuth at the instant drawn with its side of the horizon in words, and its horizon is drawn in the map's horizon hue.
  The location and zone sections (`EclipseLocationSection`, `EclipseZoneSelect`), the map click (`mapLocation`), the time formatting, the room kept around a framed eclipse (`framePadding`), and the map's heading and legend are shared by the eclipse tools in `web/src/tools/eclipse/`;
  below the sm breakpoint the heading puts the eclipse type and date on two lines, and at every width the legend starts collapsed to a button, its hide button taking clicks even where the legend lets them through to the map; the lunar map keeps the legend open or closed across eclipses (`legendOpen`, tab memory).
  The toggle "Skip eclipses not visible here" makes Previous and Next skip eclipses the place does not see; it never filters the eclipse shown.
  A URL that names an eclipse (`/tools/lunar-eclipse-map/<eclipse id>`, the id of `/api/eclipses/lunar`) shows that eclipse with its map (`showLunarEclipse`), with the same rules as the [Solar Eclipse Map](solar-eclipse-map.md)'s link.
