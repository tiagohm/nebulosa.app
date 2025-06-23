import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { ImageViewerMolecule } from '@/molecules/image/viewer'

export const ImageRoi = memo(() => {
	const viewer = useMolecule(ImageViewerMolecule)
	const { image } = viewer.scope

	return <div className='roi'></div>
})
