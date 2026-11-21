# INDI Properties

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

INDI Properties shows the raw property vectors of every device of every connection, managed or not, and writes new values to them.
The vectors are kept once in `DeviceRegistry.properties`, the toolkit's `IndiPropertyRegistry`, and published by `IndiPropertyService` (`api/src/indi.ts`) as a directory of devices and a stream per device; the view is `web/src/equipment-control/indi/`.

## Purpose

It is the escape hatch of the device layer: the operator can see and set anything a driver exposes, including devices no manager supports and properties no commander covers.

## Relations

- Every device manager reads the shared registry instead of keeping its own copy.
- Covers every connection: an INDI server natively, and the simulator and the Alpaca client through the vectors they define.
- Hosted by [Equipment Control](equipment-control.md) as the INDI Properties view of a device; driver messages are the separate [INDI Messages](indi-messages.md).
- A write runs as an `indi.propertyWrite` operation under the command contract, holding the device while it reports being connected (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- An admitted write of a mount's coordinates, site, or time suspends the [Mount Pointing Model](mount-pointing-model.md) in force on it.
- Nothing is persisted.

## Rules and Limitations

- The stream of a device reaches only the sockets subscribed to it, and a device without subscribers costs nothing.
- A write names the revision of the vector it was edited from and is refused when the vector changed since; it writes only text, number, and switch vectors the driver allows, and sends the whole vector.
- Values are not checked against the declared ranges, which the driver applies.
- A draft is never replaced by what the device reports.
- Success only means the driver ended the change: a driver may report it while its hardware still moves, which then no longer holds the device.
- BLOB bytes are never kept, and the Alpaca client ignores writes of vectors it does not map, which then time out.
