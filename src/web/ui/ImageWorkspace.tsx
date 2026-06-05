import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { imageWorkspaceStore } from '@/stores/image.workspace.store'
import { ImageContext } from '../shared/context'
import { ImageViewer } from './ImageViewer'
import { Planetarium } from './Planetarium'

export const ImageWorkspace = memo(() => {
	const { images } = useSnapshot(imageWorkspaceStore.state)

	return (
		<div className="workspace relative h-full min-h-0 w-full flex-1 overflow-hidden">
			<Planetarium />
			{images.map((image) => (
				<ImageContext key={image.id} value={image}>
					<ImageViewer />
				</ImageContext>
			))}
		</div>
	)
})
