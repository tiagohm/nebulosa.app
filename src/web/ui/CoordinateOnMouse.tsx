import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { isMouseDeviceSupported } from '@/shared/util'

const isMousePresent = isMouseDeviceSupported()

export const CoordinateOnMouse = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { coordinate } = viewer.state.mouseCoordinate
	// @ts-expect-error
	const { show, x, y } = useSnapshot(isMousePresent ? coordinate.selected : coordinate.hover)

	if (!show && isMousePresent) return null

	return (
		<svg className='pointer-events-none absolute top-0 left-0 h-full w-full select-none' stroke='#2196F3' strokeWidth={1}>
			<circle cx={x} cy={y} fill='transparent' r='16'></circle>
			<circle cx={x} cy={y} fill='transparent' r='32'></circle>
		</svg>
	)
})
