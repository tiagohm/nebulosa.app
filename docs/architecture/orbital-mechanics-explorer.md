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

`api/src/orbitalmechanics.ts`, stateless: no operation, event, store, database row, or network access, and requests carry the whole definition, so every answer is reproducible from its request.
The tool checks what it sends, so requests are taken as valid; scientific outcomes of the model are `422` with an `OrbitalMechanicsErrorCode`: `degenerateOrbit` (position and velocity parallel), `outOfRange` (an offset beyond the solver's range), `solverFailed` (no convergence or a non-finite state).
Every number answered is finite.

- `GET /api/orbital-mechanics/reference`: the centers, the presets (`orbitalmechanics.presets.ts`), and the limits (supported instants, 2048 points or states per sample, 8 orbits at once).
- `POST /api/orbital-mechanics/solve` (`OrbitSolveRequest`): the exact state, elements, diagnostics, and warnings at `at` (default the anchor), the `fingerprint` (a hash of the definition) the values belong to, and for an open orbit the `arc` it plays by default, the instants it is at 20 periapsis distances inbound and outbound.
- `POST /api/orbital-mechanics/trajectory` (`OrbitTrajectoryRequest`): the conic as a curve (the whole ellipse, its last point repeating the first, or a finite open arc out to `maxRadius`, by default 20 periapsis distances, strictly inside the asymptotes), with its apsides and the nodes on the requested plane, and the exact chronological states over `[start, end]`, refined until a cubic Hermite through neighboring states is within 1e-6 of the distance; either stops at 2048 points and says `truncated`.

## Presets

Each preset names its center and whether it is `illustrative` (an invented orbit showing one kind of conic) or `sourced` (published elements at their own epoch, with a citation): circular low Earth orbit, Molniya-type, retrograde, highly eccentric, near-parabolic, exact parabolic, hyperbolic, the J2000 mean elements of the Earth–Moon barycenter (Standish and Williams 1992, valid 1800–2050), and 1P/Halley (JPL SBDB orbit solution 75, epoch 1968-Jan-20 TDB).
A sourced preset is still a two-body model of its elements, accurate near its epoch only.
