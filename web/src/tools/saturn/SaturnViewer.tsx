import type { SaturnMoon, SaturnMoonState, SaturnRingModel, SaturnRings } from 'api'
import { useId } from 'react'
import { type MoonPosition, type PlanetOrientation, type PlanetScale, screenOffset } from '../planetary/planetary'
import { MOON_COLORS, MOON_INITIALS, MOON_LABELS, SATURN_MOONS } from './saturn'

// Schematic view of Saturn, its rings and its major moons at the tool's instant. Everything is drawn in Saturn's apparent
// equatorial radii on the sky (east, north) from the server's geometry, with exactly one orientation transform. The disk
// is the oblate outline turned by the position angle of the pole; each ring annulus of the server's model is the
// projected circle of its radius, foreshortened by the Earth opening B, so a ring seen nearly edge-on is nearly a line.
// The rings' far half is drawn before the disk and their near half after it; which half is far follows the sign of B.
// Moons are layered by their depth and their geometric overlap with the rings; a moon the rings may hide is outlined,
// never claimed hidden. Colours and opacities are schematic, not photometric, and ring and globe shadows are not drawn.

// Half-extent of each scale, in Saturn radii: horizontal and vertical. The system scale reaches Iapetus (~59 radii).
const EXTENTS: Readonly<Record<PlanetScale, readonly [number, number]>> = { disk: [3, 1.7], system: [62, 26] }

// Smallest drawn radius of a moon and of a shadow, in Saturn radii, at each scale, so they stay visible.
const MINIMUM_RADIUS: Readonly<Record<PlanetScale, number>> = { disk: 0.035, system: 0.45 }

// Size of the label of a moon, in Saturn radii, at each scale.
const LABEL_SIZE: Readonly<Record<PlanetScale, number>> = { disk: 0.13, system: 2.2 }

// Smallest drawn half-thickness of a ring ellipse, in Saturn radii: a render-only affordance so an edge-on ring stays a
// visible line; the server's opening is not changed.
const MINIMUM_RING_MINOR = 0.004

// Schematic fill opacity of each annulus: the dense B ring brightest, the C ring faint, the Cassini Division nearly empty.
const RING_OPACITY: Readonly<Record<SaturnRingModel['annuli'][number]['name'], number>> = { C: 0.3, B: 0.85, cassini: 0.08, A: 0.6 }

// Degrees per radian.
const DEGREES = 180 / Math.PI

export interface SaturnViewerProps {
	// Disk and rings of the instant, when answered: from the moons answer, or the rings answer on their own.
	readonly rings?: SaturnRings
	readonly model?: SaturnRingModel
	// Exact moons of the instant; absent when they could not be computed.
	readonly moons?: readonly SaturnMoonState[]
	// Moon positions to draw instead of the exact ones, interpolated while the clock moves.
	readonly positions?: Readonly<Record<SaturnMoon, MoonPosition>>
	readonly orientation: PlanetOrientation
	readonly scale: PlanetScale
	// Moons drawn.
	readonly drawn: readonly SaturnMoon[]
	// Whether the ring annuli are drawn.
	readonly showRings: boolean
}

// Path of an elliptical annulus centred at the origin, outer and inner ellipses with semi-axes (a, b), for an even-odd fill.
export function annulusPath(outerA: number, outerB: number, innerA: number, innerB: number) {
	const ellipse = (a: number, b: number) => `M${-a},0A${a},${b} 0 1 0 ${a},0A${a},${b} 0 1 0 ${-a},0Z`
	return `${ellipse(outerA, outerB)}${ellipse(innerA, innerB)}`
}

// Which local half of the rings is farther from the Earth, in the frame whose y axis points away from the projected north
// pole: the pole's side (y < 0) when the Earth is north of the ring plane (B > 0), the other side otherwise.
export function farHalfSign(earthOpening: number) {
	return earthOpening >= 0 ? -1 : 1
}

// Schematic view of Saturn, its rings and its moons.
export function SaturnViewer({ rings, model, moons, positions, orientation, scale, drawn, showRings }: SaturnViewerProps) {
	const [width, height] = EXTENTS[scale]
	const id = useId()
	const diskClip = `${id}-disk`
	const farClip = `${id}-far`
	const nearClip = `${id}-near`

	if (!rings || !model) {
		return (
			<svg viewBox={`${-width} ${-height} ${2 * width} ${2 * height}`} className="block h-auto w-full rounded border border-line-100 bg-base-000">
				<title>Saturn is being computed</title>
			</svg>
		)
	}

	const ratio = rings.polarRadius / rings.equatorialRadius
	const sinB = Math.abs(Math.sin(rings.earthOpening))
	// Screen direction of the projected north pole, which carries the minor axes.
	const [px, py] = screenOffset(Math.sin(rings.polePositionAngle), Math.cos(rings.polePositionAngle), orientation)
	const rotation = Math.atan2(py, px) * DEGREES + 90
	const far = farHalfSign(rings.earthOpening)
	const outer = model.annuli.at(-1)!.outer / model.equatorialRadiusKm
	// Opposite faces: the Earth sees the unlit face, drawn dimmer.
	const lit = rings.illumination === 'oppositeFaces' ? 0.45 : 1
	const minimum = MINIMUM_RADIUS[scale]
	const label = LABEL_SIZE[scale]
	const exact = new Map((moons ?? []).map((moon) => [moon.moon, moon]))
	const shown = SATURN_MOONS.filter((moon) => drawn.includes(moon) && exact.has(moon))
	const place = (moon: SaturnMoon) => positions?.[moon] ?? exact.get(moon)!
	const overlap = (moon: SaturnMoon) => exact.get(moon)!.ringOverlap
	// Layers: behind the far rings, between the far rings and the disk, between the disk and the near rings, in front.
	const layers = [
		shown.filter((moon) => place(moon).depth < 0 && overlap(moon) !== 'front'),
		shown.filter((moon) => place(moon).depth < 0 && overlap(moon) === 'front'),
		shown.filter((moon) => place(moon).depth >= 0 && overlap(moon) === 'behind'),
		shown.filter((moon) => place(moon).depth >= 0 && overlap(moon) !== 'behind'),
	]
	const [northX, northY] = screenOffset(0, 1, orientation)
	const [eastX, eastY] = screenOffset(1, 0, orientation)
	const compass = [-width + label * 4, height - label * 4] as const

	// The annuli, in the frame turned with the pole, clipped to one half.
	const ringLayer = (clip: string) =>
		showRings && (
			<g transform={`rotate(${rotation})`} clipPath={`url(#${clip})`}>
				{model.annuli.map((annulus) => {
					const a = annulus.outer / model.equatorialRadiusKm
					const i = annulus.inner / model.equatorialRadiusKm
					return (
						<path key={annulus.name} d={annulusPath(a, Math.max(a * sinB, MINIMUM_RING_MINOR), i, Math.max(i * sinB, MINIMUM_RING_MINOR))} fillRule="evenodd" fill="#a58c5c" fillOpacity={RING_OPACITY[annulus.name] * lit}>
							<title>{annulus.name === 'cassini' ? 'Cassini Division' : `${annulus.name} ring`}</title>
						</path>
					)
				})}
			</g>
		)

	// A moon: a filled disk, hollow inside the umbra, dimmed in the penumbra, outlined when the rings may hide it.
	const moonMark = (moon: SaturnMoon) => {
		const { east, north } = place(moon)
		const state = exact.get(moon)!
		const [x, y] = screenOffset(east, north, orientation)
		const r = Math.max(state.radius, minimum)
		const umbra = state.eclipse === 'umbra'
		const uncertain = state.ringOverlap === 'behind'
		return (
			<g key={moon}>
				<circle cx={x} cy={y} r={r} fill={umbra ? 'none' : MOON_COLORS[moon]} fillOpacity={state.eclipse === 'penumbra' ? 0.5 : 1} stroke={MOON_COLORS[moon]} strokeWidth={r * 0.35} strokeDasharray={umbra ? `${r * 0.6} ${r * 0.4}` : undefined}>
					<title>{`${MOON_LABELS[moon]}${state.disk === 'transit' ? ', in transit' : state.disk === 'occulted' ? ', behind Saturn' : ''}${umbra ? ", in Saturn's shadow" : state.eclipse === 'penumbra' ? ", in Saturn's penumbra" : ''}${uncertain ? ', possibly hidden by the rings' : ''}`}</title>
				</circle>
				{uncertain && <circle cx={x} cy={y} r={r * 1.9} fill="none" stroke="var(--color-warning)" strokeWidth={r * 0.25} strokeDasharray={`${r * 0.5} ${r * 0.5}`} />}
				<text x={x} y={y - r - label * 0.4} fontSize={label} textAnchor="middle" fill="var(--color-ink-200)">
					{MOON_INITIALS[moon]}
				</text>
			</g>
		)
	}

	return (
		<svg viewBox={`${-width} ${-height} ${2 * width} ${2 * height}`} className="block h-auto w-full rounded border border-line-100 bg-base-000">
			<title>{`Saturn, its rings and its moons, ${scale === 'disk' ? 'close up' : 'the whole system'}, ${orientation === 'north' ? 'north up and east left' : orientation === 'south' ? 'south up' : 'north up and east right'}`}</title>
			<defs>
				<clipPath id={diskClip}>
					<ellipse cx={0} cy={0} rx={1} ry={ratio} transform={`rotate(${rotation})`} />
				</clipPath>
				<clipPath id={farClip}>
					<rect x={-outer - 1} y={far < 0 ? -outer - 1 : 0} width={2 * outer + 2} height={outer + 1} />
				</clipPath>
				<clipPath id={nearClip}>
					<rect x={-outer - 1} y={far < 0 ? 0 : -outer - 1} width={2 * outer + 2} height={outer + 1} />
				</clipPath>
			</defs>
			{layers[0].map(moonMark)}
			{ringLayer(farClip)}
			{layers[1].map(moonMark)}
			<ellipse cx={0} cy={0} rx={1} ry={ratio} transform={`rotate(${rotation})`} fill="#ead7a8" stroke="#8a7650" strokeWidth={0.012} />
			<g clipPath={`url(#${diskClip})`}>
				{shown.map((moon) => {
					const shadow = exact.get(moon)!.shadow
					if (!shadow?.visible) return null
					const [x, y] = screenOffset(shadow.east, shadow.north, orientation)
					return (
						<circle key={moon} cx={x} cy={y} r={Math.max(exact.get(moon)!.radius, minimum)} fill="#000">
							<title>{`Shadow of ${MOON_LABELS[moon]}`}</title>
						</circle>
					)
				})}
			</g>
			{layers[2].map(moonMark)}
			{ringLayer(nearClip)}
			{layers[3].map(moonMark)}
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
