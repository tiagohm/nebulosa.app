import { useMolecule } from 'bunshi/react'
import { ImageViewerMolecule } from '@/shared/molecules'

export function Roi() {
	const viewer = useMolecule(ImageViewerMolecule)
	const { image } = viewer.scope

	return <div className='roi'></div>
}
