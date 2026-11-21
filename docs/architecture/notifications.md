# Notifications

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Notifications are facts about operations: what ended, what failed, and what needs the operator's hand.
`NotificationService` (`api/src/notifications.ts`) keeps what `NotificationClassifier` (`api/src/notifications.rules.ts`) picks from the server's events, and the web shows them as a bell, a panel, and toasts (`web/src/notifications/`).

## Purpose

An operator away from the tool that started something still learns when it ended, failed, or waits for a manual step, without watching every tool.

## Relations

- Subscribes to every event of the `ServerEventDispatcher`, after the broadcast (see [Routes and Events](routes-and-events.md)).
- Classifies lost connections, captures, [Live Stacking](live-stacking.md), [Auto Focus](auto-focus.md), the [Flat Wizard](flat-wizard.md), the [Dark Library Wizard](dark-library-wizard.md), the [Calibration Library](calibration-library.md), the [SPICE Kernel Library](spice-kernel-library.md), [TPPA](tppa.md), [iPolar](ipolar.md), [Guiding](guiding.md), [DARV](darv.md), the [Mount Pointing Model](mount-pointing-model.md), [Target Centering](target-centering.md), the [Meridian Flip Monitor](meridian-flip-monitor.md) and [Executor](meridian-flip-executor.md), failures of long-running device commands, and the messages of an INDI server ([INDI Messages](indi-messages.md)).
- A notification may target a tool, a camera tool on its camera tab, or a device in [Equipment Control](equipment-control.md).
- The shell mounts the toasts once, and the tab also uses them to report the loss of its own event socket.
- The history is kept in server memory only.

## Rules and Limitations

- A notification is a fact, never a state; classifying, storing, and publishing never throw into or wait inside the publishing service.
- Progress, telemetry, successful operations, manual moves, and cancellations stay quiet.
- Text comes from fixed templates and device names; driver errors, paths, and payloads are never copied, except the messages of an INDI server, which are its text for people.
- One record is created per occurrence while it is retained, even after it was dismissed.
- Opening a target never switches profile or connection, commands a device, or touches a session.
- The history is bounded, is lost when the server restarts, and its read states are shared by every tab and profile.
- There is no browser, sound, or remote delivery.
