# Target Centering

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Target Centering brings a fixed J2000 target to the center of one camera, or only measures how far it is, by exposing, plate solving, and correcting the mount until a frame taken after the last motion proves the position.
The session lives in `api/src/targetcentering.ts` and runs the toolkit's centering loop (`core/src/observation/mount/centering.ts`).
The web tool is a camera operation of the Images camera tabs (`web/src/images/TargetCenteringTool.tsx`, `web/src/camera/TargetCenteringPanel.tsx`), with Center, Recenter, and Verify Only as actions of one tool.

## Purpose

A GoTo alone rarely puts a target exactly at the center, and automations must know it is there before imaging.
Target Centering gives the operator and the automations a verified position, and tells them whether imaging can go on.

## Relations

- Holds the camera and the setup's mount in one operation until the end, so nothing comes between an exposure and its correction (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- The first slew goes through the mount commands' GoTo, applying the [Mount Pointing Model](mount-pointing-model.md) in force once; later corrections are the residuals measured on the sky.
- Takes its frames through the shared camera capturer with the camera settings of Camera Acquisition and its own exposure time; frames are auxiliary and recorded in the [Capture Frames](capture-frames.md) registry.
- Solves each frame with [Plate Solving](plate-solving.md), whose settings are fixed when the session starts.
- Suspends the [Guiding](guiding.md) through the setup's guide output, which drives its mount, before moving it, keeps it from starting meanwhile, and restores it afterwards.
- The target is typed or selected in the [Sky Map](sky-map.md).
- The [Meridian Flip Executor](meridian-flip-executor.md) composes it inside its reservation after a flip.
- An [Equipment Control](equipment-control.md) stop of either device cancels it, and its outcome raises a [notification](notifications.md).

## Rules and Limitations

- A position is verified only by the solution of a frame taken after the last motion; an accepted slew or an earlier solve never proves it.
- Verify Only commands the mount nothing; a correction too large, below the horizon, or across a pier-side change is refused, and Sync is never used.
- A caller inside the process can admit a session under a reservation that holds the camera and the mount; the session still suspends and restores guiding itself.
- Guiding the operator paused, or that is calibrating, is never taken over.
- A verified position with guiding not restored is not ready for imaging, so an automation must not go on as if the whole workflow succeeded.
- Proper motion and solar-system bodies are not followed, and only the position is centered, never the orientation.
- Sessions live in memory, do not survive a restart, and nothing resends a motion after one.
