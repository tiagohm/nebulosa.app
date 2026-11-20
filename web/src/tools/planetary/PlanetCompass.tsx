import { type PlanetOrientation, screenOffset } from './planetary'

// Compass of a planetary viewer: where north and east lie on the screen in an orientation, drawn beside the view in CSS
// pixels (as the PanZoomSurface legend), so it keeps one size at every zoom and never covers a moon.

// Size of the compass, in CSS pixels.
const COMPASS_PX = 40

// Length of the compass arms, in CSS pixels from its centre.
const ARM_PX = 9

// Distance of the N and E letters from the compass centre, in CSS pixels.
const LETTER_PX = 15

// Compass of a planetary viewer in an orientation.
export function PlanetCompass({ orientation }: { readonly orientation: PlanetOrientation }) {
	const [northX, northY] = screenOffset(0, 1, orientation)
	const [eastX, eastY] = screenOffset(1, 0, orientation)
	const centre = COMPASS_PX / 2

	return (
		<svg viewBox={`0 0 ${COMPASS_PX} ${COMPASS_PX}`} className="size-10 flex-none text-ink-300">
			<title>{`Compass: north ${northY < 0 ? 'up' : 'down'}, east ${eastX < 0 ? 'left' : 'right'}`}</title>
			<g stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
				<line x1={centre} y1={centre} x2={centre + northX * ARM_PX} y2={centre + northY * ARM_PX} />
				<line x1={centre} y1={centre} x2={centre + eastX * ARM_PX} y2={centre + eastY * ARM_PX} />
			</g>
			<g fill="currentColor" fontSize={11} textAnchor="middle" dominantBaseline="central">
				<text x={centre + northX * LETTER_PX} y={centre + northY * LETTER_PX}>
					N
				</text>
				<text x={centre + eastX * LETTER_PX} y={centre + eastY * LETTER_PX}>
					E
				</text>
			</g>
		</svg>
	)
}
