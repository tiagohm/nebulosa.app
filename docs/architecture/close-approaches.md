# Close Approaches Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Close Approaches tool of the Planning group and its routes over JPL.

- Close approaches (`api/src/closeapproaches.ts`): stateless, read-only queries of JPL, never operations or events, through the queue of the Sky Map Contract.
  The toolkit builds the requests and reads the tables (`closeApproachesUrl`, `parseCloseApproaches`); no list is computed or kept locally, so without JPL there is none.
  A row is an encounter, not an object: `GET /api/close-approaches` answers a page of CAD with its `total`, which CAD filters, sorts, and pages itself, and the same object appears once per encounter.
  `neoOnly` false lifts the NEO filter CAD applies by default; it does not select what is not a NEO.
  Observed behavior CAD does not document or documents otherwise: dates filter in TDB, a bare `date-max` means 00:00 (so the last day is sent as `T23:59:59`), `limit-from` is an offset (omitted on the first page), and `dist-max` also applies to one object, whose history is asked with 100 au.
  The NEO filter is refused for one object, so it is not sent.
  A page past the end has no rows and keeps its `total`.
  The time of a row is converted from the published Julian date TDB, whose text is kept with the TDB calendar date, through the toolkit's timescales, with the leap seconds of the [Astronomical Time Converter](astronomical-time-converter.md).
  Distances are AU, with the 3σ bounds of CAD, the time uncertainty is the 3σ text of CAD, and the diameter uncertainty 1σ;
  a value CAD does not publish is absent, and no diameter is estimated from H. `GET /api/close-approaches/objects?designation=` resolves a row to its body by exact designation (SBDB `des`), since a row has no SPK-ID, and answers `found` with `MinorBody` and `MinorBodyDetails` (the published text of the orbit, physical parameters, discovery, radar, satellites, alternate orbits, and virtual impactors, without SBDB's embedded close approaches), `ambiguous`, or `notFound`, all with status 200.
  It shares the cache of `MinorBodies`, fresh for an hour here while the Sky keeps a body as long as it stays cached.
  `GET /api/close-approaches/objects/:spkId/approaches` pages the encounters of one body with CAD's `spk` selector.
  Pages stay cached for 5 minutes (64 pages, successes only) and `refresh=true` reads one again.
  While the offline switch of the [Ephemeris Chain](ephemeris-chain.md) is on, nothing asks JPL: a page or an object already read is answered whatever its age (`refresh` included), and any other is `503 offline`.
  The tool checks the filters, so the routes take them as valid;
  `400` from CAD is `502 rejected`, another major format `502 upstreamSchemaChanged`, an unreadable table `502 invalidResponse`, a 429, a 503, or a paused queue `503 rateLimited` with `retryAfter` in milliseconds, and any other failure `503 serviceUnavailable`.
  Virtual impactors are Sentry's as published through SBDB, an empty list says only that SBDB lists none, and nothing here computes or infers an impact probability.
- Close Approaches tool (`web/src/tools/closeapproaches/`): its state is a tab-lived valtio proxy (`closeApproachesState`), so leaving and reopening the tool keeps the search, the page, and the selection, and the first opening of a tab searches the next 30 days for the target and largest distance of the last search that ran (the profile's `closeApproaches` preferences, Earth within 10 LD by default; see [Persistence and State](persistence-and-state.md)), without the NEO filter, so comets are not left out.
  The filters hold pending values until Search, as every screen does, say so while they differ from the search shown (`closeApproachDraftPending`), and the tool checks them, the 366-day budget of a search included, so a longer time is explored in steps;
  the unit of the largest distance (LD or AU) sits beside its field, which steps by whole LD or hundredths of an AU, and below `lg` the filters fold into one line naming the search shown (`describeCloseApproachFilters`), opened with Filters and folded again by a search that runs.
  Refresh reads the page shown from JPL again and keeps its rows until the answer.
  Sorting and paging ask the server, from page 1 when the order changes, and rows are never sorted or sliced in the browser.
  The list, the object, and its history are independent requests, each behind a request guard, so an old answer never replaces a newer one, and no request ever repeats by itself.
  A failure is named by the code of the server (`closeApproachFailureNotice`): offline, which points to the Offline switch of the SPICE Kernel Library and offers no Retry, rateLimited with the seconds JPL asked to wait, rejected, which only new filters change, an unreadable answer, or no answer; the others offer Retry.
  A failed read of the list keeps the rows shown under that notice, the page shown being the one they belong to, and Retry reads the page asked for; only without rows does the notice take the place of the table.
  A new search forgets the selection; another page keeps it, and another encounter of the same object reads nothing again.
  A failure of the object leaves the encounter usable.
  The dates of the filters are labeled TDB, the times of the rows are in the profile's display zone against the active site (the tool has no zone of its own), and the TDB of an encounter stays in its row title and in the inspector.
  The distance unit shown (LD, AU, or km) is chosen above the table and kept in the same preferences, and also formats the distance of Observability; the unit never mixes within a value and its range, no value is written in exponential notation, and kilometers are grouped by thousands; LD is the 384,400 km of JPL, a mean scale.
  The table puts the distance beside the object; the orbit solution of an encounter is in the inspector only.
  On wide screens the inspector is the contextual panel; below `lg` it covers the results, with Back to Results, which uncovers them as they were, the encounter still selected and its row focused, since the shell keeps the state of its drawer to itself.
  Its sections are collapsible (`closeapproaches.*`), each shown only with something to show: Overview, Observability, Close Approach (its time uncertainty in words, its notes folded), Orbit, Physical Properties, Observations & Discovery, Virtual Impactors, and Other Approaches, paged by JPL by SPK-ID over a span and a target of its own.
  An unknown value is left out, and every term easily read as a risk (NEO, PHA, MOID, the 3σ range) says what it means; nothing is shown as a hazard.
  Open in Sky selects the body through `selectSkyObject` and leaves the clock alone; View in Sky at Approach Time first sets `skyClock` to the UTC instant of the encounter, since the selection reads it.
  Explore Orbit opens the Orbital Mechanics Explorer on the body by its SPK-ID and name only (`exploreMinorBody`, see [Orbital Mechanics Explorer Contract](orbital-mechanics-explorer.md)).
  Neither changes the observer or any device.
  Observability starts open, since where the object stands is asked first, and summarizes its altitude and apparent magnitude in its heading while collapsed; it is read only while its section is open, through `POST /api/sky/position` with no endpoint of its own, at the encounter by default, the real current time, or the instant the Sky shows, and for the active profile's observing site, read again only when its place changes (`locationKey`), without which it is geocentric and offers Set Location.
  It states its source and fallback reason.
  Rise, transit, and set come from the local two-body orbit and the Horizons table is interpolated every 10 minutes, so during a very close flyby they lose accuracy, which the section says.
