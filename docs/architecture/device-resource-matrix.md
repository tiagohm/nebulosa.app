# Device Resource Matrix

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

What each operation requires and which devices it holds while it runs.

How availability is judged:

- Each tool's registry declares what it requires, and the web judges a role or a device (`web/src/equipment/availability.ts`) as ready, busy, unsupported, or the role or device state that prevents its use.
- Busy means a running operation holds that exact connection and device id.
- Unsupported is a connected device the operation can never run on, judged by the operation from the device state the server reports; it comes before busy, and Equipment Setup is its fix.
- A device reserved by a caller composing tools shows ready while no operation runs on it, and the server still refuses it to every manual operation (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- Conflicts are resolved by the arbiter on the server, never only in the browser, because several tabs and profiles may address the same device.
- A feature conflicts with every operation holding one of its devices, immediate settings included, and with nothing else, but for the guiding through the setup's guide output, which Target Centering and Camera Acquisition with Mount dithering keep from running beside them.

Operations, besides the view's camera:

- **Camera Acquisition**: requires nothing; holds the camera until its last frame arrived, and with Mount dithering the mount and the guide output for the whole capture.
- **Live Stacking**: requires nothing; holds nothing, since it integrates the frames of Camera Acquisition.
- **Mount Nudge**: requires the mount; holds it only while a direction is held.
- **Guiding**: requires the guide output; holds the camera for the whole session, and the guide output and the mount it drives only while it guides.
- **Auto Focus**: requires the focuser; holds the camera and the focuser for the whole session.
- **DARV**: requires the mount; holds the camera and the mount during each measurement, free between them.
- **TPPA**: requires the mount and a plate solver; holds the camera and the mount for the whole session.
- **iPolar**: requires a plate solver, and the mount for the automatic rotation; holds the camera for the whole session, the mount too when the request names it, never the guide output.
- **Mount pointing session**: requires the mount, a plate solver, and the main camera; holds the camera and the mount for each stretch of work, free while paused.
- **Mount pointing verification**: requires the mount and a plate solver; holds the camera and the mount for the whole test.
- **Target Centering**: requires the mount and a plate solver; holds the camera for the whole session, and the mount, with the rotator for a Center of an orientation, from when the guiding it stopped released it until the end.
- **Flat Wizard**: requires nothing, the filter wheel, flat panel, and cover being optional; holds the camera and the devices it uses for the whole session, also while it waits for the operator.
- **Dark Library Wizard**: requires nothing, the filter wheel, flat panel, and cover being optional; holds the camera and the devices its protection selected for the whole session, also while paused.
- **Sky slew**: requires the mount; holds it until the slew ends.
- **Mount Remote Control**: requires the mount, no camera; holds it during a client's goto or manual motion.
- **Meridian Flip Monitor**: requires the mount, no camera; holds nothing, since it only reads the mount.
- **Meridian Flip Executor**: requires the mount, the main camera, the guide output, and the focuser; holds them under a reservation, with the capture and the guiding lending their devices as guests.
- **Equipment Control motion**: requires the device shown; holds it until the motion ends, and a pulse of the setup's guide output also the mount it drives.
- **Equipment Control held motion (dome rotation)**: requires the dome; holds it only while a direction is held.
- **Equipment Control setting**: requires the device shown; holds it for the command only.
- **INDI property write**: requires the device shown; holds it until the driver ends the change.
