# Planetary Events

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Planetary Events is a tool of the Planning group and a read-only almanac of the geocentric phenomena of Mercury to Neptune: conjunctions with the Sun and between planets, oppositions, quadratures, elongations, stations, appulses, closest approaches, greatest brightness, and dichotomies (`api/src/planetaryevents.ts`, `planetaryevents.astronomy.ts`, `planetaryevents.visibility.ts`, `web/src/tools/planetaryevents/`).
It finds the events over a range, says how each can be watched from a site, and draws display curves around one, as a timeline or a calendar.

## Purpose

The planets are best observed around their events: an opposition, an elongation, a close pair.
The tool tells the operator which events are coming, which ones can be seen from the observing site and when, and hands the planet to the Sky or the planner.

## Relations

- Uses the event definitions and visibility windows of the toolkit (`core`).
- Takes the Sun, the Earth, and the planets from the fast [Ephemeris Chain](ephemeris-chain.md) without Horizons, through the shared planetary source of `api/src/planetary.source.ts`: the kernels of the [SPICE Kernel Library](spice-kernel-library.md) when they resolve every body, else VSOP87E; the search follows the library's generation.
- Shares the fixed-orientation helpers and the planetary preset of the [Observing Planner](observing-planner.md), keeping its own Earth orientation providers.
- Observes from the active profile's observing site and shows the profile's display zone (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)).
- Hands off to the Sky (showing the planet, optionally setting the Sky clock to the best window or the event) and to the Observing Planner (adding the planet as a target); its CSV export shares `web/src/download.ts` with the [Orbital Mechanics Explorer](orbital-mechanics-explorer.md).
- Stores nothing, publishes no event, starts no operation, and holds no device; its state lives in the tab.
- Hosted by the Tools workspace (see [Tools Integration](tools-integration.md)).

## Rules and Limitations

- Directions are geocentric apparent, on the true ecliptic and equinox of date; every event keeps its geocentric UTC instant, which a site or a zone never changes.
- One computation never mixes sources: a miss reruns it whole from VSOP87E.
- A planet comes from its system barycentre when the kernels lack its centre, an exception to the rule of the [Jupiter Observing Planner](jupiter-observing-planner.md) and the [Saturn Observing Planner](saturn-observing-planner.md) that this almanac alone may take, since it needs no moon.
- A conjunction and an appulse of the same pair are two events, never merged, and the appulse threshold never filters a conjunction.
- Visibility is geometric, with no terrain, horizon mask, or weather; a solar conjunction is never recommended, and without a site no event is dropped.
- It opens on real now, never on the Sky clock, and searches at most 24 months.
- Pluto, the Moon, satellites, minor bodies, occultations, transits, groupings of three or more planets, and heliocentric apsides are not covered.
- The display precision is minutes; the kernels and VSOP87E differ by seconds to minutes.
