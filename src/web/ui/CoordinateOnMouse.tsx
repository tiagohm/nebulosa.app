import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageMouseCoordinateMolecule } from '@/molecules/image/mousecoordinate'
import { isMouseDeviceSupported } from '@/shared/util'

const isMousePresent = isMouseDeviceSupported()

export const CoordinateOnMouse = memo(() => {
	const mouseCoordinate = useMolecule(ImageMouseCoordinateMolecule)
	const { coordinate } = mouseCoordinate.state
	// @ts-expect-error
	const { show, x, y } = useSnapshot(isMousePresent ? coordinate.selected : coordinate.hover)

	if (!show && isMousePresent) return null

	return (
		<svg className='mouse-coordinate pointer-events-none absolute top-0 left-0 h-full w-full select-none' stroke='#2196F3' strokeWidth={1}>
			<circle cx={x} cy={y} fill='none' r='16' />
			<circle cx={x} cy={y} fill='none' r='32' />
		</svg>
	)
})
