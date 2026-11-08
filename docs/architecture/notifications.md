# Notifications Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Notifications are facts about operations, never their state: `NotificationService` (`api/src/notifications.ts`) receives every event of the connections, operations, and sessions as a subscriber of the `ServerEventDispatcher`, after the broadcast (see [Routes and Events](routes-and-events.md)), and keeps only what `NotificationClassifier` (`api/src/notifications.rules.ts`) asks for.
  Its own `notification:created` events are broadcast directly, never classified again.
  Classifying, storing, and publishing never throw into or wait inside the publishing service.
- Classified transitions: lost connections (`connection:close` with cause `lost`, warning);
  ended Meridian Flip executions (success when imaging is ready, warning when cancelled, error otherwise);
  completed or failed captures, Auto Focus runs, Flat Wizard runs, and Dark Library Wizard runs (success or error);
  failed masters of the Calibration Library, and completed ones a wizard asked for;
  TPPA ready to refine (info) or failed;
  each new Flat Wizard or Dark Library Wizard manual step, by `stepId` (warning), and their cleanup warnings;
  guiding calibrations completed and sessions ended by a failure;
  failed DARV measurements, by generation;
  Mount Pointing Model sessions left `blocked` (error), paused by a failure (warning, once per operation), and acquisition runs completed (info);
  Target Centering sessions left `blocked` (error), failed, and completed with the position verified (success, or a warning when guiding was not restored);
  failures of the long-running device commands (go to, slew, flip, park, unpark, home, home search, focuser, wheel, and rotator moves, rotator home, cover and dome commands);
  Meridian Flip Monitor `flipCandidate`, `deadlineApproaching`, and `deadlinePassed` (warning, once per monitor, episode, and kind) and `monitorUnavailable` near the meridian (warning, per transition), never a verified flip;
  each global message of an INDI server (`indi:globalMessage`, info `indi.globalMessage`, titled INDI Server, per occurrence id and epoch), and each suppression of the rest of a window of them (`indi:globalMessagesSuppressed`, info `indi.globalMessagesSuppressed`, a fixed text, per window), without a target (see [INDI Messages Contract](indi-messages.md)).
  Quiet: progress, telemetry, frames, device events, successful operations, session operations (reported by their sessions), manual moves, pulses, property writes, every `aborted` failure, and the `removed` or `disconnected` failures of a connection closed on request, until it opens again.
  Sessions read as the fixed text of their failure reason, since errors can hold server paths; an output file that already exists is the one cause described (`failureText`), by its file name and with the way past it.
  Target Centering quotes its session error.
- Each record (`NotificationRecord`: id, sequence, creation instant, level, stable code, title, message, source with the connection endpoint, optional target) is created once per occurrence key, also across restarts.
  Text comes from fixed templates, device names, and fixed descriptions of the failure reasons, cut to 80 characters for the title and 240 for the message;
  driver errors, paths, and payloads are never copied, but for the global messages of an INDI server, which are the server's text for people and are copied as the INDI message service cleaned them.
  Targets are typed (`tool`, the Calibration Library with a group or the Meridian Flip Monitor, `cameraTool` with the camera tab tool, or `equipment`), never URLs or commands.
- History: at most 500 records for 30 days in `notifications` of the operational database, each written in its own transaction, which also deletes what the history no longer retains, and published only once committed;
  the occurrence key is unique, so an occurrence is never recorded twice, and a deleted one may be recorded again under a new sequence.
  A record that cannot be written is reported on the console and not published.
  `GET /api/notifications` answers the whole retained history, newest first; there is no write route.
- Web: `notificationsState` (`web/src/notifications/notifications.ts`, in `SERVER_STORES`) mirrors the events and refetches the history on every socket open, keeping the events received during the request.
  Only notifications arriving live after the first fetch become toasts (`NotificationToasts`, mounted once by the shell; at most 3, success for 2 s, warning for 4 s, error for 5 s; info never).
  The same host shows a toast of the tab itself when its event socket stays closed for 5 s after it was open (`onClose` of `web/src/events.ts`, `NotificationsState.server`), then a short reconnected toast when it reopens;
  the server cannot report its own loss, so this toast never enters the history.
  Read and dismissed states belong to the active profile, which the server keeps (`profile_notification_state`, see [Persistence and State](persistence-and-state.md)).
- Scope: the bell counts and the panel lists the notifications of the active profile's saved connection, matched by endpoint so they still count after it closed, plus application-wide ones; the panel can show every connection.
  Dismiss all hides, and marks read, the notifications the panel lists under its current filter and scope.
  Choosing a notification marks it read and opens its target only when it is open now (`web/src/notifications/target.ts`: the camera tab of that camera, or the device of the watched connection);
  it never switches profile or connection, commands a device, or touches a session.
- Limitations: no browser, sound, or remote delivery; read states follow the profile, so a tab of another profile reads them apart; a camera tab shows only the latest session of its camera, so an older session is not reopened.
