# Routes and Events

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

How the server exposes its services to the tabs, and how its state reaches them.

## Routes

- Every route lives under `/api/`.
- Each `api` service exposes its routes through a `create<Name>Routes(service)` factory in its own module; `api/src/index.ts` only composes the services, spreads their routes, and serves the health check and the event WebSocket.
- The identity of the distribution is the one route composed by `app/src/server.ts` instead, since `app` owns it and `api` never imports `app`.
- Every error response is `{ error, code }` (`ApiError` and `errorResponse` of `api/src/http.ts`): a message meant for people and a stable code a client branches on, never on the message.
- Each service names its codes in a `<Name>ErrorCode` union, and a route may add documented fields, such as the current state after a conflict.
- A failure a route lets through is logged and answered as an internal error by the error handler of the server.

## Events

- Server state reaches every tab through `GET` snapshots plus the `/api/ws` event stream (`ServerEvent` of `api/src/websocket.ts`).
- A tab refreshes its snapshots on every socket open, so a reload never loses running work.
- A socket that drops an event under backpressure is closed by the server, so its tab reconnects and refreshes instead of mirroring a state that lost an event.
- Events never carry pixels or secrets; a client fetches pixels and full records through the route of their owner.
- An event is an observation, never the outcome of a command: delivery is synchronous, in memory only, and never replayed.
- The events of connections and devices, operations, and the sessions of services are published through one `ServerEventDispatcher` (`api/src/events.ts`, `publish` of `api/src/index.ts`), whose subscribers are, in order, the WebSocket broadcast, the operation history, and the notification history, so a tab sees a change before the notification about it.
- A service of the process that observes the others, such as a caller composing tools, subscribes to the dispatcher after them; an observer that throws is reported and skipped.
- Other events, such as those of the workspace, the analysis jobs, and the held motions, go to `broadcast` directly, so neither the histories nor an in-process observer see them.
- An event another feature will need is added to `ServerEvent` by the service that owns it and published through the dispatcher.

## Subscribed Streams

- The INDI property stream and the INDI message stream of a physical device are the exception: they are never broadcast ([INDI Properties](indi-properties.md), [INDI Messages](indi-messages.md)).
- A tab asks for one over its own `/api/ws` socket and receives a full snapshot on it, then the changes, as one ordered stream without a `GET`.
- The subscription belongs to the socket, not to the tab, and ends with it.
- Those subscription requests are the only messages the server reads from a socket (`ClientMessage`).

## Web Stores

- Each web store that mirrors server state is registered once in `SERVER_STORES` (`web/src/main.tsx`) with its event handler and its refresh.
- Events keep arriving while a snapshot is fetched, so a store that can receive an event before an older snapshot answers records what the events changed during the refresh (`SnapshotRefreshes` of `web/src/refresh.ts`) and keeps it over the snapshot, so a session that ended during the request is never shown running again.
