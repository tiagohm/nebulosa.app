# Observatory Cameras Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Observatory cameras are IP security cameras watching the site (RTSP or RTSPS).
  They are site resources, not devices: no connection, equipment setup role, operation, or reservation involves them, and watching one never holds the mount, the cameras, or the dome.
  `ObservatoryCameraService` (`api/src/observatorycameras.ts`) owns them, with the store (`observatorycameras.store.ts`), the key (`observatorycameras.secret.ts`), the gateway (`observatorycameras.gateway.ts`), and the WHEP broker (`observatorycameras.whep.ts`).
- Definitions are one catalog per server in `observatory_cameras`: name, optional observing site (absent for a camera shared by every site; deleting the site makes it shared and republishes it), enabled, position, RTSP transport (`tcp` or `automatic`), and the address.
  `PUT /api/observatory-cameras/:id` creates one (revision 0, the tab makes the id) or edits it from its revision (`409 conflict` with the current camera); `DELETE` removes it and ends its sessions.
  The address is required to create, and an edit without it keeps the saved one; the only check is that it is an `rtsp:` or `rtsps:` URL (`422 invalidSource`).
- The whole address is a secret, its path and query included: the database keeps it only as AES-256-GCM ciphertext with the camera id as additional data, a nonce per write, and the id of the key (the first 16 hexadecimal digits of its SHA-256).
  The 32-byte key comes from `NEBULOSA_CAMERA_SECRET_KEY` (base64) when set, else from the credential storage of the operating system (`Bun.secrets`, named after the database file), where the first save makes it; it never lives in the database.
  Without a usable key nothing is saved (`503 secretKeyUnavailable` or `secretKeyInvalid`), and a row written with another key makes its camera unavailable (`secretKeyMismatch`) until its address is saved again.
  A copy of the database without its key cannot give the addresses back.
  Clients only see `sourceConfigured` and `sourceHost` (the host name, without user, password, port, path, or query); no snapshot, event, log line, or error carries the address.
- One MediaMTX process (External Tools, `mediamtx`, 1.21 or a later 1.x checked with `--version`) serves every camera.
  It runs while any camera is enabled and MediaMTX is set, configured only by `MTX_*` variables in an empty private temporary directory: the control API and WebRTC signaling listen on loopback ports chosen at each start, WebRTC media on UDP 8189 of every interface with the addresses of the interfaces as ICE candidates, and every other protocol, recording, and hook is off.
  Each enabled camera is the path `obs-<id>`, configured through the control API with `sourceOnDemand` (15 s to start, closed 10 s after its last reader);
  the server brings the paths to the database after every save and start, and never touches a path without that prefix.
  Its output is only classified (`sourceAuthFailed`, `sourceNotFound`, `sourceUnreachable`, `sourceFailed`) and never logged.
  An unexpected exit is followed by at most 3 restarts (after 1, 4, and 16 s); a stop waits 2 s for it to exit, then kills it, from both the stop signals and `stopServer`.
  Without MediaMTX the cameras are kept and the gateway is `notInstalled`; nothing else of the server depends on it.
- A browser watches a camera through `POST /api/observatory-cameras/:id/whep` (its SDP offer): the server sends it to the gateway's WHEP endpoint of the camera's path on loopback, answers `201` with the gateway's SDP and a session URL of its own (`/api/observatory-cameras/:id/whep/sessions/:token`), and keeps the gateway's session resource in memory, bound to the camera and to the gateway process.
  `PATCH` carries trickle ICE candidates; `DELETE` ends the session and always answers `204`.
  A token of another camera or of a former gateway process is `404 sessionExpired`.
  A source that fails is `502` with its code, a stream WebRTC cannot carry `unsupportedCodec`, a disabled camera `409 disabled`, and a gateway that is not ready `503 gatewayUnavailable`.
  Sessions the gateway no longer has are forgotten every 10 s, and a new address, a disabled or removed camera, and a gateway restart end them.
  The signaling only passes through the server: the video goes from the gateway to the browser over WebRTC, so the browser must reach UDP 8189 of the server.
- `GET /api/observatory-cameras` is the snapshot (`epoch`, `revision`, the key, the gateway, the ICE port, the cameras, and their streams).
  A stream is `disabled`, `idle` (nobody watches it), `connecting`, `ready` (the gateway receives it, read every 2 s while watched), or `unavailable` with its code; whether a tab shows the video is that tab's own.
  Every event carries the epoch and the next revision.
- Tools → Observatory Cameras (`web/src/tools/observatorycameras/`, mirror `observatorycameras.ts` in `SERVER_STORES`) shows the cameras of the active site and the shared ones by default (or of every site, or of one), in a grid of 16:9 tiles letterboxed to each camera's aspect, with the status under the frame, never over the video.
  Nothing plays until the operator starts a preview, of one tile or of every tile on screen; a tile otherwise shows a static placeholder and opens no stream, and a restart or a reload plays nothing by itself.
  The players are the tab's (`player.ts`): one WHEP session per camera (`whep.ts`, adapted from the `reader.js` of MediaMTX, video only, trickle ICE), whose stream the tile, the enlarged view, and the mini-player all show, so a camera is never decoded twice in a tab.
  A player is `connecting`, `playing` from its first frame (with the time since), `reconnecting` after a lost connection or a gateway that is not ready (at most 3 times, after 2, 4, and 8 s), `paused` while its tile is off screen (unless docked) or the page is hidden (unless in picture-in-picture), or `failed` until Retry, as when the camera refuses the stream or no frame arrives within 25 s.
  The mini-player (`CameraViewerHost`, mounted by `ApplicationShell` beside the workspaces, bottom left) keeps the docked players playing in every workspace;
  a tile that unmounts stops its player unless docked, and leaving the page ends every session.
  Full screen and picture-in-picture are the browser's own, offered when it supports them.
  The editor never shows a saved address: an empty one keeps it.
- MediaMTX relays, it never transcodes: cameras should send H.264 (no B-frames for every browser); H.265 plays only where the browser supports it.
  There is no recording, snapshot, HLS, ONVIF, or PTZ.
  There is no authentication: anyone who reaches the API can watch the cameras and change them, so the server belongs on a trusted network or behind a VPN, as the External Tools Contract says.
