# Dark Library Wizard

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Dark Library Wizard acquires the raw DARK frames, or dark-flats, of a capture plan for one camera: groups of exposure and target temperature, each until it has its accepted frames.
The session lives in `api/src/darklibrarywizard.ts`, its immutable plan in `api/src/darklibrarywizard.plan.ts`, and every frame is examined on a worker of its own (`api/src/darklibrarywizard.analysis.ts`) in the digital numbers of the file.
The web tool is a camera operation of the Images camera tabs (`web/src/images/DarkLibraryWizardTool.tsx`, `web/src/camera/DarkLibraryWizardPanel.tsx`).

## Purpose

Darks must match the exposure, operating point, and temperature of the lights they calibrate, so a library of them takes long, repetitive sessions.
The wizard runs them with the light kept out and the temperature verified, so the Calibration Library can trust its frames.

## Relations

- Holds the camera, and only the filter wheel, flat panel, and dust cover its protection selected, in one manual operation from start to end, while paused or waiting for the operator too (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- Takes its frames through the shared camera capturer, cooling the camera to each group's target, and shows each one through the [Capture Frames](capture-frames.md) registry.
- Registers every accepted frame in the [Calibration Library](calibration-library.md) against the camera of the [Equipment Catalog](equipment-catalog.md) the camera is bound to; a camera bound to none is refused.
- When the plan asks for masters, hands it to the library at the end, which may queue one master per complete group.
- The [Flat Wizard](flat-wizard.md) prepares its form with the dark-flats matching the flats it saved.
- Its manual steps, cleanup warnings, and outcome raise [notifications](notifications.md).

## Rules and Limitations

- It is only an acquisition: browsing, importing, masters, and reuse belong to the Calibration Library, and no pixel it saves is ever calibrated or rewritten.
- The protection hardware can verify is checked again right before every exposure; what it cannot verify (a manual cap, the opacity of a filter, an unlit panel as the only barrier) is asserted by the operator when starting or resuming.
- A suspicion of light never rejects a frame by itself, since an image cannot prove the absence of light; it is recorded, or waits for the operator's decision.
- Pausing keeps every device held, so the protection cannot be undone unnoticed.
- The cooler is never switched off or warmed, and devices the session changed are restored when it ends only if no other operation took them first.
- Nothing is resumed: a plan that ended short of its frames stays that way, and the missing frames are a new start.
- A driver that silently stops reporting temperature looks like a stable sensor.
- The wizard runs only as a manual operation, and sessions do not survive a restart.
