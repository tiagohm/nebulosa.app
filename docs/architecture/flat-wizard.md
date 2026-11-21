# Flat Wizard

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Flat Wizard acquires FLAT frames for one camera, filter after filter: it searches the exposure that brings each filter to its target level with trial frames, then takes the final frames and keeps only the accepted ones.
The session lives in `api/src/flatwizard.ts` and measures every frame on a worker of its own (`api/src/flatwizard.analysis.ts`) in the digital numbers of the file.
The web tool is a camera operation of the Images camera tabs (`web/src/images/FlatWizardTool.tsx`, `web/src/camera/FlatWizardPanel.tsx`).

## Purpose

Flats correct vignetting and dust, and each filter needs its own set at a well-exposed level.
The wizard removes the trial and error of finding that exposure and the bookkeeping of the frames, so the operator gets a homogeneous, verified set per filter ready for the Calibration Library.

## Relations

- Holds the camera, and the filter wheel, flat panel, and dust cover the request names, in one manual operation from start to end, including while it waits for the operator (see [Operation Lifecycle Rules](operation-lifecycle-rules.md)).
- Without a wheel or a panel, the operator changes the filter or readies the light, and only an explicit confirmation of that step resumes the session.
- Takes its frames through the shared camera capturer with its own camera settings, snooping the wheel into them, and shows each one through the [Capture Frames](capture-frames.md) registry.
- Registers every published flat in the [Calibration Library](calibration-library.md) against the camera of the [Equipment Catalog](equipment-catalog.md) the camera is bound to; a camera bound to none is refused.
- When asked, hands the frames of each completed filter to the library at the end, which may queue a master flat per filter; the wizard builds no master itself.
- Opens the [Dark Library Wizard](dark-library-wizard.md) form prepared with matching dark-flats, moving nothing.
- Its manual steps, cleanup warnings, and outcome raise [notifications](notifications.md).

## Rules and Limitations

- The light stays constant within a filter: there is no automatic brightness search or sky flat.
- A published frame is never replaced or modified, and published frames stay whatever the session ends in.
- A light the session switched on is switched off, and a cover it closed is opened again, once the session ended; what could not be restored is reported.
- The wizard runs only as a manual operation.
- Without a wheel, the filter name only names the files and the session; it is not written into the FITS header.
- Sessions live in memory and do not survive a restart.
