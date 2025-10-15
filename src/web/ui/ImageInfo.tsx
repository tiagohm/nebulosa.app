import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/molecules/image/viewer'
import { Icons } from './Icon'

export const ImageInfo = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { info, scale } = useSnapshot(viewer.state)

	if (!info) return null

	return (
		<div className='text-sm top-2 left-2 pointer-events-none select-none absolute p-1 opacity-80 hover:opacity-80 z-[999999]'>
			<div className='flex flex-col gap-0'>
				<span className='text-xs text-neutral-400'>{info.realPath}</span>
				<div className='flex flex-row items-center gap-1'>
					{info.width}x{info.height}
					<Icons.ZoomIn size={14} />
					{scale.toFixed(2)}
				</div>
			</div>
		</div>
	)
})
