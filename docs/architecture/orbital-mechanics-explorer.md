# Orbital Mechanics Explorer Contract

The Orbital Mechanics Explorer (`/tools/orbital-mechanics-explorer`) is a two-body laboratory: an orbit is built from classical elements or a Cartesian state, drawn in 3D, played in time, and inspected.
It is an educational and analysis surface, not an ephemeris: every trajectory it computes is the two-body motion about one center, with no perturbation, and it never says otherwise.
It is not a mission planner, an orbit determination, an N-body integrator, an apparent-position calculator, or a collision or impact predictor.
It changes no other tool's state: not the Sky's time, the observing site, the profile, the SPICE library, or any device, and it holds no operation or device reservation.

## Model

- One canonical model (`core/src/astronomy/orbits/mechanics.ts`): a `KeplerOrbit` whose state is geometric, relative to the center, in J2000 equatorial (ICRF-aligned) axes, with an identity output rotation, propagated by the toolkit's universal-variable solver.
  The browser never solves Kepler's equation: it draws what the server sampled and interpolates between exact states only to place the body on screen.
- Definitions (`OrbitDefinitionPayload`), each with the center's gravitational parameter `mu` in AU³/day²:
    - `elliptic`: semi-major axis, eccentricity `0 ≤ e < 1`, inclination, node, argument of periapsis, mean anomaly at an epoch;
    - `parabolic`: periapsis distance and time of periapsis passage, `e = 1` exactly, with no semi-major axis, period, or mean anomaly;
    - `hyperbolic`: periapsis distance, eccentricity `e > 1`, and time of periapsis passage;
    - `cartesian`: position and velocity in J2000 equatorial axes at an epoch, never rotated.
- A conic definition names its plane, `equator` or `ecliptic` (J2000); ecliptic elements are rotated to the equator exactly once, when the model is built.
- Units on the wire: instants are Julian dates TDB (a double, about 40 µs of resolution near the present), distances AU, velocities AU/day, angles radians; `utc` fields are Unix milliseconds UTC for display.
  Supported instants are within ±10 000 Julian years of J2000 (`limits.epochMin`, `limits.epochMax`), since the solver measures offsets in TT, whose series is meaningful only there.
- The anchor of a model is its epoch, or the periapsis time of an open definition.
- Elements are reported on both planes (`elements.equator`, `elements.ecliptic`); `conic` is the numerical class (`circular` below an eccentricity of 1e-10, `parabolic` within 1e-10 of 1), which decides which elements apply, while `eccentricity` stays as computed and is never snapped.
  An angle a geometry leaves undefined is `{ defined: false, reason: 'circular' | 'equatorial' }`, never a zero: an equatorial orbit has no node, argument of periapsis, or argument of latitude, and its longitudes are measured from +X in the direction of motion; a circular one has no periapsis direction or anomaly.
  `semiMajorAxis` is negative for a hyperbola and absent for a parabola; `period`, `apoapsisDistance`, and `semiMinorAxis` exist only for a bound orbit; `periapsisTime` is the most recent passage of a bound orbit.
- Diagnostics: radius, speed, radial and transverse speeds, escape speed, specific energy, angular momentum, eccentricity vector, and the plane's normal.
- Warnings (`OrbitWarning`): `periapsisInsideCenter` and `insideCenter` compare with the center's equatorial radius, a geometric statement and not a collision prediction; `nearParabolic` marks `|e − 1| < 1e-3` outside the parabolic class.
- Centers (`ORBIT_CENTERS`): the Sun, Mercury, Venus, the Earth, the Moon, and the Mars to Pluto system barycenters, with the gravitational parameters of DE440 (NAIF `gm_de440.tpc`) and the equatorial radii of `pck00008.tpc`; a system barycenter carries the GM of the planet and its satellites.
  A custom center is defined by the operator with its own GM and radius; a GM is never inferred from a name.

## Routes

`api/src/orbitalmechanics.ts`, stateless: no operation, event, store, or database row, and requests carry the whole definition, so every answer is reproducible from its request.
Only `/resolve` with `online` asks JPL, through `MinorBodies` and the queue of the Sky Map Contract; every other route works offline.
The tool checks what it sends, so requests are taken as valid; outcomes are answered with an `OrbitalMechanicsErrorCode`: `degenerateOrbit` (position and velocity parallel), `outOfRange` (an offset beyond the solver's range), `solverFailed` (no convergence or a non-finite state), `orbitSolutionUnavailable`, `unsupportedFrame` (B1950 elements), `centerUnavailable` (a center without a DE440 GM), `kernelMissing`, `kernelCoverageUnavailable`, and `unsupportedKernel` (with the `body` and the `epoch` the kernels cannot give) as `422`; `objectNotFound` and `notCached` as `404`; `kernelReadFailed`, `serviceUnavailable`, and `rateLimited` (with `retryAfter` in milliseconds) as `503`.
Every number answered is finite.

- `GET /api/orbital-mechanics/reference`: the centers, the presets (`orbitalmechanics.presets.ts`), and the limits (supported instants, 2048 points or states per sample, 8 orbits at once).
- `POST /api/orbital-mechanics/solve` (`OrbitSolveRequest`): the exact state, elements, diagnostics, and warnings at `at` (default the anchor), the `fingerprint` (a hash of the definition) the values belong to, and for an open orbit the `arc` it plays by default, the instants it is at 20 periapsis distances inbound and outbound.
- `POST /api/orbital-mechanics/trajectory` (`OrbitTrajectoryRequest`): the conic as a curve (the whole ellipse, its last point repeating the first, or a finite open arc out to `maxRadius`, by default 20 periapsis distances, strictly inside the asymptotes), with its apsides and the nodes on the requested plane, and the exact chronological states over `[start, end]`, refined until a cubic Hermite through neighboring states is within 1e-6 of the distance; either stops at 2048 points and says `truncated`.

- `POST /api/orbital-mechanics/resolve` (`OrbitResolveRequest`): the orbit of a real object with its `source`.
    - `minorBody`: by SPK-ID, designation, or name. Offline (`online: false`) it reads only the bodies `MinorBodies` resolved recently (by any tool), by SPK-ID, and answers `notCached` otherwise, never asking JPL; online it asks SBDB, answering `ambiguous` with the candidates of a name.
      The definition is SBDB's published heliocentric J2000 ecliptic solution at its own epoch (an open orbit by perihelion distance and time, a bound one by semi-major axis and mean anomaly), propagated with the Sun's DE440 GM, with the SPK-ID, designation, solution id and date, epoch, and fetch time; B1950 elements are refused.
    - `spk`: the geometric state of an SPK target relative to a DE440 center at an instant, both barycentric states read from one snapshot of the SPICE library and subtracted (no light time), with the generation and the kernels that gave them.
      It never installs or generates a kernel: a missing kernel is reported, and the SPICE Kernel Library resolves it.
- `POST /api/orbital-mechanics/compare` (`OrbitCompareRequest`): Kepler versus SPICE.
  The osculating two-body orbit of the target's SPK state at the anchor, about the center with its DE440 GM and no rotation, is propagated to up to 2048 evenly spaced instants (with the anchor) and compared with the SPK states at the same instants, center, axes, and units: per instant |Δr|, |Δv|, and their components on the RTN axes of the SPK reference (R radial, T along-track, N along the angular momentum; Δ = Kepler − SPK, absent when undefined), both state tables, and the largest separation and its instant.
  The whole comparison is read synchronously from one snapshot, so it belongs to one library generation, named in its `source` with every kernel read; an instant a kernel cannot give fails the whole comparison, never patched by another source or interpolated.
  The residual is a difference between two models, zero at the anchor by construction, not an uncertainty of either and not a prediction of an impact.

## Presets

Each preset names its center and whether it is `illustrative` (an invented orbit showing one kind of conic) or `sourced` (published elements at their own epoch, with a citation): circular low Earth orbit, Molniya-type, retrograde, highly eccentric, near-parabolic, exact parabolic, hyperbolic, the J2000 mean elements of the Earth–Moon barycenter (Standish and Williams 1992, valid 1800–2050), and 1P/Halley (JPL SBDB orbit solution 75, epoch 1968-Jan-20 TDB).
A sourced preset is still a two-body model of its elements, accurate near its epoch only.

## Tool

`web/src/tools/orbitalmechanics/`, `/tools/orbital-mechanics-explorer`, icon `orbit`.

- State: a tab-lived valtio proxy, `orbitalMechanicsState` (`orbitalmechanics.ts`), never persisted and never in `SERVER_STORES`: the reference, the shared center and its unit (km and km/s around a planet or the Moon, AU and AU/day around the Sun), the orbits (at most 8), the selected orbit, the clock, the exact inspection, the reference plane drawn, the layers, and the camera.
  The first opening of a tab reads the reference once and loads the Molniya-type preset; a preset or an imported scenario replaces the scene and frames it.
- Every orbit is about the scene's one center, in the same axes, on the same clock; changing the center solves every orbit again with its GM, as a manual orbit.
  An orbit keeps its draft (display units: degrees, the scene's unit, Julian dates TDB) apart from the last definition it sent; `draftDefinition` checks every domain the model needs (eccentricity per kind, positive distances and GM, inclination 0–180°, a non-rectilinear state, the supported instants) and says why a draft cannot be solved, keeping the last valid orbit drawn.
  Edits are solved once they rest (300 ms), and until the answer the inspector says its values belong to the previous definition.
  Changing the kind of definition carries the solved geometry over (an open orbit becomes an ellipse of eccentricity 0.5 with its periapsis, a bound one a hyperbola of eccentricity 1.5).
- Requests: the solve and the trajectory of each orbit and the inspection each run behind their own request guard, so a late answer of an older definition or instant is discarded.
- Clock: the tool's own, never the Sky's.
  The timeline of the selected orbit is one period from its anchor for a bound orbit, which loops by whole periods so the state shown is the same, or its arc (widened to the clock) for an open one, which stops at its ends.
  While it plays, each animation frame advances it by the monotonic time since the previous frame times the signed rate, at most 1 s of real time per frame, so a hidden tab never makes it jump; the default rate plays the timeline in 20 s, and the rates offered include fractions of the selected orbit's period.
- Exact versus drawn: the body on screen is interpolated between the exact samples of its track (a cubic Hermite through positions and velocities, reduced by whole periods on a bound orbit) and is a drawing only.
  The inspector shows exact values read from `/solve` for the instant it names: the clock's instant once the clock stops, steps, or is scrubbed to rest, never on every frame, or the anchor; while playing it says that the moving body is interpolated.
- Scene (`scene.ts`, `OrbitScene.tsx`): a 2D canvas with a camera orbiting a target (drag), panned (Shift or secondary-button drag, two fingers), and zoomed (wheel, pinch), perspective or orthographic, with Top, Side, Face-on (along the selected orbit's normal), and Fit.
  Display axes are those of the reference plane drawn (J2000 equator or ecliptic), right-handed with +Z up.
  Segments, the orbital-plane fills, markers, and the central body are depth-sorted, so the body hides what passes behind it.
  Layers: reference plane, orbital plane, axes, nodes and the line of nodes, apsides, position, velocity, angular momentum, eccentricity vector, labels; v, h, and e show directions only, and the center is drawn to scale or as a marker that says it is not.
  It draws only when its state changes, at most once per frame, releases its observer, listeners, and frame on unmount, and without a 2D context says so while the panel keeps every value.
  Only the canvas captures touch gestures.
- Inspector sections (`orbitalmechanics.*`): Elements (on the reference plane drawn), Geometry, Dynamics, Cartesian State, Source & Accuracy, each undefined element with its reason, and the warnings.
- Real Objects (`OrbitSources.tsx`, `orbitalmechanics.sources.ts`): Find reads a minor body by SPK-ID only from the bodies the server resolved recently, and says when only JPL can answer; Look up on JPL asks SBDB by SPK-ID, designation, or name, listing the candidates of an ambiguous name; Osculating Orbit Now starts a two-body orbit from an SPK target's state about a DE440 center at the clock's instant.
  A failure of the SPICE library offers the SPICE Kernel Library.
  A resolved orbit about another center than the scene's waits, and replaces the scene (its center, unit, plane, and clock at its anchor) only on Replace the Scene, since orbits about different centers are never drawn together.
- Handoffs: Explore Orbit of Close Approaches and of the Sky's object actions (`exploreMinorBody`) carries only the body's SPK-ID and name and opens the tool, which, once its reference is read, resolves the body offline and shows its orbit in place of the scene (the operator asked for that very orbit); when only JPL can answer, it opens Real Objects with Look up on JPL instead of asking.
  Show in Sky of a minor body's Source & Accuracy (`showMinorBodyInSky`) selects it through the Sky's own path and ephemeris, leaving the Sky's clock, the site, and every device alone.
- Compare with SPICE (`OrbitComparison.tsx`): the target (NAIF ID), the days before and after the anchor (the clock's instant), and the number of instants (2 to 2048), about the scene's center, which must be a DE440 center; the result shows the largest separation and speed difference, the kernels and generation, and SVG charts of |Δr| (km), its radial, along-track, and normal components, and |Δv| (m/s) against days from the anchor, and exports as CSV (the units in the column names, an undefined RTN component left empty) and JSON with its request.
  About the scene's center the osculating orbit is added once (source `spk`), the SPK path is drawn dashed, and the segment from the osculating body to the SPK body at the clock's instant shows the residual, both interpolated between exact states for drawing only; a comparison is never drawn about another center.
  The panel says that the difference is between two models, zero at the anchor by construction, and not an uncertainty or a prediction of an impact.
- Deferred: an SGP4 satellite source. GP elements (TLE, OMM) are SGP4 mean elements, not osculating two-body ones, and the toolkit's TEME → ICRS conversion (`frameToFrame`) rotates velocities without the transport term of a rotating frame, so a satellite is never mixed with these orbits; Artificial Satellites keeps its own SGP4 views.
  Impulsive maneuvers, transfer and Lambert solvers, perturbations, N-body integration, covariance, and orbit determination are out of scope.
- Exchange: Export Scenario writes `nebulosa-orbital-mechanics-scenario` version 1 (center, plane, clock, rate, layers, and each orbit's name, color, visibility, source, and definition in radians, AU, AU/day, and Julian dates TDB); Import checks its kind and version and runs every orbit through `draftDefinition` against its center, refusing the whole file with the reason otherwise.
  Export CSV writes the exact states received for the selected orbit (RFC 4180), with the units in the column names and the frame, origin, GM, model, and source in columns of their own; interpolated positions are never exported.
