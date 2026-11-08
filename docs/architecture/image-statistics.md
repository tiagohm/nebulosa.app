# Image Statistics Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

- **One service.** `ImageStatisticsService` (`api/src/imagestatistics.ts`) measures the original decoded samples of an image document, whole or inside a rectangle. It runs as one of the analysis jobs of the [Shared Image Contracts](shared-image.md): routes `/api/images/:id/statistics` and `/api/statistics`, event `statistics:updated`.
    - The scan is the toolkit's `createImageStatisticsScan` (`core/src/imaging/analysis/statistics.ts`). It runs on the image worker that holds the pixels (`ImageStore.statistics`, op `statistics` of `images.worker.ts`), so the image is never copied to another thread.
    - The scan advances in slices of about 6 ms and yields between them, so renderings, other requests, and a cancel are handled while a large frame is measured. A cancel stops it at the next slice and publishes no result.
    - Nothing the viewer applies (debayer preview, stretch, inversion, zoom) changes what is measured. A derived document or a live stack snapshot is measured like any other document.
- **Planes follow the document.**
    - A mono image has one plane, `mono`.
    - An RGB image has `red`, `green` and `blue`, plus `luminance`: BT.709 weights on the linear samples, not a calibrated photometric luminance.
    - A mono mosaic with a trusted CFA pattern (`ImageInfo.cfa`) has `red`, `green1`, `green2` and `blue`. Each phase is selected by absolute image coordinates, so an area at an odd offset keeps its phases, and the two greens are never merged.
    - A mosaic whose `BAYERPAT` is not trusted is measured as one mono plane and reported as `mosaic: 'untrusted'`.
- **Every value is in the scale of the source** (`SampleConversion`), in ADU for unscaled integer data and in the unit of the source otherwise (`unit`); nothing is converted to electrons. The service converts two kinds of value:
    - Levels, as scale × sample + offset: the mean, median, percentiles, extrema, histogram domains and background level.
    - Dispersions, as |scale| × sample: the population standard deviation, MAD, robust sigma and background noise.

    A read that rescaled the image to 0..1 is reported as `rescaled`.

- **Statistics of each plane:**
    - **Counts and moments.** Finite and non-finite counts (NaN and infinities never enter a reduction). Min, max, mean and population standard deviation are exact over every finite sample.
    - **Order statistics.** Median, MAD (about the median), robust sigma (1.4826 × MAD, a dispersion of the whole plane, not a noise), and P01 and P99. Their `quantileMethod` is one of:
        - `exact` for at most 65536 samples, or for unscaled 8 and 16-bit codes;
        - `binned` when such codes are not integral;
        - `sampled` from a deterministic reservoir of 65536 values.
    - **Numeric limits.** Counts at the representable limits of the source, present only for unsigned integer data that the read did not rescale and that has no BSCALE (`numericLimitsKnown` of `api/src/imagedecode.ts`). A count at a limit is labelled as such, never as saturation.
    - **Histograms.** Two chart histograms of 2048 bins, both from the same scan, counting every finite sample, with the samples outside the domain counted apart: `robust` over P0.1..P99.9 and `full` over min..max. Changing the domain therefore never runs the scan again.
    - **Background.** On each native plane, the toolkit's local background noise: tiles clipped asymmetrically, a first-order surface removed, and residual MADs combined. It reports a `status` (`measured`, `uncertain` or `unavailable`), the level, the noise sigma, the coverage, and warnings.

        It is a spatial estimate on one frame: not a read noise, a gain or a temporal noise. Correlated pixels (debayered, resampled or denoised data) bias it low and are flagged (`correlatedNoisePossible`). An unavailable estimate has no value, never 0.
- **Scheduling.**
    - One scan runs at a time.
    - An equivalent request (same image and area, under the same statistics version) is answered with the job still waiting or running (202), or with its kept result (200).
    - The job summary (`summary`: the median and standard deviation of the luminance of an RGB image, otherwise of the first plane) travels in the event. The planes are fetched from `GET /api/statistics/:jobId/result`.
    - The area is not validated by the API; the web keeps it inside the image.
    - No device is held, and nothing is persisted.
- **The web side.** The Histogram and Statistics section of the Image Inspector (`web/src/images/ImageStatisticsSection.tsx`, store `statistics.ts`) keeps the id `images.inspector.histogram-and-statistics` and starts collapsed.
    - **When it measures.** It submits a scan only while it is expanded and its document is ready, and never for display changes.
    - **Camera tabs.** A document submits one scan at a time: a camera tab following its latest frame measures the frame shown once its scan ends, skipping the frames that came meanwhile.
    - **Matching results.** A result is looked up by image id and area, so an earlier frame or another area never shows on the current one. A failure is not retried by itself; Recalculate submits again.
    - **The histogram.** The domain (robust or full range), the count scale (linear or log), the planes drawn and the zoom only redraw the counts fetched. A drag over the plot zooms; a double click resets.
    - **The statistics area.** It is drawn with Select Area (see [Overlay Contracts](overlay.md)) and kept in the document view (`ImageViewState.statistics`). A camera tab keeps it for frames of the same size and drops it, with a notice, for a frame of another size. Whole Image measures the whole image again.
- **Pixel readout.** With Inspect Pixels of the section on (kept in browser storage), the viewer status line adds the samples under the pointer after the sky coordinates of a plate solution (`web/src/images/PixelCursorStatus.tsx`).
    - **What it shows.** The value of a mono pixel, the red, green and blue samples of an RGB pixel, or the value of a mosaic photosite with its CFA phase (R, G1, G2 or B, from absolute coordinates and the trusted pattern). Values are in the scale of the source, and NaN and infinities are labelled as such.
    - **Where the values come from.** `GET /api/images/:id/samples?left&top&width&height` (`ImageStore.samples`, op `samples` of the image worker) answers a copy of the native decoded samples of a rectangle, never the rendered JPEG, with `Cache-Control: no-store`.
    - **The envelope.** It is versioned, binary, and written by `api/src/imagesamples.ts`, in this order:
        - the header length, a u32 little-endian;
        - a UTF-8 JSON header: rectangle, channels, precision 32 or 64, `SampleConversion`, CFA pattern, version;
        - zero padding to 8 bytes;
        - interleaved row-major little-endian floats, NaN and infinities kept.
    - **The tiles.** The web reads tiles of a 64-pixel grid, cut at the image edges (`web/src/images/pixeltiles.ts`). A tile is fetched once when the pointer enters it, so moves inside a fetched tile send nothing. A fetch of another tile still on its way is aborted.
    - **The cache.** It is least recently used, bounded to 8 MiB, and keeps only the image read last; a failed tile is not fetched again for that image. The rectangle is not validated by the API.
- **Limitations:**
    - There is no statistics plane mixing the phases of a mosaic.
    - There is no background estimate of the luminance.
    - Contamination covering more than half of every background tile pixel by pixel cannot be told from noise.
    - There is no export, no comparison of documents, and no trend across frames.
