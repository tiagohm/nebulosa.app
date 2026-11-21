# Astronomical Time Converter Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Astronomical Time Converter tool of the Reference group, its conversion route, and the Earth orientation and nutation its module installs for the whole server.

- Astronomical Time Converter (`api/src/astronomicaltime.ts`, `astronomicaltime.eop.ts`, `web/src/tools/astronomicaltime/`): stateless, read-only conversions of one instant, never operations or events, with the toolkit as the only source of astronomy: no value crosses one floating-point Julian date, and the browser computes nothing but the text of its fields.
  `POST /api/astronomical-time/convert` reads an instant (`now`, a `calendar` in a timescale, a numeric offset, or an IANA zone, `jd` or `mjd` as decimal text in a named scale, `unix`, or a Julian or Besselian epoch in TT) and answers the UTC and local calendars, Unix milliseconds, each of the seven scales as calendar, JD, and MJD text, GMST and GAST, LMST and LAST with an observer, the differences between scales, the epochs, the day of the year, the signed hour angle LAST − RA of an apparent right ascension of date (J2000 is not accepted: LAST is referred to the true equinox of date), and `quality`.
  Angles are radians.
  ISO 8601 is a form of the tool that it sends as a calendar with an offset, and the tool checks the fields and the supported years (−4712 to 9999), so the server takes them as valid.
  The only errors are readings that name no single instant: `422 ambiguousLocalTime` with `{ earlier, later }` for a reading the clocks repeat, which the tool resolves with Earlier or Later (`fold`), and `422 nonexistentTime` for one they skip or a `:60` on a day without a leap second.
  An inserted leap second keeps its calendar and has no `unixMillis`, which POSIX cannot represent; on such a day JD(UTC) is the ERFA quasi-JD of a stretched day.
  Calendars are proleptic Gregorian with astronomical year numbering.
  Before 1960 UTC did not exist, so a reading is taken as UT and TT as it plus the toolkit's best-estimate ΔT (`leapSeconds: beforeUtc`, TAI−UTC not shown), and after the server's now no further leap second is assumed (`assumed`).
- Earth orientation (`EarthOrientationData`): the IERS tables of the whole server.
  `app/src/server.ts` calls `startEarthOrientation` before it serves, which reads them from `iers/` of the data directory (`DEFAULT_IERS_DIRECTORY`, under `NEBULOSA_HOME`) and installs them as the default providers of the toolkit (`installEarthOrientation`), so the Sky, the mounts, the pointing models, and the converter read one UT1 and one polar motion, and a refresh reaches them all.
  `iersab`, the shared table of the toolkit, stays empty, since its lookups clamp to the edge of a table, and a process that never starts them, such as a test, keeps UT1 = UTC and no polar motion.
  Of the workers only the fit worker needs them, and it reads the same cache, read only and once per worker, when the server thread has them (`earthOrientation` of its request): the hour angles of a fit then match those of the corrections.
  Solar eclipse maps use the toolkit's ΔT model and do not change with UT1, and streak classification does not read it.
  Saved pointing models are not refitted: UT1 only moves the hour angle of their basis, so terms of 1000″ move a correction by less than 0.1″ at the largest DUT1.
  Starting the server and any conversion finding the tables older than 7 days start one background download of finals2000A (IERS, then its USNO mirror) and EOP C04, at most once an hour, with no timer and no request waiting on it;
  a download replaces a table only if the new one reaches today (IERS A) or 120 days ago (IERS B).
  An instant before the tables takes DUT1 = 0 rather than the toolkit's clamped edge, so its reading is UT; one after them takes the toolkit's extrapolation, UT1 following the best-estimate ΔT from the last value with no further leap second; either leaves `dut1` and `ttMinusUt1` out, and says so in `quality.eop` (`covered`, `outsideTable`, or `notLoaded`), and the tool states UT1 and sidereal times as approximate.
  No observed or predicted label is given, since the tables do not keep it per row.
- Nutation (`installInterpolatedNutation` of `api/src/astronomicaltime.nutation.ts`): the IAU 2006/2000A nutation of every instant without its own providers.
  `app/src/server.ts` installs it after the Earth orientation, and so does the pointing fit worker, since `TIME_PROVIDERS` belongs to each thread: the toolkit's `interpolatedNutationProviders` evaluates the series only on quarter-day TT nodes (a bounded cache of 16384 nodes) and interpolates between them, within about 0.01 mas of the full series and independent of the order of the instants.
  The precession-nutation matrix it gives also feeds the apparent sidereal time, the CIRS and ITRS rotations, and the ICRS↔CIRS and observed astrometry setups of the toolkit, so an instant evaluates it once.
  Instants with their own orientation providers keep them (Planetary Events, the Observing Planner); tests use the full series, except those comparing a worker's results with their own thread's.
- Astronomical Time Converter tool: its state is a tab-lived valtio proxy (`astronomicalTimeState`), never persisted.
  Now converts the real current time every second while the page is visible, one request at a time, and never the Sky simulation clock;
  Custom sends an entry 250 ms after the last edit, superseding the request before it.
  The last answer is kept with the request it answers (`answered`), so while new inputs wait for an answer, cannot be read, or are refused, the results stay dimmed, the reading says Out of date, every copy and use-as-input is disabled, and so is Set Sky Time: an old value is shown as such and never stands for new inputs.
  The header states the values in a word: Live (Now), Custom instant, Converting, Entry incomplete, Choose an occurrence, or Not converted, with the reason as the tooltip; the reason of an entry or of a refusal is also shown under the entry.
  A right ascension that cannot be read is reported under its field and in the Hour Angle result, and the instant is converted without it.
  The results lead with the apparent sidereal time in large figures, local with a location and Greenwich without one, stating Approximate when UT1 is taken as UTC; JD(UTC) and JD(TT) follow civil time, and every scale's calendar, JD, and MJD are under Time Scales.
  Unix time is shown and entered with three decimals.
  Edit Instant, a workspace action, opens the panel on the instant and focuses its first control.
  Changing form rewrites the entry for the instant shown.
  The location is a tab-memory `ToolLocation` (typed coordinates carry their elevation too) and the time zone the one `resolveDisplayZone` gives for the tool's `DisplayZoneOverride` and that location (see [Observing Sites and Time Zones Contract](observing-sites-and-time-zones.md)), always sent as an IANA name, since the server reads calendar entries and the local civil time in it.
  An Earlier or Later choice holds only for the zone it was made in.
  Use Sky Time copies the Sky's instant once and Set Sky Time sends the instant shown to `skyClock`, disabled inside a leap second; neither changes a device, the profile, or the status bar.
  Use Sky Selection copies the apparent right ascension of date of the selection, computed for its own instant, which the tool shows.
  Each copied value names its scale and is independent of the locale.
