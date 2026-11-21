# Image Stacking

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Image Stacking turns light frames saved on the server into one linear master per filter and into color composites of those masters.
A project imports and groups its lights by filter, chooses calibration masters for them, measures and registers every frame, validates what a stack would do, integrates it, and composes color.
It lives in `api/src/imagestacking.ts`, with analysis, integration, and composition on a worker of its own (`api/src/imagestacking.worker.ts`); its tool is `web/src/tools/imagestacking/`.

## Purpose

It lets the operator integrate a night's captures without leaving Nebulosa, grounded in the same calibration masters and camera identity the rest of the app records.
It explains every decision and every blocker of a stack instead of guessing, so a master can be traced back to its frames, masters, and recipe.

## Relations

- Hosted by the Tools workspace; frames, masters, coverage maps, and composites open in Images.
- Uses the [Calibration Library](calibration-library.md) to scan headers, to match each group of lights against its masters, and to read and lease the masters the operator chose.
- The camera of a light is the [Equipment Catalog](equipment-catalog.md) camera its capture recorded (see [Capture Frames](capture-frames.md)), or the one an operator declares.
- Uses the toolkit for star detection, registration, normalization, subframe quality, stacking, debayering, calibration, and channel composition.
- Projects, frames, measurements, chosen masters, products, and composites are rows of the operational database (see [Persistence and State](persistence-and-state.md)); product and composite files live under its directory of the data directory.
- Needs no connection, claims no device, and runs no operation.

## Rules and Limitations

- Frame files are never written, moved, copied, or deleted, and files inside Nebulosa's own directories cannot be added.
- Roles and filters come from headers, never from names; filter names are taken exactly, so names spelled differently are different filters, and an operator's declaration never overrides what a header says.
- Lights are calibrated only with masters the operator chose among those the library matches; a group with none is not calibrated.
- One analysis, run, or composition works at a time; measurements are kept as they arrive, so a later analysis resumes.
- Products and composites are immutable: published group by group, reused when their inputs match, and marked stale or unavailable instead of rewritten.
- Composition mixes masters of one project, never light frames.
- There is no drizzle, masters and composites carry no WCS, and jobs live only in server memory.
