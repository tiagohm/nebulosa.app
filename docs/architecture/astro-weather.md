# Astro Weather Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Astro Weather (`api/src/astroweather.ts`, `astroweather.openmeteo.ts`, `astroweather.seventimer.ts`, `astroweather.night.ts`) is stateless and read-only, never an operation or an event, and nothing here reads or commands a device, opens a dome, or changes a sequence.
  It answers planning questions from forecasts and is not a safety system: a forecast is never presented as an observation.
- `GET /api/astro-weather/forecast?latitude&longitude` (`AstroWeatherForecast`) reads two fixed public services, no key needed, and no URL or service is ever taken from a request.
  Each is read and cached apart, so one failing leaves the other usable, with `AstroWeatherSource` telling its `state` (`fresh`, `stale`, `unavailable`), download time, first and last sample, model run when known, and `errorCode` (`upstreamUnavailable`, `invalidResponse`, `rateLimited`).
  Neither having anything to show is `502 upstreamUnavailable` with `sources`, never empty arrays that could read as good weather.
- Open-Meteo gives the hourly weather (`MeteorologySample`) for 8 UTC days, which covers the dawn after the seventh local evening in any zone, with the service's default `best_match` model, which names no run.
  Cloud, temperature, humidity, dew point, and sustained wind are instantaneous; precipitation, its probability, and gusts describe the hour before their sample.
  Upstream seconds become milliseconds once.
  The observer's elevation is not sent, since it is a height above the ellipsoid and the service expects terrain, so the forecast's own height is reported with the grid cell.
- 7Timer!
  ASTRO gives seeing and transparency (`AstronomicalSample`): classes 1 (best) to 8 (worst), read for those two only, as discrete samples 3 hours apart counted in hours from a model run in UTC, for about 3 days from a run that may be hours old, so coverage is always read from the samples.
  A class is the service's category for a band, seeing in arcseconds (below 0.5, 0.5–0.75, 0.75–1, 1–1.25, 1.25–1.5, 1.5–2, 2–2.5, above 2.5) and transparency in magnitudes per airmass (below 0.3, 0.3–0.4, 0.4–0.5, 0.5–0.6, 0.6–0.7, 0.7–0.85, 0.85–1, above 1), never a measurement of one value.
  `-9999` and anything outside 1 to 8 are unknown.
  Observed behavior the service does not document or documents otherwise: `api.pl` redirects to its `astro.php`, which rounds the place to 0.1° (`cellDegrees`), not 0.001°, and JSON arrives labeled `text/html`, so its content type is not checked.
  `ac` stays 0: its modes are 2 and 7 km corrections, not a site elevation.
- Through `RemoteCache` with its limits (`RemoteCacheOptions`): fresh for 30 minutes (Open-Meteo) or 2 hours (7Timer!), one download shared by concurrent requests, a 12 s timeout, a 1 MiB limit, 128 places per service keyed at 0.01° and 0.1°, a failure repeated for a minute without downloading, and the last good value answered as `stale` for up to 6 or 12 hours from its download.
  The cache is shared by every tab, so no route bypasses it.
  The free services allow fewer than 10,000 Open-Meteo calls a day, and 7Timer! states no limit.
- `POST /api/astro-weather/night` (`AstroWeatherNightRequest`, `AstroWeatherNight`) answers the night containing an instant, computed from the toolkit and never the network.
  A night runs from one upper transit of the Sun to the next (`sunNightAt`), so it is named by its evening's civil date, dawn needs no second day, and any zone, even UTC for a site far from Greenwich, gives every night one evening, which civil days do not.
  The previous night is asked with `start − 1` and the next with `end`.
  Crossings use the convention of the Sun Inspector, absent ones are absent, and `darkness` is the time the Sun's center stays below −18°, empty when it never does.
  `display` runs from an hour before sunset to an hour after sunrise, or to the end of the night missing one.
  The Moon's illuminated fraction and phase are taken at the middle of `display`, and its intervals above the horizon (`moonAboveHorizon`, the rise and set convention of `SkyEphemeris.events`, on a 15-minute search) cover `display`, however many rises and sets fall in it;
  a grazing pass near a polar latitude can be missed.
  This is site-wide guidance: nothing knows a target or its separation from the Moon.
  A night costs about half a second of local computation, so the latest 10 nights of 16 sites are kept and found by the instant they contain.
- Reading a forecast (`web/src/tools/astroweather/observing.ts`) is pure and deterministic, with no request and no score: every hour of `display` gets `favorable`, `variable`, `unfavorable`, or `unavailable`, with its reasons and what it misses, beside a reading of the weather alone.
  Its limits are planning heuristics in constants, not scientific or equipment limits.
  Instantaneous values come from the sample starting an hour, and precipitation and gusts from the one ending it.
  Seeing and transparency come from the nearest 7Timer! sample within 90 minutes, labeled as such, never interpolated or carried past the last sample.
  A known hazard stands whatever else is missing and nothing offsets it; otherwise an hour missing what its mode needs is `unavailable`, never favorable.
  Every mode needs the weather, Deep Sky transparency, and Planetary seeing, so Visual keeps its windows past the horizon of 7Timer!.
  Deep Sky uses astronomical darkness and reads a bright Moon (at least half lit, above the horizon) as `variable`, Visual observes between the civil twilights and only notes the Moon, and Planetary observes between sunset and sunrise and ignores the Moon, reading gusts and seeing instead.
  A best window is at least 2 continuous favorable hours, the longest first and then the one with fewer cautions, clipped to the part of the night the mode can use and never in the past.
  A stale forecast the mode depends on is shown and recommends nothing; with no window the tool says why, and may offer the longest variable stretch as marginal.
- Astro Weather tool (`web/src/tools/astroweather/`, `/tools/astro-weather`): its state is a tab-lived valtio proxy (`astroWeatherState`); only the observing mode is a profile preference (see [Persistence and State](persistence-and-state.md)).
  The location is a tab-memory `ToolLocation` chosen in the shared `ToolLocationSection`: the active profile's observing site, followed live, another saved site, or coordinates typed with their elevation and a zone (UTC until one is chosen);
  it never changes the profile, and another profile resets it.
  Nights are named in the zone of the location (the `timeZone` of `/night`), and their times are shown in the zone `resolveDisplayZone` gives for the tool's `DisplayZoneOverride` (tab memory, `TimeZoneSelect`), which only reformats: the forecast and the night are keyed by the place and the location's zone (`siteKey`), never by the display zone.
  Its answers are read behind one request guard each for the forecast and the night, so a failure of one leaves the other shown and a late answer for another site is discarded; another site clears both at once.
  Changing mode, night, or hour asks for no forecast, and only a new site, Refresh, or reopening after 30 minutes does, with the cache of the server deciding whether a service is read at all; nothing polls.
  It opens on the current night, the one in progress until its `display` ends and the next one from then on, even before the upper transit that starts it, moves to that next night by itself while the tool stays open, asking for no forecast, goes back no further, and goes forward while the forecast has samples for the next night.
  The page shows the site and its zone, **Forecast — not live observations**, the night and mode, the outlook with its decisive reasons first, the window, six facts of the part of the night the mode can use, and a notice per service that failed, is old, or ends during the night.
  The timeline (`ForecastTimeline.tsx`) has rows of the outlook, cloud, the two classes, rain chance, gusts, and the Moon on one time axis over bands of how dark the sky is, each row on its own scale.
  Hours are bars, 7Timer! samples are tiles centered on their timestamps and 3 hours wide, a missing value draws nothing, and an hour is chosen by a click or with the arrow keys, Home, and End, never by hovering;
  each reading has a symbol as well as a color.
  The contextual panel holds the location, the time zone, Sky Conditions and Weather Conditions of the hour chosen, Astronomical Conditions of the night (`astroWeather.*`), and Sources with the credits.
  Without a location the tool offers Set Location, which opens Settings → Observing Sites.
  Nothing here is passed to the Sky, the Sequencer, or a device.
- Both free services are for non-commercial use: Open-Meteo under CC BY 4.0, 7Timer! with no formal license and public pages that conflict about paid software.
  Commercial distribution stays blocked until that is settled.
