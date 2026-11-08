# INDI Properties Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- The raw property vectors of every device of every connection, managed or not, are kept once in `DeviceRegistry.properties`, the toolkit's `IndiPropertyRegistry`: first in the handler of every client, shared by every device manager, which reads it instead of keeping its own copy.
  It holds copies of the vectors with their definition metadata, latest state, values, ranges, message, and timestamp, and a revision per vector; never BLOB bytes, only the format and size of the latest delivery.
- `IndiPropertyService` (`api/src/indi.ts`) publishes it for every connection: an `indiserver` speaks INDI natively, and the simulator and the Alpaca client define and update the vectors of their devices and take new values through the same `Client` commands (the Alpaca client translates the vectors it maps into Alpaca calls and ignores writes to the others, which then time out).
  The directory (`GET /api/connections/:id/indi/devices`, `IndiDeviceSummary`) lists each physical device once by hardware id, including drivers no manager supports, with its driver identification and the connection flag its `CONNECTION` vector reports, never a value;
  its changes are broadcast as `indi:deviceAdded`, `indi:deviceUpdated`, and `indi:deviceRemoved`.
- The property stream of one physical device (`connectionId`, `hardwareId`) reaches only the sockets that sent `indi:subscribe` for it: an `indi:snapshot` (every vector in driver order), then `indi:propertyDefined`, `indi:propertyUpdated` (the changed elements with the vector's current state, message, timestamp, and timeout), and `indi:propertyRemoved`.
  The `<message>` elements of the drivers are not part of it (see [INDI Messages Contract](indi-messages.md)); the `message` attribute of a vector stays with the vector.
  A refused subscription gets `indi:subscriptionError` (`notFound`).
  Subscribing again resends the snapshot; `indi:unsubscribe`, the close of the socket, or the removal of the device end it at once, with no grace period.
- While a device has no subscriber its changes build no payload, serialize nothing, and start no timer.
  Value-only changes of a vector are coalesced and sent every `VALUE_INTERVAL` (250 ms) with the latest values;
  definitions, removals, and changes of state, message, range, or timeout are sent at once, carrying the values still pending for that vector.
  Each stream event carries the `epoch` of its connection's client (new on every reconnection) and a `revision` increasing across the service; each vector carries its own revision.
  A socket with more than `MAX_BUFFERED_AMOUNT` (1 MiB) queued, or that queued or dropped a send, skips its streams until it drains, then receives a fresh snapshot of each.
- A write (`POST /api/connections/:id/indi/devices/:hardwareId/properties/:vector`, `IndiWriteRequest`) names the revision of the vector the tab shows and is refused as `conflict` (409, with the current `vector`) when the vector changed since;
  it writes only text, number, and switch vectors the driver does not mark `ro` (`unsupported` otherwise), names only elements the vector has, and sends the whole vector: text and number elements left out keep their current values in a `rw` vector and must be given in a `wo` one, switches are sent as the complete selection, left-out ones off except in a readable `AnyOfMany` vector, with exactly one on for `OneOfMany` and at most one for `AtMostOne` (`invalidParameter` otherwise).
  Values are not checked against the declared ranges, which the driver applies.
  A write of `ON_COORD_SET`, `EQUATORIAL_EOD_COORD`, `GEOGRAPHIC_COORD`, or `TIME_UTC` (`MODEL_SENSITIVE_VECTORS`) suspends the pointing model in force on that mount once the write is admitted;
  a write refused, as busy or otherwise, leaves it in force (see [Mount Pointing Model Contract](mount-pointing-model.md)).
  It runs as an `indi.propertyWrite` operation under the command contract (202, token, outcome through `operation:updated`).
  While the device reports being connected it holds the physical device, so it is refused as `busy` while another operation holds it and is cancelled when the device disconnects;
  a device that is not connected is written without a hold, so its port or `CONNECTION` can be set.
- A write ends with the first update of its vector after it was sent that is not `Busy`: `Ok` or `Idle` succeed, `Alert` fails as `alert` with the driver's message.
  It times out after the vector's `timeout` plus `WRITE_GRACE` (5 s), 60 s when none is declared and at most 600 s, saying the device may still be working;
  the deletion or redefinition of the vector meanwhile ends it as `commandFailed` (unknown result), and the removal of the device as `removed`.
- The web view (`web/src/equipment-control/indi/`) is the INDI Properties view of a device in Equipment Control, `/equipment/<device id>/indi`: a device both managed and INDI chooses between Controls, INDI Properties, and, on an INDI server, Messages with a selector;
  a device no interface manages opens on INDI Properties.
  `indiDirectory` mirrors the directory through `SERVER_STORES`;
  `indiView` is not a server store but the stream of the one device shown: the view subscribes while mounted, its device is in the directory, and the page is visible (a hidden page pauses the subscription and keeps what is shown and the drafts), subscribes again on every socket open, drops events of another epoch or older than what it applied, and unsubscribes when it unmounts or changes device.
  Vectors are grouped by the driver's groups in driver order (unnamed ones under Other), searchable by group, vector, and element names and labels, in collapsible groups, the first open at first.
  Text and number vectors are edited in fields (numbers in decimal or sexagesimal, in the driver's units and format, never rounded while typing; write-only fields start empty) and applied with Apply, which sends the edited elements only with the revision shown;
  `OneOfMany` switches use a select and Apply, `AnyOfMany` checkboxes and Apply, `AtMostOne` action buttons that send at once with an explicit Clear;
  lights and BLOB metadata are read-only.
  A draft is never replaced by what the device reports, which is noted as a change on the device, is kept until its write succeeds, and stays after a refusal (a conflict shows the current vector) or a failure;
  a redefinition of the vector or a new epoch discards it.
  Each vector shows the outcome of its latest write from `operation:updated`, waiting while the driver works.
- Limitations: success only means the driver ended the change; an update already on its way when the change was sent ends the write too, and a driver may report `Ok` while its hardware still moves, which then no longer holds the device.
