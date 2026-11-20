import type { JupiterState } from 'api'
import { useId } from 'react'
import { formatDegrees } from '../../format'
import type { ViewBox } from '../planetary/PanZoom'
import { type MoonPosition, type PlanetOrientation, screenOffset } from '../planetary/planetary'
import { type GalileanMoon, GALILEAN_MOONS, MOON_COLORS, MOON_INITIALS, MOON_LABELS } from './jupiter'

// Schematic view of Jupiter and its Galilean satellites at the tool's instant, over the rectangle the pan and zoom show: the oblate disk turned by the position angle
// of its pole, the central meridian, the moons in front of or behind it, their shadows where they fall on the disk, and
// the Great Red Spot from the operator's model at a schematic latitude. Sizes and offsets are in Jupiter's apparent
// equatorial radii, from the server; the faint belts are decoration, not observed cloud features. Moon positions may be
// interpolated from the tracks while the clock plays; states, shadows, and the spot are the exact view's. The moons of
// the selected event (and the spot of a selected transit) are ringed in the accent. Marks and labels are sized in CSS
// pixels, so they read the same at every zoom and width; the compass is drawn beside the view (JupiterCompass), never
// over a moon. Colours are the jupiter-* and moon-* tokens of web/src/index.css.

// Smallest drawn radius of a moon and of a shadow, in CSS pixels, so they stay visible at any zoom.
const MINIMUM_RADIUS_PX = 3

// Size of the initial of a moon, in CSS pixels.
const LABEL_PX = 12

// Gap between a mark and the accent ring around it, and the ring's stroke, in CSS pixels.
const RING_GAP_PX = 4
const RING_STROKE_PX = 1.5

// Half-axes of the schematic Great Red Spot, in Jupiter radii: about 16 000 by 12 000 km.
const GRS_AXES = [0.11, 0.08] as const

// Degrees per radian.
const DEGREES = 180 / Math.PI

export interface JupiterViewerProps {
	// Exact view of the instant, when answered.
	readonly state?: JupiterState
	// Moon positions to draw instead of the view's, interpolated while the clock moves.
	readonly positions?: Readonly<Record<GalileanMoon, MoonPosition>>
	readonly orientation: PlanetOrientation
	// The rectangle shown, in Jupiter radii (x right, y down).
	readonly box: ViewBox
	// Jupiter radii per CSS pixel of the drawing; until measured, the drawing assumes 600 pixels across the box.
	readonly radiiPerPixel?: number
	// Moons drawn.
	readonly moons: readonly GalileanMoon[]
	// Moons of the selected event, ringed in the accent.
	readonly highlight?: readonly GalileanMoon[]
	// Whether the Great Red Spot is ringed, for a selected transit of it.
	readonly highlightSpot?: boolean
}

// Schematic view of Jupiter and its moons.
export function JupiterViewer({ state, positions, orientation, box, radiiPerPixel, moons, highlight = [], highlightSpot = false }: JupiterViewerProps) {
	const viewBox = `${box.x} ${box.y} ${box.width} ${box.height}`
	const halfWidth = box.width / 2
	const pixel = radiiPerPixel ?? box.width / 600
	const id = useId()
	const clip = `${id}-disk`
	const localClip = `${id}-local`

	if (!state) {
		return (
			<svg viewBox={viewBox} className="block h-auto w-full rounded border border-line-100 bg-base-000">
				<title>Jupiter is being computed</title>
			</svg>
		)
	}

	const { disk } = state
	const ratio = disk.polarRadius / disk.equatorialRadius
	// Screen direction of the projected north pole, which carries the disk's minor axis.
	const [px, py] = screenOffset(Math.sin(disk.poleAngle), Math.cos(disk.poleAngle), orientation)
	const rotation = Math.atan2(py, px) * DEGREES + 90
	const minimum = MINIMUM_RADIUS_PX * pixel
	const label = LABEL_PX * pixel
	const drawn = GALILEAN_MOONS.filter((moon) => moons.includes(moon))
	const view = new Map(state.moons.map((moon) => [moon.moon, moon]))
	const place = (moon: GalileanMoon) => positions?.[moon] ?? view.get(moon)!
	const behind = drawn.filter((moon) => place(moon).depth < 0)
	const front = drawn.filter((moon) => place(moon).depth >= 0)

	// A moon: a filled disk, hollow inside the umbra, dimmed in the penumbra, with its initial above, ringed when it takes
	// part in the selected event.
	const moonMark = (moon: GalileanMoon) => {
		const { east, north } = place(moon)
		const exact = view.get(moon)!
		const [x, y] = screenOffset(east, north, orientation)
		const r = Math.max(exact.radius, minimum)
		const umbra = exact.eclipse === 'umbra'
		const ringed = highlight.includes(moon)
		const ring = r + RING_GAP_PX * pixel
		return (
			<g key={moon}>
				<circle cx={x} cy={y} r={r} fill={umbra ? 'none' : MOON_COLORS[moon]} fillOpacity={exact.eclipse === 'penumbra' ? 0.5 : 1} stroke={MOON_COLORS[moon]} strokeWidth={r * 0.35} strokeDasharray={umbra ? `${r * 0.6} ${r * 0.4}` : undefined}>
					<title>{`${MOON_LABELS[moon]}${exact.disk === 'transit' ? ', in transit' : exact.disk === 'occulted' ? ', behind Jupiter' : ''}${umbra ? ", in Jupiter's shadow" : exact.eclipse === 'penumbra' ? ", in Jupiter's penumbra" : ''}${ringed ? ', taking part in the selected event' : ''}`}</title>
				</circle>
				{ringed && <circle cx={x} cy={y} r={ring} fill="none" stroke="var(--color-accent)" strokeWidth={RING_STROKE_PX * pixel} />}
				<text x={x} y={y - (ringed ? ring : r) - label * 0.35} fontSize={label} fontWeight={ringed ? 600 : 400} textAnchor="middle" fill={ringed ? 'var(--color-ink-100)' : 'var(--color-ink-200)'}>
					{MOON_INITIALS[moon]}
				</text>
			</g>
		)
	}

	const spot = state.grs?.visible ? screenOffset(state.grs.east, state.grs.north, orientation) : undefined

	return (
		<svg viewBox={viewBox} className="block h-auto w-full rounded border border-line-100 bg-base-000">
			<title>{`Jupiter and its moons, ${halfWidth.toFixed(1)} Jupiter radii either side, ${orientation === 'north' ? 'north up and east left' : orientation === 'south' ? 'south up' : 'north up and east right'}`}</title>
			<defs>
				<clipPath id={clip}>
					<ellipse cx={0} cy={0} rx={1} ry={ratio} transform={`rotate(${rotation})`} />
				</clipPath>
				<clipPath id={localClip}>
					<ellipse cx={0} cy={0} rx={1} ry={ratio} />
				</clipPath>
			</defs>
			{behind.map(moonMark)}
			<g transform={`rotate(${rotation})`}>
				<ellipse cx={0} cy={0} rx={1} ry={ratio} fill="var(--color-jupiter-disk)" stroke="var(--color-line-200)" strokeWidth={pixel} />
				{/* Decorative belts, not observed cloud features. */}
				<g clipPath={`url(#${localClip})`} opacity={0.5}>
					<rect x={-1} y={-0.3 * ratio} width={2} height={0.12 * ratio} fill="var(--color-jupiter-belt)" />
					<rect x={-1} y={0.16 * ratio} width={2} height={0.14 * ratio} fill="var(--color-jupiter-belt)" />
				</g>
				<line x1={0} x2={0} y1={-ratio} y2={ratio} stroke="var(--color-ink-300)" strokeWidth={pixel} strokeDasharray={`${4 * pixel} ${4 * pixel}`}>
					<title>Central meridian</title>
				</line>
			</g>
			<g clipPath={`url(#${clip})`}>
				{spot && state.grs && (
					<ellipse cx={spot[0]} cy={spot[1]} rx={GRS_AXES[0]} ry={GRS_AXES[1]} transform={`rotate(${rotation} ${spot[0]} ${spot[1]})`} fill="var(--color-jupiter-spot)">
						<title>{`Great Red Spot from your model, System II ${formatDegrees(state.grs.longitude, 1)}, drawn at a schematic 22° S`}</title>
					</ellipse>
				)}
				{drawn.map((moon) => {
					const shadow = view.get(moon)!.shadow
					if (!shadow?.visible) return null
					const [x, y] = screenOffset(shadow.east, shadow.north, orientation)
					return (
						<circle key={moon} cx={x} cy={y} r={Math.max(view.get(moon)!.radius, minimum)} fill="var(--color-jupiter-shadow)">
							<title>{`Shadow of ${MOON_LABELS[moon]}`}</title>
						</circle>
					)
				})}
			</g>
			{spot && highlightSpot && <ellipse cx={spot[0]} cy={spot[1]} rx={GRS_AXES[0] + RING_GAP_PX * pixel} ry={GRS_AXES[1] + RING_GAP_PX * pixel} transform={`rotate(${rotation} ${spot[0]} ${spot[1]})`} fill="none" stroke="var(--color-accent)" strokeWidth={RING_STROKE_PX * pixel} />}
			{front.map(moonMark)}
		</svg>
	)
}

// Size of the compass, in CSS pixels.
const COMPASS_PX = 40

// Compass of the viewer: where north and east lie on the screen in an orientation, drawn beside the view.
export function JupiterCompass({ orientation }: { readonly orientation: PlanetOrientation }) {
	const [northX, northY] = screenOffset(0, 1, orientation)
	const [eastX, eastY] = screenOffset(1, 0, orientation)
	const centre = COMPASS_PX / 2
	const arm = 9
	const text = 15

	return (
		<svg viewBox={`0 0 ${COMPASS_PX} ${COMPASS_PX}`} className="size-10 flex-none text-ink-300">
			<title>{`Compass: north ${northY < 0 ? 'up' : 'down'}, east ${eastX < 0 ? 'left' : 'right'}`}</title>
			<g stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
				<line x1={centre} y1={centre} x2={centre + northX * arm} y2={centre + northY * arm} />
				<line x1={centre} y1={centre} x2={centre + eastX * arm} y2={centre + eastY * arm} />
			</g>
			<g fill="currentColor" fontSize={11} textAnchor="middle" dominantBaseline="central">
				<text x={centre + northX * text} y={centre + northY * text}>
					N
				</text>
				<text x={centre + eastX * text} y={centre + eastY * text}>
					E
				</text>
			</g>
		</svg>
	)
}
