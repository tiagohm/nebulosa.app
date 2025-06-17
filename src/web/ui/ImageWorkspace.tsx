import { ScopeProvider, useMolecule } from 'bunshi/react'
import { useSnapshot } from 'valtio'
import { HomeMolecule, ImageViewerScope } from '@/shared/molecules'
import { ImageViewer } from './ImageViewer'

export function ImageWorkspace() {
	const home = useMolecule(HomeMolecule)
	const { images } = useSnapshot(home.state)

	return (
		<div className='workspace relative h-full w-full'>
			{images.map((image) => (
				<ScopeProvider key={image.key} scope={ImageViewerScope} value={{ image }}>
					<ImageViewer />
				</ScopeProvider>
			))}
		</div>
	)
}
