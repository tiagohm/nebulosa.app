# Observing Sites and Time Zones

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

An observing site is a named place: geodetic latitude and longitude, height above the ellipsoid, and its IANA civil time zone.
The sites are one catalog per server (`api`, edited in Settings → Observing Sites, `web/src/settings/ObservingSitesSettings.tsx`), and each profile observes from an active site chosen in the top bar's site menu.
`web/src/location/` derives the observer, the tool locations, and the zone a time is shown in, storing nothing.

## Purpose

Every computation that depends on a place needs one, and every civil time needs a zone.
This mechanism gives them one source and one rule, so every screen of a profile observes from the same place and reads times the same way.

## Relations

- Persisted in the database, with the active site in the profile and the display zone in its settings (see [Persistence and State](persistence-and-state.md)).
- The site editor sets coordinates with the [World Map](world-map.md).
- The [Sky Map](sky-map.md), the [Sun Inspector](sun-inspector.md), the [Moon Inspector](moon-inspector.md), the [Observing Planner](observing-planner.md), the [Jupiter](jupiter-observing-planner.md) and [Saturn](saturn-observing-planner.md) Observing Planners, [Planetary Events](planetary-events.md), [Meteor Showers](meteor-showers.md), [Astro Weather](astro-weather.md), [Close Approaches](close-approaches.md), and [iPolar](ipolar.md) observe from the active site.
- The [Solar Eclipse Map](solar-eclipse-map.md), the [Lunar Eclipse Map](lunar-eclipse-map.md), and the [Astronomical Time Converter](astronomical-time-converter.md) may choose a place and zone of their own, kept in tab memory.
- The mount reports its own site, which equals a saved site only once Send Active Site to Mount wrote it.

## Rules and Limitations

- No active site is a valid state, and then nothing assumes a place.
- The catalog is shared by every profile, tab, and browser; names and coordinates may repeat.
- Selecting, editing, or deleting a site changes the workspace only: no device is commanded, and a running operation keeps the place it started with.
- A zone is always an IANA identifier chosen by a person; the map sets coordinates, never the zone.
- A tool's own place and zone are never written to the profile or a site.
- Instants are UTC; a zone only formats them, and a local day or night is always named in the zone of the place observed.
- A wall time typed in a zone may name two instants or none, and the Sky time bar and the Astronomical Time Converter say which they took or refuse a skipped one.
