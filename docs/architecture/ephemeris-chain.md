# Ephemeris Chain Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Chain (`api/src/ephemeris.chain.ts`): every computation of solar-system positions in the server takes all its states from one source, tried in the order of its mode.
    - `fast` (maps, planners, events, eclipses, almanacs, dense sweeps): the SPK kernels of the SPICE Kernel Library, then the analytical theories, then JPL Horizons.
    - `accurate` (the selected object of the Sky, mount targets): the SPK kernels, then JPL Horizons, then the analytical theories.
    - The analytical theories are VSOP87E, ELPMPP02, Pluto, L1.2, TASS 1.7, `eraEpv00` with `eraMoon98` corrected by ELPMPP02 for eclipses, and the two-body Kepler orbit of SBDB elements for a minor body.
- A computation offers only the sources it can use, and a source it does not offer is skipped without an attempt.
  Dense sweeps (Jupiter, Saturn, Planetary Events, eclipses, Sky events) offer no Horizons, since Horizons per instant is impractical and their theories always exist; a minor body without elements offers no theory.
- The kernels are tried when the set has a segment for every body the computation needs (`EphemerisBody`: the target, and the Earth and the Sun an apparent place is reduced with, marked as dependencies), and are used only when they resolve every state of the whole computation.
  A state they miss at one epoch (`EphemerisKernelMiss`, or a planner's own miss class) discards the computation, which runs whole on the next source, so one computation never mixes sources.
  A file that cannot be read is logged and treated as a miss (`kernelReadFailed`).
- The kernel snapshot is read once per computation and evaluated synchronously; a chunked computation yields to the event loop between chunks, checks its abort signal, and restarts from the first chunk when the kernel generation changed, at most twice, then fails with `generationChanged`.
- Offline switch (`offline` of the SPICE Kernel Library snapshot, `PATCH /api/spice-kernels/settings` with `{ offline }`, stored in `spice_settings`): while on, no automatic request reaches JPL.
  Horizons is removed from every chain, so a computation only Horizons could give fails with `offline`; a minor body is resolved from the SBDB answers already cached, never asking SBDB.
  Downloading or generating a kernel, explicit acts of an operator, still use the network.
- Horizons is asked through the shared JPL queue (see [Sky Map Contract](sky-map.md)) with one `HorizonsCircuitBreaker` per service: three consecutive transient failures (timeout, network) skip Horizons for 30 s (`breakerOpen`); a refusal of the queue is a `timeout` that never counts against the breaker; a semantic failure (an unknown target, an empty answer) is reported as is, never replaced by another source.
- Provenance (`EphemerisProvenance`): the source that gave the computation (`spk`, `analytical`, or `horizons`), the mode, the kernels used with their generation for `spk`, and the `attempts`, the sources tried before it in order, each with its reason:
    - kernels: `loading`, `noKernel`, `targetMissing`, `missingCenter`, `outOfCoverage`, `unsupportedFrame`, `unsupportedType`, `cycle`, `kernelReadFailed`, with the requested body, the NAIF code where resolution stopped, and the epoch when one was evaluated;
    - theories: `noModel`;
    - Horizons: `offline`, `timeout`, `network`, `breakerOpen`.
- No source (`EphemerisUnavailableError`, answered `503` by `ephemerisUnavailableResponse` with `code` and `attempts`): `offline` when the offline switch removed Horizons, `sourceUnavailable` when Horizons failed, `coverageUnavailable`, `unsupportedKernel`, or `missingDependency` when only the kernels were offered, and `generationChanged`.
- Results are cached with the kernel generation in their keys (or the source key of `EphemerisContext`: `analytical`, `horizons`, or `spk:<generation>`), so a change of the kernels or of the offline switch, which publishes a new generation, computes them again.
- Users:
    - Sky positions (`SkyEphemeris`, see [Sky Map Contract](sky-map.md)): the mode of the request, accurate by default; the map asks fast. Sky events: fast, without Horizons.
    - Mount slews (`MountCommands.slew`): accurate, with the `source` and `attempts` in `MountSlewResponse`.
    - Jupiter, Saturn, and Planetary Events (`withSatelliteSource` of `api/src/planetary.source.ts`): fast, kernels then theories, with their own `PlanetarySource` shape (`fallbackReason` is the kernels' attempt).
    - Solar and lunar eclipses (`eclipseEphemeris` of `api/src/eclipses.ts`): fast, kernels then theories, with the provenance in the map and local answers.
    - The minor bodies of the Observing Planner keep a chain of their own (see [Observing Planner Contract](observing-planner.md)), and the Astro Weather nights, the almanacs, meteor showers, and the Sun of the satellites use the theories alone.
