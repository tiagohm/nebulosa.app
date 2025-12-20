import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { ImageViewerMolecule } from '@/molecules/image/viewer'

export const RotationHandle = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)

	return (
		<svg className='rotation-handle absolute left-0 top-0 pointer-events-none h-full w-full' overflow='visible'>
			<circle className='pointer-events-auto cursor-grabbing' cx='0%' cy='0%' fill='#006fee' onPointerCancel={viewer.stopRotation} onPointerDown={viewer.startRotation} onPointerOut={viewer.stopRotation} onPointerUp={viewer.stopRotation} r={10} />
			<circle className='pointer-events-auto cursor-grabbing' cx='0%' cy='0%' fill='none' r={12} stroke='#fff' />
			<circle className='pointer-events-auto cursor-grabbing' cx='100%' cy='0%' fill='#006fee' onPointerCancel={viewer.stopRotation} onPointerDown={viewer.startRotation} onPointerOut={viewer.stopRotation} onPointerUp={viewer.stopRotation} r={10} />
			<circle className='pointer-events-auto cursor-grabbing' cx='100%' cy='0%' fill='none' r={12} stroke='#fff' />
			<circle className='pointer-events-auto cursor-grabbing' cx='0%' cy='100%' fill='#006fee' onPointerCancel={viewer.stopRotation} onPointerDown={viewer.startRotation} onPointerOut={viewer.stopRotation} onPointerUp={viewer.stopRotation} r={10} />
			<circle className='pointer-events-auto cursor-grabbing' cx='0%' cy='100%' fill='none' r={12} stroke='#fff' />
			<circle className='pointer-events-auto cursor-grabbing' cx='100%' cy='100%' fill='#006fee' onPointerCancel={viewer.stopRotation} onPointerDown={viewer.startRotation} onPointerOut={viewer.stopRotation} onPointerUp={viewer.stopRotation} r={10} />
			<circle className='pointer-events-auto cursor-grabbing' cx='100%' cy='100%' fill='none' r={12} stroke='#fff' />
		</svg>
	)
})
