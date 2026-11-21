# INDI Messages

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

INDI Messages collects the `<message>` elements INDI drivers and servers send: a history per device, kept in memory and streamed to the tabs that look, and the server's own messages as notifications.
It is `IndiMessageService` (`api/src/indimessages.ts`), and its view is the Messages view of `web/src/equipment-control/indi/`.

## Purpose

Drivers explain what they are doing, and why a command failed, in messages rather than in their property vectors.
The operator needs to read them beside the device they concern.

## Relations

- One handler in `DeviceRegistry.handler` collects them for the client of each INDI connection; the simulator and the Alpaca client send none.
- Hosted by [Equipment Control](equipment-control.md) as the Messages view of a device of an INDI connection, managed or not.
- The messages of the INDI server itself become [Notifications](notifications.md).
- The message a driver attaches to a vector stays with that vector in [INDI Properties](indi-properties.md).
- No operation runs, no device is held, and nothing is stored on disk.

## Rules and Limitations

- Only the device a message names routes it; nothing is inferred from its text, not even a severity.
- Text is driver input: it is cleaned of control characters and never redacted, so a path or address a driver writes is shown as sent.
- The server's own messages are rate-limited per connection, so a noisy server never crowds the notification history.
- The history is bounded per device and lives only while the connection is open: a reconnection or a restart forgets it.
