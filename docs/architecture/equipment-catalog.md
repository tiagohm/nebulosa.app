# Equipment Catalog

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Equipment Catalog is the stable identity of the physical cameras that calibration frames and masters are recorded against, and of the telescopes and lenses the Equipment Setup looks through.
It holds the cameras and telescopes of the catalog (`api/src/workspace.ts`), part of the workspace, and the binding of each camera device to a camera (`api/src/equipmentcatalog.ts`), kept by the server.
It is edited in Settings → Equipment Catalog (`web/src/settings/EquipmentCatalogSettings.tsx`), and bindings in the Equipment Setup (`web/src/equipment/`).

## Purpose

Calibration only holds when frames and masters are known to come from the same physical camera, whatever connection, endpoint, or driver reached it.
The catalog gives that camera one identity, and gives profiles shared optics instead of values typed again in each one.

## Relations

- One catalog is shared by every profile, tab, and browser, like the observing sites (see [Persistence and State](persistence-and-state.md)).
- The [Dark Library Wizard](dark-library-wizard.md) and the [Flat Wizard](flat-wizard.md) resolve the camera of their device, and an import of the [Calibration Library](calibration-library.md) takes it from the operator.
- [Capture Frames](capture-frames.md) records the bound camera of each frame, and [Guiding](guiding.md), [Live Stacking](live-stacking.md), [iPolar](ipolar.md), and [Image Stacking](image-stacking.md) resolve theirs from bindings or recorded frames.
- A camera's declared sensor completes the field of view of the Equipment Setup with what its device does not report.
- A telescope gives its aperture and focal length to the Telescope and Guide Telescope of a profile, read by the Sky, the framings, Guiding, the Observing Planner, and the [Calculator](calculator.md).
- Model searches fill cameras and telescopes from catalogs of the AstroBin equipment database that `bun make:cameras` and `bun make:telescopes` bundle into `web`; nothing asks AstroBin at run time.

## Rules and Limitations

- A camera's id never changes, and a camera that frames or masters are recorded against cannot be deleted; an archived camera or telescope is no longer offered and keeps what refers to it.
- A binding belongs to the physical device, not to a profile, and a camera is bound to one device at most.
- A frame records its camera once, when it is taken, so binding again never changes what was recorded; nothing compares a model, serial number, or name with a frame.
- A telescope is not a device: nothing checks that it is the one in use, and choosing one copies its values into the profile.
- No protocol gives a serial number, so a device is known only by its endpoint and driver name: another host, port, or protocol is another device, an INDI server whose address changes gives other devices, and two cameras that swap enumerated names swap bindings.
