import type { TppaAlignment, TppaOverlay as TppaOverlayRecord } from 'api'
import { toArcmin, toArcsec } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { formatArcmin } from '../format'
import type { ImageDocument } from '../images/images'
import { fitsToViewer } from '../platesolving/wcs'
import type { OverlayView, Point, Rect } from '../viewer/transform'
import { cameraKey } from './capture'
import { tppaAligned, tppaCorrectionText, tppaRuntime } from './tppa'

// Correction guide of a TPPA estimate over the frame it was solved on: the reference star where it stands, where the
// azimuth knob alone brings it, and where both knobs bring it (the target), the azimuth, altitude, and total
// correction segments, the contours of constant residual polar error labelled with it, and, under the target, the
// polar error of the estimate with the moves of the pole in words, in the colors of their segments, so the operator at
// the knobs reads it on the frame without the panel. The geometry is the toolkit's
// (computeThreePointPolarAlignmentOverlay, computed by the server in the continuous FITS pixel convention), so this
// only converts it to viewer coordinates (fitsToViewer) and draws it in image pixels; markers and text keep their size
// on screen. A point outside the frame is drawn as an arrow at the border, along its direction. Zoom, pan, and frame
// changes never request anything of the session.

// Radius of the markers, in screen pixels.
const MARKER_RADIUS = 7

// Length of the arrow of an off-screen point, in screen pixels.
const ARROW_LENGTH = 18

// Font size of the labels, in screen pixels.
const LABEL_SIZE = 11

// Width of the strokes, in screen pixels.
const STROKE = 1.5

// Font size of the polar error under the target, in screen pixels: large enough to read from the mount.
const READOUT_SIZE = 22

// Font size of the moves under the polar error, in screen pixels.
const MOVE_SIZE = 14

// Width of the dark outline that keeps the text legible over stars and nebulosity, in screen pixels.
const HALO = 3

// Advance of a character of the monospace face as a fraction of its font size (JetBrains Mono: 600 of 1000 units).
const CHARACTER_WIDTH = 0.6

// Smallest height on screen of a contour whose error is written on it, in screen pixels; a smaller ring would put its
// label over the markers.
const LABELLED_CONTOUR = 48

// Correction guide of the image a document shows.
export interface TppaGuide {
	// Geometry of the estimate, of the image shown.
	readonly geometry: NonNullable<TppaOverlayRecord['geometry']>
	// Estimate the geometry belongs to; absent while the session's latest estimate is of a later frame.
	readonly alignment?: TppaAlignment
}

// Returns the overlay of the latest TPPA estimate of the camera of a document when it was solved on the image the
// document shows now, with that estimate, or undefined.
export function useTppaOverlay(document: Pick<ImageDocument, 'source' | 'info'> | undefined): TppaGuide | undefined {
	const runtime = useSnapshot(tppaRuntime)
	if (document?.source.kind !== 'camera' || !document.info) return undefined
	const session = runtime.sessions[cameraKey(document.source.connectionId, document.source.deviceId)]
	const overlay = session && runtime.details[session.sessionId]?.overlay
	if (overlay?.imageId !== document.info.id || !overlay.geometry) return undefined
	return { geometry: overlay.geometry, alignment: session.alignment?.frame === overlay.frame ? session.alignment : undefined }
}

export interface TppaOverlayProps extends TppaGuide {
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
}

// Correction guide of a TPPA estimate.
export function TppaOverlay({ geometry, alignment, view }: TppaOverlayProps) {
	const unit = 1 / view.scale
	const { currentPoint, azimuthTargetPoint, targetPoint, azimuthSegment, altitudeSegment, totalSegment } = geometry
	const contours = geometry.contours.filter((contour) => contour.visible)

	return (
		<g fill="none" strokeWidth={STROKE}>
			<g stroke="var(--color-ink-200)" strokeOpacity={0.6} strokeDasharray="4 4">
				{contours.map((contour) => (
					<path key={contour.tolerance} d={contourPath(contour.points)} vectorEffect="non-scaling-stroke">
						<title>{`${formatTppaTolerance(contour.tolerance)} polar error`}</title>
					</path>
				))}
			</g>
			{contours.map((contour) => (
				<ContourLabel key={contour.tolerance} contour={contour} unit={unit} />
			))}
			{totalSegment.visible && <Segment from={totalSegment.from} to={totalSegment.to} color="var(--color-ink-100)" dashed />}
			{azimuthSegment.visible && <Segment from={azimuthSegment.from} to={azimuthSegment.to} color="var(--color-accent)" />}
			{altitudeSegment.visible && <Segment from={altitudeSegment.from} to={altitudeSegment.to} color="var(--color-success)" />}
			<Marker point={currentPoint} unit={unit} label="Star" color="var(--color-ink-100)" leading />
			<Marker point={azimuthTargetPoint} unit={unit} label="Az" color="var(--color-accent)" small />
			<Marker point={targetPoint} unit={unit} label="Target" color="var(--color-success)" target />
			{alignment && <GuideReadout point={targetPoint} unit={unit} visible={view.visible} alignment={alignment} />}
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

// Point of the overlay: its marker position and whether it is in the frame.
type GuidePoint = NonNullable<TppaOverlayRecord['geometry']>['currentPoint']

interface MarkerProps {
	readonly point: GuidePoint
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
	// Whether the label is drawn on the left of the marker, so it never meets the labels drawn on the right of the
	// others when the points nearly coincide.
	readonly leading?: boolean
}

// Marker of a point, or an arrow at the border pointing to it when it lies outside the frame.
function Marker({ point, unit, label, color, small, target, leading }: MarkerProps) {
	const center = fitsToViewer(point.display.x, point.display.y)
	const radius = (small ? MARKER_RADIUS * 0.6 : MARKER_RADIUS) * unit
	const offset = radius + 3 * unit
	const text = (
		<text x={leading ? center.x - offset : center.x + offset} y={center.y - radius} textAnchor={leading ? 'end' : 'start'} fill={color} stroke="none" fontSize={LABEL_SIZE * unit}>
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

interface GuideReadoutProps {
	// Target of the overlay, which the readout stands under.
	readonly point: GuidePoint
	// Image pixels per screen pixel.
	readonly unit: number
	// Region of the image on screen, in image pixels.
	readonly visible: Rect
	// Estimate the guide belongs to.
	readonly alignment: TppaAlignment
}

// Polar error of the estimate beside the target, said "Aligned" within TPPA_ALIGNED_ERROR, and the azimuth and altitude
// moves in the colors of their segments, each outlined in the darkest base so it reads over the sky. It stands on the
// right of the target, else left of it, else centered under it within the screen, and above the target when it is low
// on the screen.
function GuideReadout({ point, unit, visible, alignment }: GuideReadoutProps) {
	const center = fitsToViewer(point.display.x, point.display.y)
	const aligned = tppaAligned(alignment.totalError)
	const { azimuth, altitude } = tppaCorrectionText(alignment)
	const total = formatArcmin(alignment.totalError)
	const lines = { readout: aligned ? `Aligned ${total}` : total, azimuth: `Az · ${azimuth}`, altitude: `Alt · ${altitude}` }
	const width = Math.max(lines.readout.length * READOUT_SIZE, lines.azimuth.length * MOVE_SIZE, lines.altitude.length * MOVE_SIZE) * CHARACTER_WIDTH * unit
	const right = visible.x + visible.width - center.x - MARKER_RADIUS * unit
	const left = center.x - visible.x - MARKER_RADIUS * unit
	const anchor = right >= width ? 'start' : left >= width ? 'end' : 'middle'
	const height = (READOUT_SIZE + 2 * MOVE_SIZE + 16) * unit
	const gap = MARKER_RADIUS * 1.6 * unit
	const below = center.y + gap + height <= visible.y + visible.height
	const x = anchor === 'start' ? center.x + MARKER_RADIUS * unit : anchor === 'end' ? center.x - MARKER_RADIUS * unit : Math.min(Math.max(center.x, visible.x + width / 2), visible.x + visible.width - width / 2)
	const y = below ? center.y + gap + READOUT_SIZE * unit : center.y - gap - height + READOUT_SIZE * unit
	const halo = { stroke: 'var(--color-base-000)', strokeWidth: HALO * unit, strokeLinejoin: 'round', paintOrder: 'stroke' } as const

	return (
		<g className="tabular-nums" textAnchor={anchor}>
			<text x={x} y={y} fill={aligned ? 'var(--color-success)' : 'var(--color-ink-100)'} fontSize={READOUT_SIZE * unit} fontWeight={600} {...halo}>
				{lines.readout}
			</text>
			<text x={x} y={y + (MOVE_SIZE + 6) * unit} fill="var(--color-accent)" fontSize={MOVE_SIZE * unit} {...halo}>
				{lines.azimuth}
			</text>
			<text x={x} y={y + (2 * MOVE_SIZE + 10) * unit} fill="var(--color-success)" fontSize={MOVE_SIZE * unit} {...halo}>
				{lines.altitude}
			</text>
		</g>
	)
}

interface ContourLabelProps {
	// Contour of constant residual polar error.
	readonly contour: NonNullable<TppaOverlayRecord['geometry']>['contours'][number]
	// Image pixels per screen pixel.
	readonly unit: number
}

// Residual error of a contour, written over its topmost point on screen; none on a ring smaller than LABELLED_CONTOUR.
function ContourLabel({ contour, unit }: ContourLabelProps) {
	let top: Point | undefined
	let bottom = Number.NEGATIVE_INFINITY
	for (const point of contour.points) {
		const position = fitsToViewer(point.x, point.y)
		if (!top || position.y < top.y) top = position
		bottom = Math.max(bottom, position.y)
	}
	if (!top || bottom - top.y < LABELLED_CONTOUR * unit) return null
	return (
		<text x={top.x} y={top.y - 3 * unit} fill="var(--color-ink-200)" fontSize={LABEL_SIZE * unit} textAnchor="middle" stroke="var(--color-base-000)" strokeWidth={HALO * unit} strokeLinejoin="round" paintOrder="stroke">
			{formatTppaTolerance(contour.tolerance)}
		</text>
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
export function formatTppaTolerance(tolerance: number) {
	const seconds = toArcsec(tolerance)
	return seconds < 60 ? `${Math.round(seconds)}″` : `${Math.round(toArcmin(tolerance))}′`
}
