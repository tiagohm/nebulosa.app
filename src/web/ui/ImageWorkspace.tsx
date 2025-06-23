import { ScopeProvider, useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerScope } from '@/molecules/image/viewer'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import { ImageViewer } from './ImageViewer'

export const ImageWorkspace = memo(() => {
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { images } = useSnapshot(workspace.state)

	return (
		<div className='workspace relative h-full w-full'>
			{images.map((image) => (
				<ScopeProvider key={image.key} scope={ImageViewerScope} value={{ image }}>
					<ImageViewer />
				</ScopeProvider>
			))}
		</div>
	)
})
