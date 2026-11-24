import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { formatSampleValue, MISSING } from '../format'
import { StatusLabel, type ViewerCursor } from '../viewer/ImageViewer'
import type { Size } from '../viewer/transform'
import { type PixelReading, pixelTiles, readPixel, type SampleTileCache } from './pixeltiles'

// Samples under the pointer in the status line of the shared image viewer: the native decoded value of the pixel (mono),
// its red, green, and blue samples (RGB), or the value of the photosite with its CFA phase (a mosaic with a trusted
// pattern), in the scale of the source, read from raw sample tiles (pixeltiles.ts), never from the rendered image. A
// tile is fetched once when the pointer enters it; while it arrives, or off the image, the value is missing.

// Labels of the channels of an RGB pixel.
const RGB_LABELS = ['R', 'G', 'B'] as const

export interface PixelCursorStatusProps {
	// Id of the image shown.
	readonly imageId: string
	// Its size, in pixels.
	readonly image: Size
	// Pointer over the viewer; absent off the viewport.
	readonly cursor?: ViewerCursor
	// Cache of the tiles; the tab's by default.
	readonly cache?: SampleTileCache
}

// Returns the labelled values of a reading: R, G, and B of an RGB pixel, the CFA phase of a photosite, or Value; the
// value missing without a reading.
export function pixelReadingParts(reading?: PixelReading): readonly (readonly [label: string, value: string])[] {
	if (!reading) return [['Value', MISSING]]
	const { values, phase } = reading
	if (values.length === 3) return values.map((value, i) => [RGB_LABELS[i], formatSampleValue(value)] as const)
	return [[phase ?? 'Value', formatSampleValue(values[0])]]
}

// Returns the text of a reading.
export function formatPixelReading(reading: PixelReading): string {
	return pixelReadingParts(reading)
		.map(([label, value]) => `${label} ${value}`)
		.join('  ')
}

// Samples of the pixel under the pointer.
export function PixelCursorStatus({ imageId, image, cursor, cache = pixelTiles }: PixelCursorStatusProps) {
	useSnapshot(cache.state)
	const pixel = cursor?.pixel
	const x = pixel?.x
	const y = pixel?.y

	useEffect(() => {
		if (x !== undefined && y !== undefined) cache.load(imageId, x, y, image)
	}, [cache, imageId, x, y, image.width, image.height])

	const tile = x !== undefined && y !== undefined ? cache.get(imageId, x, y, image) : undefined
	const reading = tile && x !== undefined && y !== undefined ? readPixel(tile, x, y) : undefined
	// A photosite of a mosaic is its own native sample, whatever color the debayered preview shows there.
	return (
		<span title={reading?.phase ? 'Native sample of the photosite, not the debayered color shown' : undefined} className="flex gap-2">
			{pixelReadingParts(reading).map(([label, value]) => (
				<span key={label}>
					<StatusLabel>{label}</StatusLabel> {value}
				</span>
			))}
		</span>
	)
}
