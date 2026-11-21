# Meteor Showers

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Meteor Showers is a tool of the Planning group and a read-only catalog and planning service of meteor showers (`api/src/meteorshowers.ts` with `meteorshowers.catalog.ts`, `meteorshowers.astronomy.ts`, `meteorshowers.solar.ts`, `meteorshowers.store.ts`, `meteorshowers.visual.ts`, and `web/src/tools/meteorshowers/`).
It lists, searches, dates, and locates the showers of the IAU Meteor Data Center stream catalog, with a small curated visual subset, and finds the observing windows of a shower from a site, for one night or ranked over many.

## Purpose

A meteor shower is worth watching only on a few nights, with its radiant high, the sky dark, and the Moon out of the way.
The tool tells the operator which showers are active, when their maxima fall, which nights and hours suit the observing site, and, when a published profile exists, how many meteors an ideal observer could count.

## Relations

- Sources, never merged, each value kept with its kind: the IAU MDC catalog, the curated IMO visual subset with its year-specific predictions, and the published activity profiles of Moorhead et al. (2019).
- The IAU catalog is bundled as `api/data/meteor.showers.json.gz`, written by `bun make:meteors` (`bin/src/meteor.showers.ts`); a newer one is downloaded only when the operator asks, and stored as a snapshot in the operational database (see [Persistence and State](persistence-and-state.md)), with a change event that makes tabs read it again.
- Uses the toolkit's (`core`) catalog adapter, shower dates, radiant paths, and window planners.
- Takes the Sun and the Moon from the fast [Ephemeris Chain](ephemeris-chain.md): the kernels of the [SPICE Kernel Library](spice-kernel-library.md) when they cover the night or instant, else the analytical theories.
- Reads the night of the evening from [Astro Weather](astro-weather.md) and its forecast to describe the weather over each window.
- Feeds the [Observing Planner](observing-planner.md), whose plan item names a shower only by id, and opens from it on the planner's evening.
- Feeds the Sky's radiant layer and Meteor Shower Inspector (see [Sky Map](sky-map.md)), and hands off to the Sky, setting the Sky clock only for the best time or the published maximum.
- Observes from the active profile's observing site and shows its display zone; its own state lives in the tab.
- Starts no operation and holds no device; hosted by the Tools workspace (see [Tools Integration](tools-integration.md)).

## Rules and Limitations

- The bundled catalog works offline at once and is never written to the database; an upgrade never replaces a newer download, and a refused or failed download keeps the catalog in use.
- The IAU mean solar longitude is an average of the activity, never its maximum, and no rate is read from the IAU catalog.
- The visual subset is deliberately small and credited; the IMO Working List is never republished or exposed in bulk.
- A shower without a usable solution is listed but never located or planned, and fields of two solutions are never combined.
- Only IAU-number ids last; provisional ids may name another record after a refresh.
- Windows are geometric (airless, no terrain or horizon mask); rates and counts exist only with a published profile and the operator's assumptions, and are never a forecast.
- The weather describes a window but never changes a window, a rate, or a ranking.
- It predicts no individual meteor, and a radiant is never a mount target.
