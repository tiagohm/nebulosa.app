import { useMolecule } from 'bunshi/react'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerMolecule } from '@/shared/molecules'

export const ImageInfo = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { info, zoom } = useSnapshot(viewer.state)

	if (!info) return null

	return (
		<div className='text-sm top-2 left-2 pointer-events-none select-none absolute p-1 opacity-80 hover:opacity-80 z-[999999]'>
			<div className='flex flex-col gap-0'>
				<span className='text-xs text-neutral-400'>{info.originalPath}</span>
				<div className='flex flex-row items-center gap-1'>
					{info.width}x{info.height}
					<Lucide.ZoomIn size={16} />
					{zoom.toFixed(2)}
				</div>
			</div>
		</div>
	)
})
