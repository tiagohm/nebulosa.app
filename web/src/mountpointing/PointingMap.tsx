import type { PointingModelDetail, PointingSampleResidual } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, useMemo } from 'react'
import { moveIndex } from '../ui/navigation'
import { errorArrowEnd, errorMagnification, type MapLegendCounts, mapLegendCounts, mapRings, type MapWaypoint, mapWaypoints } from './skymap'

// Pointing Map: the local sky of a run, drawn once for Images and for Tools, with the waypoints and what is known of them.
// Each one is a mark by status, a withheld one is a diamond, a sample left out of the next fit is hollow and dashed, and an
// error is an arrow magnified to read, so an arrow shows the shape of the errors and never their size, which the numbers
// beside the map give. The map scales with its box, and its legend names every mark it draws with its count.
// A mark with a sample is one stop of the keyboard: Tab reaches the selected one (or the first), the arrow keys, Home, and
// End move between them in the order of the plan, and Enter or Space selects, like every list of the app. Each one takes
// a pointer on a circle much larger than the mark it draws, so a small map stays usable by touch.

// Radius of the map in the units of its viewBox.
const RADIUS = 100

// Space around the map for the cardinal points, in the units of its viewBox.
const MARGIN = 14

// Altitudes of the rings of the map.
const RINGS = mapRings()

// Which errors the arrows show: those before correction, those the model leaves, or none.
export type PointingMapVectors = 'raw' | 'residual' | 'none'

export interface PointingMapProps {
	// Model drawn.
	readonly model: Pick<PointingModelDetail, 'plan' | 'samples' | 'site'>
	// Errors of the revision shown, by the samples.
	readonly residuals?: readonly PointingSampleResidual[]
	// Which errors the arrows show.
	readonly vectors: PointingMapVectors
	// Waypoint the session is on.
	readonly current?: number
	// Sample selected.
	readonly selected?: string
	// Selects a sample.
	readonly onSelect?: (sampleId: string) => void
	// Accepted samples left out of the next fit, drawn hollow and dashed.
	readonly excluded?: ReadonlySet<string>
}

// Radius of the circle that takes a pointer on a mark, in the units of the viewBox: about 24 px across on a phone, where
// the map is about 300 px wide.
const HIT_RADIUS = 9

// No sample left out.
const NONE: ReadonlySet<string> = new Set()

// Fill of each status of a waypoint.
const STATUS_CLASSES: Readonly<Record<MapWaypoint['status'], string>> = { planned: 'fill-transparent stroke-ink-300', current: 'fill-info stroke-info', accepted: 'fill-success stroke-success', rejected: 'fill-danger stroke-danger' }

// Mark of an accepted sample left out of the next fit.
const LEFT_OUT_CLASS = 'fill-transparent stroke-success'

// Dashes of the mark of a sample left out, in the units of the viewBox.
const LEFT_OUT_DASHES = '1.4 1'

// Name of each status of a waypoint.
const STATUS_LABELS: Readonly<Record<MapWaypoint['status'], string>> = { planned: 'Planned', current: 'Current', accepted: 'Accepted', rejected: 'Rejected' }

// Polar map of the waypoints of a model.
export function PointingMap({ model, residuals, vectors, current, selected, onSelect, excluded = NONE }: PointingMapProps) {
	const { plan, samples, site } = model
	const waypoints = useMemo(() => mapWaypoints(plan, samples, current, RADIUS), [plan, samples, current])
	const errors = useMemo(() => new Map(residuals?.map((residual) => [residual.id, vectors === 'raw' ? ([residual.rawDx, residual.rawDy] as const) : ([residual.dx, residual.dy] as const)])), [residuals, vectors])
	const magnification = errorMagnification(
		[...errors.values()].map(([dx, dy]) => Math.hypot(dx, dy)),
		RADIUS,
	)
	const size = RADIUS + MARGIN
	const selectable = onSelect ? waypoints.filter((waypoint) => waypoint.sample !== undefined) : []
	// The one mark Tab reaches: the selected one, else the first.
	const tabbable = selectable.find((waypoint) => waypoint.sample?.id === selected) ?? selectable[0]

	// Selects on Enter or Space, and moves the focus to another mark on a navigation key.
	function press(event: KeyboardEvent<SVGGElement>, sampleId: string) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault()
			onSelect?.(sampleId)
			return
		}

		const marks = Array.from(event.currentTarget.ownerSVGElement?.querySelectorAll<SVGGElement>('[data-mark]') ?? [])
		const next = moveIndex(marks.indexOf(event.currentTarget), marks.length, event.key)
		if (next === undefined) return
		event.preventDefault()
		marks[next].focus()
	}

	return (
		<svg viewBox={`${-size} ${-size} ${2 * size} ${2 * size}`} className="block size-full">
			<title>Pointing Map</title>
			{RINGS.map((altitude) => (
				<circle key={altitude} r={RADIUS * (1 - altitude / (Math.PI / 2))} className="fill-none stroke-line-200" strokeWidth={0.5} />
			))}
			<line x1={-RADIUS} x2={RADIUS} className="stroke-line-100" strokeWidth={0.5} />
			<line y1={-RADIUS} y2={RADIUS} className="stroke-line-100" strokeWidth={0.5} />
			<text x={0} y={-RADIUS - 4} textAnchor="middle" className="fill-ink-300 text-xs">
				N
			</text>
			<text x={RADIUS + 4} y={3} className="fill-ink-300 text-xs">
				E
			</text>
			<text x={0} y={RADIUS + 10} textAnchor="middle" className="fill-ink-300 text-xs">
				S
			</text>
			<text x={-RADIUS - 4} y={3} textAnchor="end" className="fill-ink-300 text-xs">
				W
			</text>
			{vectors !== 'none' &&
				waypoints.map(({ index, point, sample }) => {
					const error = sample && errors.get(sample.id)
					if (!error) return null
					const end = errorArrowEnd(plan.waypoints[index], error[0], error[1], site.latitude, magnification, RADIUS)
					return <line key={index} x1={point.x} y1={point.y} x2={end.x} y2={end.y} className="stroke-ink-200" strokeWidth={0.8} />
				})}
			{waypoints.map((waypoint) => {
				const { index, point, status, heldOut, sample } = waypoint
				const isSelected = sample !== undefined && sample.id === selected
				const leftOut = status === 'accepted' && sample !== undefined && excluded.has(sample.id)
				const className = leftOut ? LEFT_OUT_CLASS : STATUS_CLASSES[status]
				const dashes = leftOut ? LEFT_OUT_DASHES : undefined
				const interactive = sample !== undefined && onSelect !== undefined

				return (
					<g
						key={index}
						transform={`translate(${point.x} ${point.y})`}
						data-mark={interactive || undefined}
						tabIndex={interactive ? (waypoint === tabbable ? 0 : -1) : undefined}
						onClick={() => sample && onSelect?.(sample.id)}
						onKeyDown={interactive ? (event) => press(event, sample.id) : undefined}
						className={cn('group', interactive && 'cursor-pointer focus:outline-none')}
					>
						<title>{`Point ${index + 1}: ${leftOut ? 'Left out of the next fit' : STATUS_LABELS[status]}${heldOut ? ', withheld' : ''}${sample?.reason ? `, ${sample.reason}` : ''}`}</title>
						{interactive && <circle r={HIT_RADIUS} className="fill-transparent stroke-none" />}
						{heldOut ? <rect x={-2.6} y={-2.6} width={5.2} height={5.2} transform="rotate(45)" className={className} strokeWidth={0.8} strokeDasharray={dashes} /> : <circle r={2.8} className={className} strokeWidth={0.8} strokeDasharray={dashes} />}
						{isSelected && <circle r={5} className="fill-none stroke-accent" strokeWidth={0.9} />}
						{interactive && <circle r={6.5} className="invisible fill-none stroke-accent group-focus-visible:visible" strokeWidth={0.6} strokeDasharray="1.5 1" />}
					</g>
				)
			})}
		</svg>
	)
}

export interface PointingMapLegendProps {
	// Model drawn.
	readonly model: Pick<PointingModelDetail, 'plan' | 'samples'>
	// Waypoint the session is on.
	readonly current?: number
	// Accepted samples left out of the next fit.
	readonly excluded?: ReadonlySet<string>
}

// Entry of the legend: what it counts, its name, and the mark it shows.
interface LegendEntry {
	// Count of the legend it shows.
	readonly key: keyof MapLegendCounts
	// Name of the mark.
	readonly label: string
	// Classes of the mark.
	readonly className: string
	// Whether the mark is a diamond rather than a circle.
	readonly diamond?: boolean
	// Dashes of the mark.
	readonly dashes?: string
}

// Entries of the legend, in reading order.
const LEGEND: readonly LegendEntry[] = [
	{ key: 'accepted', label: 'Accepted', className: STATUS_CLASSES.accepted },
	{ key: 'withheld', label: 'Withheld', className: 'fill-ink-200 stroke-ink-200', diamond: true },
	{ key: 'leftOut', label: 'Left Out', className: LEFT_OUT_CLASS, dashes: LEFT_OUT_DASHES },
	{ key: 'rejected', label: 'Rejected', className: STATUS_CLASSES.rejected },
	{ key: 'current', label: 'Current', className: STATUS_CLASSES.current },
	{ key: 'planned', label: 'Planned', className: STATUS_CLASSES.planned },
]

// Names of the marks of a map with how many of each it draws; a mark the map does not draw is left out.
export function PointingMapLegend({ model, current, excluded = NONE }: PointingMapLegendProps) {
	const counts = useMemo(() => mapLegendCounts(mapWaypoints(model.plan, model.samples, current, RADIUS), excluded), [model.plan, model.samples, current, excluded])

	return (
		<ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-ink-300 tabular-nums">
			{LEGEND.filter(({ key }) => counts[key] > 0).map(({ key, label, className, diamond, dashes }) => (
				<li key={key} className="flex items-center gap-1.5">
					<svg viewBox="-4 -4 8 8" className="size-2.5 flex-none">
						{diamond ? <rect x={-2.4} y={-2.4} width={4.8} height={4.8} transform="rotate(45)" className={className} strokeWidth={0.8} /> : <circle r={2.8} className={className} strokeWidth={0.8} strokeDasharray={dashes} />}
					</svg>
					{`${label} ${counts[key]}`}
				</li>
			))}
		</ul>
	)
}
