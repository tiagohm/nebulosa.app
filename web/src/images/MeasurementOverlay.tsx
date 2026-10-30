import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { greatCircle, layoutLabels, skyPolyline } from '../annotations/geometry'
import { formatAngularSize } from '../platesolving/coordinates'
import { distanceValues, draftMeasurement, handlesOf, type Measurement } from '../platesolving/measurement'
import { skyAt } from '../platesolving/wcs'
import type { OverlayView, Size } from '../viewer/transform'
import { astrometryDraft } from './astrometryTool'
import type { ImageAstrometryState } from './images'

// Measurements of the document shown over the shared image viewer, with the one being drawn or edited: a distance is
// drawn along the great circle between its ends through the selected solution (so SIP distortion bends it as the sky
// does), or as a dashed straight line with no value when an end cannot be unprojected. Handles and labels keep their
// size on screen; the selected measurement is highlighted. It subscribes to the draft itself, so drawing renders only
// this overlay.

// Radius of a handle, in screen pixels.
const HANDLE_SIZE = 4

// Font size of the labels, in screen pixels.
const LABEL_SIZE = 11

// Most labels placed.
const LABEL_BUDGET = 64

export interface MeasurementOverlayProps {
	// Selected solution of the image shown.
	readonly solution: PlateSolution
	// Id of the image shown; a draft of another image is not drawn.
	readonly imageId: string
	// Size of the image shown, in pixels.
	readonly image: Size
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
	// Measurements of the document and their selection.
	readonly astrometry: ImageAstrometryState
}

// Measurements of a document and the draft in progress.
export function MeasurementOverlay({ solution, imageId, image, view, astrometry }: MeasurementOverlayProps) {
	const { draft } = useSnapshot(astrometryDraft)
	const current = draft?.imageId === imageId ? draftMeasurement(draft) : undefined
	const selected = astrometry.selected?.id
	const shown = useMemo(() => {
		const measurements = astrometry.measurements.filter((m) => m.visible).map((m) => (current && m.id === current.id ? current : m))
		if (current && !current.id) measurements.push(current)
		return measurements.map((measurement) => drawing(solution, measurement, image))
	}, [solution, astrometry.measurements, current, image.width, image.height])
	const unit = 1 / view.scale
	const labels = layoutLabels(
		shown.flatMap(({ measurement, text, middle }) => (text ? [{ key: measurement.id || 'draft', anchor: middle, text: measurement.label ? `${measurement.label} ${text}` : text, priority: measurement.id === selected ? 0 : 1, clearance: HANDLE_SIZE }] : [])),
		view,
		LABEL_SIZE,
		LABEL_BUDGET,
		selected,
	)

	return (
		<g fill="none">
			{shown.map(({ measurement, path, sky }) => {
				const color = measurement.id === selected || !measurement.id ? 'var(--color-accent)' : 'var(--color-ink-100)'

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

// Returns how a measurement is drawn with a solution: the measurement, its path as SVG path data, whether it follows the
// sky, the text of its value, and the point its label is placed at, in viewer coordinates.
function drawing(solution: PlateSolution, measurement: Measurement, image: Size) {
	const { a, b } = measurement
	const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
	const from = skyAt(solution, a)
	const to = skyAt(solution, b)
	const straight = `M${a.x} ${a.y}L${b.x} ${b.y}`
	if (!from || !to) return { measurement, path: straight, sky: false, text: '', middle }

	const path = skyPolyline(solution, greatCircle(from, to), image.width, image.height)
	const { offset } = distanceValues(solution, measurement)
	return { measurement, path: path || straight, sky: true, text: offset ? formatAngularSize(offset.separation) : '', middle }
}
