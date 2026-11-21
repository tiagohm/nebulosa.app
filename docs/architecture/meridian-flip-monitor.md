# Meridian Flip Monitor

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Meridian Flip Monitor follows one mount and forecasts its meridian passage: the hour angle, the flip window, and whether the pier side it reports suggests a flip is due.
It is `MeridianFlipService` (`api/src/meridianflip.ts`), which classifies the passage with the toolkit's `evaluateMeridianFlip` and commands nothing.

## Purpose

An unattended night on a German equatorial mount has to flip around the meridian.
The monitor gives every other feature one shared, passive reading of when that passage comes and whether a flip may be needed, without touching the mount.

## Relations

- Reads the telemetry of the toolkit's `Mount`, the site the mount reports, and the host clock; never the profile's observing site, which the server does not know.
- Watches the motion operations of its mount (slews, GoTos, flips, park, and the sessions that slew it) to tell an observation apart from a repositioning.
- Shown by the [Meridian Flip](meridian-flip.md) tool and the status bar.
- The [Meridian Flip Executor](meridian-flip-executor.md) reads it to decide and time a flip.
- Its transitions become [Notifications](notifications.md).
- Nothing is persisted.

## Rules and Limitations

- It reserves no device, starts no operation, and never pauses an exposure, guiding, or tracking.
- One monitor exists per physical mount, process-wide: a tab, a profile, or a reload never enables, disables, or redirects it; the removal of its mount or the close of its connection removes it, and a restart leaves none.
- A flip candidate means a flip may be needed, never that one is safe or authorized; a change of pier side is an observation, never a verified flip.
- The window is a timing preference, not a physical limit of the mount, and its settings are not validated by the server.
- Nothing is replayed, so a consumer checks the current context, episode, and state before acting.
- A non-sidereal target is only approximated, and the intended object of an external GoTo cannot be known.
