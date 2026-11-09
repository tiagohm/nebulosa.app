# Meteor Showers Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Meteor Showers (`api/src/meteorshowers.ts` with `meteorshowers.catalog.ts`, `meteorshowers.astronomy.ts`, `meteorshowers.solar.ts`, `meteorshowers.store.ts`, and `meteorshowers.visual.ts`) is a read-only catalog and planning service of meteor showers.
  It lists, searches, dates, and locates the showers of the IAU Meteor Data Center stream catalog with a small curated visual subset, and finds the geometric observing windows of a shower from a site.
  It starts no operation, reserves no device, and never changes a device, a site, a profile, or the Sky clock;
  it predicts no individual meteor.
- Sources, never merged, each datum kept with its kind (`MeteorDataBasis`: `iauScientific`, `imoVisual`, `publishedAnnualPrediction`, `nebulosaModel`, `observerGeometry`):
    - The IAU MDC catalog (`streamfulldata.json`, https://iaumdc.astro.sk/downloads), read by the toolkit's adapter (`iau.meteor.showers.ts`): every record with every published solution in source order.
      Its status, technique, orbit, mean solar longitude `LoS`, and activity interval are scientific data: `LoS` is an average of the activity, never its maximum, and no ZHR or observability is read from it.
    - The curated visual subset (`METEOR_VISUAL_ENTRIES`): thirteen major showers of Table 5 (Working List of Visual Meteor Showers) of the IMO Meteor Shower Calendar 2026, typed by hand, each with its IAU number, the activity period as calendar days, the solar longitude of the maximum (equinox J2000.0, with the decimals it is published with), the typical ZHR, the population index, and the entry speed.
      The IMO grants this use with credit and edition; the subset is deliberately not the full Working List, which is never republished, scraped, or exposed as a bulk endpoint.
      Its revision is `METEOR_VISUAL_REVISION`, raised by every release that changes it, and its years with curated year-specific notes are `METEOR_ANNUAL_PREDICTION_YEARS`.
- Identity (`MeteorShowerRecord`): `iau:<number>` from the IAU number; a record without one is `mdc:<provisional name>`, and a repeated number (the catalog has one, 89) takes `~2` after the first record in source order.
  Those two are `snapshot` ids, which a later document may give to another record; only `iau` ids last.
- Preferred solution (`selectSolution`): among the solutions not removed with a radiant, an annual one first, then one with an activity interval, then one with a radiant drift, then the largest sample, then the lowest solution id, then source order.
  A year-limited label (`2010/13`, a survey's span) says when the data was observed, so such a solution ranks after an annual one.
  The choice (`selectedBy`: `ranked`, `only`, `none`) and what the solution leaves unknown (`gaps`: `radiant`, `activityInterval`, `drift`, `referenceSolarLongitude`, `usableSolution`) are answered with every solution;
  fields of two solutions are never combined, and a shower without a usable solution is listed but never located or planned.
- Catalog in use: the snapshot the operator last downloaded (`meteor_catalog_snapshots`, `meteor_catalog_source`), or the document bundled with the application when none is, or when the bundled one names a later ISO date as its version (an application upgraded past an older download).
  The bundled document is `api/data/meteor.showers.json.gz`, written by `bun make:meteors` (`bin/src/meteor.showers.ts`) exactly as published and gzipped, not committed and embedded in the executable;
  `bun make:meteors --empty` writes an empty catalog of version `empty`, which a later `bun make:meteors` replaces without `--force`.
  The bundled document is never written to the database, so a fresh installation lists the catalog offline at once and an upgrade never replaces a newer download.
  The catalog is parsed and indexed once per active document, in memory, and never sent whole to a tab.
- Refresh (`POST /sources/iau/refresh`): only when asked, never on a timer.
  It downloads the fixed official URL (no URL is taken from a request) within 60 s and 32 MiB (`fetchUpstream`), parses and normalizes it with the toolkit, and refuses a document that is not the versioned stream catalog, whose published count disagrees with its records, or that keeps fewer than half the records of the catalog in use (`invalidCatalog`).
  The new catalog is indexed before anything is written, then the snapshot is inserted, activated, and the revision raised in one transaction that keeps one previous snapshot;
  the index is swapped and `meteorShowers:changed` published with the revision and the sources.
  The same document again (same SHA-256) changes and publishes nothing, and concurrent refreshes share one download.
  A failure keeps the catalog in use and records its time and code: `502 upstreamUnavailable`, `502 invalidCatalog`, `502 catalogTooLarge`, or `500 persistenceFailure`.
- Dates (`MeteorShowerOccurrence`), each source apart:
    - IAU (`iauOccurrence`): the occurrence of the preferred solution that starts in a civil UTC year, as the toolkit's `meteorShowerDates` defines it: the end is the first crossing after the start and the reference the crossing nearest to it, so the Quadrantids starting in late December keep their reference in January.
      A start the civil year never reaches (a fraction of a degree of longitude at its turn) starts no occurrence that year, and a dated solution outside its years has none.
    - Visual (`visualOccurrence`): the activity period's calendar days in the year (the end in the next year when it comes first) and the crossing of the published maximum longitude nearest to the period.
      The maximum's instant has the precision of its published decimals (0 is about a day, 1 about two hours, 2 about fifteen minutes), which the tool formats accordingly.
    - Solar longitudes are the toolkit's geometric geocentric J2000 ones; the IMO publishes its maxima for the equinox J2000.0, which differs only by the aberration (about 20″, under ten minutes), below the precision of a published maximum, so they are used as published.
    - Instants come from `MeteorSolarLongitudeTable`: the toolkit's solar longitude sampled once a day per civil year and inverted on the cubic of the four samples around the crossing, which agrees with the toolkit's root search to a few milliseconds and makes the whole catalog's dates cost a few milliseconds instead of about 20 s.
- Activity at an instant (`activityAt`): the visual activity period when the shower has one (`imoVisual`), else the support of its preferred solution and the years it applies to (`iauScientific`), and `unknown` without a support, never inactive.
- Routes (`/api/meteor-showers`):
    - `GET /` (`MeteorShowerListRequest` as query parameters → `MeteorShowerListPage`): the filtered catalog with its `total`, at most 100 rows, ordered by next occurrence (the visual maximum, else the IAU reference), name, or IAU number, ties by id.
      The search matches an IAU number exactly and any other text as part of the names (visual, IAU, and provisional) or the code, without diacritics or separators;
      the filters are status, kind of activity, visual data, missing data, active now, and a latitude whose radiant reaches a minimum altitude at culmination (the catalog position, without drift).
      Each row gives the activity now and the next occurrence, or the occurrence of a civil year.
    - `GET /sources` (`MeteorShowersSources`) and `POST /sources/iau/refresh`.
    - `GET /:id` (`MeteorShowerDetail`): every solution, the preferred one and why, the gaps, the visual entry with its source, and the occurrences of the previous, current, and next year; `404 notFound`.
    - `POST /calendar` (`MeteorShowersCalendarRequest` → `MeteorShowersCalendar`): the occurrences overlapping months of a civil year, an occurrence crossing the new year included, ordered by the instant standing for each.
    - `POST /states` (`MeteorShowerStatesRequest` → `MeteorShowerStates`): at most 100 showers at one instant sharing one toolkit context (`meteorShowerStates`): activity, radiant J2000 and of date, and, with an observer, geometric altitude and azimuth, the Sun's altitude, and the Moon's altitude, illuminated fraction, and separation from each radiant, all at that same instant.
      A daily drift moves a radiant at most `MAX_DRIFT_DAYS` (30) from its reference longitude, about the half-width of a long activity; beyond it, outside any activity, the radiant is the catalog position at the reference (`radiantAtReference`), never a linear drift months long.
    - `POST /radiants` (`MeteorSkyRadiantsRequest` → `MeteorSkyRadiants`): the radiants the Sky draws, geocentric J2000, at most 100: the curated showers inside their activity period and the established IAU showers whose annual preferred solution is inside its support, never a removed, working, or year-limited record.
    - `POST /:id/observing` (`MeteorObservingRequest` → `MeteorObservingNight`): the geometric observing night, below.
- Observing night: the night is the Astro Weather night of the evening (`resolveNight` of the Observing Planner, `AstroWeatherService.night` in process), named by the civil date of its evening in the site's zone.
  The windows are the toolkit's `meteorGeometricObservingWindows` over the whole night: inside the support, the Sun at most `maximumSolarAltitude`, the radiant at least `minimumRadiantAltitude`, and the optional lunar constraints applied while the Moon is up.
  The support (`MeteorObservingSupport`) is the visual activity period of the nearest occurrence converted to solar longitudes when the shower has curated data, else the IAU interval, else none, whose windows are `geometryOnly`.
  A window carries its best instant (the highest radiant), the Sun and the Moon there, and `radiantSineHours`, a geometric opportunity measure, never a count: there is no ZHR, rate, or count without an activity profile.
  Without a window, `reasons` says why: `missingRadiant`, `noSupportedActivity`, `sunTooHigh`, `radiantBelowThreshold`, `moonConstraint`, or `insufficientData`.
  The chart's samples every 10 minutes over the night's display give the radiant's, the Sun's, and the Moon's altitude; the Sun and the Moon are interpolated between hourly vectors (the Moon's chord departs from its arc by under 0.001°), since one lunar evaluation costs about 9 ms.
  Altitudes are geometric (airless), the Moon's geocentric (up to about a degree from topocentric), and no terrain, horizon mask, or weather is applied.
  Nights are cached in an `LruCache` (64) by the catalog revision, the shower, the site's place and zone, the evening, and the constraints.
- The tool, the Sky radiant layer, and the Meteor Shower Inspector are described in the [Tools Integration Contract](tools-integration.md) and the [Sky Map Contract](sky-map.md).
- Costs measured on the 2026-11-03 catalog (1077 records, 2197 solutions): indexing about 150 ms once per document, the first listing about 1.3 s while the solar-longitude years are sampled and then milliseconds, a night about 0.1 s of windows plus the Astro Weather night.
