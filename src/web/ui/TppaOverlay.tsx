import { ImageViewerStoreContext } from '@shared/context'
import { tppaOverlayStore } from '@stores/tppa.overlay.store'
import type { PolarAlignmentOverlayPoint, PolarAlignmentOverlaySegment, ThreePointPolarAlignmentOverlay } from 'nebulosa/src/observation/alignment/polaralignment.overlay'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import type { ImageTransformation } from '#/image'

// SVG-only TPPA guidance in FITS base-1 pixel centers (image edges at 0.5). Rendering allocates only
// small SVG descriptions; the backend owns astrometry, clipping, and sampled tolerance contours.

// Semantic colors shared with the TPPA panel legend.
const AZIMUTH_STROKE = 'var(--primary)'
// Altitude correction color; distinct from the azimuth component.
const ALTITUDE_STROKE = 'var(--warning)'
// Final corrected reference and residual-error contours.
const TARGET_STROKE = 'var(--success)'

// Complete precomputed geometry and the processing settings confirmed with its displayed pixels.
export interface TppaOverlayGeometryProps {
	// Geometry computed against the original, unmirrored plate solution in FITS pixels.
	readonly overlay: ThreePointPolarAlignmentOverlay
	// Mirror settings actually used by the image response, not pending UI settings.
	readonly transformation: ImageTransformation
}

// Draws a preclipped segment only when it intersects the image's inset frame.
function Segment({ segment, stroke, dashed = false }: { readonly segment: PolarAlignmentOverlaySegment; readonly stroke: string; readonly dashed?: boolean }) {
	return segment.visible && segment.length > 0 ? <line x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y} stroke={stroke} strokeDasharray={dashed ? '5 4' : undefined} /> : null
}

// Marks a true on-screen point or an edge arrow pointing toward its off-screen position, in pixels.
function Marker({ point, stroke }: { readonly point: PolarAlignmentOverlayPoint; readonly stroke: string }) {
	const { x, y } = point.display
	if (!point.onScreen) return <path d="M -8 -5 L 0 0 L -8 5" stroke={stroke} transform={`translate(${x} ${y}) rotate(${(Math.atan2(point.direction.y, point.direction.x) * 180) / Math.PI})`} />
	return <circle cx={x} cy={y} r={5} stroke={stroke} />
}

// Renders geometry without subscriptions. Zoom/pan/rotation are inherited from Interactable; only
// pixel mirrors are applied here, reflecting FITS centers around (dimension + 1) / 2.
export function TppaOverlayGeometry({ overlay, transformation }: TppaOverlayGeometryProps) {
	const { frame } = overlay

	const horizontal = transformation.enabled && transformation.horizontalMirror
	const vertical = transformation.enabled && transformation.verticalMirror
	const transform = `translate(${horizontal ? 2 * frame.x + frame.width : 0} ${vertical ? 2 * frame.y + frame.height : 0}) scale(${horizontal ? -1 : 1} ${vertical ? -1 : 1})`

	return (
		<svg className="tppa-overlay pointer-events-none absolute top-0 left-0 h-full w-full select-none" fill="none" strokeWidth={1.5} viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}>
			<g transform={transform}>
				{overlay.contours.map((contour) => contour.visible && <polyline key={contour.tolerance} points={contour.points.map(({ x, y }) => `${x},${y}`).join(' ')} stroke={TARGET_STROKE} opacity={0.5} />)}
				<Segment segment={overlay.azimuthSegment} stroke={AZIMUTH_STROKE} />
				<Segment segment={overlay.altitudeSegment} stroke={ALTITUDE_STROKE} />
				<Marker point={overlay.currentPoint} stroke={AZIMUTH_STROKE} />
				<Marker point={overlay.azimuthTargetPoint} stroke={ALTITUDE_STROKE} />
				<Marker point={overlay.targetPoint} stroke={TARGET_STROKE} />
			</g>
		</svg>
	)
}

// Subscribes only to the confirmed viewer image and the bounded collection of active TPPA panels.
export const TppaOverlay = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { panels } = useSnapshot(tppaOverlayStore.state)

	if (!viewer.state.info) return null

	for (const presentation of panels.values()) {
		const overlay = presentation.overlay

		if (presentation.enabled && overlay?.result.success && presentation.camera === viewer.image.camera?.id) {
			return <TppaOverlayGeometry overlay={overlay.result.overlay} transformation={viewer.state.info.transformation} />
		}
	}

	return null
})
