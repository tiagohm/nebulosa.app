import type { SaturnMoon, SaturnMoonState, SaturnRingModel, SaturnRings } from 'api'
import { useId } from 'react'
import type { ViewBox } from '../planetary/PanZoom'
import { type MoonPosition, type PlanetOrientation, screenOffset } from '../planetary/planetary'
import { MOON_COLORS, MOON_INITIALS, MOON_LABELS, SATURN_MOONS } from './saturn'

// Schematic view of Saturn, its rings and its major moons at the tool's instant, over the rectangle the pan and zoom show. Everything is drawn in Saturn's apparent
// equatorial radii on the sky (east, north) from the server's geometry, with exactly one orientation transform. The disk
// is the oblate outline turned by the position angle of the pole; each ring annulus of the server's model is the
// projected circle of its radius, foreshortened by the Earth opening B, so a ring seen nearly edge-on is nearly a line.
// The rings' far half is drawn before the disk and their near half after it; which half is far follows the sign of B.
// Moons are layered by their depth and their geometric overlap with the rings; a moon the rings may hide is outlined,
// never claimed hidden. The moons of the event chosen last are ringed in the accent. Marks and labels are sized in CSS
// pixels, so they read the same at every zoom and width, and a label that would cover another moves beside its moon;
// the compass is drawn beside the view (PlanetCompass). Colours are the saturn-* and moon-* tokens of web/src/index.css,
// schematic, not photometric; ring and globe shadows are not drawn.

// Smallest drawn radius of a moon and of a shadow, in CSS pixels, so they stay visible at any zoom.
const MINIMUM_RADIUS_PX = 3

// Size of the label of a moon, in CSS pixels.
const LABEL_PX = 12

// Width of a character of a label, as a fraction of its size: JetBrains Mono's advance of 0.6 em, with a little room.
const CHARACTER_WIDTH = 0.65

// Gap between a moon and its label or its accent ring, in CSS pixels.
const RING_GAP_PX = 4

// Width of the accent ring of a moon of the chosen event and of the dashed ring of a moon the rings may hide, in CSS
// pixels.
const RING_STROKE_PX = 1.5

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
	// The rectangle shown, in Saturn radii (x right, y down).
	readonly box: ViewBox
	// Saturn radii per CSS pixel of the view; absent until it is measured.
	readonly radiiPerPixel?: number
	// Moons drawn.
	readonly drawn: readonly SaturnMoon[]
	// Moons of the event chosen last, ringed in the accent.
	readonly highlight?: readonly SaturnMoon[]
	// Whether the ring annuli are drawn.
	readonly showRings: boolean
}

// A mark a label belongs to: its centre and radius, in the view's units.
export interface LabelMark {
	readonly x: number
	readonly y: number
	readonly r: number
}

// Centre of a placed label, in the view's units.
export interface LabelPlace {
	readonly x: number
	readonly y: number
}

// Places the label of each mark (all of one width and height, in the view's units, as is the gap to the mark) above it,
// else below, right, or left of it, the first side whose box covers neither a label placed before nor another mark;
// above when every side is taken. Marks earlier in the list are placed first.
export function placeLabels(marks: readonly LabelMark[], width: number, height: number, gap: number): LabelPlace[] {
	const placed: LabelPlace[] = []
	const overlaps = (a: LabelPlace, b: LabelPlace) => Math.abs(a.x - b.x) < width && Math.abs(a.y - b.y) < height
	const covers = (place: LabelPlace, mark: LabelMark) => Math.abs(place.x - mark.x) < width / 2 + mark.r && Math.abs(place.y - mark.y) < height / 2 + mark.r

	for (let i = 0; i < marks.length; i++) {
		const { x, y, r } = marks[i]
		const sides: LabelPlace[] = [
			{ x, y: y - r - gap - height / 2 },
			{ x, y: y + r + gap + height / 2 },
			{ x: x + r + gap + width / 2, y },
			{ x: x - r - gap - width / 2, y },
		]
		const free = sides.find((side) => !placed.some((other) => overlaps(side, other)) && !marks.some((mark, j) => j !== i && covers(side, mark)))
		placed.push(free ?? sides[0])
	}

	return placed
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
export function SaturnViewer({ rings, model, moons, positions, orientation, box, radiiPerPixel, drawn, highlight = [], showRings }: SaturnViewerProps) {
	const viewBox = `${box.x} ${box.y} ${box.width} ${box.height}`
	const halfWidth = box.width / 2
	const pixel = radiiPerPixel ?? box.width / 600
	const id = useId()
	const diskClip = `${id}-disk`
	const farClip = `${id}-far`
	const nearClip = `${id}-near`

	if (!rings || !model) {
		return (
			<svg viewBox={viewBox} className="block h-auto w-full rounded border border-line-100 bg-base-000">
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
	const minimum = MINIMUM_RADIUS_PX * pixel
	const label = LABEL_PX * pixel
	const gap = RING_GAP_PX * pixel
	const stroke = RING_STROKE_PX * pixel
	const exact = new Map((moons ?? []).map((moon) => [moon.moon, moon]))
	const shown = SATURN_MOONS.filter((moon) => drawn.includes(moon) && exact.has(moon))
	const place = (moon: SaturnMoon) => positions?.[moon] ?? exact.get(moon)!
	const overlap = (moon: SaturnMoon) => exact.get(moon)!.ringOverlap
	// Screen centre and drawn radius of each moon shown, and the reach of its rings, which its label keeps clear of.
	const marks = new Map(
		shown.map((moon) => {
			const { east, north } = place(moon)
			const [x, y] = screenOffset(east, north, orientation)
			const r = Math.max(exact.get(moon)!.radius, minimum)
			const reach = r + (highlight.includes(moon) ? gap + stroke : 0) + (overlap(moon) === 'behind' ? gap + stroke : 0)
			return [moon, { x, y, r, reach }] as const
		}),
	)
	// The ringed moons' labels are placed first, so they keep the side above them.
	const labelOrder = [...shown.filter((moon) => highlight.includes(moon)), ...shown.filter((moon) => !highlight.includes(moon))]
	const labelPlaces = new Map(
		placeLabels(
			labelOrder.map((moon) => ({ x: marks.get(moon)!.x, y: marks.get(moon)!.y, r: marks.get(moon)!.reach })),
			2 * CHARACTER_WIDTH * label,
			label,
			gap,
		).map((place, i) => [labelOrder[i], place]),
	)
	// Layers: behind the far rings, between the far rings and the disk, between the disk and the near rings, in front.
	const layers = [
		shown.filter((moon) => place(moon).depth < 0 && overlap(moon) !== 'front'),
		shown.filter((moon) => place(moon).depth < 0 && overlap(moon) === 'front'),
		shown.filter((moon) => place(moon).depth >= 0 && overlap(moon) === 'behind'),
		shown.filter((moon) => place(moon).depth >= 0 && overlap(moon) !== 'behind'),
	]

	// The annuli, in the frame turned with the pole, clipped to one half.
	const ringLayer = (clip: string) =>
		showRings && (
			<g transform={`rotate(${rotation})`} clipPath={`url(#${clip})`}>
				{model.annuli.map((annulus) => {
					const a = annulus.outer / model.equatorialRadiusKm
					const i = annulus.inner / model.equatorialRadiusKm
					return (
						<path key={annulus.name} d={annulusPath(a, Math.max(a * sinB, MINIMUM_RING_MINOR), i, Math.max(i * sinB, MINIMUM_RING_MINOR))} fillRule="evenodd" fill="var(--color-saturn-ring)" fillOpacity={RING_OPACITY[annulus.name] * lit}>
							<title>{annulus.name === 'cassini' ? 'Cassini Division' : `${annulus.name} ring`}</title>
						</path>
					)
				})}
			</g>
		)

	// A moon: a filled disk, hollow inside the umbra, dimmed in the penumbra, ringed in the accent when it takes part in
	// the chosen event, and circled with a dashed warning ring when the rings may hide it.
	const moonMark = (moon: SaturnMoon) => {
		const { x, y, r } = marks.get(moon)!
		const state = exact.get(moon)!
		const umbra = state.eclipse === 'umbra'
		const uncertain = state.ringOverlap === 'behind'
		const ringed = highlight.includes(moon)
		const accentRadius = r + gap
		const warningRadius = (ringed ? accentRadius : r) + gap
		const text = labelPlaces.get(moon)!
		return (
			<g key={moon}>
				<circle cx={x} cy={y} r={r} fill={umbra ? 'none' : MOON_COLORS[moon]} fillOpacity={state.eclipse === 'penumbra' ? 0.5 : 1} stroke={MOON_COLORS[moon]} strokeWidth={r * 0.35} strokeDasharray={umbra ? `${r * 0.6} ${r * 0.4}` : undefined}>
					<title>{`${MOON_LABELS[moon]}${state.disk === 'transit' ? ', in transit' : state.disk === 'occulted' ? ', behind Saturn' : ''}${umbra ? ", in Saturn's shadow" : state.eclipse === 'penumbra' ? ", in Saturn's penumbra" : ''}${uncertain ? ', possibly hidden by the rings' : ''}${ringed ? ', taking part in the chosen event' : ''}`}</title>
				</circle>
				{ringed && <circle cx={x} cy={y} r={accentRadius} fill="none" stroke="var(--color-accent)" strokeWidth={stroke} />}
				{uncertain && <circle cx={x} cy={y} r={warningRadius} fill="none" stroke="var(--color-warning)" strokeWidth={stroke} strokeDasharray={`${3 * pixel} ${3 * pixel}`} />}
				<text x={text.x} y={text.y} fontSize={label} fontWeight={ringed ? 600 : 400} textAnchor="middle" dominantBaseline="central" fill={ringed ? 'var(--color-ink-100)' : 'var(--color-ink-200)'}>
					{MOON_INITIALS[moon]}
				</text>
			</g>
		)
	}

	return (
		<svg viewBox={viewBox} className="block h-auto w-full rounded border border-line-100 bg-base-000">
			<title>{`Saturn, its rings and its moons, ${halfWidth.toFixed(1)} Saturn radii either side, ${orientation === 'north' ? 'north up and east left' : orientation === 'south' ? 'south up' : 'north up and east right'}`}</title>
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
			<ellipse cx={0} cy={0} rx={1} ry={ratio} transform={`rotate(${rotation})`} fill="var(--color-saturn-disk)" stroke="var(--color-line-200)" strokeWidth={pixel} />
			<g clipPath={`url(#${diskClip})`}>
				{shown.map((moon) => {
					const shadow = exact.get(moon)!.shadow
					if (!shadow?.visible) return null
					const [x, y] = screenOffset(shadow.east, shadow.north, orientation)
					return (
						<circle key={moon} cx={x} cy={y} r={Math.max(exact.get(moon)!.radius, minimum)} fill="var(--color-base-000)">
							<title>{`Shadow of ${MOON_LABELS[moon]}`}</title>
						</circle>
					)
				})}
			</g>
			{layers[2].map(moonMark)}
			{ringLayer(nearClip)}
			{layers[3].map(moonMark)}
		</svg>
	)
}
