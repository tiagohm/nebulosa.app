# Annotation

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Annotation identifies what an image document shows from its WCS, never from its pixels: catalog stars, deep-sky objects, constellations, and, on request, solar-system bodies.
`AnnotationService` (`api/src/annotations.ts`) scans the embedded sky catalog (`api/src/sky/`) for the field, and asks the IMCCE SkyBoT service for the solar-system bodies of the same field.
Images → Annotation (`web/src/images/AnnotationPanel.tsx`, store and overlay in `web/src/annotations/`) runs it, lists the objects in the field, and draws them.

## Purpose

An operator wants to know which objects a frame contains and where, to confirm a target, find what else is in the field, and spot moving bodies.
It turns a plate solution into named objects and links them to the rest of the app.

## Relations

- An analysis job of the [Shared Image](shared-image.md) store; it holds no device.
- The WCS is a [Plate Solving](plate-solving.md) solution of the image, else the WCS of its header, frozen when the job is submitted.
- The local job reads the embedded sky catalog built by `bun make:catalog`; the solar-system search uses the toolkit's SkyBoT client and needs the network.
- The observation instant and site come from the image header, read by the toolkit (`core`).
- Selected objects open in the [Sky Map](sky-map.md) at the current time or the image time; minor bodies are looked up there by designation.
- The drawing is an [Overlay](overlay.md); its defaults come from the profile (see [Persistence and State](persistence-and-state.md)), and on a camera tab a run holds the frame shown (see [Capture Frames](capture-frames.md)).

## Rules and Limitations

- Nothing is solved implicitly, and a local annotation queries no network.
- Positions are astrometric ICRS (J2000), never apparent of date; a request carries no instant or observer.
- The overlay is drawn only over the image annotated and only while the solution shown is the one it was computed with.
- A solar-system position that could not be corrected for the site stays geocentric and is labelled so, never shown as topocentric; there is no fallback to another service.
- The catalog is not complete to any magnitude, solar-system positions are predictions, planets SkyBoT cannot compute are missing, and there are no artificial satellites.
- Without a site in the header the Moon may be up to a degree off, and the Sky workspace shows objects from the profile's site, not the image's.
- There is no annotated image export.
