# Meridian Flip Executor

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Meridian Flip Executor flips a German equatorial mount at the passage its monitor follows and gives imaging back: it pauses the capture, suspends guiding, flips, verifies the flip, recenters, refocuses, and resumes.
It is `MeridianFlipExecutor` (`api/src/meridianflipexecutor.ts`), with its pure decisions in `api/src/meridianflipexecutor.policy.ts`.
Only a request starts it: a flip now, or a one-shot arm that flips unattended once eligible.

## Purpose

It lets an imaging night continue across the meridian without the operator.
It composes the services that own each step instead of commanding devices itself, and says plainly how well a flip was verified.

## Relations

- Reads the [Meridian Flip Monitor](meridian-flip-monitor.md), which stays passive.
- Uses the devices of the Equipment Setup by exact ids: the mount, the main camera, the guide output, the focuser, and the rotator.
- Pauses the main camera's capture at a frame boundary through Camera Acquisition (`api/src/captures.ts`) and suspends [Guiding](guiding.md) of the setup's guide output.
- Flips through `MountCommands`, measures and recenters with [Target Centering](target-centering.md), and refocuses with [Auto Focus](auto-focus.md).
- Holds the mount, guide output, camera, and focuser under one reservation of its own (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- Started from the [Meridian Flip](meridian-flip.md) tool; its policy is a profile preference of the web.
- Every ended execution becomes a [Notification](notifications.md).
- Nothing survives the process: arms, executions, and the reservation are memory only, and a restart re-arms nothing and replays no motion.

## Rules and Limitations

- One execution runs per physical mount, and an arm is consumed by the execution it starts.
- A flip is always sent, never corrected by a pointing model, and never repeated.
- A flip is verified only by a pier side the driver reports; an inference from plate solutions is supporting evidence, never a mechanical confirmation.
- Only an accepted flip goes on to recentering and Auto Focus, and the Executor alone suspends and restores guiding.
- The capture resumes only when every step succeeded; otherwise it stays paused for the operator, and a flip motion that fails with the mount still moving leaves the execution blocked.
- Only the main camera's capture is paused, a non-sidereal target is never flipped, the firmware limit is only what the operator enters, no dome is slaved, and no rotator is moved: its recentering asks no orientation, and a flip turns the field by half a turn, which keeps an orientation that allows it.
- Hardware acceptance on a real mount (timing against the firmware, cable clearance) is the operator's.
