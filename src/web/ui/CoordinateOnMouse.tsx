import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageMouseCoordinateMolecule } from '@/molecules/image/mousecoordinate'

const MARKER_RADII = [16, 32] as const
const MARKER_STROKE = 'var(--primary)'

export const CoordinateOnMouse = memo(() => {
	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)
	const { coordinate } = mouseCoordinate.state
	const { show, x, y } = useSnapshot(coordinate.selected)

	if (!show || !Number.isFinite(x) || !Number.isFinite(y)) return null

	return (
		<svg className="mouse-coordinate pointer-events-none absolute top-0 left-0 h-full w-full select-none" fill="none" stroke={MARKER_STROKE} strokeWidth={1}>
			{MARKER_RADII.map((radius) => (
				<circle cx={x} cy={y} key={radius} r={radius} />
			))}
		</svg>
	)
})
