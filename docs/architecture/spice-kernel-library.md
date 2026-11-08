# SPICE Kernel Library Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Library (`api/src/spicekernels.ts`, `SpiceKernelLibrary`): one server-global set of SPK files, shared by every profile and tab; selecting a tab or switching profiles changes nothing in it.
  Files come only from explicit actions of an operator: a curated NAIF download (`POST /api/spice-kernels/download` with the id of an entry of `SPICE_KERNEL_CATALOG`, `spicekernels.catalog.ts`, never a URL; the reviewed entries, whose segments that module documents, are `de440s.bsp`; the NAIF/JUICE `jup365_19900101_20500101.bsp`, the JUP365 Galilean satellite ephemeris for 1990-2050 with its own planetary segments; NAIF's `sat480.bsp`, Saturn's centre for 1950-2050, enough for the Saturn planner's rings; and NAIF's `sat441.bsp`, the SAT441 Saturnian satellite ephemeris for 1749-2250 with its own planetary segments, the only NAIF source of Saturn's major moons), a Horizons small-body generation (`POST /generate` with the canonical SBDB SPK-ID, an optional designation, and an interval in Unix milliseconds), or an upload (`POST /import?name=` with an `application/octet-stream` body).
  No position, event, or locator request ever downloads, generates, or resolves anything remotely for a kernel.
- Storage (`spicekernels.store.ts`): every file is streamed into `spice-kernels/staging/<id>.part` of the data directory while it is hashed, never buffered whole (`MAX_SPICE_KERNEL_BYTES`, 1 GiB, enforced while reading; the app's server reads request bodies up to that limit plus 1 MiB, so an oversized upload gets the library's `413 tooLarge`), inspected, renamed into `spice-kernels/objects/<sha256>.bsp`, and only then recorded in `spice_kernels` and `spice_segments` in one transaction.
  An identical file is one kernel: adding it again answers the installed one with `alreadyInstalled`.
  The display name of an upload is its base name, never a path; responses and events never carry a server path.
- Inspection (`openSpiceKernel`, `spicekernels.runtime.ts`): the toolkit's `readDaf` and `inspectSpk` list every segment (target, center, frame, data type, coverage in TDB seconds past J2000) without evaluating it, so a file with unsupported segments is stored and listed, its segments marked `dataType` or `frame`.
  A file that is not an SPK, or whose descriptors are inconsistent, is rejected (`422 invalidSpk`) and leaves nothing behind.
  A generated file must contain a segment for the requested SPK-ID (`generationFailed` otherwise).
- Jobs (`spicekernels.jobs.ts`): downloads and generations run one at a time in submission order, at most `MAX_QUEUED_SPICE_KERNEL_JOBS` (8) waiting (`503 queueFull`);
  a submission with the intent of a queued or running job (the same entry, or the same body and interval) joins it.
  States `queued`, `running`, `validating`, `publishing`, `completed`, `failed` (with a message and a `SpiceKernelErrorCode`), and `cancelled` (`POST /jobs/:jobId/cancel`).
  Downloads follow no redirect and time out after 30 minutes; generations go through the shared JPL queue with its User-Agent, throttling, and cancellation, and a throttled or busy queue fails them as `rateLimited`.
  Jobs live in memory: they outlive the tabs but never a restart, and their staging files are cleared at the next start.
- Runtime (`spicekernels.runtime.ts`, `SpiceKernelRuntime`, shared through `spiceKernels` of `api/src/sky/index.ts`): the open files of the enabled ready kernels and an immutable `SpiceKernelSnapshot` (generation, policy, the toolkit's prepared `SpkKernelSet`, readiness by kernel).
  Every change (add, enable, disable, reorder, verify, delete, policy) is serialized, prepares a complete new set beside the current one, swaps the reference, and only then closes the files that left;
  a failure leaves the previous generation in force.
  Evaluation is synchronous from `current()` to its result, so a calculation never mixes generations or reads a closed file, and a deleted file is unlinked only after its handle is closed (with retries on Windows).
- Load order: `priority`, from 0, the higher taking precedence where segments of the same body overlap, as a file loaded later in SPICE; within a file the later segment wins.
  Selection is the toolkit's NAIF rule for each body of the chain, whatever its center;
  an unsupported selected segment makes the body unavailable rather than falling back to a lower one, a system barycenter is never taken for its planet, and coverage is never extrapolated across gaps or ends.
- Readiness (`SpiceKernelSummary.readiness`): `ready` when every evaluable segment resolves to the barycenter at the middle of its coverage, `missingDependency` with `missingBodies` when a center is provided by no enabled kernel (a heliocentric small body needs a planetary kernel with the Sun; nothing is downloaded for it), `unsupported`, `disabled`, `loading` at start, `invalid` (hash mismatch or unreadable, with `failure`), and `missing` (file gone).
  `POST /:id/verify` hashes and inspects the file again, never downloading it.
- Start (`startSpiceKernels`, called by the app after `startDatabase`): in the background, clears staging, finishes pending deletions, marks kernels whose file is gone as missing and those whose hash changed as invalid, and publishes the first generation;
  until then the Sky uses its other sources.
  A corrupt file never stops the server.
- Events: `spiceKernels:changed` (epoch of the process and a new revision) after every change, and `spiceKernels:jobUpdated` with the job, its progress published at most four times a second;
  tabs read the snapshot (`GET /api/spice-kernels`, `SpiceKernelLibrarySnapshot`) again.
- Sky (see [Sky Map Contract](sky-map.md)): `SkyEphemeris` reads `current()` once per position or events calculation and evaluates it synchronously, so an in-flight request finishes on the generation it started with.
  The Observing Planner reads it once per minor-body trajectory and copies every node it needs before the analysis, with the generation and policy in the keys of its trajectories.
  The Jupiter Observing Planner reads it before each chunk of a computation and restarts when the generation changed (see [Jupiter Observing Planner Contract](jupiter-observing-planner.md)), with the generation and policy in the keys of its answers;
  the Saturn Observing Planner does the same for each scope (see [Saturn Observing Planner Contract](saturn-observing-planner.md)).
- Not provided: CK, SCLK, FK, PCK, LSK, and mission kernels, frames other than J2000, SPK data types other than 2, 3, 9, and 21, catalog discovery beyond the curated entries, automatic updates or downloads, and the visualization of spacecraft.
