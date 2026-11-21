# Mount Remote Control

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Mount Remote Control exposes the mount of the active profile's Equipment Setup to planetarium programs through LX200 and Stellarium listeners.
It lives in `api/src/mountremotecontrol.ts`, over the toolkit's `Lx200ProtocolServer` and `StellariumProtocolServer`, and its tool of the Rig & Observatory group is `web/src/tools/mountremotecontrol/`.

## Purpose

Operators point their mounts from Stellarium, SkySafari, and similar programs.
The listeners let them do so while Nebulosa keeps arbitrating the mount, checking the horizon, and applying its pointing corrections.

## Relations

- Hosted by the Tools workspace; it chooses no mount and offers the Equipment Setup without one, and the status bar shows the listeners of the profile's mount (see [UI Structure](ui-and-layout.md)).
- Commands run through the shared `MountCommands` commander and the operation registry: GoTos as `mount.goto` operations, corrected by the [Mount Pointing Model](mount-pointing-model.md), syncs, an LX200 client's manual motion as its own `mount.remoteMove` operation, and the site an LX200 client sends.
- The [Meridian Flip Monitor](meridian-flip-monitor.md) sees its motions as mount motion.
- The binding a listener was last started with is remembered in the profile per saved connection, mount, and protocol; listeners themselves are memory only.

## Rules and Limitations

- A listener exists per connection, mount, and protocol, process-wide: switching profile, setup, or workspace, or closing the tab never stops or redirects one.
- A listener stops with its mount, its connection, or the process, and never restarts by itself.
- There is no second command path: a GoTo meets the same refusals as the goto route, and an admitted one goes on if its client leaves.
- A manual motion stops when every axis is released, its client leaves, the listener stops, or a watchdog fires; clock commands never change the mount.
- Clients are not authenticated, and the default binding is every interface, so anyone on the network can move the mount.
- The position reported is that of the corrected command, so a client sees the offset of a pointing model.
