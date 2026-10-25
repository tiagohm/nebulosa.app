import type { GuidingFrameOverlay, GuidingSessionSummary } from 'api'
import { useSnapshot } from 'valtio'
import type { ImageDocument } from '../images/images'
import type { OverlayView } from '../viewer/transform'
import { cameraKey } from './capture'
import { guidingRunning, guidingRuntime } from './guiding'

// What the guider saw in the guide frame a camera tab shows: the detected stars (accepted ones in the accent color,
// rejected ones dashed gray), the search square around the search position, the lock position as a cross, and the
// measured star position. Positions are 0-based pixel centres of the frame, the centre of the upper-left sample at
// (0, 0), so they are shifted half a pixel to the viewer's corner-based coordinates; markers keep their size on screen,
// except star circles, which grow with the star once it is larger than them.
// It is drawn only over the image of the session's newest previewed frame, or of the frame before it until the tab shows
// the newest, never over an older or saved frame.

// Smallest radius of a star marker, in screen pixels; a star larger on screen gets a circle of its half-flux diameter as
// radius, so the marker surrounds it at any zoom instead of disappearing inside it.
const STAR_RADIUS = 4

// Half the arm of the lock cross, in screen pixels.
const CROSS_ARM = 10

// Overlay of the guiding session of a document's camera and the session, when the document shows the session's newest
// previewed frame.
export interface GuidingOverlayState {
	// Session of the camera.
	readonly session: GuidingSessionSummary
	// What the guider saw in the frame shown.
	readonly overlay: GuidingFrameOverlay
}

// Returns the overlay of the running guiding session of a camera tab's camera when the tab shows its newest previewed
// frame, or the one before it while the tab has not switched to the newest yet, or undefined.
export function useGuidingOverlay(document: Pick<ImageDocument, 'source' | 'info'> | undefined): GuidingOverlayState | undefined {
	const runtime = useSnapshot(guidingRuntime)
	if (document?.source.kind !== 'camera' || !document.info) return undefined
	const session = runtime.sessions[cameraKey(document.source.connectionId, document.source.deviceId)]
	if (!session || !guidingRunning(session)) return undefined
	const frame = runtime.frames[session.sessionId]
	if (frame?.imageId === document.info.id) return { session, overlay: frame.overlay }
	return frame?.previous?.imageId === document.info.id ? { session, overlay: frame.previous.overlay } : undefined
}

export interface GuidingOverlayProps {
	// What the guider saw in the frame shown.
	readonly overlay: GuidingFrameOverlay
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
}

// Guider overlay of a guide frame.
export function GuidingOverlay({ overlay, view }: GuidingOverlayProps) {
	const unit = 1 / view.scale
	const { lockPosition, searchPosition, searchRegion, measurement, stars } = overlay
	const half = searchRegion / 2

	return (
		<g fill="none" strokeWidth={1}>
			{stars.map((star) => (
				<circle
					key={`${star.x},${star.y}`}
					cx={star.x + 0.5}
					cy={star.y + 0.5}
					r={Math.max(STAR_RADIUS * unit, star.hfd)}
					stroke={star.accepted ? 'var(--color-accent)' : 'var(--color-ink-300)'}
					strokeOpacity={star.accepted ? 0.8 : 0.6}
					strokeDasharray={star.accepted ? undefined : '2 2'}
					vectorEffect="non-scaling-stroke"
				/>
			))}
			{searchPosition && half > 0 && <rect x={searchPosition[0] + 0.5 - half} y={searchPosition[1] + 0.5 - half} width={searchRegion} height={searchRegion} stroke="var(--color-ink-100)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
			{lockPosition && <path d={`M ${lockPosition[0] + 0.5 - CROSS_ARM * unit} ${lockPosition[1] + 0.5} h ${2 * CROSS_ARM * unit} M ${lockPosition[0] + 0.5} ${lockPosition[1] + 0.5 - CROSS_ARM * unit} v ${2 * CROSS_ARM * unit}`} stroke="var(--color-success)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
			{measurement && <circle cx={measurement[0] + 0.5} cy={measurement[1] + 0.5} r={2 * STAR_RADIUS * unit} stroke="var(--color-success)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
		</g>
	)
}
