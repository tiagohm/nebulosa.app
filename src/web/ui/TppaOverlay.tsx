import { ImageViewerStoreContext } from '@shared/context'
import { tppaOverlayStore } from '@stores/tppa.overlay.store'
import type { PolarAlignmentOverlayFrame, PolarAlignmentOverlayPoint, PolarAlignmentOverlaySegment, ThreePointPolarAlignmentOverlay } from 'nebulosa/src/observation/alignment/polaralignment.overlay'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import type { ImageTransformation } from '#/image'

// SVG-only TPPA guidance in FITS base-1 pixel centers (image edges at 0.5). Rendering allocates only
// small SVG descriptions; the backend owns astrometry and sampled tolerance contours. Labels identify
// axis corrections and residual polar error, and remain readable when the image pixels are mirrored.

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

interface SegmentProps {
	readonly segment: PolarAlignmentOverlaySegment
	readonly stroke: string
	readonly dashed?: boolean
	readonly frame: PolarAlignmentOverlayFrame
	readonly text: string
}

// Draws a preclipped segment only when it intersects the image's inset frame.
function Segment({ segment, stroke, frame, text, dashed = false }: SegmentProps) {
	if (!segment.visible || segment.length <= 0) return null

	return (
		<>
			<line x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y} stroke={stroke} strokeDasharray={dashed ? '5 4' : undefined} />
			<Label x={(segment.from.x + segment.to.x) / 2} y={(segment.from.y + segment.to.y) / 2} text={text} stroke={stroke} frame={frame} />
		</>
	)
}

// Marks a point in FITS pixels. A nonzero visible incoming segment adds an arrow in its correction
// direction, colored by arrowStroke. At the frame edge, axis targets still indicate that axis's
// correction direction; a point without an incoming correction points toward its off-screen position.
function Marker({ point, stroke, segment, arrowStroke = stroke }: { readonly point: PolarAlignmentOverlayPoint; readonly stroke: string; readonly segment?: PolarAlignmentOverlaySegment; readonly arrowStroke?: string }) {
	const { x, y } = point.display

	if (!point.onScreen) {
		const direction = segment && segment.length > 0 ? segment.direction : point.direction
		return <path d="M -8 -5 L 0 0 L -8 5" stroke={arrowStroke} transform={`translate(${x} ${y}) rotate(${(Math.atan2(direction.y, direction.x) * 180) / Math.PI})`} />
	}

	return (
		<>
			<circle cx={x} cy={y} r={5} stroke={stroke} />
			{segment?.visible && segment.length > 0 && <path d="M -22 0 H -6 M -12 -5 L -6 0 L -12 5" stroke={arrowStroke} transform={`translate(${x} ${y}) rotate(${(Math.atan2(segment.direction.y, segment.direction.x) * 180) / Math.PI})`} />}
		</>
	)
}

interface LabelProps {
	readonly x: number
	readonly y: number
	readonly text: string
	readonly stroke: string
	readonly frame: PolarAlignmentOverlayFrame
}

// Places outlined text above or below a FITS point, clamped inside the image. Reflecting the anchor rather
// than the glyphs preserves readability; zoom and rotation still follow the image's Interactable.
function Label({ x, y, text, stroke, frame }: LabelProps) {
	return (
		<text className="text-xs font-bold" x={Math.max(frame.x + 24, Math.min(frame.x + frame.width - 24, x))} y={Math.max(frame.y + 14, Math.min(frame.y + frame.height - 14, y))} fill={stroke} stroke="black" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round" textAnchor="middle">
			{text}
		</text>
	)
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
				<Segment segment={overlay.azimuthSegment} stroke={AZIMUTH_STROKE} frame={frame} text="AZ" />
				<Segment segment={overlay.altitudeSegment} stroke={ALTITUDE_STROKE} frame={frame} text="ALT" />
				<Marker point={overlay.currentPoint} stroke={AZIMUTH_STROKE} />
				<Marker point={overlay.azimuthTargetPoint} stroke={AZIMUTH_STROKE} segment={overlay.azimuthSegment} />
				<Marker point={overlay.targetPoint} stroke={TARGET_STROKE} segment={overlay.altitudeSegment} arrowStroke={ALTITUDE_STROKE} />
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
