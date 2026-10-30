import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { copyText } from '../clipboard'
import { type CoordinateStyle, formatDeclinationAs, formatPixel, formatRightAscensionAs, formatSkyPosition } from '../platesolving/coordinates'
import { skyAt, wcsFrame } from '../platesolving/wcs'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import { pixelAt, type Point, type Size } from '../viewer/transform'
import { openInSky } from './skyHandoff'

// Context menu of a point of a solved image in the Images workspace: copy its sky position (named by the frame of the
// selected solution) or its zero-based pixel, mark it on the Sky map, add a marker there, or measure a distance from
// it. Every action uses the point the menu was opened on, never where the pointer is later. A copy that fails keeps the
// menu open and says so.

// Text shown when a copy fails.
const COPY_FAILED = 'Could not copy to the clipboard.'

export interface ImageMenuProps {
	// Image point the menu acts on, in viewer coordinates, inside the image.
	readonly point: Point
	// Client point the menu opens at, in CSS pixels.
	readonly client: Point
	// Selected solution of the image.
	readonly solution: PlateSolution
	// Size of the image, in pixels.
	readonly image: Size
	// How coordinates are written.
	readonly style: CoordinateStyle
	// Why the latest action failed.
	readonly status?: string
	// Sets why the latest action failed.
	readonly onStatus: (status?: string) => void
	// Closes the menu.
	readonly onClose: () => void
	// Why the actions that draw are unavailable; absent when they are available.
	readonly unavailable?: string
	// Adds a marker at a point.
	readonly onAddMarker: (point: Point) => void
	// Starts a distance from a point.
	readonly onMeasureFrom: (point: Point) => void
}

// Context menu of a point of a solved image.
export function ImageMenu({ point, client, solution, image, style, status, onStatus, onClose, unavailable, onAddMarker, onMeasureFrom }: ImageMenuProps) {
	const sky = skyAt(solution, point)
	const pixel = pixelAt(image, point)
	const frame = wcsFrame(solution)

	// Copies text, keeping the menu open with a status when it fails.
	async function copy(text: string) {
		const copied = await copyText(text)
		onStatus(copied ? undefined : COPY_FAILED)
		return copied
	}

	const items: ContextMenuItem[] = [
		{ label: `Copy RA/Dec (${frame})`, disabledReason: sky ? undefined : 'The solution cannot locate this point.', onSelect: () => (sky ? copy(formatSkyPosition(sky, frame, style)) : false) },
		{ label: 'Copy Pixel Coordinates (x, y from 0)', disabledReason: pixel ? undefined : 'The point is outside the image.', onSelect: () => (pixel ? copy(formatPixel(pixel)) : false) },
		{ label: 'Open Coordinates in Sky', disabledReason: sky ? undefined : 'The solution cannot locate this point.', onSelect: () => sky && openInSky(sky, `${formatRightAscensionAs(sky[0], style)} ${formatDeclinationAs(sky[1], style)}`) },
		{ label: 'Add Marker Here', disabledReason: unavailable, onSelect: () => onAddMarker(point) },
		{ label: 'Measure From Here', disabledReason: unavailable, onSelect: () => onMeasureFrom(point) },
	]

	return <ContextMenu at={client} title={sky ? `${formatRightAscensionAs(sky[0], style)} ${formatDeclinationAs(sky[1], style)}${pixel ? ` · ${formatPixel(pixel)}` : ''}` : undefined} items={items} status={status} onClose={onClose} />
}
