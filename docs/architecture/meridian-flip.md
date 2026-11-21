# Meridian Flip

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Meridian Flip tool of the Rig & Observatory group shows the server's monitor and executor for the mount of the active profile's Equipment Setup.
It reads where the passage stands, enables the monitor, and checks, arms, or runs a flip with the settings it will use.
It lives in `web/src/tools/meridianflip/`, over `api/src/meridianflip.ts` and `api/src/meridianflipexecutor.ts`.

## Purpose

The operator needs one place to see, from across the room, how far the target is from the meridian and what will happen there, and to hand a flip to the server with the equipment and settings it will use.

## Relations

- Mirrors the [Meridian Flip Monitor](meridian-flip-monitor.md) and the [Meridian Flip Executor](meridian-flip-executor.md); the status bar also shows the monitor (see [UI Structure](ui-and-layout.md)).
- Hosted by the Tools workspace; like [Mount Remote Control](mount-remote-control.md) it chooses no mount and offers the Equipment Setup without one.
- Builds its requests from the Equipment Setup and the main camera's Target Centering, plate solving, exposure, star detection, and Auto Focus forms the profile keeps, and opens those camera tools on the camera tab in Images.
- Remembers the flip window and policy in the profile, per mount.
- Notices when the site the mount reports differs from the active [observing site](observing-sites-and-time-zones.md), and points to Equipment Control to send it.
- The manual Flip of [Equipment Control](equipment-control.md) only moves the mount and links here; Camera Acquisition shows a capture a flip left paused and resumes it.

## Rules and Limitations

- Closing the tab, switching profile, setup, or workspace, or reloading never enables, disables, or redirects a monitor.
- The camera forms are copied when a request is sent or armed, so a later change applies to the next request.
- Reading the monitor never commands the mount, and the policy is locked while a flip runs.
