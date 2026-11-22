# Plate Solving

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Plate solving finds where an image document points, its scale, and its orientation, as a WCS solution, through ASTAP, Astrometry.net Local, or Nova Astrometry.net.
`PlateSolvingService` (`api/src/platesolving.ts`, hints in `api/src/platesolving.hints.ts`, Nova in `api/src/platesolving.nova.ts`) solves for every consumer.
Images → Plate Solver (`web/src/images/PlateSolverPanel.tsx`, `web/src/platesolving/`) solves by hand, chooses the solution shown, and offers the astrometric tools built on it: measurements and markers, target offset, the context menu, and Sync Mount.

## Purpose

Knowing exactly where the camera points is the base of every astrometric feature: polar alignment, centering, pointing models, annotation, and measuring on the sky.
One service gives all of them the same solve, hints, and acceptance rules.

## Relations

- An analysis job of the [Shared Image](shared-image.md) store; the service holds no device.
- Consumers: the Plate Solver, [TPPA](tppa.md), [iPolar](ipolar.md) (which may solve private pixels of a frame), [Mount Pointing Model](mount-pointing-model.md), and [Target Centering](target-centering.md).
- Its solutions feed [Annotation](annotation.md), [Streak Detection](streak-detection.md), the [Star Profile Inspector](star-profile-inspector.md), the celestial [Overlay](overlay.md), and Mount Nudge, whose pad moves by the orientation of the latest solved frame of the camera.
- Providers are configured in [External Tools](external-tools.md); Nova uploads the image to the Astrometry.net web service.
- On a camera tab the settings belong to the physical camera and are shared with the operations of that camera.
- The toolkit (`core`) parses and proves the WCS and does the spherical geometry.
- Sync Mount syncs the mount of the active equipment setup on the solution shown, through the mount commands; Target Offset may take its target from the [Sky Map](sky-map.md) selection.

## Rules and Limitations

- Captures never solve their frames, and the service never syncs, slews, or centers a mount; Sync Mount only syncs, after a confirmation.
- A provider never falls back to another, so a local failure never uploads an image.
- The current mount position is never a hint; a mount pointing session hints the position it commanded.
- Only TAN and TAN-SIP solutions in the ICRS or FK5 J2000 of the document's size are accepted; a header's WCS is never replaced and no file is written.
- Coordinates are shown in the frame of their solution, never relabelled.
- Measurements and markers are kept as image points in tab memory and recomputed from the selected solution.
- ASTAP may not write SIP terms, only Nova takes a scale tolerance, and the following of a Nova job does not survive a restart.
