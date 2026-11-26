import type { IPolarMeasurementSummary, IPolarOverlay as IPolarOverlayRecord } from 'api'
import { useSnapshot } from 'valtio'
import { formatArcmin } from '../format'
import type { ImageDocument } from '../images/images'
import { fitsToViewer } from '../platesolving/wcs'
import type { OverlayView, Point, Rect } from '../viewer/transform'
import { cameraKey } from './capture'
import { ipolarCorrectionText, ipolarRuntime, ipolarWithinTarget } from './ipolar'

// Markers of an iPolar measurement over the frame it was measured on: the mechanical RA axis (a ring with a cross, fixed
// to the camera, labelled on its left), the target celestial pole (a diamond, which the operator moves onto the axis by
// adjusting the mount base, labelled on its right, so the labels never meet when the markers nearly coincide), and the
// line between them; beside the pole, the polar error with the moves of the mount pole in words, so the operator at the
// knobs reads it on the frame without the panel. Shapes and labels tell the markers apart, not only colors: the pole is
// green only while the error is within the target. Text is outlined in the darkest base so it reads over the sky. The
// projections are the server's (FITS 1-based pixels of that frame), so this only converts them to viewer coordinates
// (fitsToViewer) and draws them in image pixels; markers and text keep their size on screen. A point outside the frame
// is an arrow at the border along its direction, and a point the frame cannot represent is not drawn. A measurement a
// later frame left stale is drawn dimmed. On a later frame of the same session, not measured yet or giving no
// measurement, the last markers stay drawn dimmed and say their frame, since the axis is fixed to the camera and the
// geometry of a session's frames does not change; nothing is drawn over any other image.

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

// Font size of the polar error beside the pole, in screen pixels: large enough to read from the mount.
const READOUT_SIZE = 22

// Font size of the moves under the polar error, in screen pixels.
const MOVE_SIZE = 14

// Width of the dark outline that keeps the text legible over stars and nebulosity, in screen pixels.
const HALO = 3

// Advance of a character of the monospace face as a fraction of its font size (JetBrains Mono: 600 of 1000 units).
const CHARACTER_WIDTH = 0.6

// Outline of the text, in image pixels per screen pixel unit: the darkest base drawn under the fill.
function halo(unit: number) {
	return { stroke: 'var(--color-base-000)', strokeWidth: HALO * unit, strokeLinejoin: 'round', paintOrder: 'stroke' } as const
}

// Overlay of the camera of a document, when it belongs to the image the document shows now or to an earlier frame of
// the same session.
export interface IPolarOverlayData {
	// Markers of the latest accepted measurement.
	readonly overlay: IPolarOverlayRecord
	// Whether the markers are not current: a later frame gave no measurement, or the image shown is a later frame.
	readonly stale: boolean
	// Frame number the markers were measured on when the image shown is a later frame of the session; absent on their own.
	readonly earlier?: number
	// Measurement the markers belong to, for the polar error beside the pole; absent while the session's latest
	// measurement is of another frame.
	readonly measurement?: IPolarMeasurementSummary
	// Whether that measurement is current and within the requested threshold.
	readonly within: boolean
}

// Returns the overlay of the latest iPolar measurement of the camera of a document when it was measured on the image
// the document shows now, or on an earlier frame of the session whose later frame the document shows; else undefined.
export function useIPolarOverlay(document: Pick<ImageDocument, 'source' | 'info' | 'camera'> | undefined): IPolarOverlayData | undefined {
	const runtime = useSnapshot(ipolarRuntime)
	if (document?.source.kind !== 'camera' || !document.info) return undefined
	const session = runtime.sessions[cameraKey(document.source.connectionId, document.source.deviceId)]
	const overlay = session && runtime.details[session.sessionId]?.overlay
	if (!overlay) return undefined
	const measurement = session.measurement?.frame === overlay.frame ? session.measurement : undefined
	const within = measurement !== undefined && ipolarWithinTarget(session)
	if (overlay.imageId === document.info.id) return { overlay, stale: !session.current, measurement, within }
	const frame = document.camera?.live ? undefined : document.camera?.shown?.frame
	if (frame?.origin === 'ipolar' && frame.sessionId === session.sessionId && frame.generation > overlay.frame) return { overlay, stale: true, earlier: overlay.frame, measurement, within: false }
	return undefined
}

export interface IPolarOverlayProps extends IPolarOverlayData {
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
}

// Markers of an iPolar measurement.
export function IPolarOverlay({ overlay, stale, earlier, measurement, within, view }: IPolarOverlayProps) {
	const unit = 1 / view.scale
	const axis = position(overlay.axis)
	const pole = position(overlay.pole)
	const suffix = earlier !== undefined ? ` (frame #${earlier})` : stale ? ' (stale)' : ''

	return (
		<g fill="none" strokeWidth={STROKE} opacity={stale ? STALE_OPACITY : 1}>
			{axis && pole && <Line from={pole} to={axis} />}
			<Marker projection={overlay.axis} unit={unit} label={`RA axis${suffix}`} color="var(--color-ink-100)" shape="ring" leading />
			<Marker projection={overlay.pole} unit={unit} label={`Pole${suffix}`} color={within ? 'var(--color-success)' : 'var(--color-ink-200)'} shape="diamond" />
			{measurement && overlay.pole.kind === 'visible' && <Readout point={overlay.pole.position} unit={unit} visible={view.visible} measurement={measurement} within={within} />}
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
	return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-ink-300)" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
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
	// Whether the label is drawn on the left of the marker, so it never meets a label drawn on the right of the other.
	readonly leading?: boolean
}

// Marker of a point, an arrow at the border pointing to it when it lies outside the frame, or nothing.
function Marker({ projection, unit, label, color, shape, leading }: MarkerProps) {
	if (projection.kind === 'unprojectable') return null

	const point = projection.kind === 'visible' ? projection.position : projection.border
	const center = fitsToViewer(point.x, point.y)
	const radius = MARKER_RADIUS * unit
	const offset = radius * (shape === 'ring' ? 1.6 : 1) + 3 * unit
	const text = (
		<text x={leading ? center.x - offset : center.x + offset} y={center.y - radius} textAnchor={leading ? 'end' : 'start'} fill={color} fontSize={LABEL_SIZE * unit} {...halo(unit)}>
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
			<g>
				<path d={`M ${tail.x} ${tail.y} L ${center.x} ${center.y} M ${barb(0.45)} L ${center.x} ${center.y} L ${barb(-0.45)}`} stroke={color} vectorEffect="non-scaling-stroke" />
				{text}
			</g>
		)
	}

	return (
		<g>
			{shape === 'ring' ? (
				<g stroke={color}>
					<circle cx={center.x} cy={center.y} r={radius} vectorEffect="non-scaling-stroke" />
					<path d={`M ${center.x - radius * 1.6} ${center.y} H ${center.x + radius * 1.6} M ${center.x} ${center.y - radius * 1.6} V ${center.y + radius * 1.6}`} vectorEffect="non-scaling-stroke" />
				</g>
			) : (
				<path d={`M ${center.x} ${center.y - radius} L ${center.x + radius} ${center.y} L ${center.x} ${center.y + radius} L ${center.x - radius} ${center.y} Z`} stroke={color} vectorEffect="non-scaling-stroke" />
			)}
			{text}
		</g>
	)
}

interface ReadoutProps {
	// Pole marker, which the readout stands under, in FITS pixels.
	readonly point: Point
	// Image pixels per screen pixel.
	readonly unit: number
	// Region of the image on screen, in image pixels.
	readonly visible: Rect
	// Measurement the markers belong to.
	readonly measurement: IPolarMeasurementSummary
	// Whether it is current and within the requested threshold.
	readonly within: boolean
}

// Polar error of the measurement beside the pole, said within the target when it is, and the azimuth and altitude moves
// of the mount pole in words. It stands on the right of the pole, else left of it, else centered under it within the
// screen, and above the pole when it is low on the screen.
function Readout({ point, unit, visible, measurement, within }: ReadoutProps) {
	const center = fitsToViewer(point.x, point.y)
	const { azimuth, altitude } = ipolarCorrectionText(measurement)
	const total = formatArcmin(measurement.totalError)
	const lines = { readout: within ? `Within target ${total}` : total, azimuth: `Az · ${azimuth}`, altitude: `Alt · ${altitude}` }
	const width = Math.max(lines.readout.length * READOUT_SIZE, lines.azimuth.length * MOVE_SIZE, lines.altitude.length * MOVE_SIZE) * CHARACTER_WIDTH * unit
	const right = visible.x + visible.width - center.x - MARKER_RADIUS * unit
	const left = center.x - visible.x - MARKER_RADIUS * unit
	const anchor = right >= width ? 'start' : left >= width ? 'end' : 'middle'
	const height = (READOUT_SIZE + 2 * MOVE_SIZE + 16) * unit
	const gap = MARKER_RADIUS * 2 * unit
	const below = center.y + gap + height <= visible.y + visible.height
	const x = anchor === 'start' ? center.x + MARKER_RADIUS * unit : anchor === 'end' ? center.x - MARKER_RADIUS * unit : Math.min(Math.max(center.x, visible.x + width / 2), visible.x + visible.width - width / 2)
	const y = below ? center.y + gap + READOUT_SIZE * unit : center.y - gap - height + READOUT_SIZE * unit

	return (
		<g className="tabular-nums" textAnchor={anchor}>
			<text x={x} y={y} fill={within ? 'var(--color-success)' : 'var(--color-ink-100)'} fontSize={READOUT_SIZE * unit} fontWeight={600} {...halo(unit)}>
				{lines.readout}
			</text>
			<text x={x} y={y + (MOVE_SIZE + 6) * unit} fill="var(--color-ink-200)" fontSize={MOVE_SIZE * unit} {...halo(unit)}>
				{lines.azimuth}
			</text>
			<text x={x} y={y + (2 * MOVE_SIZE + 10) * unit} fill="var(--color-ink-200)" fontSize={MOVE_SIZE * unit} {...halo(unit)}>
				{lines.altitude}
			</text>
		</g>
	)
}
