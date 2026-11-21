# Live Stacking

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Live Stacking integrates the light frames of Camera Acquisition as they arrive into online stacks, one per filter and field, that a camera tab shows and an operator saves.
It is a server-owned analysis session of one camera, not an operation: the session lives in `api/src/livestacking.ts`, the grouping policy in `livestacking.groups.ts`, the engine of fields and stacks in `livestacking.engine.ts` on a worker of its own, and the saved stacks in `livestacking.store.ts`, over the toolkit's live stacker.
The web tool is a camera operation of the Images camera tabs (`web/src/images/LiveStackingTool.tsx`, `web/src/camera/LiveStackingPanel.tsx`, store `web/src/camera/livestacking.ts`).

## Purpose

An operator wants to see the integrated result while capturing, without waiting for an offline stack.
Live Stacking gives that view, calibrated when the operator chooses masters, and saves it as a linear FITS at any time.

## Relations

- Receives every light frame of Camera Acquisition of its camera through the frame sink of the capture service (see [Capture Frames](capture-frames.md)), Preview Only frames included, and spans any number of captures.
- Groups frames by filter and acquisition cohort as [Image Stacking](image-stacking.md) keys them, and composes color views of mono stacks as it composes masters, sharing its color presets.
- Calibrates with the masters the operator chose from the [Calibration Library](calibration-library.md), limited to the camera's [Equipment Catalog](equipment-catalog.md) camera, leased while read.
- Serves its views as derived documents of the image store, so the viewer shows them and saves what it integrates.
- Saves stacks as products recorded in the database and on disk, listed to open in Images (see [Persistence and State](persistence-and-state.md)).

## Rules and Limitations

- It never commands or holds a device; it slows Camera Acquisition only by delaying the next exposure while its small in-memory queue is full.
- Every received frame is counted in exactly one outcome; why each one ended is not kept.
- The Calibration Library never chooses masters: a stack is calibrated only with masters chosen before its frames arrive, and no stack mixes calibrated and uncalibrated frames.
- Retained memory of all sessions is bounded, nothing is evicted, and a new field, stack, or held frame beyond it is refused.
- A failed worker loses the session's stacks, and the capture goes on.
- A color stack of a one-shot-color camera cannot be composed with mono stacks.
- Sessions survive no restart and frames received before a session started are not replayed; only saved stacks persist.
