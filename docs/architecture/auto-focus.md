# Auto Focus

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Auto Focus finds the best focuser position for one camera by sweeping the focuser, measuring the stars of a frame at each position, and fitting a curve to them.
The session lives in `api/src/autofocus.ts` and runs the toolkit's auto focus runner, which owns the sampling, the fitting, and the best position.
The web tool is a camera operation of the Images camera tabs (`web/src/images/AutoFocusTool.tsx`, `web/src/camera/AutoFocusPanel.tsx`).

## Purpose

Focus shifts over a night, and soft stars cost every later frame, solve, and guide step.
Auto Focus gives the operator, and the automations that run unattended, a measured best focus instead of a visual guess, verified by one more frame taken there.

## Relations

- Holds the camera and the focuser in one operation for the whole session (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)); the mount is not held.
- Moves the focuser through the backlash-compensated mover of the focuser commands, and can move it back to the start after a stop.
- Takes its frames through the shared camera capturer with the camera settings of Camera Acquisition and its own exposure time, snooping the setup's mount, filter wheel, and rotator into them.
- Measures each frame with [Star Detection](star-detection.md), using the profile's detection settings.
- Records every frame in the [Capture Frames](capture-frames.md) registry so the camera tab shows it; frames are auxiliary and never saved as captures.
- The [Meridian Flip Executor](meridian-flip-executor.md) composes it inside its reservation after a flip.
- An [Equipment Control](equipment-control.md) stop of either device cancels it, and its outcome raises a [notification](notifications.md).

## Rules and Limitations

- Nothing is fitted in `api` or `web`; the toolkit's runner is the only judge of the curve.
- A caller inside the process can admit a session under a reservation that holds the camera and the focuser; every operation of the session, the move back included, then runs inside it.
- Focusers that only move relatively are refused.
- The web refuses a run whose first pass would leave the travel the focuser reports; a sweep that later extends past it fails. The session names that cause and a rejected curve apart from other failures, and says whether the focuser stands at its start position afterwards.
- One frame per position, no repeated samples, and the filter wheel is never moved.
- A slew during a session goes unnoticed, since the mount is not held.
- Sessions live in memory and do not survive a restart.
