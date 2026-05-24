import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageContext } from '../shared/context'
import { imageWorkspaceStore } from '../store/image.workspace.store'
import { ImageViewer } from './ImageViewer'

export const ImageWorkspace = memo(() => {
	const { images } = useSnapshot(imageWorkspaceStore.state)

	return (
		<div className="workspace relative min-h-0 w-full flex-1 overflow-hidden">
			{images.map((image) => (
				<ImageContext key={image.id} value={image}>
					<ImageViewer />
				</ImageContext>
			))}
		</div>
	)
})
