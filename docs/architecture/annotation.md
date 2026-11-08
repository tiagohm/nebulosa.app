# Annotation Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- One service, `AnnotationService` (`api/src/annotations.ts`, analysis jobs of the Shared Image Contracts with routes `/api/images/:id/annotations` and `/api/annotations` and event `annotations:updated`), identifies what an image document shows from its WCS, never from its pixels (manual runs only).
  The WCS is the solution of the completed plate solving job of the image the request names (`plateSolveJobId`), else the valid WCS of its header (`PlateSolvingService.result`/`solutions`), resolved and frozen when the job is submitted;
  a named job unknown, no longer kept, of another image, or without a solution, an image without a usable WCS, or a WCS that cannot unproject the image is refused (422 `contextUnavailable`).
  Nothing is solved implicitly, and a local job queries no network.
- The field is the cone around the unprojected image center that holds 8 unprojected points along each side (`annotationField`), plus 1′ for proper motion.
  The embedded sky catalog is scanned in memory for it (`fieldObjects`, `fieldConstellations` in `api/src/sky/catalog.ts`, behind the narrow `annotationSky` of `api/src/sky/index.ts`; a few milliseconds for the whole catalog, so the catalog has no spatial index): the stars and deep-sky objects up to the request's `magnitudeLimit`, deep-sky objects of a classic visual catalog without a magnitude too, at most 2000 of each (brightest first, `truncated` when more), and the stick figures with a segment reaching the cone, whole, with the labels inside it.
  An object is kept when `tanProject` puts it on the image; a deep-sky object when its major axis may reach the image.
- Positions are astrometric on the ICRS (J2000) equator of a plate solution, never apparent of date: deep-sky objects keep their catalog position, and stars are moved linearly by their proper motion to the observation instant.
  A local job has no solar-system body: the Sun, the Moon, the planets, and their satellites come from the solar-system search with the asteroids and comets.
- The observation context (`observationContext`) always comes from the image, for both kinds; a request carries no instant or observer.
  The instant is the middle of the exposure from the raw DATE-OBS of the header, else from its DATE-END when the exposure (EXPTIME or EXPOSURE) is known; FITS dates are UTC, and a date resolved to more than a second only is `approximate`.
  Without one, a local job moves the stars to the current time (origin `now`, with a warning) and a solar-system search is refused; a camera frame's command instant is not a fallback.
  The site is that of the header (OBSGEO-X/Y/Z, OBSGEO-B/L/H, or SITELAT/SITELONG/SITEELEV, read by the toolkit's `readFitsTime`), else the Earth's center.
- One local annotation runs at a time (provider `local`).
  An equivalent request (image, kind, WCS job, and the magnitude limit of a local job or the groups of a solar-system search) is answered with the job still waiting or running (202), or with its kept result.
- A result carries the WCS it was computed with (`solution`), so a client projects the objects with the same one, the field, the observation context, and each object's stable id (`catalog:<id>`, `body:<code>`, `satellite:<number or name>`, `skybot:<number or name>`), its `SkyObjectRef`, layer, names, magnitude, and size and position angle when the catalog has them;
  never pixels, screen positions, or SVG.
- Images → Annotation (`web/src/images/AnnotationPanel.tsx`, mirrored by `web/src/annotations/annotations.ts` in `SERVER_STORES`) sends the plate solution shown when it is a completed job of the image, else annotates with the header's WCS;
  Run Analysis is disabled without either and holds the frame a camera tab shows.
  The overlay (`web/src/annotations/AnnotationOverlay.tsx`) is drawn only over the image its result annotated and only while the solution shown is the one it was computed with (`annotationMatchesWcs`).
  Its geometry (`web/src/annotations/geometry.ts`) is computed once per result through `pointAt`: the outline of a deep-sky object is an ellipse of its catalog axes and position angle sampled on the sphere and then projected (a dashed circle of the major axis without an orientation or minor axis, a marker below 10 screen pixels), constellation figures are sampled along great circles, broken where the projection fails or jumps, and clipped to the image, and a body's predicted motion during the exposure is a dashed segment.
  Zoom and pan only place the labels again: a greedy, deterministic pass by priority (bodies, deep-sky objects, stars, then magnitude; the selected object first) over a spatial grid, within a budget per density (15, 40, 150), never over a marker.
  Groups (deep-sky objects, stars, the Sun, Moon, and planets, satellites, asteroids and comets, constellation lines and names), labels, density, outlines, motion, the magnitude limit (a lower one filters at once, a higher one applies to the next run), the groups the next solar-system search lists, and the selected object (by result job and object id) belong to the document view (`ImageAnnotationState`, started from the profile's `imageAnnotation`, see [Persistence and State](persistence-and-state.md)), so nothing of the overlay runs an analysis;
  a click within 8 screen pixels of a marker, or inside the extent of an object, and a row of the list select the same object, and the selection of a camera tab is cleared when another frame is committed.
  Open in Sky selects the object's `SkyObjectRef` in the Object Inspector and opens the Sky workspace without changing its time.
- A solar-system search (`kind: solarSystemBodies`, Find) is a separate job of the same routes and events, run by its own provider (`skybot`, one at a time) so it never waits for nor delays a local annotation.
  It asks the IMCCE SkyBoT cone search (`coneSearch` of `core/src/adapters/orbits/skybot.ts`) for the solar-system objects of the same cone at the observation instant, always from the geocenter (code 500): SkyBoT refuses a geographic observer on every interface despite its documentation.
  The request's `bodies` choose the groups listed, every one by default: `solarSystem` (the Sun, the Moon, and the planets, SkyBoT classes Star and Planet and the satellite Moon, which take the `SkyObjectRef` and the id of their body in the sky API, so they open in the Sky workspace), `satellite` (the other natural satellites), and `minorBody` (asteroids, dwarf planets, and comets);
  SkyBoT's object filter asks only for the classes needed, and the Sun, the planets, and the satellites, which it lists together, are sorted afterwards.
  When the header locates the image, every position, the motion ends included, is moved by the parallax of that site at its own instant (`geocentricToTopocentric` of `core/src/astronomy/coordinates/astrometry.ts`) from SkyBoT's geocentric distance;
  without a site, or for a body without a distance, it stays geocentric, with a warning.
  The search runs within 20 s (`timeout`; a failure of the service is `providerFailed`; cancelling aborts the request).
  SkyBoT fails a whole answer when it cannot compute an ephemeris of a planet or a satellite of the field, so a failed search that asks for both planets and minor bodies is repeated once for the asteroids and comets alone, within the same 20 s, and completes with a warning that the planets and their satellites are missing;
  a search of those groups alone fails with the message of the service.
  No other retry, fallback to another service, or background search exists.
  It is refused at submit (422 `contextUnavailable`) without an observation date, outside SkyBoT's epochs (1889 to 2060), for a cone beyond its 10° radius, or with no group.
  Kept objects are those on the image, at most 1000, brightest first, with SkyBoT's J2000 position, magnitude, position uncertainty, and motion during the exposure from its rates;
  a satellite or minor body has no `SkyObjectRef`: SkyBoT gives no SPK-ID.
  The magnitude limit never filters them.
  Every position says where it is seen from (`center` of the object and of the observation: `geocentricCorrected` computed for the geocenter and moved by the parallax of the site, `geocentric`), so a fallback is never shown as a topocentric prediction, and the observation carries the `site` used (latitude, longitude, elevation, and the keywords it came from).
  `GET /api/images/:id/annotations/context` gives the observation date and site of an image header (`AnnotationImageContext`) before any run.
  In the panel, Source & Status shows that date (UTC, with its keyword, or the current time without one) and the site with its keywords, the Solar System Bodies section the groups to list and how the positions will be seen;
  Find is disabled for an image without an observation date or with no group chosen.
  Its objects are listed and drawn with the local ones (the Sun, Moon, and planets as a diamond, a satellite as a smaller one, an asteroid or comet as a cross, the uncertainty as a dashed circle once larger than the marker);
  a satellite does not open in the Sky workspace, and Find in SBDB and Open in Sky looks the selected minor body up by its number or designation (`/api/sky/minorbodies/search`) and opens it only when SBDB knows exactly one body;
  a match is never guessed from a position.
- Limitations: the catalog is not complete to any magnitude, and the stars are those of the embedded catalog only;
  solar-system bodies need the network and SkyBoT, and their positions are predictions, not detections;
  the planets of a field SkyBoT cannot compute are not listed by any other source;
  no artificial satellites or nebula outlines;
  without a site in the header the Moon may be up to a degree off;
  the outline of a deep-sky object is the ellipse of its catalog axes, a dashed circle without an orientation;
  Open in Sky shows the object at the time of the Sky workspace, not of the image;
  there is no annotated image export (the overlay is drawn by the viewer only, and Save As writes the scientific pixels unchanged).
