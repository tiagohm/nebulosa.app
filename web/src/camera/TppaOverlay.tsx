import type { TppaOverlay as TppaOverlayRecord } from 'api'
import { toArcmin, toArcsec } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import type { ImageDocument } from '../images/images'
import { fitsToViewer } from '../platesolving/wcs'
import type { OverlayView, Point } from '../viewer/transform'
import { cameraKey } from './capture'
import { tppaRuntime } from './tppa'

// Correction guide of a TPPA estimate over the frame it was solved on: the reference star where it stands, where the
// azimuth knob alone brings it, and where both knobs bring it (the target), the azimuth, altitude, and total
// correction segments, and the contours of constant residual polar error. The geometry is the toolkit's
// (computeThreePointPolarAlignmentOverlay, computed by the server in the continuous FITS pixel convention), so this
// only converts it to viewer coordinates (fitsToViewer) and draws it in image pixels; markers keep their size on
// screen. A point outside the frame is drawn as an arrow at the border, along its direction. Zoom, pan, and frame
// changes never request anything of the session.

// Radius of the markers, in screen pixels.
const MARKER_RADIUS = 7

// Length of the arrow of an off-screen point, in screen pixels.
const ARROW_LENGTH = 18

// Font size of the labels, in screen pixels.
const LABEL_SIZE = 11

// Width of the strokes, in screen pixels.
const STROKE = 1.5

// Returns the overlay of the latest TPPA estimate of the camera of a document when it was solved on the image the
// document shows now, or undefined.
export function useTppaOverlay(document: Pick<ImageDocument, 'source' | 'info'> | undefined): TppaOverlayRecord['geometry'] | undefined {
	const runtime = useSnapshot(tppaRuntime)
	if (document?.source.kind !== 'camera' || !document.info) return undefined
	const session = runtime.sessions[cameraKey(document.source.connectionId, document.source.deviceId)]
	const overlay = session && runtime.details[session.sessionId]?.overlay
	return overlay?.imageId === document.info.id ? overlay.geometry : undefined
}

export interface TppaOverlayProps {
	// Geometry of the estimate, of the image shown.
	readonly geometry: NonNullable<TppaOverlayRecord['geometry']>
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
}

// Correction guide of a TPPA estimate.
export function TppaOverlay({ geometry, view }: TppaOverlayProps) {
	const unit = 1 / view.scale
	const { currentPoint, azimuthTargetPoint, targetPoint, azimuthSegment, altitudeSegment, totalSegment, contours } = geometry

	return (
		<g fill="none" strokeWidth={STROKE}>
			<g stroke="var(--color-ink-200)" strokeOpacity={0.6} strokeDasharray="4 4">
				{contours
					.filter((contour) => contour.visible)
					.map((contour) => (
						<path key={contour.tolerance} d={contourPath(contour.points)} vectorEffect="non-scaling-stroke">
							<title>{`${formatTolerance(contour.tolerance)} polar error`}</title>
						</path>
					))}
			</g>
			{totalSegment.visible && <Segment from={totalSegment.from} to={totalSegment.to} color="var(--color-ink-100)" dashed />}
			{azimuthSegment.visible && <Segment from={azimuthSegment.from} to={azimuthSegment.to} color="var(--color-accent)" />}
			{altitudeSegment.visible && <Segment from={altitudeSegment.from} to={altitudeSegment.to} color="var(--color-success)" />}
			<Marker point={currentPoint} unit={unit} label="Star" color="var(--color-ink-100)" />
			<Marker point={azimuthTargetPoint} unit={unit} label="Az" color="var(--color-accent)" small />
			<Marker point={targetPoint} unit={unit} label="Target" color="var(--color-success)" target />
		</g>
	)
}

interface SegmentProps {
	// Clipped start, in FITS pixels.
	readonly from: Point
	// Clipped end, in FITS pixels.
	readonly to: Point
	// Stroke color.
	readonly color: string
	// Whether the stroke is dashed.
	readonly dashed?: boolean
}

// Correction segment, clipped to the frame by the server.
function Segment({ from, to, color, dashed }: SegmentProps) {
	const a = fitsToViewer(from.x, from.y)
	const b = fitsToViewer(to.x, to.y)
	return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeDasharray={dashed ? '6 4' : undefined} vectorEffect="non-scaling-stroke" />
}

interface MarkerProps {
	// Point of the overlay: its marker position and whether it is in the frame.
	readonly point: NonNullable<TppaOverlayRecord['geometry']>['currentPoint']
	// Image pixels per screen pixel.
	readonly unit: number
	// Label drawn beside the marker.
	readonly label: string
	// Stroke and text color.
	readonly color: string
	// Whether the marker is drawn smaller.
	readonly small?: boolean
	// Whether the marker is the target: a ring with a cross.
	readonly target?: boolean
}

// Marker of a point, or an arrow at the border pointing to it when it lies outside the frame.
function Marker({ point, unit, label, color, small, target }: MarkerProps) {
	const center = fitsToViewer(point.display.x, point.display.y)
	const radius = (small ? MARKER_RADIUS * 0.6 : MARKER_RADIUS) * unit
	const text = (
		<text x={center.x + radius + 3 * unit} y={center.y - radius} fill={color} stroke="none" fontSize={LABEL_SIZE * unit}>
			{point.onScreen ? label : `${label} (off frame)`}
		</text>
	)

	if (!point.onScreen) {
		const { x, y } = point.direction
		const length = ARROW_LENGTH * unit
		const tail = { x: center.x - x * length, y: center.y - y * length }
		const head = 6 * unit
		const barb = (angle: number) => `${center.x - head * (x * Math.cos(angle) - y * Math.sin(angle))} ${center.y - head * (x * Math.sin(angle) + y * Math.cos(angle))}`
		return (
			<g stroke={color}>
				<path d={`M ${tail.x} ${tail.y} L ${center.x} ${center.y} M ${barb(0.45)} L ${center.x} ${center.y} L ${barb(-0.45)}`} vectorEffect="non-scaling-stroke" />
				{text}
			</g>
		)
	}

	return (
		<g stroke={color}>
			<circle cx={center.x} cy={center.y} r={radius} vectorEffect="non-scaling-stroke" />
			{target && <path d={`M ${center.x - radius * 1.6} ${center.y} H ${center.x + radius * 1.6} M ${center.x} ${center.y - radius * 1.6} V ${center.y + radius * 1.6}`} vectorEffect="non-scaling-stroke" />}
			{text}
		</g>
	)
}

// SVG path of a closed contour given in FITS pixels.
function contourPath(points: readonly Point[]) {
	return points
		.map((point, index) => {
			const { x, y } = fitsToViewer(point.x, point.y)
			return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
		})
		.join(' ')
}

// Formats a contour radius in radians: arcseconds below one arcminute, else arcminutes.
function formatTolerance(tolerance: number) {
	const seconds = toArcsec(tolerance)
	return seconds < 60 ? `${Math.round(seconds)}″` : `${Math.round(toArcmin(tolerance))}′`
}
