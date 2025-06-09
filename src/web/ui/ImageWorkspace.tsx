import { HomeMolecule } from '@/shared/molecules'
import { useMolecule } from 'bunshi/react'
import { useSnapshot } from 'valtio'
import { ImageViewer } from './ImageViewer'

export function ImageWorkspace() {
	const molecule = useMolecule(HomeMolecule)
	const { images } = useSnapshot(molecule.state)

	return (
		<div className='workspace relative h-full w-full'>
			{images.map((image, index) => (
				<ImageViewer key={image.key} image={image} index={index} />
			))}
		</div>
	)
}
