# Operation Lifecycle Rules

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Every device operation runs under the process-wide `OperationRegistry` (`api/src/operations.ts`).
  It owns the single `ResourceArbiter` and `OperationCoordinator` of `nebulosa`, plus a `DeviceLifecycle` that follows every managed device type.
- An operation holds its devices by capability (`resourceKey`).
  It is the hardware id for almost every interface, so the interfaces of one device, such as a camera and its integrated filter wheel or focuser, a flip-flat's cover and flat panel, or a mount and its own guide output, are one resource;
  the ST4 port of a camera is the one capability of its own (`<hardwareId>:guideOutput`), granted apart from the camera's sensor, so it pulses while that camera exposes.
  A second operation on a held capability is refused as busy, whichever service or tab starts it; nothing waits or queues.
  Disconnecting or removing a device cancels the operations holding any of its capabilities.
  An immediate setting (see [Equipment Control Contract](equipment-control.md)) holds its device through the coordinator for the command only and publishes no record.
- Each start, progress, and end is published as `operation:updated` (`OperationRecord`: id, `OperationKind`, exact devices, state, start instant, latest progress, failure reason and error);
  an operation is published as running before its work starts, so a progress reported from its first synchronous step is published too.
  An operation started for a command token is remembered by it (the newest 256), so a repeated token answers the same operation.
  `GET /api/operations` lists the running ones.
  The web mirrors them in `web/src/operations.ts`.
- `OperationRecorder` (`api/src/operationhistory.ts`) keeps the history of the operations in `operation_runs`: `publish` of `api/src/index.ts` hands it every event through the `ServerEventDispatcher`, and it writes the start of an operation and its end (state and reason), with the names its devices had, never a progress nor the text of an error, which can hold server paths.
  An operation still running when the server stopped is recorded as `interrupted` when it starts again, and nothing resumes it.
  Rows beyond its retention (see [Persistence and State](persistence-and-state.md)) are deleted as operations end.
  `GET /api/operations/history?before=&limit=` pages it newest first (at most 200 per page, `next` the cursor of the next page: the start instant and the id of the last operation of the page, since operations a composed tool starts together share a millisecond);
  no screen shows it yet.
- Operations are owned by the server.
  Switching workspace, profile, camera tab, or mode, collapsing a panel, or unmounting a component never ends one.
- A server stopped by a signal (`app/src/main.ts`) first cancels every running operation and waits, at most 3 s (`stopOperations` of `api/src/index.ts`, `OperationRegistry.stop`), for their cleanups to stop what they commanded, then closes the database: a driver keeps a motion once its client is gone, so exiting at once would leave a mount moving under a held nudge.
  A second signal ends the process at once.
  A hot reload of `bun dev` evaluates the server code again in the same process, which would keep the previous run alive beside the new one;
  the new run first stops the previous one in place (`stopServer` of `api/src/index.ts`, which says what it releases) and opens again the connections it had open (`reopenConnections`).
  Operations and in-memory sessions do not survive a reload; the connections are closed and opened again.
- Interruptions are distinct commands, offered only when supported: cancel a pending request, abort an exposure, stop guiding, stop mount motion, stop a persistent service.
  There is no generic "Cancel": the Abort of the status bar sends the command of each operation, the same as the page that started it (see Status bar).
- Long-lived services (guiding sessions, Live Stacking sessions, Mount Remote Control listeners, Meridian Flip Monitors) are server objects with explicit start and stop and their own state events.
  They are not operations of a React screen.
- A service composing tools inside the process runs them under a `ToolInvocation` (`api/src/operations.ts`): a `ResourceReservation` of the registry's arbiter holding every device the tool commands, kept in process memory only (never in a request, an event, a store, or the database).
  `admits(device, invocation)` grants a tool a device, without an invocation, only when it is available and, with one, only when that reservation holds it and no operation of it holds it now (`reserves` tells whether the reservation holds it at all), so a tool never takes a device outside the reservation it was given and a manual command stays refused as busy on a reserved device;
  `scope(invocation)` is the coordinator or the reservation's scope (`reservedScope`) every operation of the tool starts with.
  `admit` starts the operation of a token as `run` does and returns an `OperationAdmission`: the running record, `finished` (the final record, never rejecting), and whether the token had already started it, so a repeated token answers the same end.
  `admitCommand` of `api/src/commands.ts` is the in-process form of `startCommand`, answering the admission or a `CommandRefusal` (status, code, message) a route answers as `{ error, code }`.
  Stopping a device (`stopResponse`, the mount stop) still cancels whatever operation holds it, reserved or not: a stop is a safety command.
  Only the services the Capture–Sequencer Compatibility Report lists as ready accept an invocation; every other operation is manual and refused on a reserved device.
  Camera Acquisition reserves the mount and the guide output of its Mount dithering for the whole capture (`api/src/dithering.ts`); no other caller reserves devices yet besides `api/src/composition.test.ts`.
- A reservation can take a device from a session that keeps running, with no instant at which another owner could take it: a reservation request may name a **guest**, the root operation of one session (`ReservationRequest.guest` of the toolkit's arbiter).
  Reserving a device the guest leases is then not a conflict, the device stays in the reservation when the guest lets it go, and only the guest may take it again without the reservation's token, while manual commands stay refused.
  `reservation.extend(requests)` adds devices to the same reservation, and `arbiter.transfer(from, to, keys)` moves free devices between two live reservations at once.
  A paused Camera Acquisition lends its camera this way (`CameraCaptures.suspendForMotion`), with its Mount dithering reservation transferred (`CaptureDitherPlan.lend`), and a guiding run suspended with a reservation (`GuidingSessions.suspendForMotion(sessionId, { reservation })`) lends its mount and guide output;
  both take them back inside the reservation as its guest.
- Toolkit runners (the `GuiderClient` of a guiding session, `CameraCapturer` reports) keep their own state machines.
  The registry tracks what they hold; it does not replace their states.
- The shared `CameraCapturer` of `api/src/captures.ts` (Camera Capture, Auto Focus, TPPA, iPolar, DARV, Mount Pointing, Target Centering, Flat Wizard, Dark Library Wizard) allows `FRAME_TRANSFER_TIMEOUT` (10 min) for a frame's payload to arrive after its exposure, and for a stopped exposure to stop being Busy.
  INDI delivers in order, so a stop is answered only after the BLOB in transit, and an unbinned frame of a large sensor over a slow link takes minutes (an ASI294MM Pro frame of 124.8 MB in base64 took about 130 s at 1.2 MB/s).
  The camera stays held until then, and a frame that is really lost fails only after that time.
