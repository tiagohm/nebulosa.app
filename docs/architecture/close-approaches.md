# Close Approaches

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Close Approaches is a tool of the Planning group that lists the close approaches of asteroids and comets to a body, read from the JPL Close-Approach Data service (CAD), and inspects the object of each encounter from SBDB (`api/src/closeapproaches.ts`, `web/src/tools/closeapproaches/`).
A row is an encounter, not an object: the same object appears once per approach.

## Purpose

Close flybys of the Earth are some of the brightest and fastest-moving minor-body targets an operator can image.
The tool answers which objects pass close in a period, when, how close, and whether they can be observed from the site, and leads to the Sky or the orbit of the object.

## Relations

- Asks JPL CAD and SBDB through the shared JPL queue of the [Sky Map](sky-map.md); the toolkit builds the requests and reads the tables.
- Resolves an object through `MinorBodies`, sharing its cache with the Sky.
- Converts the published TDB times with the toolkit's timescales and the leap seconds of the [Astronomical Time Converter](astronomical-time-converter.md).
- Follows the offline switch of the [Ephemeris Chain](ephemeris-chain.md): offline, only pages and objects already read are answered.
- Locates the object for the active profile's observing site through the Sky's position route, stating the source it used.
- Keeps the last search's target and distance and the distance unit in the profile's preferences (see [Persistence and State](persistence-and-state.md)); the rest of its state lives in the tab.
- Hands off to the Sky (Open in Sky, optionally at the approach time, which sets the Sky clock) and to the [Orbital Mechanics Explorer](orbital-mechanics-explorer.md) (Explore Orbit), changing no observer or device.
- Read-only queries: no operation, event, or device; hosted by the Tools workspace (see [Tools Integration](tools-integration.md)).

## Rules and Limitations

- No list is computed or kept locally, so without JPL there is none; filtering, sorting, and paging are CAD's, never the browser's.
- A search spans a bounded number of days, so a longer period is explored in steps.
- Values CAD does not publish are absent; no diameter is estimated from H.
- Virtual impactors are Sentry's as SBDB publishes them; nothing computes or infers an impact probability, and nothing is shown as a hazard.
- Rise, transit, and set come from a local two-body orbit and lose accuracy during a very close flyby.
