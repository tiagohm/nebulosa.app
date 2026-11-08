# Device Resource Matrix

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Requirements are declared by each tool's registry;
the web evaluates availability with `roleAvailability` and `deviceAvailability` (`web/src/equipment/availability.ts`): ready, busy (a running operation holds that exact connection and device id), unsupported, or the role or device state that prevents use.
Unsupported is a connected device the operation can never run on, judged by the operation from the device state the server reports (mechanical design, capabilities) and passed as its reason; it comes before busy, and Equipment Setup is its fix.
A device reserved by a caller composing tools (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)) shows ready while no operation runs on it, and the server still refuses it to every manual operation.

Every `OperationKind`, what it requires besides the view's camera, and the devices it holds:

- **Camera Acquisition**
    - Operation kinds: `camera.capture`
    - Requires: —
    - Holds: camera, until its last frame arrived; with Mount dithering, a reservation of the mount and the guide output for the whole capture
- **Live Stacking**
    - Operation kinds: none
    - Requires: —
    - Holds: nothing: it integrates the frames of Camera Acquisition
- **Mount Nudge**
    - Operation kinds: `mount.nudge`
    - Requires: Mount
    - Holds: mount, only while a direction is held
- **Guiding**
    - Operation kinds: `camera.guiding`, `guideOutput.guiding`
    - Requires: Guide output
    - Holds: camera for the whole session; the guide output (the mount, or a camera's ST4 port, apart from its sensor) and the mount it drives only while it guides
- **Auto Focus**
    - Operation kinds: `focuser.autofocus`
    - Requires: Focuser
    - Holds: camera and focuser for the whole session
- **DARV**
    - Operation kinds: `mount.darv`
    - Requires: Mount
    - Holds: camera and mount during each measurement, free between them
- **TPPA**
    - Operation kinds: `mount.tppa`
    - Requires: Mount; a plate solver
    - Holds: camera and mount for the whole session
- **iPolar**
    - Operation kinds: `camera.ipolar`
    - Requires: a plate solver; the Mount for the automatic rotation
    - Holds: camera for the whole session; the setup's mount for the whole session too when the request names it (always in automatic mode); never the guide output
- **Mount pointing session**
    - Operation kinds: `mount.pointingModel`
    - Requires: Mount; a plate solver; the camera is the Main Camera
    - Holds: camera and mount for each stretch of work, free while paused
- **Mount pointing verification**
    - Operation kinds: `mount.pointingVerification`
    - Requires: Mount; a plate solver
    - Holds: camera and mount for the whole test
- **Target Centering**
    - Operation kinds: `mount.targetCentering`
    - Requires: Mount; a plate solver
    - Holds: camera for the whole session; mount from when the guiding it stopped released it until the end
- **Flat Wizard**
    - Operation kinds: `camera.flatWizard`
    - Requires: — (filter wheel, flat panel, and cover optional)
    - Holds: camera; the wheel, panel, and cover it uses, for the whole session, also while it waits for the operator
- **Dark Library Wizard**
    - Operation kinds: `camera.darkLibraryWizard`
    - Requires: — (filter wheel, flat panel, and cover optional)
    - Holds: camera; the wheel, panel, and cover its protection selected, for the whole session, also while paused
- **Sky slew**
    - Operation kinds: `mount.slew`
    - Requires: Mount
    - Holds: mount until the slew ends
- **Mount Remote Control**
    - Operation kinds: `mount.goto`, `mount.remoteMove`
    - Requires: Mount (no camera)
    - Holds: mount during a client's goto or manual motion; for the command only during a sync or site change, which publish no record
- **Meridian Flip Monitor**
    - Operation kinds: none
    - Requires: Mount (no camera)
    - Holds: nothing: it reads the mount and starts no operation
- **Meridian Flip Executor**
    - Operation kinds: a reservation of the execution, then the guiding hold of the guide output
    - Requires: Mount, Main Camera, Guide Output, Focuser
    - Holds: the capture lends its camera, guiding its mount and guide output (guests); flip, Target Centering, Auto Focus run under the reservation
- **Equipment Control motion**
    - Operation kinds: `mount.goto`, `mount.flip`, `mount.park`, `mount.unpark`, `mount.home`, `mount.findHome`, `focuser.move`, `wheel.move`, `rotator.move`, `rotator.home`, `cover.open`, `cover.close`, `dome.slew`, `dome.home`, `dome.park`, `dome.unpark`, `dome.shutter`, `guideOutput.pulse`
    - Requires: the device shown
    - Holds: the physical device until the motion ends; a pulse of the setup's guide output also the mount it drives
- **Equipment Control dome rotation**
    - Operation kinds: `dome.move`
    - Requires: the device shown
    - Holds: the dome, only while a direction is held
- **Equipment Control setting**
    - Operation kinds: none
    - Requires: the device shown
    - Holds: the physical device, for the command only
- **INDI property write**
    - Operation kinds: `indi.propertyWrite`
    - Requires: the device shown
    - Holds: the physical device until the driver ends the change, only while connected

Each feature conflicts with every operation holding one of its devices, immediate settings included (cooling during a capture, a panel's light during a Flat Wizard), and with nothing else but one case: Target Centering stops the guiding that may pulse its mount and restores it afterwards, refuses to start beside guiding it would not stop, and keeps guiding from starting until it ends, through the setup's guide output, which drives the mount even on a camera's ST4 port that shares no device with it.
Camera Acquisition with Mount dithering likewise refuses to start beside guiding through that guide output, reserves it with the mount, and keeps guiding through it from starting until it ends, the ST4 port of the camera it captures with included, which the capture's hold of the sensor does not cover.
Conflicts are resolved by the arbiter on the server, never only in the browser, because several tabs (and profiles) may address the same device.
