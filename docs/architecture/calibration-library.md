# Calibration Library

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Calibration Library keeps the calibration frames (darks, flats, biases, and dark-flats) Nebulosa knows of, explains which of them can be combined, and builds and keeps the masters made of them.
It lives in `api/src/calibrationlibrary.ts`, with its compatibility rules in `api/src/calibrationlibrary.compatibility.ts` and master integration on a worker of its own (`api/src/calibrationlibrary.worker.ts`).
Its tool is `web/src/tools/calibrationlibrary/`, mirrored through `web/src/calibrationlibrary/calibrationlibrary.ts`.

## Purpose

A calibration is only as good as the match between a master and the lights it corrects.
The operator needs one place that knows every frame, how each value about it is known, and why a group can or cannot become a master.
The library is that single owner: every feature that calibrates frames takes its masters from it instead of finding files of its own.

## Relations

- Hosted by the Tools workspace; frames and masters open in Images.
- Frames come from the [Dark Library Wizard](dark-library-wizard.md) and the [Flat Wizard](flat-wizard.md), which publish what they acquire and may ask for masters when their session ends, and from directories and files an operator imports.
- Every frame and master is recorded against a camera of the [Equipment Catalog](equipment-catalog.md), declared by a wizard or by the operator on import, never taken from a header.
- [Image Stacking](image-stacking.md), [Live Stacking](live-stacking.md), [Guiding](guiding.md), and [iPolar](ipolar.md) calibrate their frames with masters chosen from the library.
- Uses the toolkit for reading frames and for calibration.
- Frames and masters are rows of the operational database (see [Persistence and State](persistence-and-state.md)); master files live under the library's directory of the data directory.
- Needs no connection, claims no device, and runs no operation; automatic builds wait while a camera operation runs.
- Failed masters, and completed ones a wizard asked for, become [Notifications](notifications.md).

## Rules and Limitations

- The library lists the masters that match a target and never picks one; the operator chooses, and a consumer keeps the master and content digest it used.
- A chosen master is read only while its content is the one chosen and it is available, and a master cannot be deleted while a master, a job, or an analysis depends on it.
- Frames are referenced, never written; nothing is inferred from a file or directory name; only an operator deletes.
- Compatibility is explained, never scored: a known difference blocks, an unknown value never matches a known one, and there is no closest master, dark scaling, or temperature interpolation.
- Every build publishes a new immutable master.
  Masters in digital numbers keep their pedestal, and a master flat is normalized and exists only from flats corrected by a dark-flat or a bias.
- There is no optical train, so flats are grouped by the filter, telescope, and focal length their headers write.
- Jobs live in server memory: a restart forgets them, the masters a wizard asked for among them, and nothing asks for them again.
