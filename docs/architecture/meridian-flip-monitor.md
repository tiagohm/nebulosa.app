# Meridian Flip Monitor Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- `MeridianFlipService` (`api/src/meridianflip.ts`) observes one mount per monitor and commands nothing.
  It reserves no device, starts no operation, and never pauses an exposure, guiding, or tracking.
  A monitor exists per physical mount (`resourceKey`).
  `POST …/meridian-flip/enable` takes `MeridianFlipSettings` and answers the monitor.
  It is idempotent for the same connection and mount id, and the same physical mount through another connection or id is `409 conflict`.
  `/disable` is idempotent (204).
  The registry is process-wide: a tab, a profile, a route, or a reload never enables, disables, or redirects a monitor.
  A removed mount (`device:removed`) or a closed connection (`connection:close`) removes its monitor, and a restart leaves none enabled.
- Inputs: the telemetry of the toolkit `Mount` (position of date and `hasEquatorialCoordinate`, the site the mount reports and `hasGeographicCoordinate`, tracking and track mode, park, motion flags, mount type, pier side) and the host clock.
  Never the active observing site of a profile, which the server does not know.
    - The hour angle is LAST − RA in (−π, π], positive west, and the forecast follows the signed hour angle, so it never jumps to the next day after the transit.
    - The monitor subscribes to the dispatcher after its other subscribers.
      `mount:updated`, `device:updated`, and a running motion operation of the mount (`mount.slew`, `mount.goto`, `mount.flip`, `mount.park`, `mount.unpark`, `mount.home`, `mount.findHome`, `mount.remoteMove`) evaluate it at once, and a 1 s timer evaluates every monitor so sidereal time is observed without new telemetry.
- Settings are wall-clock seconds:
    - early warning (900);
    - window minimum and maximum after the transit (300, 900);
    - deadline warning before the window closes (180);
    - settle time (2).

    `evaluateMeridianFlip` of the toolkit classifies them as hour angles, bounded to ±6 sidereal hours (`MAXIMUM_OFFSET_SECONDS`).
    The server does not validate them, so the tool keeps them within range.
    `PATCH …/settings` carries `expectedRevision` of `settingsRevision`, and an outdated one is `409 conflict` with the current monitor.
    The window is a timing preference, never a physical tracking limit of the mount.

- State (`MeridianFlipMonitor`) has three axes and a reason (`MeridianMonitorReason`):
    - availability: `waitingForMount`, `waitingForCoordinates`, `idle` (parked or not tracking), `repositioning`, `settling`, or `monitoring`;
    - timing phase: `unavailable`, `before`, `approaching`, `windowOpen`, or `pastDeadline`, with the instants of the warning, transit, window, and deadline in Unix ms.
      Quality is `approximate` for a track mode other than sidereal;
    - mechanical assessment: `unsupportedMountType` (ALTAZ, EQ_FORK), `unknown` (UNKNOWN type, no or `NEITHER` pier side, the pole), `notDue`, `alreadyOnExpectedSide`, `flipCandidate`, or `verificationPending` while repositioning or settling.
      It compares the side the driver reports with `expectedPierSide` of the position.
      A candidate means a flip may be needed, never that one is safe or authorized.
- Observation context: a tracking, still position stable for the settle time starts a context.
  The context is kept while the mount stays within `CONTEXT_TOLERANCE` (0.25°, a detection heuristic).
  A motion, a jump without motion (a sync or another program's GoTo), or a stop of tracking interrupts it.
  Settling back within the tolerance resumes it, and settling elsewhere starts a new context and episode (`targetChanged`).
  A refused command interrupts nothing, since only observed state counts.
  A disconnection forgets the context, and the reconnected mount starts a new one.
  The episode also changes when the target passes the lower meridian.
- Transitions (`MeridianFlipTransition`, `meridianFlip:transition`, after the `meridianFlip:updated` of the state they describe; the last `TRANSITION_HISTORY`, 100, per monitor at `GET …/transitions`, memory only):
    - `approaching`, `windowOpened`, `flipCandidate`, `deadlineApproaching`, and `deadlinePassed` (the last three with a candidate pending) are published once per episode;
    - `upperMeridianCrossed` is published only between two consecutive monitored samples of the same context, so a GoTo across the meridian is never a crossing;
    - `pierSideChanged` is an observation, and `externalFlipSuspected` is a change across a motion that came back to the same target in the window.
      Neither is a verified flip;
    - `monitorUnavailable` and `monitorRecovered`.

    `meridianFlip:updated` is published on a material change (availability, phase, quality, assessment, reason, pier sides, tracking, context, episode, settings) and at least every 30 s, so a tab interpolates countdowns from `sampledAt`.
    The snapshot (`GET /api/meridian-flip`) and the events carry an epoch per process and a revision per publication.
    A consumer subscribes, reads the snapshot, and checks `contextId`, `episodeId`, and the current state before acting, since nothing is replayed.

- `POST …/assess-exposure` (`MeridianExposureRequest`, seconds) evaluates the monitor and answers `MeridianExposureAssessment`; it starts and changes nothing:
    - `allowed` when the exposure ends before the window closes (with `latestSafeStartAt`) or no flip is pending;
    - `defer` when it would end after the window closes and the window has not opened;
    - `blocked` with a candidate pending in or past the window;
    - `unknown` without a monitored target, without evidence, or for another `expectedContextId`.

    The answer is valid for its context at that instant only.

- Limitations: the monitor commands no flip (the Meridian Flip Executor does, and Equipment Control keeps its own manual flip), and no physical clearance limit exists.
  A static right ascension only approximates a non-sidereal target.
  The monitor cannot know the intended catalog object of an external GoTo.
