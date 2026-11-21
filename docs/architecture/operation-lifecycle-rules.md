# Operation Lifecycle Rules

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

What an operation is, who may hold a device, and how tools compose.

## Operations

- Every device operation runs under the process-wide `OperationRegistry` (`api/src/operations.ts`), which owns the single `ResourceArbiter` and `OperationCoordinator` of `nebulosa` and follows the lifecycle of every managed device.
- Operations are owned by the server: switching workspace, profile, camera tab, or mode, collapsing a panel, or unmounting a component never ends one.
- Each start, progress, and end is published to every tab, and the start and end of each operation are kept as its history.
- An operation started for a command token is remembered by it, so a request repeated after a lost response answers the same operation, whatever the device is now.
- An immediate setting holds its device for the command only and publishes no record.
- Long-lived services (guiding sessions, Live Stacking sessions, Mount Remote Control listeners, Meridian Flip Monitors) are server objects with an explicit start and stop and their own state events, never operations of a screen.
- Toolkit runners keep their own state machines; the registry tracks what they hold, and does not replace their states.
- Every camera operation but guiding exposes through the shared `CameraCapturer` of `api/src/captures.ts`, which keeps the camera held until a frame's payload arrived after its exposure; an unbinned frame of a large sensor over a slow link takes minutes.

## Arbitration

- An operation holds its devices by capability: the interfaces of one physical device share a hardware id and are one resource, while the ST4 port of a camera is a capability of its own, granted apart from the camera's sensor so it pulses while that camera exposes.
- A second operation on a held capability is refused as busy, whichever service or tab starts it; nothing waits or queues.
- Disconnecting or removing a device cancels the operations holding any of its capabilities.
- Every operation that moves the mount through a guide output holds the guide output and the mount it drives until the motion is over.
- See the [Device Resource Matrix](device-resource-matrix.md) for what each operation holds.

## Interruptions

- Interruptions are distinct commands, offered only when supported: cancel a pending request, abort an exposure, stop guiding, stop mount motion, stop a persistent service.
- There is no generic Cancel: the Abort of the status bar sends the same command as the page that started the operation.
- Stopping a device still cancels whatever operation holds it, reserved or not: a stop is a safety command.

## Reservations and Composition

- A service composing tools inside the process runs them under a `ToolInvocation`: a reservation of the registry's arbiter holding every device the tools command, kept in process memory only, never in a request, an event, a store, or the database.
- A tool is granted a device without an invocation only when it is available, and with one only when that reservation holds it and no operation of it holds it now, so a tool never takes a device outside its reservation and a manual command stays refused as busy on a reserved device.
- A capability other tools may compose answers through a typed `admit…` method taking an optional `ToolInvocation`, returning its identity and end or a refusal, and runs every operation under the registry's scope of that invocation; its route only maps that to a response.
- Only the services the [Capture–Sequencer Compatibility Report](capture-sequencer-compatibility-report.md) lists as ready accept an invocation; every other operation is manual and refused on a reserved device.
- A reservation can take a device from a session that keeps running by naming it as guest: the device stays in the reservation when the guest lets it go, and only the guest may take it again, while manual commands stay refused.
  A paused capture lends its camera this way, and a suspended guiding run its mount and guide output.
- A reservation can be extended with more devices, and free devices can move between two live reservations at once.

## Process Lifetime

- Nothing survives the process: operations and in-memory sessions end with a stop or a reload, and nothing resumes them.
- A server stopped by a signal first cancels every running operation and waits briefly for their cleanups to stop what they commanded, since a driver keeps a motion once its client is gone; a second signal ends the process at once.
- A hot reload stops the previous run in place before the new one serves, and opens again the connections it had open.
- An operation still running when the server stopped is recorded as interrupted when it starts again.
