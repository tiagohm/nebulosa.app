import type { PointingModelDetail, PointingSampleResidual } from 'api'
import { cn } from 'cn'
import { useMemo } from 'react'
import { errorArrowEnd, errorMagnification, mapRings, type MapWaypoint, mapWaypoints } from './skymap'

// Pointing Map: the local sky of a run, drawn once for Images and for Tools, with the waypoints and what is known of them.
// Each one is a mark by status, a withheld one is a diamond, and an error is an arrow magnified to read, so an arrow shows
// the shape of the errors and never their size, which the numbers beside the map give. The map scales with its box.

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
}

// Fill of each status of a waypoint.
const STATUS_CLASSES: Readonly<Record<MapWaypoint['status'], string>> = { planned: 'fill-transparent stroke-ink-300', current: 'fill-info stroke-info', accepted: 'fill-success stroke-success', rejected: 'fill-danger stroke-danger' }

// Name of each status of a waypoint.
const STATUS_LABELS: Readonly<Record<MapWaypoint['status'], string>> = { planned: 'Planned', current: 'Current', accepted: 'Accepted', rejected: 'Rejected' }

// Polar map of the waypoints of a model.
export function PointingMap({ model, residuals, vectors, current, selected, onSelect }: PointingMapProps) {
	const { plan, samples, site } = model
	const waypoints = useMemo(() => mapWaypoints(plan, samples, current, RADIUS), [plan, samples, current])
	const errors = useMemo(() => new Map(residuals?.map((residual) => [residual.id, vectors === 'raw' ? ([residual.rawDx, residual.rawDy] as const) : ([residual.dx, residual.dy] as const)])), [residuals, vectors])
	const magnification = errorMagnification(
		[...errors.values()].map(([dx, dy]) => Math.hypot(dx, dy)),
		RADIUS,
	)
	const size = RADIUS + MARGIN

	return (
		<svg viewBox={`${-size} ${-size} ${2 * size} ${2 * size}`} className="block size-full">
			<title>Pointing Map</title>
			{RINGS.map((altitude) => (
				<circle key={altitude} r={RADIUS * (1 - altitude / (Math.PI / 2))} className="fill-none stroke-line-200" strokeWidth={0.5} />
			))}
			<line x1={-RADIUS} x2={RADIUS} className="stroke-line-100" strokeWidth={0.5} />
			<line y1={-RADIUS} y2={RADIUS} className="stroke-line-100" strokeWidth={0.5} />
			<text x={0} y={-RADIUS - 4} textAnchor="middle" className="fill-ink-300 text-[8px]">
				N
			</text>
			<text x={RADIUS + 4} y={3} className="fill-ink-300 text-[8px]">
				E
			</text>
			<text x={0} y={RADIUS + 10} textAnchor="middle" className="fill-ink-300 text-[8px]">
				S
			</text>
			<text x={-RADIUS - 4} y={3} textAnchor="end" className="fill-ink-300 text-[8px]">
				W
			</text>
			{vectors !== 'none' &&
				waypoints.map(({ index, point, sample }) => {
					const error = sample && errors.get(sample.id)
					if (!error) return null
					const end = errorArrowEnd(plan.waypoints[index], error[0], error[1], site.latitude, magnification, RADIUS)
					return <line key={index} x1={point.x} y1={point.y} x2={end.x} y2={end.y} className="stroke-accent" strokeWidth={0.8} />
				})}
			{waypoints.map((waypoint) => {
				const { index, point, status, heldOut, sample } = waypoint
				const isSelected = sample !== undefined && sample.id === selected

				return (
					<g key={index} transform={`translate(${point.x} ${point.y})`} onClick={() => sample && onSelect?.(sample.id)} className={cn(sample && onSelect && 'cursor-pointer')}>
						<title>{`Point ${index + 1}: ${STATUS_LABELS[status]}${heldOut ? ', withheld' : ''}${sample?.reason ? `, ${sample.reason}` : ''}`}</title>
						{heldOut ? <rect x={-2.6} y={-2.6} width={5.2} height={5.2} transform="rotate(45)" className={STATUS_CLASSES[status]} strokeWidth={0.8} /> : <circle r={2.8} className={STATUS_CLASSES[status]} strokeWidth={0.8} />}
						{isSelected && <circle r={5} className="fill-none stroke-ink-100" strokeWidth={0.8} />}
					</g>
				)
			})}
		</svg>
	)
}
