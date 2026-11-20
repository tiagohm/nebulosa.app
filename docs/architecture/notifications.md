# Notifications Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Notifications are facts about operations, never their state: `NotificationService` (`api/src/notifications.ts`) receives every event of the connections, operations, and sessions as a subscriber of the `ServerEventDispatcher`, after the broadcast (see [Routes and Events](routes-and-events.md)), and keeps only what `NotificationClassifier` (`api/src/notifications.rules.ts`) asks for.
  Its own `notification:created`, `notification:read`, and `notification:dismissed` events are broadcast directly, never classified again.
  Classifying, storing, and publishing never throw into or wait inside the publishing service.
- Classified transitions: lost connections (`connection:close` with cause `lost`, warning, per loss and server run);
  ended Meridian Flip executions (success when imaging is ready, warning when cancelled, error otherwise);
  completed or failed captures, Auto Focus runs, Flat Wizard runs, and Dark Library Wizard runs (success or error);
  failed masters of the Calibration Library, and completed ones a wizard asked for;
  TPPA ready to refine (info) or failed;
  iPolar ready to refine, within its requested threshold (info, once per session), or failed;
  each new Flat Wizard or Dark Library Wizard manual step, by `stepId` (warning), and their cleanup warnings;
  guiding calibrations completed and sessions ended by a failure;
  failed DARV measurements, by generation;
  Mount Pointing Model sessions left `blocked` (error), paused by a failure (warning, once per operation), and acquisition runs completed (info);
  Target Centering sessions left `blocked` (error), failed, and completed with the position verified (success, or a warning when guiding was not restored);
  failures of the long-running device commands (go to, slew, flip, park, unpark, home, home search, focuser, wheel, and rotator moves, rotator home, cover and dome commands);
  Meridian Flip Monitor `flipCandidate`, `deadlineApproaching`, and `deadlinePassed` (warning, once per monitor, episode, and kind; the first two left out while a flip of the mount is armed or running, since the Executor reports how it ended) and `monitorUnavailable` near the meridian (warning, per transition), never a verified flip;
  each global message of an INDI server (`indi:globalMessage`, info `indi.globalMessage`, titled INDI Server, per occurrence id and epoch), and each suppression of the rest of a window of them (`indi:globalMessagesSuppressed`, info `indi.globalMessagesSuppressed`, a fixed text, per window), without a target (see [INDI Messages Contract](indi-messages.md)).
  Quiet: progress, telemetry, frames, device events, successful operations, session operations (reported by their sessions), manual moves, pulses, property writes, every `aborted` failure, and the `removed` or `disconnected` failures of a connection closed on request, until it opens again.
  Sessions read as the fixed text of their failure reason, since errors can hold server paths; an output file that already exists is the one cause described (`failureText`), by its file name and with the way past it.
  Target Centering quotes its session error.
- Each record (`NotificationRecord`: id, sequence, creation instant, level, stable code, title, message, source with the connection endpoint, optional target, and whether it was read) is created once per occurrence key while the key is younger than the retention, even after the record was dismissed.
  Text comes from fixed templates, device names, and fixed descriptions of the failure reasons, cut to 80 characters for the title and 240 for the message;
  driver errors, paths, and payloads are never copied, but for the global messages of an INDI server, which are the server's text for people and are copied as the INDI message service cleaned them.
  Targets are typed (`tool`, the Calibration Library with a group or the Meridian Flip Monitor, `cameraTool` with the camera tab tool, or `equipment`), never URLs or commands.
- History: in server memory only, never in the database: a restart of the server starts an empty history, and its occurrences may be notified again.
  At most 500 records for 30 days, the older ones dropped when a record is created or the history is read; an occurrence older than the retention may be recorded again under a new sequence.
  `GET /api/notifications` answers the whole retained history, newest first.
  The history and its read states are the same for every tab: `POST /api/notifications/read` marks notifications read and publishes `notification:read` with the ids that were unread, and `POST /api/notifications/dismiss` removes them from the history and publishes `notification:dismissed` with the ids it held (both take `NotificationIdsRequest`, ignore unknown ids, publish nothing when nothing changed, and answer 204).
- Web: `notificationsState` (`web/src/notifications/notifications.ts`, in `SERVER_STORES`) mirrors the events and refetches the history on every socket open, replaying the notification events received during the request.
  Reading and dismissing (`markNotificationsRead`, `dismissNotifications`) are asked of the server and applied when their events arrive, so every tab follows them; a dismissed notification also leaves the toasts.
  Only notifications arriving live after the first fetch become toasts (`NotificationToasts`, mounted once by the shell; info never).
  A toast writes its severity as a word, and notifications with the same code, title, message, and connection share one toast with a count.
  A success hides itself after its reading time (`toastDuration`: 2 s plus 40 ms per character of title and message, at most 8 s), which stops while the toast is hovered or focused; an error or a warning stays until hidden or viewed.
  At most 3 toasts show: a new one drops the oldest success first, and the oldest toast only when none is a success, so a burst of successes never hides an error.
  Hiding a toast never marks it read; when its target can be opened now, the whole toast is the View action, which marks every notification of the toast read.
  The stack sits above the status bar at the bottom right, left of the contextual panel while it is docked and open (`data-docked-panel`).
  The same host shows a toast of the tab itself when its event socket stays closed for 5 s after it was open (`onClose` of `web/src/events.ts`, `NotificationsState.server`), then a short reconnected toast when it reopens;
  the server cannot report its own loss, so this toast never enters the history.
- Scope: the bell counts and the panel lists the notifications of the active profile's saved connection, matched by endpoint so they still count after it closed, plus application-wide ones; the panel can show every connection.
  Mark all as read marks read, and Dismiss all removes from the server history, the notifications the panel lists under its current filter and scope, for every tab.
  Choosing a notification marks it read and opens its target only when it is open now (`web/src/notifications/target.ts`: the camera tab of that camera, or the device of the watched connection);
  it never switches profile or connection, commands a device, or touches a session.
- Limitations: no browser, sound, or remote delivery; the history and its read states are lost when the server restarts; read states are shared by every tab and profile, never kept per profile; a camera tab shows only the latest session of its camera, so an older session is not reopened.
