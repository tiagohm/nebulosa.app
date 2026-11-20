# Mount Remote Control Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Mount Remote Control tool of the Rig & Observatory group: the LX200 and Stellarium listeners that expose a mount to planetarium programs.

- Mount Remote Control (`api/src/mountremotecontrol.ts`, `web/src/tools/mountremotecontrol/`): exposes the MOUNT of the active profile's Equipment Setup to planetarium programs through `Lx200ProtocolServer` and `StellariumProtocolServer`.
  The tool never chooses a mount: without a MOUNT, or with one that is unavailable, disconnected, or switching, Start is disabled with the reason, and Equipment Setup is offered.
  A listener exists per (open connection id, exact mount id, protocol), so one mount may run an LX200 and a Stellarium listener at once and several mounts may be exposed by different tabs;
  the registry is process-wide, never per tab or profile, and switching profile, setup, or workspace, or closing the tab, never stops or redirects one.
  `POST …/remote-control/:protocol/start` with `{ host, port }` answers the listener (`MountRemoteServer`), whose `addresses` are where a client on another computer connects (`reachableAddresses`): the host itself when it names one interface, or the external addresses of the computer a wildcard host binds (IPv4 for `0.0.0.0`, both families for `::`, link-local IPv6 left out), read again at every publication and snapshot;
  a repeated start with the same binding answers it again, another binding is `409 conflict`, a taken address `409 addressInUse`, another bind failure `500 bindFailed`, each message saying how to recover (stop the listener first, choose another port, use an address of this computer), and a failed start leaves the other listeners running.
  `/stop` (idempotent, 204) closes its clients and waits for their manual motions to stop; `DELETE …/clients/:clientId` closes one client (204, also when it already left).
  A listener stops with its mount (`device:updated` disconnected, `device:removed`) or connection (`connection:close`) and with the process, and is never restarted by itself.
  `GET /api/mount-remote-control` (`MountRemoteSnapshot`) and `mountRemoteControl:updated` carry an epoch per process and a revision per change, so the mirror (`listeners.ts`, in `SERVER_STORES`) drops a snapshot or start response older than an event it applied.
  Each protocol is a card with its state as a `StatusBadge` (Stopped muted, Starting or Stopping neutral, Serving active) and its own Start or Stop, kept in the card rather than among the workspace actions because the two listeners run independently.
  A stopped card shows the Host and Port to bind; Start is disabled with the reason as its tooltip (the mount's blocker, an empty host, a request in flight).
  A serving card shows instead a readout: Connect to, each address of `addresses` with the port (selected whole by one tap, or No network address), and Listening on, the binding itself when it is not one of them; then who can connect, that it keeps running on the server when the tab closes, Stop, and its clients, each as IP:port with Disconnect (Waiting for a planetarium to connect while there is none).
  The status bar and its details show the listeners of the profile's mount from every workspace (see [UI and Layout Contracts](ui-and-layout.md)).
  How It Works, a disclosure closed until opened, explains connecting a program, what clients may command, and what a listener exposes.
  Clients are not authenticated; the default binding is `0.0.0.0` (every interface) on 10002 for LX200 and 10001 for Stellarium, and whenever the host is not a loopback address the tool says beside the binding, in the warning tone, that anyone on the network can move the mount.
  Commands run through the shared `MountCommands` commander and the operation registry, never a second command path: positions are the mount's (equinox of date) converted to J2000 at the server's time;
  a goto (`goToNow`, the same refusals as the goto route, above the horizon of the site the mount reports) or a sync (`syncNow`) is admitted or refused at once, LX200 answering it (`:MS#` `0` or `1Slew not possible#`, `:CM#` `#` or `Sync failed#`) and Stellarium only logging a refusal, and an admitted goto (`mount.goto`) goes on if its client leaves.
  An LX200 client's manual motion is its own `mount.remoteMove` operation, its commands run in order, another client's or a nudge's motion refuses it, and it stops when every axis is released, the client disconnects, the listener stops, or after `REMOTE_MOTION_WATCHDOG` (30 s);
  `:Q#` is the emergency stop of the mount.
  An LX200 client may set the mount's site (`:St#`, `:Sg#`, such as the GPS position Stellarium Mobile sends): the latitude and longitude are admitted at once, refused (`0`) while the mount is disconnected or held by an operation, and written together through the commander (`mountLocation`) after 250 ms, keeping the elevation;
  clock commands never change the mount (setters answer `0`), and slew rates are ignored.
  Stellarium clients receive the position every second.
  The host and port a listener was last started with are remembered per saved connection, mount, and protocol in the profile; a serving card always shows the actual binding.
