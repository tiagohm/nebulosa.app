import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { greatCircle, layoutLabels, skyPolyline } from '../annotations/geometry'
import { formatAngularSize } from '../platesolving/coordinates'
import { bounds, circleOutline, circleValues, draftMeasurement, handlesOf, type Measurement, rectangleValues } from '../platesolving/measurement'
import { skyAt, skyOffset } from '../platesolving/wcs'
import type { OverlayView, Point, Size } from '../viewer/transform'
import { astrometryDraft } from './astrometryTool'
import type { ImageAstrometryState } from './images'

// Measurements and markers of the document shown over the shared image viewer, with the one being drawn or edited. A
// distance follows the great circle between its ends through the selected solution (so SIP distortion bends it as the
// sky does); a rectangle is drawn along its pixel edges; a circle is its outline of constant angular radius projected
// through the WCS, which may look elliptical; a measurement whose points cannot be unprojected is dashed with no value.
// Everything is clipped to the image; handles, markers, and labels keep their size on screen, and the selected item is
// highlighted. It subscribes to the draft itself, so drawing renders only this overlay.

// Radius of a handle, in screen pixels.
const HANDLE_SIZE = 4

// Half size of a marker, in screen pixels.
const MARKER_SIZE = 7

// Font size of the labels, in screen pixels.
const LABEL_SIZE = 11

// Most labels placed.
const LABEL_BUDGET = 64

// Id of the clip path of the image, unique in the page since one viewer is shown at a time.
const CLIP_ID = 'astrometry-image-clip'

export interface MeasurementOverlayProps {
	// Selected solution of the image shown.
	readonly solution: PlateSolution
	// Id of the image shown; a draft of another image is not drawn.
	readonly imageId: string
	// Size of the image shown, in pixels.
	readonly image: Size
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
	// Measurements, markers, and selection of the document.
	readonly astrometry: ImageAstrometryState
}

// Measurements and markers of a document and the draft in progress.
export function MeasurementOverlay({ solution, imageId, image, view, astrometry }: MeasurementOverlayProps) {
	const { draft } = useSnapshot(astrometryDraft)
	const own = draft?.imageId === imageId ? draft : undefined
	const current = own && draftMeasurement(own)
	const moving = own?.type === 'move' ? own.marker : undefined
	const placing = own?.type === 'marker' ? own.point : undefined
	const selected = astrometry.selected
	const isSelected = (kind: 'measurement' | 'marker', id: string) => selected?.kind === kind && selected.id === id
	const shown = useMemo(() => {
		const measurements = astrometry.measurements.filter((m) => m.visible).map((m) => (current && m.id === current.id ? current : m))
		if (current && !current.id) measurements.push(current)
		return measurements.map((measurement) => drawing(solution, measurement, image, view.scale))
	}, [solution, astrometry.measurements, current, image.width, image.height, view.scale])
	const markers = astrometry.markers.flatMap((marker, index) => (marker.visible ? [{ marker: moving?.id === marker.id ? moving : marker, name: marker.label ?? `M${index + 1}` }] : []))
	const unit = 1 / view.scale
	const labels = layoutLabels(
		[
			...shown.flatMap(({ measurement, text, anchor }) => (text ? [{ key: measurement.id || 'draft', anchor, text: measurement.label ? `${measurement.label} ${text}` : text, priority: isSelected('measurement', measurement.id) ? 0 : 1, clearance: HANDLE_SIZE }] : [])),
			...markers.map(({ marker, name }) => ({ key: marker.id, anchor: marker.point, text: name, priority: isSelected('marker', marker.id) ? 0 : 2, clearance: MARKER_SIZE })),
		],
		view,
		LABEL_SIZE,
		LABEL_BUDGET,
		selected?.id,
	)

	return (
		<g fill="none">
			<clipPath id={CLIP_ID}>
				<rect x={0} y={0} width={image.width} height={image.height} />
			</clipPath>
			<g clipPath={`url(#${CLIP_ID})`}>
				{shown.map(({ measurement, path, sky }) => {
					const color = !measurement.id || isSelected('measurement', measurement.id) ? 'var(--color-accent)' : 'var(--color-ink-100)'

					return (
						<g key={measurement.id || 'draft'}>
							<path d={path} stroke="var(--color-base-000)" strokeOpacity={0.6} strokeWidth={3} vectorEffect="non-scaling-stroke" />
							<path d={path} stroke={color} strokeWidth={1.5} strokeDasharray={sky ? undefined : '6 4'} vectorEffect="non-scaling-stroke" />
							{handlesOf(measurement).map(([name, at]) => (
								<circle key={name} cx={at.x} cy={at.y} r={HANDLE_SIZE * unit} fill="var(--color-base-000)" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
							))}
						</g>
					)
				})}
				{markers.map(({ marker }) => (
					<MarkerSymbol key={marker.id} point={marker.point} unit={unit} color={isSelected('marker', marker.id) ? 'var(--color-accent)' : 'var(--color-success)'} />
				))}
				{placing && <MarkerSymbol point={placing} unit={unit} color="var(--color-accent)" />}
			</g>
			<g fill="var(--color-ink-100)" stroke="var(--color-base-000)" strokeOpacity={0.85} strokeWidth={3 * unit} paintOrder="stroke" fontSize={LABEL_SIZE * unit} className="font-mono tabular-nums">
				{labels.map((label) => (
					<text key={label.key} x={label.x} y={label.y} textAnchor={label.textAnchor} dominantBaseline={label.baseline}>
						{label.text}
					</text>
				))}
			</g>
		</g>
	)
}

interface MarkerSymbolProps {
	// Point of the marker, in viewer coordinates.
	readonly point: Point
	// Image pixels per screen pixel.
	readonly unit: number
	// Stroke color.
	readonly color: string
}

// Marker: a diamond around its point with a dot at its centre, constant in size on screen.
function MarkerSymbol({ point, unit, color }: MarkerSymbolProps) {
	const size = MARKER_SIZE * unit
	const d = `M${point.x} ${point.y - size}L${point.x + size} ${point.y}L${point.x} ${point.y + size}L${point.x - size} ${point.y}Z`

	return (
		<g>
			<path d={d} stroke="var(--color-base-000)" strokeOpacity={0.6} strokeWidth={3} vectorEffect="non-scaling-stroke" />
			<path d={d} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
			<circle cx={point.x} cy={point.y} r={1.2 * unit} fill={color} />
		</g>
	)
}

// Returns how a measurement is drawn with a solution at a zoom: the measurement, its path as SVG path data, whether it
// follows the sky, the text of its value, and the point its label is placed next to, in viewer coordinates.
function drawing(solution: PlateSolution, measurement: Measurement, image: Size, scale: number) {
	const { a, b } = measurement

	if (measurement.kind === 'rectangle') {
		const { left, top, right, bottom } = bounds(measurement)
		const { centerLines } = rectangleValues(solution, measurement)
		const text = centerLines ? `${formatAngularSize(centerLines.width)} × ${formatAngularSize(centerLines.height)}` : ''
		return { measurement, path: `M${left} ${top}H${right}V${bottom}H${left}Z`, sky: !!centerLines, text, anchor: { x: right, y: top } }
	}

	if (measurement.kind === 'circle') {
		const outline = circleOutline(solution, measurement, scale)
		const { radius } = circleValues(solution, measurement)
		const path = outline?.map((points) => points.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`).join('')).join('') ?? ''
		return { measurement, path: `${path}M${a.x} ${a.y}L${b.x} ${b.y}`, sky: !!path, text: path && radius ? `r ${formatAngularSize(radius)}` : '', anchor: b }
	}

	const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
	const straight = `M${a.x} ${a.y}L${b.x} ${b.y}`
	const from = skyAt(solution, a)
	const to = skyAt(solution, b)
	if (!from || !to) return { measurement, path: straight, sky: false, text: '', anchor: middle }
	return { measurement, path: skyPolyline(solution, greatCircle(from, to), image.width, image.height) || straight, sky: true, text: formatAngularSize(skyOffset(from, to).separation), anchor: middle }
}
