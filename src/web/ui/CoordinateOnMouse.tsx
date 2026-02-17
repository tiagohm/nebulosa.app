import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageMouseCoordinateMolecule } from '@/molecules/image/mousecoordinate'

export const CoordinateOnMouse = memo(() => {
	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)
	const { coordinate } = mouseCoordinate.state
	const { show, x, y } = useSnapshot(coordinate.selected)

	if (!show) return null

	return (
		<svg className='mouse-coordinate pointer-events-none absolute top-0 left-0 h-full w-full select-none' stroke='#2196F3' strokeWidth={1}>
			<circle cx={x} cy={y} fill='none' r='16' />
			<circle cx={x} cy={y} fill='none' r='32' />
		</svg>
	)
})
