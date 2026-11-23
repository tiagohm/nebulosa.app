# Open Images

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

Open Images brings back, after a reload of a tab, the files that tab had open in the Images workspace, each with its tab, its tool, and its view state.
`openImagesEntry` and `restoreImage` (`web/src/images/openimages.ts`) keep and restore them as a view entry of the tab; `ImageStore.claim` (`api/src/images.ts`) lets the reloaded page take back the documents it held.

## Purpose

A reload (a deploy of the development server, a page refresh, a phone that discarded the tab) used to close every file the operator had open and lose how each was looked at.
The operator finds the same files, in the same order, at the same zoom and pan, with the same display settings, overlays, plate solving request, measurements, and statistics area.

## Relations

- Keeps its state in the session storage of the tab through the view persistence (see [Persistence and State](persistence-and-state.md)); the server and other tabs never see it.
- Claims the documents of the [Shared Image](shared-image.md) store the page held, so their pixels and the results of the analyses of [Star Detection](star-detection.md), [Streak Detection](streak-detection.md), [Plate Solving](plate-solving.md), [Annotation](annotation.md), and [Image Statistics](image-statistics.md) are used as they are; otherwise it opens the files again.
- Camera tabs are not part of it: they follow their cameras ([Capture Frames](capture-frames.md)), and the document selected last, a file or a camera tab, is selected again by the view persistence once it is back.

## Rules and Limitations

- Only the tab that had the files gets them back, and only across its reloads; a new tab or a restarted browser starts without them.
- A document is held by the page that opened it and by every page that claimed it since; it closes once all of them released it or stayed disconnected past the grace of the documents, so a reload never leaves a second copy of the image in memory and a copy of the tab never closes the image of the other.
- When the server no longer holds the image (it restarted, or the page was gone longer than the grace), the file is read again: its analyses start over and a solution chosen for the old image is dropped, the header's WCS excepted.
- A file that changed on disk since it was opened is shown as it was while the server still holds it.
- Selections, renderings, the star measured by the Star Profile Inspector, and measurements in progress are never kept; a file that cannot be opened again shows why in its tab.
