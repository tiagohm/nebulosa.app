# Astro Weather

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Astro Weather reads the forecast for the active site and tells, hour by hour over a night, whether it suits an observing mode (deep sky, visual, or planetary), with its reasons and the best window.
It also computes the night itself (sunset, twilights, darkness, and the Moon) from the toolkit, which other planning features reuse.
The server is `api/src/astroweather.ts` with its provider and night modules, and the tool is `web/src/tools/astroweather/`, whose reading of a forecast is the pure `observing.ts`.

## Purpose

It answers whether tonight, or one of the next nights, is worth setting up for, from forecasts rather than guesswork.
Its night is the one definition of an observing night that the planning tools share.

## Relations

- Hosted by the Tools workspace.
- Reads the hourly weather of Open-Meteo and the seeing and transparency of 7Timer! ASTRO, two free public services, through the shared remote cache, each apart so one failing leaves the other.
- Computes nights through the fast [Ephemeris Chain](ephemeris-chain.md): the kernels of the [SPICE Kernel Library](spice-kernel-library.md) when they cover the night, else the theories, with the almanac convention of the [Sun Inspector](sun-inspector.md).
- Its nights are read in process by the [Observing Planner](observing-planner.md), [Meteor Showers](meteor-showers.md), and the [Jupiter](jupiter-observing-planner.md) and [Saturn](saturn-observing-planner.md) Observing Planners, and by the Tonight view of [Artificial Satellites](artificial-satellites.md); Meteor Showers also reads its forecast.
- Observes from the active site, names nights in the site's zone, and shows the profile's display zone (see [Observing Sites and Time Zones](observing-sites-and-time-zones.md)); without a site it offers to choose one.
- Keeps only the observing mode in the profile (see [Persistence and State](persistence-and-state.md)).

## Rules and Limitations

- It is stateless and read-only, never an operation: nothing reads or commands a device, opens a dome, or changes a sequence.
- It is a planning aid, not a safety system, and a forecast is never presented as an observation.
- A night runs from one upper transit of the Sun to the next, so every night has one evening in any zone.
- Its Moon guidance is site-wide: nothing knows a target or its separation from the Moon.
- An hour missing what its mode needs is unavailable, never favorable, and a stale forecast recommends nothing.
- Its limits are planning heuristics, not scientific or equipment limits.
- Both services are for non-commercial use, so commercial distribution stays blocked until their terms are settled.
