import type { DarvTrail } from 'api'
import { useSnapshot } from 'valtio'
import type { ImageDocument } from '../images/images'
import type { OverlayView, Point } from '../viewer/transform'
import { cameraKey } from './capture'
import { darvRuntime } from './darv'

// Trails a DARV analysis paired over the frame they were found on: the outbound and the return leg of every star, with
// the outer ends and the turn marked, so the operator sees which trails the drift came from. Trails left out of the
// drift (clipped by the border or unresolved) are dashed. The trails are in 0-based pixels of the frame, the centre of
// the upper-left sample at (0, 0), so they are shifted half a pixel to the viewer's corner-based coordinates; markers
// keep their size on screen. Zoom, pan, and frame changes never request anything of the session.

// Radius of the end markers, in screen pixels.
const MARKER_RADIUS = 4

// Width of the strokes, in screen pixels.
const STROKE = 1.5

// Returns the trails of the latest analyzed DARV measurement of the camera of a document when they were found on the
// image the document shows now, or undefined.
export function useDarvOverlay(document: Pick<ImageDocument, 'source' | 'info'> | undefined): readonly DarvTrail[] | undefined {
	const runtime = useSnapshot(darvRuntime)
	if (document?.source.kind !== 'camera' || !document.info) return undefined
	const session = runtime.sessions[cameraKey(document.source.connectionId, document.source.deviceId)]
	const trails = session && runtime.details[session.sessionId]?.trails.findLast((measurement) => measurement.imageId === document.info!.id)
	return trails && trails.trails.length > 0 ? trails.trails : undefined
}

export interface DarvOverlayProps {
	// Trails of the image shown.
	readonly trails: readonly DarvTrail[]
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
}

// Paired DARV trails.
export function DarvOverlay({ trails, view }: DarvOverlayProps) {
	const unit = 1 / view.scale

	return (
		<g fill="none" strokeWidth={STROKE}>
			{trails.map((trail) => {
				const dashed = trail.clipped || trail.unresolved ? '4 3' : undefined
				const [start, turn, returnStart, end] = [trail.start, trail.turn, trail.returnStart, trail.end].map(viewer)
				return (
					<g key={`${trail.start.x},${trail.start.y}`}>
						<title>{`${trail.driftMagnitude.toFixed(3)} px/s${trail.clipped ? ', clipped' : ''}${trail.unresolved ? ', unresolved' : ''}`}</title>
						<line x1={start.x} y1={start.y} x2={turn.x} y2={turn.y} stroke="var(--color-accent)" strokeDasharray={dashed} vectorEffect="non-scaling-stroke" />
						<line x1={returnStart.x} y1={returnStart.y} x2={end.x} y2={end.y} stroke="var(--color-success)" strokeDasharray={dashed} vectorEffect="non-scaling-stroke" />
						<circle cx={start.x} cy={start.y} r={MARKER_RADIUS * unit} stroke="var(--color-ink-100)" vectorEffect="non-scaling-stroke" />
						<circle cx={end.x} cy={end.y} r={MARKER_RADIUS * unit} stroke="var(--color-ink-100)" vectorEffect="non-scaling-stroke" />
						<path d={`M ${turn.x} ${turn.y} L ${returnStart.x} ${returnStart.y}`} stroke="var(--color-ink-200)" vectorEffect="non-scaling-stroke" />
					</g>
				)
			})}
		</g>
	)
}

// Converts a 0-based pixel centre of the frame to viewer coordinates.
function viewer(point: Point): Point {
	return { x: point.x + 0.5, y: point.y + 0.5 }
}
