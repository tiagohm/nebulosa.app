# Framing

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

A framing is the field of view of one camera behind one telescope: a name, the telescope and camera with where each comes from, the rotation of the sensor, and the colour it is drawn in.
The framings are one catalog shared by every profile, tab, and browser (`api/src/framings.ts`), mirrored and resolved into optics in `web/src/framing/`.
The Framing tool (`web/src/tools/framing/`) edits them and previews them together around a target, over an offline Mini-Sky of the sky catalog or a survey image (`api/src/framings.hips.ts`).

## Purpose

It lets the operator compare fields of view on a target and choose a rotation before imaging.
It is the one source of fields of view for every tool that applies one, so a camera and telescope are described once.

## Relations

- Hosted by the Tools workspace, in Planning.
- Takes its optics from values typed, from the AstroBin camera and telescope model catalogs bundled by `bun make:cameras` and `bun make:telescopes`, from the [Equipment Catalog](equipment-catalog.md), or from the telescope and camera roles of the Equipment Setup of the active profile.
- Draws the Mini-Sky from the sky catalog through the field query shared with [Annotation](annotation.md).
- Proxies CDS hips2fits cutouts of the surveys bundled by `bun make:surveys` from the CDS MocServer.
- Persists the framings in the database and publishes every change (see [Persistence and State](persistence-and-state.md)).
- Centers its preview on a catalog search, typed coordinates, the [Sky Map](sky-map.md) selection (Open in Framing, also from the [Moon Inspector](moon-inspector.md)), or the mount's current position, read only.
- Read by the [Sky Map](sky-map.md), which draws the framings around the selection, by the [Observing Planner](observing-planner.md), which judges how targets fit one, and by the [Calculator](calculator.md), which imports one by value.

## Rules and Limitations

- A framing never holds a position on the sky; a tool that needs one asks for it itself, so [Target Centering](target-centering.md) never takes its target from a framing.
- Consumers read the framings and never keep a copy; framings are created and edited only in the Framing tool.
- The pseudo-framings of the Equipment Setup's Main Camera and Guide Camera come first everywhere and are never saved; a tool that has no framing chosen uses the Main Camera's.
- Edits are written from the revision they were made on, and a conflict keeps the draft for the operator to resolve.
- The Mini-Sky works offline; survey images need hips2fits and never block the preview.
- Nothing here moves a device, changes the profile, or starts an operation.
