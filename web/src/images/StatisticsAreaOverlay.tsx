import type { ImageRect } from 'api'
import { useSnapshot } from 'valtio'
import { formatCount } from '../format'
import type { OverlayView } from '../viewer/transform'
import { statisticsAreaSelection } from './statisticsArea'

// Area the Histogram and Statistics section of the Image Inspector measures, over the shared image viewer: the committed
// rectangle dashed along its pixel edges, and the rectangle being drawn solid with its size in pixels. It subscribes to
// the selection itself, so drawing renders only this overlay.

// Font size of the size label, in screen pixels.
const LABEL_SIZE = 11

export interface StatisticsAreaOverlayProps {
	// Committed area of the document; absent for the whole image.
	readonly area?: ImageRect
	// Id of the image shown; a rectangle drawn over another image is not drawn.
	readonly imageId: string
	// Zoom and visible region of the viewer.
	readonly view: OverlayView
}

// Committed statistics area of a document and the rectangle being drawn.
export function StatisticsAreaOverlay({ area, imageId, view }: StatisticsAreaOverlayProps) {
	const { draft } = useSnapshot(statisticsAreaSelection)
	const drawing = draft?.imageId === imageId ? draft.rect : undefined
	const size = LABEL_SIZE / view.scale

	return (
		<g pointerEvents="none">
			{area && !drawing && <rect x={area.left} y={area.top} width={area.width} height={area.height} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
			{drawing && (
				<>
					<rect x={drawing.left} y={drawing.top} width={drawing.width} height={drawing.height} fill="var(--color-accent)" fillOpacity={0.08} stroke="var(--color-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
					<text x={drawing.left} y={drawing.top - size * 0.4} fontSize={size} fill="var(--color-accent)">
						{formatCount(drawing.width)} × {formatCount(drawing.height)} px
					</text>
				</>
			)}
		</g>
	)
}
