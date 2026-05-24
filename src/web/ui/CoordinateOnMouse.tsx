import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerStoreContext } from '../shared/context'

const MARKER_RADII = [16, 32] as const
const MARKER_STROKE = 'var(--primary)'

export const CoordinateOnMouse = memo(() => {
	const { mouseCoordinate } = useContext(ImageViewerStoreContext)
	const { visible, interpolator } = useSnapshot(mouseCoordinate.state)
	const { show, x, y } = useSnapshot(mouseCoordinate.state.coordinate.selected)

	if (!visible || interpolator === undefined || !show || !Number.isFinite(x) || !Number.isFinite(y)) return null

	return (
		<svg className="mouse-coordinate pointer-events-none absolute top-0 left-0 h-full w-full select-none" fill="none" stroke={MARKER_STROKE} strokeWidth={1}>
			{MARKER_RADII.map((radius) => (
				<circle cx={x} cy={y} key={radius} r={radius} />
			))}
		</svg>
	)
})
