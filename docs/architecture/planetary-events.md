# Planetary Events Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Planetary Events (`api/src/planetaryevents.ts` with `planetaryevents.astronomy.ts` and `planetaryevents.visibility.ts`) is a read-only almanac of the geocentric phenomena of Mercury to Neptune.
  It finds the phenomena over a range (`POST /search`), says how each one can be watched from a site (`POST /visibility`), and samples display curves around one (`POST /series`).
  It stores nothing, publishes no event, starts no operation, reserves no device, and never changes a device, a site, a profile, or the Sky clock.
  Horizons is never asked and nothing is downloaded, offline or not: its source is the fast [Ephemeris Chain](ephemeris-chain.md) without Horizons.
  Pluto, the Moon, satellites, minor bodies, occultations, solar transits, groupings of three or more planets, and heliocentric apsides are not covered.
- Definitions (the toolkit's Planetary Longitude Events, Appulses, Greatest Elongations, Stations, Closest Approaches, Illumination Crossings, and Brightness Maxima):
    - `solarConjunction` (Mercury–Neptune): the planet's apparent true ecliptic longitude of date equals the Sun's. It is `inferior` when the planet is nearer than the Sun, `superior` otherwise; an outer planet is always superior. The separation at the instant is reported, never assumed zero.
    - `opposition` and `quadrature` (Mars–Neptune): the longitudes differ by π, or by +π/2 (`east`, evening) or −π/2 (`west`, morning).
    - `greatestElongation` (Mercury, Venus): a maximum of the apparent separation from the Sun, `east` or `west` by the signed longitude difference.
    - `station`: a root of the apparent longitude rate, a centred difference of ±0.5 day, `directToRetrograde` or `retrogradeToDirect`.
    - `planetaryConjunction` (every pair of selected planets): equal apparent longitudes, with the separation at the instant and the planet north of the other (`northBody`).
    - `planetaryAppulse`: a local minimum of the apparent separation of a pair, kept when it is at most `appulseThreshold` (radians; the tool's default is 5°).
      The threshold never filters a conjunction.
      A conjunction and an appulse of the same pair are two events, never merged, and are linked by `relatedIds`.
    - `closestEarthApproach`: a minimum of the geometric Earth–planet centre distance, not the opposition, which can be days away.
    - `greatestBrightness` (Venus): a minimum of the Mallama and Hilton (2018) magnitude on its crescent branch, phase angles 90° to 163.7°.
      The model's faint minima around inferior conjunction (beyond 163.7°) and its shallow ones near superior conjunction (about −3.9) are not greatest brilliancies.
    - `halfIllumination` (Mercury, Venus): the illuminated fraction crosses 0.5 (the dichotomy), `increasing` or `decreasing`. It is not the greatest elongation.
- Conventions (`PlanetaryEventsConvention`, in every signature):
    - Directions are geocentric apparent: three light-time iterations, the Sun's deflection, and the Earth's aberration.
    - Longitudes and latitudes are on the true ecliptic and equinox of date.
    - Distances, illuminated fractions, and magnitudes are geometric at the instant.
    - Every event keeps its geocentric UTC instant; a site or a time zone never changes it.
    - Each event carries the `circumstances` of its planets at the instant: longitude, latitude, solar elongation, Earth distance, illuminated fraction, and magnitude, which is absent where the model is undefined.
    - Its `id` is `kind|bodies|subtype|instant in seconds`, with a pair's bodies in the order Mercury to Neptune, so A–B and B–A are one event.
    - `relatedIds` lists the events of other kinds with the same bodies within 15 days.
- Source: every computation takes the Sun, the Earth, and the selected planets from one source, chosen once through the shared `withSatelliteSource` of `api/src/planetary.source.ts`.
  That source is the SPICE kernels when the set resolves each of them, else VSOP87E.
  A planet comes from its centre (199–899) when the set has it, else from its system barycentre (1–8), which every planetary kernel such as `de440s` holds.
  The signature's `origins` names which one, per planet.
  The barycentre offset is at most about 300 km (Saturn, Titan): under 0.1″ seen from the Earth, about a second at an opposition and tens of seconds for a slow pair, far below VSOP87E's own error.
  This exception to the never-barycentre rule of the [Jupiter Observing Planner](jupiter-observing-planner.md) and the [Saturn Observing Planner](saturn-observing-planner.md) belongs to this almanac alone, which needs no moon.
  A miss anywhere reruns the whole computation from VSOP87E (`fallbackReason`, `miss`).
  The kernel set is read again after each yield, and a changed generation restarts the computation at most twice, then answers `503 generationChanged`; an aborted request is not answered.
  The positions are interpolated (six-point Lagrange on one- or two-day TDB nodes, `interpolatedSatelliteEphemeris`), whose nodes reach about six days beyond a scan, so a scan that close to the end of a kernel's coverage falls back.
  The Earth orientation is interpolated linearly between half-day IAU 2006/2000A nodes (under 0.001″), and TDB − TT comes from the USNO Circular 179 series.
- Scan: `/search` covers `[start, end)` in 30-day chunks, each scanned three days beyond both edges and keeping the events whose instant falls in it, so none is reported twice or lost at an edge.
  The coarse step is one day and the refinement 1e-6 day; two events of one kind and pair closer than about two days could merge.
  Answers are kept in an `LruCache` (8), keyed by the model version (`PLANETARY_EVENTS_MODEL_VERSION`, 1), the range, the sorted bodies and kinds, the threshold, the offline switch, and the generation, and stored under the snapshot actually used.
- Visibility (`/visibility`, `PlanetaryEventVisibility`): a batch of events, a `PlanningSite`, and the threshold, answered per event id.
  Each event is cached in an `LruCache` (1024) by its id, the site's coordinates, and the threshold; the zone only formats, and an aborted batch caches nothing.
  Positions are geometric and interpolated, from one source of the fast [Ephemeris Chain](ephemeris-chain.md) for the events of a batch not cached (`withVisibilitySource`: the SPICE kernels when they resolve the Sun, the Earth, and every planet of them, else VSOP87E; a miss reruns the batch from VSOP87E), and the cache key holds the kernel generation; they only decide when an event can be watched.
    - Span: each event gets one span around its instant, ±3.5 days, or ±2.5 for a pair.
      It holds the precession-nutation matrix and the sidereal time of its middle fixed (`fixedOrientationProviders` and `SiteOffset` of `observingplanner.astronomy.ts`, shared with `PlanningNight`), under 2″ of altitude error.
      The toolkit's `visibilityWindows` finds every 10 minutes, then refines, where each planet is high enough and the Sun low enough; a pair needs both planets at once.
    - Profiles: `night` (the Observing Planner's planetary preset: every planet at least 25°, the Sun at most −6°) for Mars–Neptune, and `twilight` (at least 5°, the Sun at most −6°) whenever Mercury or Venus takes part.
    - Status: `observable` at the instant, `nearby` in a window of at least 15 minutes, `notObservable`, or `notSuitable` for a solar conjunction (`solarGlare`), which is never recommended.
      The web uses `unknownNoSite` without a site and never drops an event for it.
    - Reasons: `sunTooHigh`, `planetTooLow` (with `lowBodies`), `noWindow`, and `separationTooWide`, when a pair's windows fall while it is wider than the threshold.
    - `atEvent` gives each planet's altitude and azimuth and the Sun's altitude at the instant.
    - `bestWindow` is the window holding the instant, else the one the fewest whole days away, then the longest, then the highest lowest peak.
      It gives its `period` (`evening` or `morning`), each planet's peak altitude, a pair's separation at its middle, and its `offsetMs` from the instant.
      Altitudes are geometric (airless), and no terrain, horizon mask, or weather is applied.
      A batch yields to the event loop every 10 events.
- Series (`/series`, `PlanetaryEventSeries`): 241 samples around one event from the same source chain, for display only; the event's instant is the solved one and never a sample.
    - The span is ±10 days for a pair, ±30 to ±60 days otherwise.
    - The curves are elongation, a pair's separation and longitude difference, a station's longitude (unwrapped about the event), Earth distance, magnitude (null where undefined), or illuminated fraction.
    - Cached in an `LruCache` (32) by the event, the offline switch, and the generation.
- Planetary Events tool (`web/src/tools/planetaryevents/`, `/tools/planetary-events`, icon `planetAlignment`):
    - State: the tab state is `planetaryEventsState` (`planetaryevents.ts`), tab memory. It observes from the active site and shows the profile's display zone, and holds the range (a start and 1, 3, 6, 12, or 24 months), the planets and kinds searched, the appulse threshold in degrees (5 by default, 0.1 to 15), the Timeline or Calendar view (a `SegmentedControl` beside the title), the calendar month, the visibility filter, and the selected event.
    - Layout: the content fits the width of the workspace (container queries, `@container/events`): from 64 rem the list or month and the inspector stand side by side, each filling the height and scrolling itself; below it they stack, the list capped at 60 % of the viewport height, and choosing an event scrolls the inspector into view when its top is out of sight.
      Above them, the visibility filter (All, Observable, Not observable) sits beside the count of the events listed ("56 of 90 events"), with the source, the zone, and the range on the line below.
    - Range: it opens on real now for twelve months, never on the Sky clock.
      Use Sky Time copies the Sky's instant into the start without moving the Sky clock, and a start date is the first instant of that civil date in the display zone.
    - Requests: each answer has its own request guard.
      The search follows the range, the planets, the kinds, the threshold, and the SPICE Kernel Library's generation (`spiceKernelsState`).
      With a site, each answer is followed by one batch `/visibility` request for every event, cancelled when the answer or the place changes and never sent again for a change of zone.
      Without a site every event reads `unknownNoSite`, the filter is disabled with its reason as its tooltip, and every event is listed, so none is dropped because no site is set.
      An empty answer says which kinds searched none of the planets searched can have (an opposition of Mercury, a conjunction of a single planet) and offers Select All Planets and Kinds; a filter that keeps nothing offers Show All Events.
      The selected event's curves (`/series`) follow it and the kernels.
    - `PlanetaryEventsTimeline` lists the events by their UTC instant, each row with the civil date of the display zone (muted after the first of its day), the time, the event named planets first ("Mars · Quadrature (west)"), its visibility badge, and its primary value.
      It fits the width of the list (`@container/list`): below 32 rem the date sits above the time and the badge under the name, and the primary value shows only from 48 rem.
      The visibility tones are calm: observable at the event in the success tone, nearby neutral, not observable muted, a solar conjunction in the warning tone; none uses the pulsing active tone of running work, and each badge's tooltip says what its status means (nearby: a window of at least 15 minutes within 3.5 days, 2.5 for a pair).
    - `PlanetaryEventsCalendar` lays out a Monday-first month of the display zone's dates from the same answer, navigable within the range.
      From 48 rem of the list each day lists its events kind first ("Opposition · Mars"), those that cannot be watched from the site muted; below it a day is one button with a dot per event (filled when observable, hollow when not), and the events of the day chosen are listed under the grid with their visibility in words.
      Today is outlined and named, and the arrow keys, Home, and End move between the buttons of the grid.
    - `PlanetaryEventDetails` answers first: the event's name, its visibility badge, one line saying how it can be watched (the best window with its timing and peak altitudes, or the first reason it cannot be), the instant in the display zone, the primary value, and the handoffs.
      Then the definition of the kind (a conjunction is never named an appulse), the visibility from the site in full (the criteria, the planets and the Sun at the instant, the best window and when it falls against the event, a pair's separation, and the remaining reasons), `PlanetaryEventChart`, each planet's circumstances in a collapsed disclosure, and the related events; the source is named once, on the badge above the list and in the Ephemeris section.
      The chart is a hand-drawn SVG of the curves against days from the event, drawn at the width of its frame so its labels keep the caption size, with the event marked at its solved instant, the y axis naming its unit when every curve shares one, and magnitudes upward toward brighter.
    - Handoffs act on one planet, chosen by a `SegmentedControl` for a pair: Show in Sky at Best Window, offered when the site has a best window, sets the Sky clock to the middle of that window and shows the planet; Show in Sky at Event Time sets it to the event's instant before showing it; these are the only changes to the Sky clock. Show in Sky selects the planet through the Observing Planner's handoff at the Sky's own time; Add to Observing Planner offers the planet as an independent target, never a night or a schedule.
    - Export CSV, disabled with its reason while nothing is listed, writes the listed events (RFC 4180, CRLF) with UTC ISO instants, angles in degrees, empty missing values, the site's visibility, the source, and the model version.
      A text field starting with `=`, `+`, `-`, or `@` is prefixed with an apostrophe.
      The download helper and the CSV quoting are `web/src/download.ts`, shared with the Orbital Mechanics Explorer.
    - Nothing here moves the mount, changes a site or the profile, or starts an operation.
- Limits: the routes trust their requests, and the tool asks for ranges of at most 24 months.
  On a desktop a 12-month search of every planet takes about 1.5 s and its visibility from a site about 2.5 s, computed once per range and site; both yield between chunks and batches.
  The display precision is minutes, and the refinement tolerance is no accuracy claim: VSOP87E and the kernels differ by seconds to minutes depending on the event's rate.
