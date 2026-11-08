# Sun Inspector Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Solar almanac (`api/src/sky/sun.ts`, `POST /api/sky/sun/almanac`): a stateless, read-only computation from the toolkit, never the network.
  For an instant (Unix milliseconds), an observer, and an IANA time zone it answers the Sun's day on the observer's civil date of that instant (`localDay`, absent without an observer), the next four equinoxes and solstices strictly after the instant (named `marchEquinox`, `juneSolstice`, `septemberEquinox`, `decemberSolstice`, so the names hold in both hemispheres), and the equation of time and the Carrington rotation in progress at the instant.
- The civil date is the time zone's, with its real bounds (`zonedDay`): a day the clocks change is 23 or 25 hours long, and a skipped midnight starts the day when the clocks jump.
  Sunrise, transit, sunset, the daylight (the time above the sunrise threshold within the day), the civil, nautical, and astronomical twilight, and the astronomical night (from the day's astronomical dusk to the next astronomical dawn within 36 hours) use the toolkit's almanac convention: the geometric, geocentric altitude of the Sun's center against `SUN_HORIZON` (−50′) and −6°, −12°, and −18°.
  This differs by seconds from the rise and set of `POST /api/sky/position` (the upper limb against the refracted topocentric altitude, nearest events within ±12 h), which other objects keep.
- A threshold the Sun crosses both ways is `normal`, one way `partial`, and not at all `continuousAbove` or `continuousBelow`; the first upward and the last downward crossings are kept.
  Absent crossings, daylight, and durations are absent, never 0.
  The equation of time uses the Sun's apparent geocentric right ascension of date (nutation and aberration), never the observer's topocentric one.
  Local days are cached by date, zone, and observer.
- Observation sources: the latest SDO image (`api/src/sky/sdo.ts`, `GET /api/sky/sun/image?channel&size`) and the latest NOAA SWPC active region report (`api/src/sky/activeregions.ts`, `GET /api/sky/sun/active-regions`) are current real-world observations, never tied to the Sky clock.
  The image is one of the fixed public JPEGs of the SDO `latest` directory, chosen from an allowlist of channels (`aia193`, `aia171`, `aia304`, `hmiIntensitygram` = HMI colored intensitygram, `hmiMagnetogram`) and sizes (512, 1024), so no URL is built from a request.
  SDO tells only when a file was modified (`Last-Modified`), never when it was observed, so the route answers that time and the download time (`X-Sun-Fetched-At`) as headers, and the client calls it the update time.
  The NOAA feed keeps a month of daily records; the report is the records of its latest observed date, one per region, with null fields absent; its spot counts are per group, never the international sunspot number.
- Both sources go through `RemoteCache` (`api/src/sky/remote.ts`): fresh for 15 minutes (images) or 30 minutes (report), one download shared by concurrent requests, a timeout, a size limit, and a content type check.
  When a download fails the last good value is answered marked stale (`X-Sun-Stale: 1`, `stale: true`), without downloading again for a minute; with none, `502 upstreamUnavailable`.
  A failure of one source never affects the other nor the almanac.
- Sun Inspector (`web/src/sky/sun/`): the Object Inspector of the body `10` (`SunInspector`, dispatched by `ObjectInspector`); no Sky panel view or navigation entry of its own, and no lunar data.
  Under the name its magnitude and the latest SDO image (`SolarImage`: a channel selector, the update and download times in UTC, a stale image said to be one, a larger 1024 px image in a `Modal` on a click), then the actions of every object (`ObjectActions`), then Active Regions (one row per region, its details on a click), Position with the apparent angular diameter (`2·asin(SUN_RADIUS_AU / distance)`, the distance of the position shown), Visibility (refracted altitude and azimuth of the position, then the sunrise, transit, sunset, and daylight of the almanac's local day), Twilight, Next Solar Eclipse, Seasons (the hemisphere's season named only with an observer), and Solar Physical Data.
- Three times are kept apart: the position and the almanac follow the instant the Sky shows (`selection.position.time`), the day is the site's civil date of that instant in the site's own zone (no day without a site), whatever zone the times are shown in (the profile's display zone), and the image and the report are the latest real observations, dated by their sources, whatever the clock shows.
  The store (`sun.ts`, `sunState`, tab memory) asks for the almanac and for the image and the report at the cadences it documents (`ALMANAC_BUCKET_MS`, `SUN_OBSERVATION_REFRESH_MS`), never on every tick;
  for the next eclipse (`/api/eclipses/solar?direction=next`, and `/:id/local` with an observer) only when the instant leaves the interval from the search instant to the eclipse's maximum or the observer changes.
  Each resource has its own request guard, loading, and error.
  A value of another day, zone, or observer is cleared at once.
  View Eclipse Map opens `/tools/solar-eclipse-map/<eclipse id>` of the eclipse shown.
  Slew to Object is the generic action: nothing refuses pointing at the Sun, in the inspector or in `api`.
