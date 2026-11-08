# Plate Solving Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- One service, `PlateSolvingService` (`api/src/platesolving.ts`), solves an image document for every consumer: Images → Plate Solver, TPPA, iPolar, mount pointing sessions, and Target Centering.
  Captures never solve their frames.
  Providers are ASTAP, Astrometry.net Local (`solve-field`), and Nova Astrometry.net, each resolved once per job from [External Tools](external-tools.md); a request never names an executable or a URL.
  A provider never falls back to another, so a local failure never uploads an image.
  The libastrometry FFI binding is not a provider (see [External Tools Contract](external-tools.md)).
- Strategies: `assisted` searches around a position, `blind` over the whole sky.
  Hints (`api/src/platesolving.hints.ts`) come from the operator, then from the header pointing (RA/DEC, OBJCTRA/OBJCTDEC, RA_OBJ/DEC_OBJ, CRVAL1/CRVAL2) and the optics (XPIXSZ after binning over FOCALLEN); a position without a radius gets 10°.
  A blind solve sends no position but keeps a known scale, and its FITS copy leaves the pointing keywords out so ASTAP cannot use them.
  The current mount position is never a hint; a mount pointing session hints the position it commanded, explicitly.
  Every job keeps the hints it used with their origins.
  Angles are radians; the scale is radians per pixel.
- A result keeps the whole WCS header of the solver as the toolkit's `PlateSolution` (ICRS center, scale, orientation, parity, field size).
  It is accepted only when `plateSolutionFrom` proves it (equatorial TAN or TAN-SIP, ICRS or FK5 J2000) and its image size is the document's, within 1 px (ASTAP rebuilds NAXIS from CRPIX); otherwise the job fails as `invalidSolution`.
  A solver that ended normally without a WCS completes with `outcome: noSolution`, which is not a failure.
  The WCS a header already had is reported apart (`GET /api/images/:id/plate-solutions`, `header`) and never replaced; no file is written.
- Jobs are the analysis jobs of the [Shared Image Contracts](shared-image.md), with one ASTAP and one solve-field process and two nova solves at a time.
  An equivalent request (image, provider, strategy, effective hints, tolerance, downsampling, provider settings, pixels) is answered with the job still waiting or running, or with its kept result (200 for both), so a double click, a second tab, or a retry never solves twice.
- A consumer inside the process may hand a job private pixels (`PlateSolvePixels`: a FITS of the same size and pixel grid, with a fingerprint such as `dark:<masterId>:<digest>`), solved in place of the copy of the image, as iPolar does with a frame less a master dark.
  The job stays the image's: it retains the image, takes its hints from its header, checks the size against it, and keeps its result under its id, so the camera tab and the Plate Solver see the WCS on the frame itself.
  The fingerprint is part of the equivalence, so a solve of the image itself and one of its private pixels are never answered for each other; private pixels never become a document, and no route takes them.
  The service itself never syncs, slews, or centers a mount; Target Centering does that with what it measures.
- Nova (`api/src/platesolving.nova.ts`) uploads the FITS copy once, as a private submission, publishes the stages `uploading`, `submitted` (submission id), `solving` (job id), and `retrieving`, polls every 5 s, and gives up after 3 failed requests in a row (`network`) or at the provider timeout.
  An upload refused for its session is `sessionExpired`.
  Cancel stops following the remote job only, and says so.
  The following of a nova job does not survive a restart, and nothing is uploaded again.
- Routes are `POST /api/images/:id/plate-solving` (`422 notConfigured` when the provider is not configured) and `/api/plate-solving`, and the event `plateSolving:updated` without the WCS;
  instead of a list of kept jobs, `GET /api/images/:id/plate-solutions` gives the header's WCS and the kept completed jobs, and `GET /api/images/:id/plate-solving/hints?strategy=` the hints an image would use.
- Images → Plate Solver (`web/src/images/PlateSolverPanel.tsx`, store `web/src/platesolving/platesolving.ts`) edits the document's hints and the settings the profile shares between the documents (`imagePlateSolving`), and sends them only with Solve Image;
  on a camera tab it edits the plate solving settings of the physical camera instead (`CameraSettings.plateSolving`, `effectivePlateSolveRequest`), which TPPA, iPolar, and the other operations of that camera apply, keeping only the hints in the document, so a typed position never reaches an operation;
  the request is editable before the document has an image (`imageUnavailableReason` says why), with Solve Image disabled until it has one.
  The solution shown is the latest submitted job of the image unless the operator chose another one or the header's (`ImagePlateSolvingState.selected`), so a job that ends never replaces a chosen solution;
  the choice is offered whenever the image has a header solution, even before any solve, or more than one completed job (`solutionOptions`), and a header solution is never shown unless chosen;
  results are fetched only for the image shown.
  Zoom, pan, stretch, and the overlay toggles never solve.
  The solution shows the position angle of the image top (`imageTopPositionAngle`, the sky direction of the top edge as the viewer draws it, at the reference pixel), the same quantity as the Rotation of Sky Framing;
  `solution.orientation` is the solver’s own angle and is not shown.
- Operation integration: `PlateSolvingService.solve(imageId, request, signal, origin)` resolves to the result of that image (a search without a solution completes with `outcome: noSolution`), whatever newer frame arrives, cancels with its signal, and throws `PlateSolvingError` with the job code otherwise;
  a preparation resolved once keeps the provider settings of a whole session.
  TPPA jobs carry the `tppa` origin (session, camera, frame id, and the pose during acquisition), iPolar jobs the `ipolar` origin (session, camera, frame id, and the step: `reference`, `second`, or `refinement`), mount pointing jobs the `mountPointing` origin, and Target Centering jobs the `targetCentering` origin (session, camera, frame id).
- Sync Mount (the Mount section of Images → Plate Solver, shown with a solution) syncs the MOUNT of the active equipment setup on the centre of the solution shown, after a confirmation, through `POST /api/connections/:id/mounts/:deviceId/sync`: the ICRS centre is sent as J2000 in decimal hours and degrees (`mountSyncTarget`).
  It is offered only while the mount is connected, can sync, is not parked, and no operation or command holds it (`mountSyncBlocker`); the server checks again.
  This action only syncs: it never slews or centers the mount.
- Coordinates read from a solution are in its own frame: `wcsFrame` (`web/src/platesolving/wcs.ts`) names it `ICRS` or `FK5 J2000` from RADESYS, else EQUINOX, and every label shows it;
  the toolkit takes FK5 J2000 as the ICRS (within 0.03″) but the UI never relabels it.
  Separations and position angles (`skyOffset`) use the toolkit's atan2 formulas (`sphericalSeparation`, `sphericalPositionAngle`), from north through east, undefined for coincident or antipodal positions.
- Measurements and markers (`web/src/platesolving/measurement.ts`, state `ImageViewState.astrometry`, tool `web/src/images/astrometryTool.ts`) are kept per document as points in viewer pixels, kept inside the image, never as sky positions, in tab memory only: their values are computed again from the selected solution, so choosing another one keeps what was pointed at, and a point it cannot unproject makes them unavailable.
  A camera tab clears them when it shows another frame.
  A distance reports its great-circle separation, the position angle from north through east, ΔRA and ΔDec (a difference of right ascension, not an angle on the sky), the gnomonic east and north offsets of its end around its start, and its length in pixels, and is drawn along the great circle through the WCS.
  A rectangle is axis-aligned in image pixels, not in right ascension and declination: it reports the great-circle lengths of its four sides, of its two centre lines (between the midpoints of opposite sides), and of its diagonals, and its size in pixels, since one width would mislead under distortion.
  A circle has a constant angular radius on the sky around its centre, set by a rim point: its outline is that small circle sampled at every position angle (`CIRCLE_VERTICES`) and projected through the WCS, so it may look elliptical, and it reports its radius, diameter, and centre;
  a degenerate or unprojectable one is unavailable.
  A marker is a fixed point with its coordinates in the WCS frame and its zero-based pixel.
  The measure mode of the viewer toolbar (per document, Pan by default, disabled without a solution or while Guiding picks a star) owns every press: a drag draws, or a click then a second click, and a click places a marker;
  with the Plate Solver tool shown, presses on a handle (12 px: the points of a distance or circle, the corners and edge midpoints of a rectangle) or a marker drag it in any mode and a click selects the item whose outline is under it, the rest pans.
  The gesture in progress lives in its own store, so drawing renders only its overlay; Escape drops it, then leaves the mode, then clears the selection, and Delete removes the selected item.
  The Measurements and Markers sections of the panel list them with their values, and rename, hide, delete, and clear them.
- The context menu of a solved image (`web/src/images/ImageMenu.tsx` over the generic `ContextMenu` of `web/src/ui/`, opened by a right click or a long press on a point inside the image; elsewhere the browser's own menu is kept) copies the point's right ascension and declination with the frame's name, or its zero-based pixel, adds a marker there, or starts a distance from it (Measure From Here);
  the drawing actions are disabled while Guiding picks a star.
  Every action uses the point the menu opened on.
  Copies go through `copyText` (`web/src/clipboard.ts`): the Clipboard API where the context is secure, otherwise a selection copied by the browser, since the app is usually opened over plain HTTP on the local network;
  a copy that fails keeps the menu open and says so.
- Target Offset (`web/src/images/TargetOffsetSection.tsx`, drawn by `web/src/images/TargetOffsetOverlay.tsx`, values `targetOffset` in `web/src/platesolving/measurement.ts`) is read only: it reports the offset of one target per document from the solved centre of the image (the separation, the position angle from north through east, and the east and north offsets on the plane tangent at the centre), and where the target falls in the image.
  The target is a marker of the image (located with the selected solution), a right ascension and declination typed in the frame of the solution, or the catalog star or deep-sky object selected in Sky, taken at its J2000 catalog position, epoch J2000.0, without proper motion;
  solar-system bodies, minor bodies, constellations, and the mount are refused with the reason.
  Inside the image the target is a ring with a dashed line from the centre; outside it, an arrow at the border along the direction towards it, labelled with the separation.
  Its values follow the selected solution; a marker target is dropped with its marker or when a camera tab shows another frame (which clears the markers), while a typed or Sky target is kept across frames.
  It never changes the Sky selection and nothing is sent to a mount.
- Limitations: only TAN and TAN-SIP solutions in the ICRS or FK5 J2000 are accepted;
  ASTAP may not write SIP terms;
  solve-field applies its own ±30% scale window and only nova takes `scaleTolerance`;
  ASTAP's "not enough stars" (exit code 2) is reported as a search without a solution.
