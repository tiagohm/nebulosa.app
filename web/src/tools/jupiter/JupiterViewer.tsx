import type { JupiterState } from 'api'
import { useId } from 'react'
import { type MoonPosition, type PlanetOrientation, type PlanetScale, screenOffset } from '../planetary/planetary'
import { type GalileanMoon, GALILEAN_MOONS, MOON_COLORS, MOON_INITIALS, MOON_LABELS } from './jupiter'

// Schematic view of Jupiter and its Galilean satellites at the tool's instant: the oblate disk turned by the position angle
// of its pole, the central meridian, the moons in front of or behind it, their shadows where they fall on the disk, and
// the Great Red Spot from the operator's model at a schematic latitude. Sizes and offsets are in Jupiter's apparent
// equatorial radii, from the server; the faint belts are decoration, not observed cloud features. Moon positions may be
// interpolated from the tracks while the clock plays; states, shadows, and the spot are the exact view's.

// Half-extent of each scale, in Jupiter radii: horizontal and vertical.
const EXTENTS: Readonly<Record<PlanetScale, readonly [number, number]>> = { disk: [2.6, 1.6], system: [30, 12] }

// Smallest drawn radius of a moon and of a shadow, in Jupiter radii, at each scale, so they stay visible.
const MINIMUM_RADIUS: Readonly<Record<PlanetScale, number>> = { disk: 0.04, system: 0.3 }

// Size of the label of a moon, in Jupiter radii, at each scale.
const LABEL_SIZE: Readonly<Record<PlanetScale, number>> = { disk: 0.14, system: 1.4 }

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
	readonly scale: PlanetScale
	// Moons drawn.
	readonly moons: readonly GalileanMoon[]
}

// Schematic view of Jupiter and its moons.
export function JupiterViewer({ state, positions, orientation, scale, moons }: JupiterViewerProps) {
	const [width, height] = EXTENTS[scale]
	const id = useId()
	const clip = `${id}-disk`
	const localClip = `${id}-local`

	if (!state) {
		return (
			<svg viewBox={`${-width} ${-height} ${2 * width} ${2 * height}`} className="block h-auto w-full rounded border border-line-100 bg-base-000">
				<title>Jupiter is being computed</title>
			</svg>
		)
	}

	const { disk } = state
	const ratio = disk.polarRadius / disk.equatorialRadius
	// Screen direction of the projected north pole, which carries the disk's minor axis.
	const [px, py] = screenOffset(Math.sin(disk.poleAngle), Math.cos(disk.poleAngle), orientation)
	const rotation = Math.atan2(py, px) * DEGREES + 90
	const minimum = MINIMUM_RADIUS[scale]
	const label = LABEL_SIZE[scale]
	const drawn = GALILEAN_MOONS.filter((moon) => moons.includes(moon))
	const view = new Map(state.moons.map((moon) => [moon.moon, moon]))
	const place = (moon: GalileanMoon) => positions?.[moon] ?? view.get(moon)!
	const behind = drawn.filter((moon) => place(moon).depth < 0)
	const front = drawn.filter((moon) => place(moon).depth >= 0)
	const [northX, northY] = screenOffset(0, 1, orientation)
	const [eastX, eastY] = screenOffset(1, 0, orientation)
	const compass = [-width + label * 4, height - label * 4] as const

	// A moon: a filled disk, hollow inside the umbra, dimmed in the penumbra, with its initial above.
	const moonMark = (moon: GalileanMoon) => {
		const { east, north } = place(moon)
		const exact = view.get(moon)!
		const [x, y] = screenOffset(east, north, orientation)
		const r = Math.max(exact.radius, minimum)
		const umbra = exact.eclipse === 'umbra'
		return (
			<g key={moon}>
				<circle cx={x} cy={y} r={r} fill={umbra ? 'none' : MOON_COLORS[moon]} fillOpacity={exact.eclipse === 'penumbra' ? 0.5 : 1} stroke={MOON_COLORS[moon]} strokeWidth={r * 0.35} strokeDasharray={umbra ? `${r * 0.6} ${r * 0.4}` : undefined}>
					<title>{`${MOON_LABELS[moon]}${exact.disk === 'transit' ? ', in transit' : exact.disk === 'occulted' ? ', behind Jupiter' : ''}${umbra ? ", in Jupiter's shadow" : exact.eclipse === 'penumbra' ? ", in Jupiter's penumbra" : ''}`}</title>
				</circle>
				<text x={x} y={y - r - label * 0.4} fontSize={label} textAnchor="middle" fill="var(--color-ink-200)">
					{MOON_INITIALS[moon]}
				</text>
			</g>
		)
	}

	return (
		<svg viewBox={`${-width} ${-height} ${2 * width} ${2 * height}`} className="block h-auto w-full rounded border border-line-100 bg-base-000">
			<title>{`Jupiter and its moons, ${scale === 'disk' ? 'the disk' : 'the whole system'}, ${orientation === 'north' ? 'north up and east left' : orientation === 'south' ? 'south up' : 'north up and east right'}`}</title>
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
				<ellipse cx={0} cy={0} rx={1} ry={ratio} fill="#d8c3a0" stroke="var(--color-line-200)" strokeWidth={0.01} />
				{/* Decorative belts, not observed cloud features. */}
				<g clipPath={`url(#${localClip})`} opacity={0.35}>
					<rect x={-1} y={-0.3 * ratio} width={2} height={0.12 * ratio} fill="#9a6b4a" />
					<rect x={-1} y={0.16 * ratio} width={2} height={0.14 * ratio} fill="#9a6b4a" />
				</g>
				<line x1={0} x2={0} y1={-ratio} y2={ratio} stroke="var(--color-ink-300)" strokeWidth={0.008} strokeDasharray="0.04 0.04">
					<title>Central meridian</title>
				</line>
			</g>
			<g clipPath={`url(#${clip})`}>
				{state.grs?.visible &&
					(() => {
						const [x, y] = screenOffset(state.grs.east, state.grs.north, orientation)
						return (
							<ellipse cx={x} cy={y} rx={GRS_AXES[0]} ry={GRS_AXES[1]} transform={`rotate(${rotation} ${x} ${y})`} fill="#c0503a" opacity={0.85}>
								<title>{`Great Red Spot from your model, System II ${(state.grs.longitude * DEGREES).toFixed(1)}°, drawn at a schematic 22° S`}</title>
							</ellipse>
						)
					})()}
				{drawn.map((moon) => {
					const shadow = view.get(moon)!.shadow
					if (!shadow?.visible) return null
					const [x, y] = screenOffset(shadow.east, shadow.north, orientation)
					return (
						<circle key={moon} cx={x} cy={y} r={Math.max(view.get(moon)!.radius, minimum)} fill="#000">
							<title>{`Shadow of ${MOON_LABELS[moon]}`}</title>
						</circle>
					)
				})}
			</g>
			{front.map(moonMark)}
			<g stroke="var(--color-ink-300)" strokeWidth={label * 0.12} fill="var(--color-ink-300)" fontSize={label}>
				<line x1={compass[0]} y1={compass[1]} x2={compass[0] + northX * label * 2} y2={compass[1] + northY * label * 2} />
				<text x={compass[0] + northX * label * 2.8} y={compass[1] + northY * label * 2.8} stroke="none" textAnchor="middle" dominantBaseline="middle">
					N
				</text>
				<line x1={compass[0]} y1={compass[1]} x2={compass[0] + eastX * label * 2} y2={compass[1] + eastY * label * 2} />
				<text x={compass[0] + eastX * label * 2.8} y={compass[1] + eastY * label * 2.8} stroke="none" textAnchor="middle" dominantBaseline="middle">
					E
				</text>
			</g>
		</svg>
	)
}
