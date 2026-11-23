# Plate Solving

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Plate solving finds where an image document points, its scale, and its orientation, as a WCS solution, through ASTAP, Astrometry.net Local, Astrometry.net Online (nova.astrometry.net), or the built-in Nebulosa solver.
`PlateSolvingService` (`api/src/platesolving.ts`, hints in `api/src/platesolving.hints.ts`, Nova in `api/src/platesolving.nova.ts`, the built-in solver in `api/src/platesolving.native.ts` on its worker `api/src/platesolving.worker.ts`, its downloadable index bands in `api/src/platesolving.downloads.ts`) solves for every consumer.
Images → Plate Solver (`web/src/images/PlateSolverPanel.tsx`, `web/src/platesolving/`) solves by hand, chooses the solution shown, and offers the astrometric tools built on it: measurements and markers, target offset, the context menu, and Sync Mount.

## Purpose

Knowing exactly where the camera points is the base of every astrometric feature: polar alignment, centering, pointing models, annotation, and measuring on the sky.
One service gives all of them the same solve, hints, and acceptance rules.

## Relations

- An analysis job of the [Shared Image](shared-image.md) store; the service holds no device.
- Consumers: the Plate Solver, [TPPA](tppa.md), [iPolar](ipolar.md) (which may solve private pixels of a frame), [Mount Pointing Model](mount-pointing-model.md), and [Target Centering](target-centering.md).
- Its solutions feed [Annotation](annotation.md), [Streak Detection](streak-detection.md), the [Star Profile Inspector](star-profile-inspector.md), the celestial [Overlay](overlay.md), and Mount Nudge, whose pad moves by the orientation of the latest solved frame of the camera.
- Providers are configured in [External Tools](external-tools.md); Nova uploads the image to the Astrometry.net web service.
- The built-in solver is the toolkit's native solver (`core/src/astrometry/solvers/native.ts`): it detects the stars of the image with the toolkit's detector, searches the quad index files of its index folder (Nebulosa `.nqi` tiles, written by `bun make:quads`, and Astrometry.net index files) and, around a known position and scale, the quads it builds from the largest ASTAP or HNSKY star database of its star database folder.
- Its index folder defaults to a folder of the data directory, into which the settings of the built-in solver download bands of `.nqi` tiles built from a star database (ASTAP D20) and shared on Google Drive.
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
- ASTAP may not write SIP terms, only Nova and the built-in solver take a scale tolerance, and the following of a Nova job does not survive a restart.
- The built-in solver runs one solve at a time on one worker, which keeps the indexes of its folder open between solves until their files change; a cancel stops it between slices of the search, while the star detection and the opening of an index cannot be interrupted.
- The built-in solver searches the star database only when the index files found nothing and both a position and a scale are known; without index files it cannot solve blind.
- An index file or subfolder that cannot be read is skipped with a warning of the result, and of two files of one tile the one holding more quads is searched; Astrometry.net index files are read whole where they cannot be mapped (on Windows), so a folder holding many of them needs that much memory once a field uses them.
- The cache of a solve does not follow the contents of the folders of the built-in solver, so a solve repeated after its index files changed by hand answers with the kept result; a band installed or removed by the downloads makes the next solves search again.
- A band is downloaded only on an explicit request, one at a time, and replaces the installed files of its band only once its archive has the size and SHA-256 of the catalog; a download does not survive a restart, and the downloaded bands are searched only while the Index Folder is empty or holds the default folder.
