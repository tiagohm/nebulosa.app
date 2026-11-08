# Sky Framing Integration Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- Delivered: Framing is a panel view of Sky (`web/src/sky/FramingPanel.tsx`) that draws the field of view around the selection (`syncFraming` of `planetarium.ts`, the gnomonic outline of `framePolygon`) from an `OpticalPreset` or the Equipment Setup, resolved by `resolveFraming` of `web/src/sky/framing.ts`: angular size, image scale, and position angle measured from north through east. Its Equipment Setup source combines the sensor of a camera role or a manual one with the optics that camera looks through (`usesGuideTelescope`): the profile's guide telescope (`guideTelescope`) for the Guide Camera, its telescope otherwise; the panel edits those optics under their name.
- Planned, nothing built yet: survey images from `hips2fits` (`core/src/adapters/sky/hips2fits.ts`) through an `api` proxy route that caches cutouts and survey lists and returns the survey's attribution. Network failure leaves the planetarium framing usable.
- The cutout is to be requested in TAN projection centered on the framing center, with the field and rotation of the framing, so its pixels match the outline of `framePolygon`. The first task is a test that pins the sign convention of the position angle against a cutout's WCS.
- Pixels are not assumed to be linear in RA/Dec. Any overlay on the survey uses the cutout's WCS.
