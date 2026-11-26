# Target Centering

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Target Centering brings a fixed J2000 target to the center of one camera, or only measures how far it is, by exposing, plate solving, and correcting the mount until a frame taken after the last motion proves the position.
Optionally it also brings the field to a requested orientation, the position angle of the image top, by turning the setup's rotator, or only measures it.
The session lives in `api/src/targetcentering.ts` and runs the toolkit's centering loop (`core/src/observation/mount/centering.ts`).
The web tool is a camera operation of the Images camera tabs (`web/src/images/TargetCenteringTool.tsx`, `web/src/camera/TargetCenteringPanel.tsx`), with Center and Verify Only as actions of one tool.

## Purpose

A GoTo alone rarely puts a target exactly at the center, and automations must know it is there before imaging.
Framing a mosaic panel, or a project imaged over several nights, also needs the field turned as it was planned.
Target Centering gives the operator and the automations a verified position, and a verified orientation when one is asked, and tells them whether imaging can go on.

## Relations

- Holds the camera and the setup's mount in one operation until the end, so nothing comes between an exposure and its correction (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)); a Center of an orientation holds the setup's rotator with the mount and turns it through the rotator commander.
- Keeps the rotation sense it learns for a camera and a rotator in the operational database and reads it when a later session is admitted, whoever admits it (see [Persistence and State](persistence-and-state.md)).
- A slew goes through the mount commands' GoTo, applying the [Mount Pointing Model](mount-pointing-model.md) in force once; later corrections are the residuals measured on the sky.
- Takes its frames through the shared camera capturer with the camera settings of Camera Acquisition and its own exposure time; frames are auxiliary and recorded in the [Capture Frames](capture-frames.md) registry.
- Solves each frame with [Plate Solving](plate-solving.md), whose settings are fixed when the session starts.
- Suspends the [Guiding](guiding.md) through the setup's guide output, which drives its mount, before moving it, keeps it from starting meanwhile, and restores it afterwards.
- The target is typed or selected in the [Sky Map](sky-map.md); the orientation is typed, taken from the latest solved frame of the camera tab, or taken from the rotation of a saved [Framing](framing.md), the same position angle of the image top the Plate Solver shows.
- The Sky's framings and the [Plate Solving](plate-solving.md) of any solved image hand a target with its orientation to the form of the Main Camera (Center Here, Center on This Frame), which only fills it and shows the tool.
- The [Meridian Flip Executor](meridian-flip-executor.md) composes it inside its reservation after a flip.
- An [Equipment Control](equipment-control.md) stop of any device it holds cancels it, and its outcome raises a [notification](notifications.md).
- A rotation is a new context for [Guiding](guiding.md), which derives its calibration for it when the guide camera turns with the rotator.

## Rules and Limitations

- A position is verified only by the solution of a frame taken after the last motion; an accepted slew or an earlier solve never proves it.
- Center slews first only when the mount stands farther from the target than the largest correction, so a mount already near it is corrected from the sky alone; the tool tells which before the operator confirms.
- Verify Only commands the mount nothing; a correction too large, below the horizon, or across a pier-side change is refused, and Sync is never used.
- A caller inside the process can admit a session under a reservation that holds the camera and the mount; the session still suspends and restores guiding itself.
- Guiding the operator paused, or that is calibrating, is never taken over.
- A verified position with guiding not restored is not ready for imaging, so an automation must not go on as if the whole workflow succeeded.
- An orientation is verified only by the same frame as the position, taken after the last motion of the mount or of the rotator.
- The rotator is closed-loop on the sky: its angle is never synced, homed, or reversed, and only its rotation sense is learned, from a check that the field turned with it; a rotator that does not turn the field ends the session.
- A Center that verified an orientation keeps the offset of the position angle for the rotator, modulo a half turn, and a later Center allowing the half turn turns the rotator while the mount slews; the first frame after it still verifies, and a stale offset costs only the usual rotation.
- A position angle and the one opposite frame the same field by default, so the rotator turns at most a quarter turn and a meridian flip keeps the orientation without turning it.
- An orientation outside the rotator's limits is refused before any rotation; an alt-az mount is refused, its field turning all the time; Center of an orientation without a rotator is refused, and Verify Only measures it with none.
- Flats must be taken after the final framing: a rotation turns the camera on the telescope.
- Proper motion and solar-system bodies are not followed.
- Sessions live in memory, do not survive a restart, and nothing resends a motion after one.
