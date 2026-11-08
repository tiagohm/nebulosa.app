# Capture–Sequencer Compatibility Report

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- There is no sequencer engine to integrate.
  It will be an `api` service that orchestrates the tools as they are: it decides when and why a tool runs, and calls the same application services the manual screens call (Camera Acquisition, Auto Focus, Guiding, Target Centering, the device commands), never `CameraCapturer` or a commander directly.
  How a tool operates its equipment (capabilities, device commands, resources, cleanup, progress, outcome) stays in the service that owns it;
  a direct `CameraCapturer` or commander call belongs only inside such a service, for the auxiliary exposures and moves of its own procedure.
- Each tool stays usable on its own and never knows the sequencer.
  A caller composes tools under one reservation of the `ResourceArbiter` (`reserve`, `reservedScope`, `tokenScope`, `drainByReservationOwner`, `cancelByReservationOwner` of `nebulosa`), which is the only arbitration: no second lock, queue, or busy flag.
- A command's outcome is what its service returns for the exact request it admitted, never a `202`, an event, a notification, or the latest session of a camera, which a newer session replaces.
- Nothing survives the process: a crash, stop, or reload ends every run, and nothing is checkpointed, replayed, or resumed (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
  Saved frames stay on disk, and a person starts a new run.
  No table is added for plans or runs before the sequencer itself.
- Camera Acquisition (`api/src/captures.ts`): a start carries a token (`CaptureStartRequest`, `nanoid` of `startCapture`), so a repeated request answers the session it started and never exposes again.
  `admit(connectionId, deviceId, request, { invocation, beforeFrame })` is the start of a caller inside the process: it answers a `CommandRefusal` or the session and operation ids, `started` (the toolkit's first dispatch), and `ended`, the final session once the capture released the camera (`completed` or `stopped`, where with Preview + Save `saved` equals `captured` since a failed write fails the capture; `aborted`; `failed` with reason and error).
  The service remembers the last 256 captures by operation id (a repeated token of a forgotten one answers `404`), so `ended` and a repeated token outlive the latest session of the camera, which the snapshot and the events keep showing.
  `beforeFrame` is the toolkit's asynchronous gate, awaited after the frame sink's (Live Stacking) and the capture's own dither before each next frame and never before the exposure in flight; its failure ends the capture.
  A request that dithers (`CaptureRequest.dither`) keeps its own cadence inside the capture, so an orchestrator that dithers between capture blocks itself sends none;
  the dithering service (`CaptureDithering` of `api/src/dithering.ts`) is the boundary it would call for that.
  Stop and abort name the session: the routes take `{ sessionId }` (`CaptureControlRequest`) and answer 404 when the camera runs another session, and `stopSession` and `abortSession` are their in-process form, so a late command never reaches the session that replaced its own.
  `suspendForMotion(sessionId, { id, holder, reservation }, signal)` pauses a running capture a tab started for a tool of the process: its camera joins the tool's reservation at once (the capture as guest), the pause takes effect at the next frame boundary (the frame in flight exposed, received and written, before the frame sink's gate and the dither of the next frame), the reservation of its Mount dithering is lent too, and the session publishes `phase: 'paused'` with `suspension: { holder, state }`.
  The returned `CaptureSuspensionHandle` (server only) `reclaim`s, `resume`s (the next frame, its dither run once), or `release`s the capture (camera taken back, paused for the operator, who resumes it with `POST /api/connections/:id/cameras/:deviceId/capture/resume { sessionId }` or stops it).
  The session id, counters, file sequence and dither cadence carry on, frames of the tool never count as the capture's nor reach the frame sink, a stop or abort while paused ends it without commanding the lent camera, and a capture admitted under a reservation is never paused for another tool (`unsupported`).

Readiness of the services a sequencer would call:

- **`OperationRegistry`, `api/src/commands.ts`** (ready): `ToolInvocation`, `admits`, `reserves`, `scope`, `admit` (`finished`), `admitCommand` (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- **Camera Acquisition (`CameraCaptures`)** (ready): `admit` (see above); the manual routes answer through it.
- **Auto Focus** (ready): `AutoFocusSessions.admit` and `interrupt` (see [Auto Focus Contract](auto-focus.md)).
- **Guiding** (ready): `GuidingSessions.admit`, the `admit*` durable commands, and `rootOf` (see [Guiding Contract](guiding.md)).
  Under a reservation only the start, Start Guiding, Stop Guiding, the stop, and the drain are tested; pause, resume, and dither go through the same scope but have no test of their own, since they need a calibrated run on the simulator.
- **Target Centering** (ready): `TargetCenteringSessions.admit` and `interrupt` (see [Target Centering Contract](target-centering.md)).
- **Mount, Filter Wheel** (ready): `MountCommands.admitGoTo` (the refusals and the single correction of the goto route) and `WheelCommands.admitMove` admit under an invocation;
  `MountCommands.admitMeridianFlip` admits a `mount.flip` by native flip or forced GoTo, always sent and never corrected, with its evidence as `result`;
  the other device commands stay manual until a caller needs them, the manual `MountCommands.flip` included.
  The read-only Meridian Flip Monitor already offers what a caller deciding a flip reads: its snapshot, `meridianFlip:transition`, and `assessExposure`.
- **Server events (`ServerEventDispatcher`, `api/src/events.ts`)** (ready): `publish` of `api/src/index.ts` goes through the dispatcher (see [Routes and Events](routes-and-events.md)); no event of a sequencer exists yet.
- **TPPA, DARV, Mount Pointing Model** (future): No in-process `admit` under an invocation: only their routes start them, and TPPA and DARV need a person adjusting the mount.
- **Flat Wizard, Dark Library Wizard** (future): Their manual steps (`continue` of a pending step, a pause) wait for a person; unattended automation cannot assume they happen.
- **Rotator, Dome, Cover, Flat Panel, cooling, Plate Solving, stacking** (future): Not needed until the sequencer itself; read-only and analysis services need no operation contract.

- `api/src/composition.test.ts` proves the composition with direct calls of the services, no engine, plan, or step: under one reservation of the camera, focuser, and filter wheel, a saved capture, a filter change, and another saved capture, while the manual commands of the same devices stay refused and nothing is left once the reservation is cancelled, and the same with an Auto Focus after the first capture (only with `RUN_ALL_TESTS`);
  a device the reservation does not hold is refused to its tools;
  a disconnection fails the reserved work and refuses the next admission;
  and stopping the operations as a server stop does (`OperationRegistry.stop`) aborts it and resumes nothing.
  The guiding drain and the Target Centering composition are tested in their own files.
  The physical exclusivity of a camera and its integrated filter wheel (one `resourceKey`) is not simulated: the simulator's devices are separate hardware, and the arbiter's own tests cover shared keys.

- Acquisition exists once, in `CameraCapturer`: Camera Acquisition, Auto Focus, TPPA, DARV, Flat Wizard, Dark Library Wizard, the Mount Pointing Model, and Target Centering expose through the one capturer of `CameraCaptures` (`captures.capturer`), never an exposure loop of their own;
  only guiding exposes through the toolkit's `GuiderClient`.
- Every acquisition snoops the managed devices of the equipment setup (mount, focuser, filter wheel, rotator; `captureSnoop` in `web/src/camera/capture.ts`, chosen per camera by `CameraOperationContext.snoop`) into the frame headers.
  Requests name them by device id on the camera's connection (`CaptureSnoop`), and `api` resolves the ids to the driver names (`snoopedDevices`); snooped devices are read, never acquired.
- The Camera Simulator of the `SIMULATOR` connection (`api/src/connection.ts`) reads the devices a capture snoops through the shared managers, and starts on the `SKY` catalog source: the J2000 stars of the sky catalog around the mount's pointing (`catalogStars` in `api/src/sky/catalog.ts`, `skyStarSource`), through a 50 mm f/2 lens so the magnitude-8 catalog fills its 7.6° × 6.1° field with enough stars to plate solve.
  The Guide Camera Simulator renders the same sky through a 40 mm lens with a 2 s noise reference exposure, and the Camera Simulator with 3 s (`noiseExposureTime`, 60 s in the toolkit), since star fluxes scale with the exposure over that reference and exposures of seconds would otherwise show no star above the noise.
  Proper motion is not applied.
- A run resolves its connection and device ids when it starts and keeps them.
  Changing the active profile in a tab never redirects it.
