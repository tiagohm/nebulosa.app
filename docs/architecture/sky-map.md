# Sky Map Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- One tick drives the star map and the selection (`#followClock` of `web/src/sky/planetarium.ts`): every `SKY_REALTIME_TICK_MS` (15 s) while the clock follows the real time, frequently while playing, and once for a fixed instant.
  Each tick reads the instant once, shows it on the map, and refreshes the selection's position and events for that same instant (`refreshSkySelection` with the tick's time): accurately on every real-time tick, from the local models every few ticks while playing, and accurately once a fixed instant settles.
  The time bar's own redraws are display only.
  Once the clock is not playing, an instant more than `MAP_DATA_EPOCH_MS` (a Julian year) from the map data's reloads the catalogs (`mapDataCovers` of `web/src/sky/sky.ts`).
- Picking tolerates fingers: a touch or pen tap picks within a larger radius and stays a tap over a longer travel than a mouse click (`touchPickRadius` and `touchTapSlop` of `InteractionOptions` of `web/src/sky/celestial/`).
- On the local sky zoomed in to `SKY_ANCHOR_ZOOM` or more, a tick that changes the instant keeps the view on the same point of the sky (recentered after the update) instead of the same point of the horizon, unless the mount is followed;
  at lower zoom the horizon stays still.
- Selected objects the map data lacks are remembered for the tab (`RememberedObjects` of `web/src/sky/remembered.ts`, at most `REMEMBERED_LIMIT`, the least recently selected forgotten first, in memory only, kept when the map is replaced by the other kind of chart): minor bodies from SBDB as moving bodies drawn at every zoom whatever their magnitude (`alwaysVisible`), and catalog stars and deep-sky objects fainter than the map data as selectable shapes with their name.
  They stay drawn and can be selected again on the map.
  The selected one follows the Inspector's position of each tick; the other minor bodies are moved with local (`fast`) positions at every map update.
  Satellites are never remembered: the satellite layer draws them (see [Artificial Satellites Contract](artificial-satellites.md)).
- The projection of the map is fixed: the local sky is centred on the observer's zenith and the equatorial chart on its own hemisphere, and no feature ever moves the projection centre or reprojects the map around a coordinate.
  "Centre on" a coordinate (the mount, a coordinate or footprint sent from an image) only pans the screen view with `Planetarium.centerOn`/`Celestial.centerOnCoordinate`, keeping the zoom and orientation;
  a point the map cannot project (below the local horizon, or outside the hemisphere the equatorial chart projects) leaves the view unchanged and is said to be so.
- Handoffs from a solved image (`web/src/sky/footprint.ts`, `skyImageState`, tab memory): Open Coordinates in Sky (the image context menu, and the details of a marker) marks a position and pans to it;
  Show Footprint in Sky (Images → Plate Solver) draws the outline the selected solution gives to the image borders (sampled along each side, broken where the WCS cannot unproject) as a dashed shape of its own beside the framing, with a cross at its centre, and pans to that centre.
  Both keep their positions in the J2000 (ICRS or FK5 J2000) frame of the solution and are converted for the map with the toolkit's IAU 2006/2000A precession-nutation matrix at the instant the catalogs were computed for (`ofDateMatrix`, the conversion of `api/src/sky/catalog.ts`), so they line up with the stars drawn;
  the matrix is computed once per map data load, never per tick, and nothing is requested.
  A footprint is drawn only while its document still shows that image and is dropped otherwise (the document closed, or its camera tab shows another frame);
  the mark stays until replaced or cleared from the Sky toolbar, where a toggle also hides the footprint and shows it again in place, without moving the view (sending a footprint shows it).
  Neither changes the Sky selection, the clock, or the mount.
- Meteor shower radiants (`web/src/sky/meteors.sky.ts`, `MeteorRadiantLayer`, the `meteorRadiants` layer of the display, shown by default): the radiants of the showers active at the instant shown (`POST /api/meteor-showers/radiants`) and the selected shower's (`/states`, drawn even outside its activity and with the layer hidden), as selectable custom shapes (`meteorRadiant`) with their code.
  The server gives them geocentric J2000 and the map converts them with the precession-nutation matrix of its data (`ofDateMatrix`), as the stars, so they are precessed once.
  They are asked for again only when the instant shown moves more than an hour from the last request (about 0.05° of drift), the catalog revision or the layer changes, or another shower is selected, and a failure waits 10 s; nothing is fetched per tick or frame.
  A radiant is a direction, not an object (`SkyObjectRef` `meteorShower`): `/api/sky/position` refuses it (`422 unsupportedTarget`), the locator of the mounts never resolves it, the selection loads no position, and the Meteor Shower Inspector (`web/src/sky/meteor/`) reads its state at the Sky's instant every minute: activity and its source, the radiant J2000 and of date, and for the site its geometric altitude and azimuth, the Sun, and the Moon, with its next maximum.
  It offers Center on Radiant (a pan through `showCoordinateInSky`, without a mark) and Open in Meteor Showers, never Slew, framing, or a planner target.
  The selected shower's drift path over its nearest occurrence (`/path`) is drawn dashed in the same frame as the radiants, never joined across a gap, asked for once per shower and catalog and again only when the instant shown leaves the occurrence by more than a month; the radiant itself stays at the Sky's instant, and the Inspector names the dates the path covers.
  The search lists matching showers (at most 5, never removed records, the curated ones first) in a Meteor Showers section.
- Handoff to the Orbital Mechanics Explorer: Explore Orbit (`ObjectActions.tsx`, for a minor body) opens the tool on the body by its SPK-ID and name only (`exploreMinorBody`), never by a position, and changes nothing of the Sky (see [Orbital Mechanics Explorer Contract](orbital-mechanics-explorer.md)).
- Handoffs with the Observing Planner: Add to Observing Planner (`ObjectActions.tsx`, for a catalog object, a major body other than the Sun, or a minor body by its SPK-ID, `plannerTarget`) opens the tool with the target pending (`addToObservingPlanner`), where a dialog adds it to a plan chosen by the operator;
  Show in Sky of the planner (`showTargetInSky`) selects a catalog object, a body, or a minor body (located by the Sky's own ephemeris, never the planner's trajectory) through `selectSkyObject` without moving the view, and marks fixed coordinates through `skyImageState`, panning to them.
  Neither moves the Sky clock (positions are at the Sky's own time), the mount, the profile, or its site.
- The search reads Bayer and Flamsteed designations by the IAU abbreviation or the genitive of the constellation and the Greek letter by name, symbol, or abbreviation, with SIMBAD's own (`alf`, `tet`, `ksi`) too, so "Alpha Centauri", "alf Ori", and "58 Orionis" all resolve.
  Catalog stars stop at magnitude 8 (`bin/src/sky.catalog.ts`), which the empty result says.
- `POST /api/sky/position` returns the rise, transit, and set for an observer in both modes (they are computed locally and cached per hour), so the Visibility of the Object Inspector always shows the instant of its Position.
  Rise and set are the instants the airless altitude crosses the standard horizon: −34′ for a point, −50′ for the Sun, and −49.5′ for the Moon, its mean semidiameter below the horizon of a point, on its topocentric place.
  Transit is the crossing of the meridian, the hour angle going from negative to positive, not the highest point, with its altitude read from the same model.
  Horizontal altitudes hold the refraction of a standard atmosphere (ERFA from 5°, Sæmundsson below, fading out under the horizon).
- Every request of the process to JPL (Horizons, SBDB, CAD) goes through one `SsdRequestQueue` (`api/src/ssd.ts`), since its fair-use policy allows one request at a time: tasks run in order, the budget of each starts with it, the wait for a turn is limited to `SSD_QUEUE_WAIT_MS` (15 s), identical requests are shared, and the last caller to leave stops one.
  Requests name the client in a `User-Agent` with the version `app/src/main.ts` gives to `identifyJplClient` and the repository as contact.
  A 429 or 503 is never retried: it pauses the queue for its `Retry-After`, 30 s by default and 5 minutes at most, and the queue refuses tasks meanwhile; only SBDB and CAD answers can do so, since the Horizons adapter does not expose the status.
  An accurate position may therefore wait behind another JPL request, and a refusal of the queue falls back to the local model with `fallbackReason: 'timeout'` without counting against the Horizons circuit breaker.
- Accurate positions of the Sun, the Moon, the planets, Pluto, and minor bodies (`SkyEphemeris` of `api/src/sky/ephemeris.ts`, given the `spiceKernels` runtime) come first from the SPK kernels of the SPICE Kernel Library (`source: 'spk'`, with `kernels`: the generation and the ids of the kernels used) when the kernel set resolves the target by its NAIF code (the body code, never a system barycenter for its planet, or the SBDB SPK-ID), the Earth (399), and the Sun (10) at every epoch the calculation needs, light-time emission epochs included;
  a single miss abandons the whole kernel calculation, which is never completed with a local model.
  Otherwise the ephemeris policy of the library decides: `automatic` asks Horizons as before, `offline` uses the local models with `fallbackReason: 'offline'` and never calls Horizons, and `spkOnly` answers `503` with `coverageUnavailable` (the target) or `missingDependency` (the Earth, the Sun, or a center).
  Under `offline` and `spkOnly` a minor body is resolved from the SBDB answers already cached, never asking SBDB, and a minor body with neither kernels nor cached elements answers `503 offline` under `offline`.
  Fast positions stay on the local models whenever one exists, whatever the policy.
  Events use the kernels when they cover the whole ±12 h window, else the local models (none under `spkOnly`), and are cached per kernel generation and policy as well.
  A kernel that cannot be read answers `503` instead of a silent downgrade.
  Only the Sky positions, events, the locator of the mounts, and the minor-body trajectories of the Observing Planner (see [Observing Planner Contract](observing-planner.md)) consume the kernels;
  the Sun and Moon Inspectors, the eclipses, the converter, and the satellites keep their own models.
