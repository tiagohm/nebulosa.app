# Framing Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

A framing is the field of view of one camera behind one telescope: a name, the telescope and camera with where each comes from, and the rotation of the sensor, the position angle of its top edge measured from north through east, in degrees in [0, 360).
It never holds a position on the sky: a tool that needs one asks for it itself.

- **Server.**
  The framings are one catalog shared by every profile, tab, and browser (`FramingStore` and `FramingService` of `api/src/framings.ts`, table `framings`), with an id the tab that created one generates (`nanoid`), a name unique without regard to case (`409 nameTaken`), and a revision: `GET /api/framings` (`FramingsSnapshot`), `PUT /api/framings/:id` writes the whole framing from the revision it was edited from (0 creates it; `409 conflict` with the framing the server kept, `null` when it was deleted), `DELETE /api/framings/:id?revision=` (`409 conflict`, `404 notFound`), and `POST /api/framings/:id/duplicate` (`FramingDuplicateRequest`).
  Every committed write is published as `framing:updated` (the whole framing) or `framing:removed`.
- **Optics.**
  The telescope (`FramingTelescope`) and the camera (`FramingCamera`) each name their source (`FramingOpticsSource`): `manual` (typed), `model` (copied from a model of the AstroBin equipment database, whose name is kept), `catalog` (an item of the Equipment Catalog by id), or `setup` (the telescope or guide telescope, or the Main or Guide Camera role, of the Equipment Setup of the active profile of the tab).
  Each keeps the values last typed or copied: a `catalog` or `setup` source resolves them again from what it refers to and keeps them for what it does not declare or when it no longer exists.
  The reducer or Barlow factor is always the framing's own.
- **Field of a preview.**
  `POST /api/framings/field` answers the stars and deep-sky objects of the sky catalog in a cone around a J2000 center (`FramingFieldRequest`, `FramingField`), through the field query of the image annotation (`fieldObjects` of `api/src/sky/catalog.ts`): positions on the J2000 equator, stars moved by their proper motion to now, at most `FIELD_MAX_STARS` stars and `FIELD_MAX_DEEP_SKY` deep-sky objects, the brightest ones, down to the magnitude `fieldMagnitudeLimit` gives for the radius (9 at 1°, half a magnitude fainter each time the radius is divided by about 1.6, within 6 to 14).
