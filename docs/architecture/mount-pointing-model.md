# Mount Pointing Model

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

A pointing model maps the coordinates a mount was commanded to onto the sky position it reached, fitted from plate-solved samples and applied as a software correction of GoTos.
The server side acquires samples (`api/src/mountpointing.sessions.ts`), fits them on a worker (`api/src/mountpointing.fit.ts`), keeps the model library (`api/src/mountpointing.ts`, `api/src/mountpointing.store.ts`), and corrects GoTos (`api/src/mountpointing.corrections.ts`).
The web side is the Pointing Model Builder of camera tabs (`web/src/camera/PointingModelBuilderPanel.tsx`), the Pointing Map (`web/src/mountpointing/`), and the Mount Pointing Model tool (`web/src/tools/mountpointing/`).

## Purpose

Mechanics, refraction, and the semantics of a driver make a mount miss its GoTo targets.
A model measured on the sky, and judged on sky it has not seen before it is used, lets GoTos land closer without relying on a native model of the mount.

## Relations

- The fit, the prediction, and the inverse correction are the toolkit's (`core/src/observation/mount/pointing.ts`); samples are reduced with the [Ephemeris Chain](ephemeris-chain.md).
- Images → Pointing Model Builder, a camera operation of the Main Camera's tab, acquires and verifies on the sky with the setup's mount, as `mount.pointingModel` and `mount.pointingVerification` operations holding the camera and the mount; it solves with [Plate Solving](plate-solving.md).
- Tools → Mount Pointing Model manages the models of the setup's mount without moving anything, and opens the builder on the Main Camera's tab.
- `MountCommands` applies the model in force to GoTos: the goto route, [Mount Remote Control](mount-remote-control.md), and the first slew of [Target Centering](target-centering.md).
- A Sync, a disconnection, a site or clock change, or an [INDI Properties](indi-properties.md) write of the mount's coordinates, site, or time suspends it.
- Models, samples, revisions, and verifications are rows of the operational database (see [Persistence and State](persistence-and-state.md)).
- Blocked or failed sessions and completed runs become [Notifications](notifications.md).

## Rules and Limitations

- Samples, revisions, and verifications are immutable: a fit adds a revision, and withheld samples never enter one.
- A model belongs to one mount, site, and optical train; a model of another mount can be read, never used.
- Activation is explicit and needs a revision that passed offline and on the sky, the same mount and site, and the operator's acknowledgment of what cannot be detected; one revision is in force per mount, in memory only.
- A suspended model never resumes by itself, and a restart leaves every mount inactive and every session interrupted.
- Flips, syncs, manual motion, guiding, sessions, centering corrections, and dithering are never corrected.
- Alt-azimuth mounts are refused.
- The sky is the operator's responsibility: nothing knows an obstacle or cable limit the driver does not report.
- A client talking to the driver directly is not corrected, a native model or a Sync made outside Nebulosa cannot be detected, the host clock defines sidereal time, and a model does not improve tracking.
