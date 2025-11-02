import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/molecules/image/viewer'

export const CoordinateOnMouse = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { show, x, y } = useSnapshot(viewer.state.mouseCoordinate.coordinate.selected)

	if (!show) return null

	return (
		<svg className='pointer-events-none absolute top-0 left-0 h-full w-full select-none' stroke='#2196F3' strokeWidth={1}>
			<circle cx={x} cy={y} fill='transparent' r='16'></circle>
			<circle cx={x} cy={y} fill='transparent' r='32'></circle>
		</svg>
	)
})
