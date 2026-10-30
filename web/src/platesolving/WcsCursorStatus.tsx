import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { ViewerCursor } from '../viewer/ImageViewer'
import { type CoordinateStyle, formatDeclinationAs, formatPixelScale, formatRightAscensionAs, MISSING } from './coordinates'
import { pixelScaleAt, skyAt, wcsFrame } from './wcs'

// Sky position under the pointer in the status line of the shared image viewer: right ascension and declination in the
// frame of the selected solution, named, and the local pixel scale there, which follows the distortion of the WCS. One
// unprojection per pointer move, never a request. Off the image, or where the WCS cannot unproject, the values are
// shown as missing, never 0; the frame and scale give way on narrow screens.

export interface WcsCursorStatusProps {
	// Selected solution of the image shown.
	readonly solution: PlateSolution
	// Pointer over the viewer; absent off the viewport.
	readonly cursor?: ViewerCursor
	// How coordinates are written.
	readonly style: CoordinateStyle
}

// Coordinates under the pointer.
export function WcsCursorStatus({ solution, cursor, style }: WcsCursorStatusProps) {
	const sky = cursor?.pixel && skyAt(solution, cursor.image)
	const scale = cursor?.pixel && pixelScaleAt(solution, cursor.image)

	return (
		<>
			<span>RA {sky ? formatRightAscensionAs(sky[0], style) : MISSING}</span>
			<span>Dec {sky ? formatDeclinationAs(sky[1], style) : MISSING}</span>
			<span className="max-sm:hidden">{wcsFrame(solution)}</span>
			<span className="max-md:hidden">{scale ? formatPixelScale(scale) : MISSING}</span>
		</>
	)
}
