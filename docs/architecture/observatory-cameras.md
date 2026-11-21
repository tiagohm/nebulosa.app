# Observatory Cameras

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Observatory cameras are IP security cameras watching the site, over RTSP or RTSPS, shown live in the browser through a MediaMTX gateway.
`ObservatoryCameraService` (`api/src/observatorycameras.ts`) owns them, with their store, the key of their addresses, the gateway, and the WHEP broker in the neighbouring `api/src/observatorycameras.*.ts` modules; the tool is `web/src/tools/observatorycameras/`.

## Purpose

An operator working remotely, or leaving the rig unattended, needs to see the observatory itself: the mount, the dome, and the sky over them.

## Relations

- They are site resources, not devices: no connection, equipment setup role, operation, or reservation involves them, and watching one holds nothing.
- A camera may belong to an [observing site](observing-sites-and-time-zones.md), or be shared by every site.
- The gateway is MediaMTX, configured in [External Tools](external-tools.md); only the signaling passes through the server, and the video goes from the gateway to the browser over WebRTC.
- The catalog is one per server, in the operational database (see [Persistence and State](persistence-and-state.md)), with the address encrypted by a key from the environment or the credential storage of the operating system.
- Hosted by the Tools workspace; a picture-in-picture window keeps playing in every workspace.

## Rules and Limitations

- The whole address is a secret: no snapshot, event, log line, or error carries it, a copy of the database without its key cannot give it back, and nothing is saved without a usable key.
- Nothing plays until the operator starts a preview, and a tab decodes each camera once.
- Without MediaMTX the cameras are kept but cannot be watched; nothing else of the server depends on it.
- The gateway relays and never transcodes, so cameras should send H.264; there is no recording, snapshot, HLS, ONVIF, or PTZ.
- The browser must reach the WebRTC media port of the server.
- There is no authentication: anyone who reaches the API can watch the cameras and change them, so the server belongs on a trusted network or behind a VPN.
