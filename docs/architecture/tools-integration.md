# Tools Integration Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Navigation: Tools → catalog card → `/tools/<id>` (`TOOL_DEFINITIONS` of `web/src/tools/tools.ts`), rendered by the tool's `view` inside its own `WorkspaceLayout`.
  A tool without a view (the Alpaca Server) is planned and its URL is replaced by the catalog's.
  The [Astro Weather](astro-weather.md), [Calibration Library](calibration-library.md), [Image Stacking](image-stacking.md), and [Mount Pointing Model](mount-pointing-model.md) tools follow their own contracts.
- Calculator (`web/src/tools/calculator/`): task-oriented calculators chosen in one menu grouped by category (`catalog.ts`), each composing pure formulas of `nebulosa/src/astronomy/formulas` behind one form, never one entry per formula and no expression engine.
  The five categories are Optics & Field of View (Imaging Setup: field, diagonal, image scale, effective focal length and ratio through `resolveFraming`, so it matches Sky Framing's 2·atan convention, with no image scale for a sensor given by its physical size; Mosaic Estimator: rectangular panel count per axis with overlap, not an optimized layout), Sampling & Focus (Sampling: FWHM in pixels from the seeing or the seeing from a measured FWHM, the 2–3 px rule-of-thumb class, and the focal length for a target FWHM; Diffraction & Focus: Airy disk and critical focus zone, wavelength in nanometers), Exposure & Integration (Exposure Planner: total integration from a frame count or whole frames for a target time, with the idealized √N and 1.25·log₁₀N stacking gains; Star Trailing: sidereal drift of an untracked star and the longest exposure within a trail budget, none at a celestial pole), Visual Observation (Eyepiece & Telescope: magnification, exit pupil, true field from the apparent field or the field stop, Dawes and Rayleigh limits, limiting magnitude; Aperture Comparison: clear light grasp and the collecting area left by central obstructions, never presented as resolution), and Atmosphere & Conditions (Airmass & Visibility Effects: Kasten–Young airmass, extinction for a coefficient, Sæmundsson refraction; Dew Conditions: Magnus dew point with the heuristic ambient-margin risk, humidity from a dew point, or frost point from a humidity relative to ice).
  Each calculator shows its formula, units, domain, and approximations; mode switches fix the direction of a calculation so fields never depend on each other circularly.
  Camera & Signal and Guiding & Tracking calculators are not provided yet.
  Everything runs in the browser: no route, event, operation, or device is involved.
  Fields keep their text as typed and are parsed only at the calculation boundary (`values.ts`), so an empty or out-of-domain field shows what to enter or why it cannot be used instead of a previous result, and no result shows NaN or Infinity.
  Each calculator keeps a draft in React state while the tool is open; drafts start from labeled examples and are never persisted, and a change of active profile starts over.
  An optical configuration can be imported by value (`sources.ts`) from the Main or Guide Camera (the telescope or guide telescope with the sensor that camera reports, never another camera's), from the Sky Framing manual sensor (refused when none is entered), or from an optical preset;
  the draft is then edited on its own, live changes never rewrite it, its origin is shown only while the same camera is followed, and the profile, presets, and devices are never written.
- Astronomical Time Converter (`api/src/astronomicaltime.ts`, `astronomicaltime.eop.ts`, `web/src/tools/astronomicaltime/`): stateless, read-only conversions of one instant, never operations or events, with the toolkit as the only source of astronomy: no value crosses one floating-point Julian date, and the browser computes nothing but the text of its fields.
  `POST /api/astronomical-time/convert` reads an instant (`now`, a `calendar` in a timescale, a numeric offset, or an IANA zone, `jd` or `mjd` as decimal text in a named scale, `unix`, or a Julian or Besselian epoch in TT) and answers the UTC and local calendars, Unix milliseconds, each of the seven scales as calendar, JD, and MJD text, GMST and GAST, LMST and LAST with an observer, the differences between scales, the epochs, the day of the year, the signed hour angle LAST − RA of an apparent right ascension of date (J2000 is not accepted: LAST is referred to the true equinox of date), and `quality`.
  Angles are radians.
  ISO 8601 is a form of the tool that it sends as a calendar with an offset, and the tool checks the fields and the supported years (−4712 to 9999), so the server takes them as valid.
  The only errors are readings that name no single instant: `422 ambiguousLocalTime` with `{ earlier, later }` for a reading the clocks repeat, which the tool resolves with Earlier or Later (`fold`), and `422 nonexistentTime` for one they skip or a `:60` on a day without a leap second.
  An inserted leap second keeps its calendar and has no `unixMillis`, which POSIX cannot represent; on such a day JD(UTC) is the ERFA quasi-JD of a stretched day.
  Calendars are proleptic Gregorian with astronomical year numbering.
  Before 1960 UTC did not exist, so TAI−UTC is taken as 0 (`leapSeconds: beforeUtc`), and after the server's now no further leap second is assumed (`assumed`).
- Earth orientation (`EarthOrientationData`): the IERS tables of the whole server.
  `app/src/main.ts` calls `startEarthOrientation` before it serves, which reads them from `iers/` of the data directory (`DEFAULT_IERS_DIRECTORY`, under `NEBULOSA_HOME`) and installs them as the default providers of the toolkit (`installEarthOrientation`), so the Sky, the mounts, the pointing models, and the converter read one UT1 and one polar motion, and a refresh reaches them all.
  `iersab`, the shared table of the toolkit, stays empty, since its lookups clamp to the edge of a table, and a process that never starts them, such as a test, keeps UT1 = UTC and no polar motion.
  Of the workers only the fit worker needs them, and it reads the same cache, read only and once per worker, when the server thread has them (`earthOrientation` of its request): the hour angles of a fit then match those of the corrections.
  Solar eclipse maps use the toolkit's ΔT model and do not change with UT1, and streak classification does not read it.
  Saved pointing models are not refitted: UT1 only moves the hour angle of their basis, so terms of 1000″ move a correction by less than 0.1″ at the largest DUT1.
  Starting the server and any conversion finding the tables older than 7 days start one background download of finals2000A (IERS, then its USNO mirror) and EOP C04, at most once an hour, with no timer and no request waiting on it;
  a download replaces a table only if the new one reaches today (IERS A) or 120 days ago (IERS B).
  An instant no table holds takes DUT1 = 0 rather than the toolkit's clamped edge, leaves `dut1` and `ttMinusUt1` out, and says so in `quality.eop` (`covered`, `outsideTable`, or `notLoaded`), and the tool states UT1 and sidereal times as approximate.
  No observed or predicted label is given, since the tables do not keep it per row.
- Astronomical Time Converter tool: its state is a tab-lived valtio proxy (`astronomicalTimeState`), never persisted.
  Now converts the real current time every second while the page is visible, one request at a time, and never the Sky simulation clock;
  Custom sends an entry 250 ms after the last edit, superseding the request before it, and an entry the tool cannot read or a refused one leaves no result, so an old value never stands for new inputs.
  Changing form rewrites the entry for the instant shown.
  The location is a tab-memory `ToolLocation` (typed coordinates carry their elevation too) and the time zone the one `resolveDisplayZone` gives for the tool's `DisplayZoneOverride` and that location (see [Observing Sites and Time Zones Contract](observing-sites-and-time-zones.md)), always sent as an IANA name, since the server reads calendar entries and the local civil time in it.
  An Earlier or Later choice holds only for the zone it was made in.
  Use Sky Time copies the Sky's instant once and Set Sky Time sends the instant shown to `skyClock`, disabled inside a leap second; neither changes a device, the profile, or the status bar.
  Use Sky Selection copies the apparent right ascension of date of the selection, computed for its own instant, which the tool shows.
  Each copied value names its scale and is independent of the locale.
- Eclipse maps: computed in `api` from `core/src/astronomy/events/eclipse/*`, which produce geographic geometry and SVG paths, drawn on `WorldMap` (see [World Map Contract](world-map.md)).
  No map library is added.
- Eclipse ephemeris (`api/src/eclipses.ts`): the toolkit's series find an eclipse and `refineSolarEclipse` and `refineLunarEclipse` fix it, so the id, the type, and the times of a response are those of the refined eclipse.
  Every computation of one eclipse uses the same Sun and Moon (`eclipseSunMoon`: `eraMoon98` corrected with three ELPMPP02 evaluations), so its contacts, maps, and local circumstances agree.
  Stepping compares refined instants, never the series' ones (`findRefinedEclipse`), and the lunar series also hands the refinement candidates slightly below magnitude 0 (`SERIES_PENUMBRAL_MARGIN` of `api/src/lunareclipses.ts`), which finds the faintest penumbral eclipses.
  Measured against the NASA catalogs for 2001–2100: solar greatest eclipse within 26 s and gamma within 0.0001; lunar greatest eclipse within 3 s, magnitude within 0.0003, and types all equal.
  The solar residual is not explained, and NASA's series differs from ELPMPP02.
  Local solar contacts are within 5 s of a DE421 oracle, with the smooth limb and NASA's k2 = 0.272281.
- Lunar eclipses (`api/src/lunareclipses.ts`): stateless, read-only queries, never operations or events.
  The id, the degree plane, and the location parameters are the eclipse conventions of `api/src/eclipses.ts`.
  An eclipse is named by its id, the Unix milliseconds of its greatest eclipse, resolved again on every request (an id that names no eclipse is `404 notFound`), so nothing is stored per client.
  `GET /api/eclipses/lunar` steps to the next or previous eclipse from an instant, strictly, so stepping from an id never returns the same eclipse;
  with a place, it skips eclipses whose Moon stays below its horizon, trying 24 eclipses at most (`MAX_VISIBLE_SCAN`, `404 notFound` beyond) and letting the event loop run between them.
  `/:id/map` answers the contact times, sublunar points, and per-contact moonrise/moonset lines and above-horizon regions as SVG path data on a degree plane (x = longitude + 180, y = 90 − latitude);
  `/:id/local` answers the circumstances of a place (visibility over the whole eclipse, contact altitudes, azimuths, P and Z angles, magnitudes, durations) and the Local View's shapes.
  Times are Unix milliseconds (UTC, converted from the toolkit's TT), angles degrees, durations seconds; contacts an eclipse lacks are absent.
  Visibility is the Moon's center at or above the geometric 0° horizon without refraction, on the map and locally alike.
  Whole-eclipse visibility zones on the map are not provided: the map shows visibility at one contact.
- Solar eclipses (`api/src/solareclipses.ts`, `solareclipses.map.ts`): stateless, read-only queries with the lunar conventions of `api/src/eclipses.ts` (id, strict stepping, `404 notFound`), never operations or events.
  `GET /api/eclipses/solar` steps to the next or previous eclipse;
  with a place, it skips eclipses whose Sun stays below its horizon during the local eclipse, trying 48 eclipses at most (`404 notFound` beyond) and letting the event loop run between them.
  `/:id/map` answers the named global points (P1–P4, U1–U4, C1/C2 the ends of the central line, MAX, N1/N2/S1/S2) with their times and the Sun's geometric altitude there, the greatest eclipse and greatest duration, and SVG path data on the degree plane for the total and annular parts of the central line (split where a hybrid eclipse changes), the northern and southern limits of the central and partial eclipse, and the sunrise/sunset curves;
  separate branches stay separate subpaths.
  A map costs hundreds of milliseconds, so it is computed on a worker of its own (`api/src/solareclipses.worker.ts`, embedded by `app/build.ts`), one at a time, with concurrent requests for one id sharing a job, a 30 s timeout (`500 computationFailed`), and the latest 8 maps cached.
  `/:id/local` answers the circumstances of a place computed in the API process with the same ephemeris as the map's Besselian elements: visibility (kind, central phase, Sun rising or setting, completeness of the contacts), C1, C2, MAX, C3, C4 with the Sun's altitude, P and Z, and magnitude, the maximum magnitude, Moon/Sun diameter ratio, partial and central durations, the width of the path here (`pathWidthKm`, the limits across the central line over the passage, as the catalogs publish it, for a place in the central path), the central shadow's chord through the place (`shadowPathWidthKm`, the narrowest width of its footprint at the local maximum, which can be several times smaller at a low Sun), and the Local View's shapes.
  Units are the lunar ones, widths in kilometers; values an eclipse or a place lacks are absent.
  Locally, visible means the Sun's center at or above the 0° horizon, without the site's elevation, terrain, or the lunar limb profile; the map's limits use the toolkit's empirical horizon refraction, matching the NASA maps.
  Obscuration zones and animation of the shadow are not provided.
- Lunar Eclipse Map (`web/src/tools/lunareclipse/`): its state is a tab-lived valtio proxy (`lunarEclipseState`), never persisted, so leaving and reopening the tool keeps the eclipse, the place, and the presentation.
  It opens on the next eclipse after the real current time, never the Sky simulation clock, unless its URL names an eclipse, and observes from its own `ToolLocation`: the active profile's observing site until another saved site, coordinates typed in, or a click on the map is chosen, for the tool only, never the profile;
  a click gives coordinates at 0 m in the zone of the coordinates before, or UTC after a site.
  Only a new longitude or latitude asks for the local circumstances again; a click asks only for them; choosing a contact or a Local View presentation asks only for them again, and zooming or panning asks for nothing.
  Stale answers are discarded through request guards.
  Times show the date and the zone's name, in the zone `resolveDisplayZone` gives for the tool's `DisplayZoneOverride` (tab memory) and its location, whose change asks for nothing.
  The location and zone sections (`EclipseLocationSection`, `EclipseZoneSelect`), the map click (`mapLocation`), the time formatting, and the map's heading and legend are shared by the eclipse tools in `web/src/tools/eclipse/`;
  below the sm breakpoint the heading puts the eclipse type and date on two lines and the legend starts collapsed to a button.
  A URL that names an eclipse (`/tools/lunar-eclipse-map/<eclipse id>`, the id of `/api/eclipses/lunar`) shows that eclipse with its map (`showLunarEclipse`), with the same rules as the Solar Eclipse Map's link.
- Solar Eclipse Map (`web/src/tools/solareclipse/`): built like the Lunar Eclipse Map, with a tab-lived valtio proxy (`solarEclipseState`), the shared place and time zone rules, and request guards.
  Its global map does not depend on a contact or a place, so a click or a contact asks only for the local circumstances again, and showing or hiding a layer (central line, central limits, partial limits, sunrise/sunset curves, points, point names; all shown at first) asks for nothing.
  The central line is solid where total and dashed where annular, so a hybrid eclipse reads without color.
  Every global point is drawn with its name (a layer of its own), with a marker shape per family, and the names of points that nearly coincide are stacked.
  A global point is chosen in the panel's Global Points list, since a click on the map chooses the place;
  the map then rings it and centers on it, and the panel tells what it is, where and when, the Sun's altitude, and for the greatest eclipse and duration the Sun's azimuth, the central phase, its duration, and the path width, and can make it the place.
  The Local Circumstances show the path width at the greatest eclipse, the path width here, and the shadow chord here under their own names.
  Global points are named apart from the local contacts: C1 and C2 on the map are the ends of the central path, never the contacts of a place.
  Contacts, durations, and the shadow chord a place lacks are left out, and the magnitude is a fraction of the solar diameter, never an obscured area.
  A URL that names an eclipse (`/tools/solar-eclipse-map/<eclipse id>`, the id of `/api/eclipses/solar`) shows that eclipse with its map (`showEclipse`, under the same request guard as the searches), whatever the tab showed before, on a link, a reload, back, or forward;
  an id that names no eclipse shows the error, never another eclipse.
  Stepping to another eclipse from such a URL replaces it with the new id, so the URL never names an eclipse other than the one shown; without an id the tool keeps its own choice.
- Close approaches (`api/src/closeapproaches.ts`): stateless, read-only queries of JPL, never operations or events, through the queue of the Sky Map Contract.
  The toolkit builds the requests and reads the tables (`closeApproachesUrl`, `parseCloseApproaches`); no list is computed or kept locally, so without JPL there is none.
  A row is an encounter, not an object: `GET /api/close-approaches` answers a page of CAD with its `total`, which CAD filters, sorts, and pages itself, and the same object appears once per encounter.
  `neoOnly` false lifts the NEO filter CAD applies by default; it does not select what is not a NEO.
  Observed behavior CAD does not document or documents otherwise: dates filter in TDB, a bare `date-max` means 00:00 (so the last day is sent as `T23:59:59`), `limit-from` is an offset (omitted on the first page), and `dist-max` also applies to one object, whose history is asked with 100 au.
  The NEO filter is refused for one object, so it is not sent.
  A page past the end has no rows and keeps its `total`.
  The time of a row is converted from the published Julian date TDB, whose text is kept with the TDB calendar date, through the toolkit's timescales, with the leap seconds of the Astronomical Time Converter.
  Distances are AU, with the 3σ bounds of CAD, the time uncertainty is the 3σ text of CAD, and the diameter uncertainty 1σ;
  a value CAD does not publish is absent, and no diameter is estimated from H. `GET /api/close-approaches/objects?designation=` resolves a row to its body by exact designation (SBDB `des`), since a row has no SPK-ID, and answers `found` with `MinorBody` and `MinorBodyDetails` (the published text of the orbit, physical parameters, discovery, radar, satellites, alternate orbits, and virtual impactors, without SBDB's embedded close approaches), `ambiguous`, or `notFound`, all with status 200.
  It shares the cache of `MinorBodies`, fresh for an hour here while the Sky keeps a body as long as it stays cached.
  `GET /api/close-approaches/objects/:spkId/approaches` pages the encounters of one body with CAD's `spk` selector.
  Pages stay cached for 5 minutes (64 pages, successes only) and `refresh=true` reads one again.
  The tool checks the filters, so the routes take them as valid;
  `400` from CAD is `502 rejected`, another major format `502 upstreamSchemaChanged`, an unreadable table `502 invalidResponse`, a 429, a 503, or a paused queue `503 rateLimited` with `retryAfter` in milliseconds, and any other failure `503 serviceUnavailable`.
  Virtual impactors are Sentry's as published through SBDB, an empty list says only that SBDB lists none, and nothing here computes or infers an impact probability.
- Close Approaches tool (`web/src/tools/closeapproaches/`): its state is a tab-lived valtio proxy (`closeApproachesState`), so leaving and reopening the tool keeps the search, the page, and the selection, and the first opening of a tab searches the next 30 days for the target and largest distance of the last search that ran (the profile's `closeApproaches` preferences, Earth within 10 LD by default; see [Persistence and State](persistence-and-state.md)), without the NEO filter, so comets are not left out.
  The filters hold pending values until Search, as every screen does, and the tool checks them, the 366-day budget of a search included, so a longer time is explored in steps;
  Refresh reads the page shown from JPL again and keeps its rows until the answer.
  Sorting and paging ask the server, from page 1 when the order changes, and rows are never sorted or sliced in the browser.
  The list, the object, and its history are independent requests, each behind a request guard, so an old answer never replaces a newer one, and no request ever repeats by itself: a failure shows why with Retry.
  A new search forgets the selection; another page keeps it, and another encounter of the same object reads nothing again.
  A failure of the object leaves the encounter usable.
  The dates of the filters are labeled TDB, the times of the rows are in the zone `resolveDisplayZone` gives for the tool's `DisplayZoneOverride` (`TimeZoneSelect`, the profile's default unless chosen) and the active site, always named in the header and, with why it applies, in the inspector, and the TDB of an encounter stays in its row title and in the inspector.
  The zone of the times and the distance unit (LD, AU, or km) are chosen above the table and kept in the same preferences; the unit never mixes within a value and its range; LD is the 384,400 km of JPL, a mean scale.
  On wide screens the inspector is the contextual panel; below `lg` it takes the place of the table, with Back to Results, since the shell keeps the state of its drawer to itself.
  Its sections are collapsible (`closeapproaches.*`), each shown only with something to show: Overview, Close Approach, Orbit, Physical Properties, Observations & Discovery, Virtual Impactors, and Other Approaches, paged by JPL by SPK-ID over a span and a target of its own.
  An unknown value is left out, and every term easily read as a risk (NEO, PHA, MOID, the 3σ range) says what it means; nothing is shown as a hazard.
  Open in Sky selects the body through `selectSkyObject` and leaves the clock alone; View in Sky at Approach Time first sets `skyClock` to the UTC instant of the encounter, since the selection reads it.
  Explore Orbit opens the Orbital Mechanics Explorer on the body by its SPK-ID and name only (`exploreMinorBody`, see [Orbital Mechanics Explorer Contract](orbital-mechanics-explorer.md)).
  Neither changes the observer or any device.
  Observability is read only while its section is open, through `POST /api/sky/position` with no endpoint of its own, at the encounter by default, the real current time, or the instant the Sky shows, and for the active profile's observing site, read again only when its place changes (`locationKey`), without which it is geocentric and offers Set Location.
  It states its source and fallback reason.
  Rise, transit, and set come from the local two-body orbit and the Horizons table is interpolated every 10 minutes, so during a very close flyby they lose accuracy, which the section says.
- Artificial Satellites tool (`web/src/tools/artificialsatellites/`, `/tools/artificial-satellites[/<noradId>]`): a tab-lived valtio proxy (`artificialSatellitesState`), never persisted, with the views Catalog, Passes, Ephemeris, and Ground Track, chosen by a select in the header beside the title, over the routes of the Artificial Satellites Contract;
  it commands no device.
  The details of the satellite selected are the contextual panel, a drawer on narrow screens that choosing a satellite never opens.
  Catalog searches the server's catalog only (text, group, favorites of the profile by id) and pages by 50.
  The workspace actions hold Import Elements, a popover that imports OMM or TLE text (kept in the tab's state when it closes), and Settings, a modal listing the CelesTrak groups with their state, an Automatic checkbox (the server's choice, shared by every profile), and a Download or Refresh that the server refuses inside its interval with its reason (a disabled button says until when).
  Every prediction is for the observing site of the active profile, with its elevation, and times are shown in the profile's display zone; the tool has no place or zone of its own.
  Without a site positions are geocentric and passes cannot be asked for, and Set Location opens Settings → Observing Sites.
  The Position Now of the panel is read again every `POSITION_REFRESH_MS` (15 s, the Sky's real-time tick) while a satellite with elements is selected and the page is shown, with RA and Dec formatted as the Sky does (`web/src/sky/format.ts`), as are those of the ephemeris table.
  Passes ask a window of 1 to 7 days from now or from the Sky's time, a minimum altitude, and a twilight limit, list each pass with its start (or "in progress"), highest point, end (or "continues"), duration, range, and conditions (visible, daylight, or the shadow), and draw the one selected as altitude against time through its three known points, its visible parts hatched and labeled.
  Ephemeris samples up to 72 hours (at most 5 000 rows, checked before sending) and exports the rows received as CSV with the units in the header, each time in UTC and in the display zone, whose IANA name is a column of its own (`time_civil`, `time_zone`).
  Ground Track (`SatelliteGroundTrack.tsx`, `groundtrack.ts`) draws on `WorldMap` (see [World Map Contract](world-map.md)) the subpoint from one orbit before an instant (now or the Sky's time) to 1 to 5 orbits after it, dashed before the instant shown and solid after it, fainter in the penumbra and fainter still in the umbra, with the satellite, its footprint (a spherical Earth with an ideal horizon), the night side, and the observing site with whether it sees the satellite above its horizon;
  the footprint, night, observer, and shadow are layers of the legend, and hiding one asks for nothing.
  Points between samples are interpolated on great circles, never predicted again.
  It is read when the view shows a satellite with elements; a ground track of now follows the real time on the 15 s tick and is read again once the satellite has gone an orbit past its instant, while one of the Sky's time stays put.
  A cursor chooses another instant of the window (Live returns to the real time), with its subpoint, height, illumination, and quality, and Show in Sky sets `skyClock` to it and selects the satellite there.
  It needs no observer, so another observer keeps it.
  Each kind of answer has a request guard, another satellite or another place of the site (`locationKey`, never its name or zone) drops the predictions of the previous one at once (`followSatelliteObserver`), and a change of the catalog (`satellites:changed`) reads the search, details, position, and a ground track shown again.
  Favorites, the element set used, and Open in Sky (with View in Sky at the Highest Point moving `skyClock` first) are explicit actions.
- Mount Remote Control (`api/src/mountremotecontrol.ts`, `web/src/tools/mountremotecontrol/`): exposes the MOUNT of the active profile's Equipment Setup to planetarium programs through `Lx200ProtocolServer` and `StellariumProtocolServer`.
  The tool never chooses a mount: without a MOUNT, or with one that is unavailable, disconnected, or switching, Start is disabled with the reason, and Equipment Setup is offered.
  A listener exists per (open connection id, exact mount id, protocol), so one mount may run an LX200 and a Stellarium listener at once and several mounts may be exposed by different tabs;
  the registry is process-wide, never per tab or profile, and switching profile, setup, or workspace, or closing the tab, never stops or redirects one.
  `POST …/remote-control/:protocol/start` with `{ host, port }` answers the listener (`MountRemoteServer`);
  a repeated start with the same binding answers it again, another binding is `409 conflict`, a taken address `409 addressInUse`, another bind failure `500 bindFailed`, and a failed start leaves the other listeners running.
  `/stop` (idempotent, 204) closes its clients and waits for their manual motions to stop; `DELETE …/clients/:clientId` closes one client (204, also when it already left).
  A listener stops with its mount (`device:updated` disconnected, `device:removed`) or connection (`connection:close`) and with the process, and is never restarted by itself.
  `GET /api/mount-remote-control` (`MountRemoteSnapshot`) and `mountRemoteControl:updated` carry an epoch per process and a revision per change, so the mirror (`listeners.ts`, in `SERVER_STORES`) drops a snapshot or start response older than an event it applied.
  Each client is shown as IP:port with Disconnect, nothing else.
  Clients are not authenticated; the default binding is `0.0.0.0` (every interface) on 10002 for LX200 and 10001 for Stellarium, and the tool warns whenever the host is not a loopback address.
  Commands run through the shared `MountCommands` commander and the operation registry, never a second command path: positions are the mount's (equinox of date) converted to J2000 at the server's time;
  a goto (`goToNow`, the same refusals as the goto route, above the horizon of the site the mount reports) or a sync (`syncNow`) is admitted or refused at once, LX200 answering it (`:MS#` `0` or `1Slew not possible#`, `:CM#` `#` or `Sync failed#`) and Stellarium only logging a refusal, and an admitted goto (`mount.goto`) goes on if its client leaves.
  An LX200 client's manual motion is its own `mount.remoteMove` operation, its commands run in order, another client's or a nudge's motion refuses it, and it stops when every axis is released, the client disconnects, the listener stops, or after `REMOTE_MOTION_WATCHDOG` (30 s);
  `:Q#` is the emergency stop of the mount.
  An LX200 client may set the mount's site (`:St#`, `:Sg#`, such as the GPS position Stellarium Mobile sends): the latitude and longitude are admitted at once, refused (`0`) while the mount is disconnected or held by an operation, and written together through the commander (`mountLocation`) after 250 ms, keeping the elevation;
  clock commands never change the mount (setters answer `0`), and slew rates are ignored.
  Stellarium clients receive the position every second.
  The host and port a listener was last started with are remembered per saved connection, mount, and protocol in the profile; a running listener always shows its actual binding.
- Meridian Flip (`api/src/meridianflip.ts`, `api/src/meridianflipexecutor.ts`, `web/src/tools/meridianflip/`, `/tools/meridian-flip-monitor`, icon `meridian`), with a Monitor and an Executor section (a transient choice of the tab).
  The Monitor section shows the server's monitor of the MOUNT of the active profile's Equipment Setup (see [Meridian Flip Monitor Contract](meridian-flip-monitor.md)), which the status bar also shows while it is enabled.
  The tool chooses no mount, as Mount Remote Control: without a usable MOUNT, Enable (a workspace action, beside Disable) is disabled with the reason, and Equipment Setup is offered.
  The mirror (`meridianFlipState` of `meridianflip.ts`, in `SERVER_STORES`) drops a snapshot or response older than an event it applied by epoch and revision.
  It keeps the recent transitions of each enablement, loaded from `GET …/transitions` and appended from `meridianFlip:transition`.
  Closing the tab, switching profile, setup, or workspace, or reloading never enables, disables, or redirects a monitor.
  The view shows:
    - the availability and the derived headline, the signed hour angle (`formatHourAngle`, "geometry only" without a forecast), the transit as a countdown interpolated from `sampledAt` with `useNow`, which shows "Stale" after 65 s without a publication, and the window instants in UTC;
    - the reported and the geometric pier side, the mechanical assessment, and the reason in words;
    - a timeline of the warning, transit, window, and deadline with now, and a legend naming each color (the approach, the preferred window, its closing minutes, outside them) and each mark (the transit, now);
    - the settings in minutes (the settle time in seconds), held as a draft clamped by `normalizeMeridianFlipSettings` to what the server accepts.
      Enable and Apply remember them in the profile per mount, and Apply sends them with `expectedRevision`, a conflict showing the running settings;
    - a read-only exposure preview (`assess-exposure`, with the current `contextId`);
    - the recent transitions, newest first.

    Nothing in the Monitor section commands the mount.

    The Executor section (`MeridianFlipExecutorView.tsx`, mirror `meridianFlipExecutorState` of `meridianflipexecutor.ts` in `SERVER_STORES`, ordered by epoch and revision) shows the MOUNT, its type, pier side, and commands, the MAIN_CAMERA, GUIDE_OUTPUT, FOCUSER, and ROTATOR of the Equipment Setup, and the Executor policy of the mount, remembered by the profile.
    Requests are built from the setup and the Target Centering, plate solving, exposure, star detection, and Auto Focus forms the profile keeps for the main camera, with a `nanoid` token: Check (read-only eligibility), Flip Now, Flip When Eligible, and Arm Automatic, each confirmed with what it commands, Disarm, and Cancel of the running flip.
    The latest flip shows its steps and its outcome, the flip verification apart from Ready for imaging, and Resume Capture (confirmed) for a capture it left paused.
    Equipment Control's manual Flip says it only moves the mount and links here, and Camera Acquisition shows a paused capture and, once a tool released it, Resume.

- SPICE Kernel Library tool (`web/src/tools/spicekernels/`, `/tools/spice-kernel-library`, icon `orbit`): shows the server's library (see [SPICE Kernel Library Contract](spice-kernel-library.md)) through one mirror, `spiceKernelsState` (`spicekernels.ts`) in `SERVER_STORES`, fed by `GET /api/spice-kernels` and both `spiceKernels:*` events, ordered by epoch and revision, with tab-lived requests in flight and their errors;
  nothing is persisted by the tab, and changing tab, profile, or route starts or stops nothing.
  Its context selects Installed (the kernels by precedence, highest first, each with an enabled checkbox, its bodies, the span of its segments, size, and readiness; a row opens the panel with provenance, SHA-256, the missing bodies of a kernel that needs a planetary kernel, Raise and Lower in the load order, Verify, Delete behind a confirmation, and every segment with its own coverage), Add Kernel (the curated downloads, the SBDB search of `searchMinorBodies` that resolves a small body to its SPK-ID before a Horizons generation over a UTC interval, ten years suggested, with the kernels already covering it, and the acquisitions with their progress and Cancel), and Settings (the ephemeris policy and the storage used).
  The header action Import uploads a `.bsp` file as the request body.
  Segment epochs are shown as UTC dates.
- Observing Planner tool (`web/src/tools/observingplanner/`, `/tools/observing-planner` and `/tools/observing-planner/<plan id>`, icon `compass`; see [Observing Planner Contract](observing-planner.md)): the tab state is `observingPlannerState` (`observingplanner.ts`, tab memory): the section (Discover, Analysis, Night Plan), a `ToolLocation` chosen in `ToolLocationSection` (the active profile's site by default, never changing the profile or the site), a `DisplayZoneOverride` that only formats times, the evening date (tonight in the location's zone by default), the constraints (the presets of `GET /presets`, edited in the panel), the catalog filter, and the answers of the catalog listing, the discovery, the analysis, and the preview, each behind its own request guard so a late answer never replaces a newer one.
  The saved plans are mirrored by `observingPlansState` in `SERVER_STORES`, read on every socket open and kept by revision from `observingPlan:*`, so an older read or event never rolls a plan back.
  An edit becomes a draft written whole 400 ms later from the revision it was made on, one write at a time per plan; a `409` keeps the draft and shows Keep Theirs (drop it) and Save Mine (write it over the revision the server kept).
  Discover lists the catalog without a location and ranks the night's targets in batches that add up, saying how many objects were evaluated of how many match;
  its Asteroids & Comets view (`discoverSource`) looks a body up in SBDB on request (`searchMinorBody`, behind its own guard), telling a found body, candidates to choose by designation, no match, and a failure apart, and a found body is analyzed or added by its SPK-ID like any target, never ranked.
  Analysis shows the status and reasons, the windows, the score with its factors, the chart (`NightChart.tsx`: the target's and the Moon's altitude over the bands of the sky, the windows hatched, the minimum altitude, and a cursor moved by a click or the keyboard), and analyzes fixed coordinates typed in hours and degrees;
  for a minor body it also shows the Ephemeris (the source and why, the kernels or the elements' epoch and solution, the fastest motion, and the distance and estimated magnitude at the chart's cursor), labels the approximate model, and offers Refresh Orbital Elements, which analyzes it again.
  Night Plan creates, duplicates, and deletes plans, edits the name, the evening, the copied location and constraints (Use Tool Location, Use Tool Constraints), and the items (priority, requested minutes, a start typed as a local date and time of the display zone, notes, order), and shows the totals, the problems of each item, and a timeline (`PlanTimeline.tsx`) whose blocks are dragged or moved with the arrow keys to the same canonical start, rounded to the minute.
  Show in Sky and Add to Plan are the handoffs of the Sky Map Contract.
  Nothing here moves the mount, changes the Sky clock, or starts an operation.
- Jupiter Observing Planner tool (`web/src/tools/jupiter/`, `/tools/jupiter-observing-planner`, icon `jupiter`; see [Jupiter Observing Planner Contract](jupiter-observing-planner.md)): the tab state is `jupiterPlannerState` (`jupiter.ts`), tab memory with a `ToolLocation` (the active site by default), a `DisplayZoneOverride`, the first evening (tonight in the location's zone, else the display zone) and a period of 1, 3, 7, or 14 days from that evening's local noon, the tool's own clock (real now on first opening, never the Sky clock), the play rate, the event and moon filters, the viewer orientation, and the selected event.
  Each answer has its own request guard (`/state`, `/track`, `/events`, `/source`).
  Events and the readiness are read again when the period, the place, or the Great Red Spot revision changes, the tracks when the period does; the filters only choose what is listed.
  The exact view is read shortly after the clock settles and at a bounded rate while it plays (`STATE_DELAY_MS`, `PLAY_STATE_INTERVAL_MS` of `web/src/tools/planetary/planetary.ts`); between those reads the moons are drawn from a linear interpolation of the tracks, for display only.
  Play stops when the tab is hidden and jumps once a second under reduced motion.
  `JupiterViewer` draws the oblate disk turned by its pole's position angle, the central meridian, decorative belts, the moons in front of or behind the disk, the shadows that face the Earth, and the schematic Great Red Spot, north up and east left, south up, or north up and east right, in one view that pans and zooms from the whole system to the disk (`PanZoomSurface` of `web/src/tools/planetary/PanZoom.tsx`; the zoom is transient React state, and marker and label sizes follow it).
  `MoonChart` plots each moon's offset along the equator against time over the period, east up, with the disk's band, the site's watchable windows, the selected event, and a cursor moved by a click or the arrow keys, Home, and End.
  `EventTimeline` lists the events with their visibility and rank, and `EventInspector` shows the reached contacts in the display zone and UTC, the definition, overlaps, reasons, and the ephemeris source.
  Choosing an event only moves the tool's clock to its maximum.
  The Great Red Spot model is the server mirror `jupiterGrsState` in `SERVER_STORES` (`GET /api/jupiter/grs` and `jupiter:grsUpdated`), edited in degrees by `GrsSettings` from the revision it knows; a 409 offers Keep Theirs and Save Mine.
  Manage Kernels opens the SPICE Kernel Library and Show in Sky selects Jupiter through the Observing Planner's handoff.
  Its clock, period, orientation, track interpolation, time bar, event table, and contact and visibility rows are the shared planetary planner pieces of `web/src/tools/planetary/`.
  Nothing here moves the mount, changes the Sky clock, a site, or the profile, or starts an operation.
- Saturn Observing Planner tool (`web/src/tools/saturn/`, `/tools/saturn-observing-planner`, icon `saturn`; see [Saturn Observing Planner Contract](saturn-observing-planner.md)): the tab state is `saturnPlannerState` (`saturn.ts`), tab memory with a `ToolLocation` that names the evenings and the display zone (the predictions are geocentric), the shared clock, period, rate, and orientation of `web/src/tools/planetary/`, the phenomenon kinds and moons listed, whether the rings are drawn, the span of the ring history (the year, ±5 years, or a Saturnian year around the period), and the selected entries.
  Each answer has its own request guard;
  the tracks, separations, and readiness follow the period, the phenomena (`/moons/events`, asked for whole with the site) the period and the place, the ring timeline its span, and every answer is read again when the SPICE Kernel Library's generation or policy changes (`spiceKernelsState`).
  The exact view (`/moons/state`) is read as Jupiter's; a 503 of the moons reads `/rings/state` instead, so the rings stay drawn and a notice explains the refusal.
  `SaturnViewer` draws, in one sky basis with one orientation transform, the far half of the ring annuli, the oblate disk with the moons' shadows, then the near half, from the server's openings and ring model (an edge-on ring keeps a render-only minimum thickness), and layers the moons by depth and ring overlap, outlining a moon the rings may hide, in the same pan and zoom view as Jupiter's;
  colours are schematic.
  `MoonChart` plots each moon's offset along the ring plane in arcseconds against time, with the disk and ring bands, with an extent fitted to the moons drawn.
  `RingGeometry` lists B, B′, P, the apparent ring and disk sizes, and which face is seen and lit; `RingHistoryChart` plots B and B′ over the span with the server's searched events as markers.
  `PhenomenaTable` lists the period's phenomena with their visibility (`Rings may hide it` for `uncertainRingInterference`) and rank, and `PhenomenonInspector` shows the reached contacts in the display zone and UTC, the definition, the ring note, the visibility rows, the overlaps, and the source;
  a notice explains a quiet season or a missing site.
  `SaturnEventList` lists the period's ring-plane events and the greatest separations of the moons drawn.
  Choosing an event, a marker, or a point of a chart only moves the tool's clock.
  Manage Kernels opens the SPICE Kernel Library and Show in Sky selects Saturn through the Observing Planner's handoff.
  Nothing here moves the mount, changes the Sky clock, a site, or the profile, or starts an operation.
- Alpaca Server (planned: a catalog entry without a view, and no `api` service yet): an `api` service over `AlpacaServer` (`core/src/devices/alpaca/server.ts`), started and stopped explicitly, bound to localhost by default, publishing only an explicit allowlist of devices.
  Devices imported from Alpaca connections are never exported, to avoid publication loops.
  Its state is published as events.
  The Tools view only controls it.
