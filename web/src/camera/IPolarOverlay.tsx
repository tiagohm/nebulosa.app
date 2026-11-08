import type { IPolarOverlay as IPolarOverlayRecord } from 'api'
import { useSnapshot } from 'valtio'
import type { ImageDocument } from '../images/images'
import { fitsToViewer } from '../platesolving/wcs'
import type { OverlayView, Point } from '../viewer/transform'
import { cameraKey } from './capture'
import { ipolarRuntime } from './ipolar'

// Markers of an iPolar measurement over the frame it was measured on: the mechanical RA axis (a ring with a cross, fixed
// to the camera), the target celestial pole (a diamond, which the operator moves onto the axis by adjusting the mount
// base), and the line between them. Shapes and labels tell them apart, not only colors. The projections are the
// server's (FITS 1-based pixels of that frame), so this only converts them to viewer coordinates (fitsToViewer) and
// draws them in image pixels; markers keep their size on screen. A point outside the frame is an arrow at the border
// along its direction, and a point the frame cannot represent is not drawn. A measurement a later frame left stale is
// drawn dimmed. Nothing is drawn over any other image than the one measured.

// Radius of the markers, in screen pixels.
const MARKER_RADIUS = 8

// Length of the arrow of an off-screen point, in screen pixels.
const ARROW_LENGTH = 18

// Font size of the labels, in screen pixels.
const LABEL_SIZE = 11

// Width of the strokes, in screen pixels.
const STROKE = 1.5

// Opacity of a stale measurement.
const STALE_OPACITY = 0.4

// Overlay of the camera of a document, when it belongs to the image the document shows now.
export interface IPolarOverlayData {
	// Markers of the latest accepted measurement.
	readonly overlay: IPolarOverlayRecord
	// Whether a later frame gave no measurement, so the markers are no longer current.
	readonly stale: boolean
}

// Returns the overlay of the latest iPolar measurement of the camera of a document when it was measured on the image
// the document shows now, or undefined.
export function useIPolarOverlay(document: Pick<ImageDocument, 'source' | 'info'> | undefined): IPolarOverlayData | undefined {
	const runtime = useSnapshot(ipolarRuntime)
	if (document?.source.kind !== 'camera' || !document.info) return undefined
	const session = runtime.sessions[cameraKey(document.source.connectionId, document.source.deviceId)]
	const overlay = session && runtime.details[session.sessionId]?.overlay
	return overlay?.imageId === document.info.id ? { overlay, stale: !session.current } : undefined
}

export interface IPolarOverlayProps extends IPolarOverlayData {
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
}

// Markers of an iPolar measurement.
export function IPolarOverlay({ overlay, stale, view }: IPolarOverlayProps) {
	const unit = 1 / view.scale
	const axis = position(overlay.axis)
	const pole = position(overlay.pole)

	return (
		<g fill="none" strokeWidth={STROKE} opacity={stale ? STALE_OPACITY : 1}>
			{axis && pole && <Line from={pole} to={axis} />}
			<Marker projection={overlay.axis} unit={unit} label={stale ? 'RA axis (stale)' : 'RA axis'} color="var(--color-ink-100)" shape="ring" />
			<Marker projection={overlay.pole} unit={unit} label={stale ? 'Pole (stale)' : 'Pole'} color="var(--color-success)" shape="diamond" />
		</g>
	)
}

// Pixel where a projection is drawn: its position on the frame, its border crossing off it, nothing when unprojectable.
function position(projection: IPolarOverlayRecord['axis']): Point | undefined {
	if (projection.kind === 'visible') return projection.position
	if (projection.kind === 'offscreen') return projection.border
	return undefined
}

// Dashed line from the pole marker to the axis marker, the correction to make.
function Line({ from, to }: { readonly from: Point; readonly to: Point }) {
	const a = fitsToViewer(from.x, from.y)
	const b = fitsToViewer(to.x, to.y)
	return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-accent)" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
}

interface MarkerProps {
	// Projection of the point.
	readonly projection: IPolarOverlayRecord['axis']
	// Image pixels per screen pixel.
	readonly unit: number
	// Label drawn beside the marker.
	readonly label: string
	// Stroke and text color.
	readonly color: string
	// Ring with a cross for the axis, diamond for the pole.
	readonly shape: 'ring' | 'diamond'
}

// Marker of a point, an arrow at the border pointing to it when it lies outside the frame, or nothing.
function Marker({ projection, unit, label, color, shape }: MarkerProps) {
	if (projection.kind === 'unprojectable') return null

	const point = projection.kind === 'visible' ? projection.position : projection.border
	const center = fitsToViewer(point.x, point.y)
	const radius = MARKER_RADIUS * unit
	const text = (
		<text x={center.x + radius + 3 * unit} y={center.y - radius} fill={color} stroke="none" fontSize={LABEL_SIZE * unit}>
			{projection.kind === 'visible' ? label : `${label} (off frame)`}
		</text>
	)

	if (projection.kind === 'offscreen') {
		const { x, y } = projection.direction
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
			{shape === 'ring' ? (
				<>
					<circle cx={center.x} cy={center.y} r={radius} vectorEffect="non-scaling-stroke" />
					<path d={`M ${center.x - radius * 1.6} ${center.y} H ${center.x + radius * 1.6} M ${center.x} ${center.y - radius * 1.6} V ${center.y + radius * 1.6}`} vectorEffect="non-scaling-stroke" />
				</>
			) : (
				<path d={`M ${center.x} ${center.y - radius} L ${center.x + radius} ${center.y} L ${center.x} ${center.y + radius} L ${center.x - radius} ${center.y} Z`} vectorEffect="non-scaling-stroke" />
			)}
			{text}
		</g>
	)
}
