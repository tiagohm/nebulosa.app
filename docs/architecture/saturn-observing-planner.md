# Saturn Observing Planner Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- The Saturn Observing Planner (`api/src/saturn.ts` with `saturn.astronomy.ts` and `saturn.events.ts`) predicts, on request and read-only, the geometry of Saturn's disk and rings at an instant (`POST /rings/state`) and over a range (`POST /rings/timeline`), the view of the rings and seven major moons at an instant (`POST /moons/state`), the moons' sampled tracks (`POST /moons/track`), their greatest separations (`POST /moons/elongations`), and their phenomena with their visibility from a site (`POST /moons/events`), and reports the kernel readiness of each scope (`POST /source`).
  It stores nothing, publishes no event, and never changes a device, a site, an operation, or the Sky clock.
- Scopes and source: a computation of the `rings` scope evaluates only the Sun, the Earth, and Saturn's centre (NAIF 699, never the barycenter 6);
  a computation of the `moons` scope also evaluates Mimas, Enceladus, Tethys, Dione, Rhea, Titan, and Iapetus (601-606, 608; Hyperion is not planned).
  Each takes all its states from one source chosen once with the shared `withSatelliteSource` of `api/src/planetary.source.ts`: the SPICE kernels when the set has every body of the scope, else VSOP87E (+ TASS 1.7 for the moons), with the same fallback reasons, full reruns after a `SaturnianEphemerisMiss`, and `503` codes as the Jupiter planner.
  A scope that `spkOnly` refuses leaves the other one answering: `sat480.bsp` alone gives the rings from the kernels while the moons answer `503 missingDependency`.
  `/moons/state` carries the ring geometry from the same source as its moons, so a drawing never joins two sources; `/rings/state` serves when the moons cannot be computed.
- Kernel lifetime: timelines run in yearly chunks, tracks in 250-sample chunks, separations in 30-day chunks, events in day chunks, each yielding to the event loop and restarting when the kernel generation changed, at most twice, then `503 generationChanged`;
  an aborted request is not answered and caches nothing.
- Signature (`SaturnSignature`) of every answer: the model version (`SATURN_MODEL_VERSION`, 1), the ring model version (`SATURN_RING_MODEL`, 1), the scope, the source (an analytical rings source names VSOP87E alone), the policy, and the kernel generation.
  Caches: timelines (8), tracks (16), separations (16), and events (16), keyed by the kind, the model versions, the range, the requested moons and kinds, the site's coordinates and zone for events, the policy, and the generation;
  states and readiness are not cached.
- Geometry (see the toolkit's Saturn Ring Geometry and Saturnian Satellite Geometry): geocentric observed instants;
  signed Earth and solar openings B and B′ (planetocentric, north positive), the pole position angle on the true equator of date, and the apparent disk and outer A-ring axes in radians;
  the moons' sky offsets and depths in Saturn equatorial radii, their separations, position angles, and signed clearances from the oblate limb and the outer A-ring edge in radians, a geometric `ringOverlap` (`front` or `behind`, never an occultation claim), disk and eclipse states, and the shadow centre on the globe.
  Answers that draw the planet carry the ring model (`SaturnRingModel`: the NSSDC C, B, and A rings and the Cassini Division in km, and Saturn's IAU 1-bar radii).
- Ring timeline: at most 2000 samples of B and B′ a whole number of minutes apart over the range, and the events with their instant in the range found by root and extremum search on a ring-only interpolator of the source (`interpolatedSaturnianRingEphemeris`): `earthPlaneCrossing`, `solarPlaneCrossing`, `openingMaximum`, `openingMinimum`, and `nearPlaneApproach`.
  The chart never infers an event from its samples.
  The solar crossing is when the sunlight reaching the rings is edge-on, about 80 minutes before JPL Horizons' sub-solar zero.
- Tracks and separations: tracks sample the seven moons at most 2000 times a whole number of minutes apart on the true equator of the middle of the range, with the pole position angle there;
  separations are the true local maxima of the separation of each requested moon (not east-west elongations), and a slow moon may have none in a short range.
- Readiness (`/source`): each scope is probed every 6 hours, or at most 2000 evenly spaced epochs over a long range, and reported as `ready`, `partialCoverage`, `unsupported`, or `missingDependencies`, with the source a computation would use;
  advisory, not a guarantee for a scan.
- Events (`POST /moons/events`, see the toolkit's Saturnian Satellite Phenomena and Mutual Planetary-Satellite Events): the transits, shadow transits, occultations, and eclipses of the seven moons on Saturn's oblate disk and their mutual occultations and eclipses, scanned over the range padded by 12 hours (a central Iapetus eclipse lasts about 10.5 hours) in day chunks with one moons source, kept when they overlap the range, and filtered by `kinds` and `moons` (a mutual event when either moon is selected).
  Each has a stable id (`kind|moons|maximum in seconds`), the reached contacts, its range flags, `grazing`, `depth` or `impactParameter`, the ids of the selected events it overlaps, and `ringInterference`: a participating moon is behind the projected rings, or a shadow falls on the disk under the near rings, at one of seven instants sampled across the event.
  Contacts are geocentric and never change with the site.
- Visibility (`SaturnEventVisibility`): with a `site`, the shared `api/src/planetary.visibility.ts` intersects the physically visible part of each event (a shadow transit while its centre faces the Earth, an eclipse while the moon is not behind the disk, a mutual event while neither moon is behind the disk or in the umbra, using every scanned event) with Saturn's planetary windows on the site's Astro Weather nights (Saturn at least 25° high, the Sun at most −6°, from its local VSOP87E position), and gives `observable`, `partial`, or `notObservable` with `sunTooHigh`, `saturnTooLow`, `moonHidden`, or `shadowHidden`, the windows, the peak altitude and airmass, and a rank;
  an event with ring interference that could be watched becomes `uncertainRingInterference` with `ringInterferencePossible`, never an exact ring occultation.
  Without a site the status is `unknownNoSite` and the physical reasons remain; no event is dropped for its visibility, and no detectability or magnitude is predicted.
- Limits: the routes trust their requests (the tool asks for tracks of at most 14 days, separations of at most a year, and ring timelines of at most a Saturnian year).
  Ring occultations, ring shadows, the rings' optical depth, and photometry are not modeled; the first visibility of a site computes each of its nights synchronously through the shared Astro Weather night.
