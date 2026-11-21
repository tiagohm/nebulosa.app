# Equipment Control

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Equipment Control is the management page that lists the devices of the active profile's connection, one entry per physical device, with the controls of each interface, read-only diagnostics, and the INDI views of the devices an INDI server reports.
It lives in `web/src/equipment-control/`, and every command goes through `api` under the shared command contract of `api/src/commands.ts`.

## Purpose

It is the operator's place for direct manual control and inspection of each device: connecting, cooling, moving, parking, stopping, and seeing what a driver reports, including devices no other feature manages.

## Relations

- Commands follow the command contract: settings answer once the driver reports them, and motions run as operations under the [Operation Lifecycle Rules](operation-lifecycle-rules.md); held manual motions such as a mount nudge or a dome rotation share the leases of `api/src/leases.ts`.
- Reads the device managers of the toolkit through `DeviceRegistry`, including its `ThermometerManager` for sensor temperatures.
- Hosts the [INDI Properties](indi-properties.md) and [INDI Messages](indi-messages.md) views of a device.
- Device links of the camera operations, [Mount Remote Control](mount-remote-control.md), the [Mount Pointing Model](mount-pointing-model.md), the status bar, and [Notifications](notifications.md) open a device here.
- Its manual Flip only moves the mount and links to [Meridian Flip](meridian-flip.md).

## Rules and Limitations

- Opening the page, switching devices, or reloading never connects, disconnects, or commands anything.
- Command controls are disabled while a command of the device is in flight or an operation holds it; stop buttons never are.
- Fields that type a request follow the value the device reports until the operator edits them, so a command never starts from a value read when the page opened.
- Disconnecting a device asks first while an operation holds it or it reports an activity a disconnection would leave out of reach (a motion, tracking, a cooler on).
- A stop never waits for a lease: it cancels whatever holds the physical device and stops its motion; a filter wheel has no abort, and a guide pulse stop never cancels another operation of the mount.
- The mount type is unknown until reported, and only alt-azimuth is evidence against a polar alignment.
- Drivers differ: Alpaca mounts only go home, Alpaca domes cannot unpark or rotate manually, Alpaca focusers have no sync or reverse, and Alpaca rotators have no home.
- Pier side and the INDI Alignment Subsystem are shown read-only, and power, weather, safety monitor, and GPS devices are not managed; all of them can still be written in INDI Properties.
