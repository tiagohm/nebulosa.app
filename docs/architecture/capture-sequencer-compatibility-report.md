# Capture–Sequencer Compatibility Report

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The composition boundary the future Sequencer follows, and how ready the services it would call are.

## Composition Boundary

- There is no sequencer engine yet.
  It will be an `api` service that orchestrates the tools as they are: it decides when and why a tool runs, and calls the same application services the manual screens call, never `CameraCapturer` or a commander directly.
- How a tool operates its equipment (capabilities, device commands, resources, cleanup, progress, outcome) stays in the service that owns it; a direct `CameraCapturer` or commander call belongs only inside such a service, for its own procedure.
- Each tool stays usable on its own and never knows the sequencer.
- A caller composes tools under one reservation of the `ResourceArbiter`, which is the only arbitration: no second lock, queue, or busy flag (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- A command's outcome is what its service returns for the exact request it admitted, never a response that only accepted it, an event, a notification, or the latest session of a camera, which a newer session replaces.
- Nothing survives the process: a crash, stop, or reload ends every run, and nothing is checkpointed, replayed, or resumed; saved frames stay on disk, and a person starts a new run.
- No table is added for plans or runs before the sequencer itself.
- A run resolves its connection and device ids when it starts and keeps them; changing the active profile in a tab never redirects it.
- Acquisition exists once, in `CameraCapturer`, which every camera operation but guiding exposes through; every acquisition snoops the managed devices of the equipment setup into the frame headers, reading them, never acquiring them.
- A running capture can be paused for a tool of the process at a frame boundary, lending its camera to the tool's reservation, and then taken back, resumed, or left paused for the operator (see [Capture Frames](capture-frames.md)).
- A capture that dithers keeps its own cadence, so an orchestrator dithering between capture blocks sends none itself.
- Events a sequencer run will need are added by the sequencer service and published through the same dispatcher (see [Routes and Events](routes-and-events.md)).

## Readiness

- **Operation registry and device commands**: ready.
- **Camera Acquisition**: ready; the manual routes answer through the same admission.
- **Auto Focus**: ready ([Auto Focus](auto-focus.md)).
- **Guiding**: ready ([Guiding](guiding.md)); under a reservation, pause, resume, and dither have no test of their own, since they need a calibrated run on the simulator.
- **Target Centering**: ready ([Target Centering](target-centering.md)).
- **Mount and filter wheel**: ready for a goto, a meridian flip, and a filter change; the other device commands stay manual until a caller needs them.
  The read-only [Meridian Flip Monitor](meridian-flip-monitor.md) already offers what a caller deciding a flip reads.
- **Server events**: ready; no event of a sequencer exists yet.
- **TPPA, iPolar, DARV, Mount Pointing Model**: future; only their routes start them, and TPPA, iPolar, and DARV need a person adjusting the mount.
- **Flat Wizard, Dark Library Wizard**: future; their manual steps wait for a person, which unattended automation cannot assume.
- **Rotator, dome, cover, flat panel, cooling, plate solving, stacking**: future; not needed until the sequencer itself, and read-only and analysis services need no operation contract.

## Gaps

- `api/src/composition.test.ts` proves the composition with direct calls of the services, without engine, plan, or step; part of it runs only with `RUN_ALL_TESTS`.
- The physical exclusivity of a camera and its integrated filter wheel is not simulated, since the simulator's devices are separate hardware; the arbiter's own tests cover shared keys.
