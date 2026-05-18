import { ScopeProvider } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerScope } from '@/molecules/image/viewer'
import { imageWorkspaceStore } from '../store/image.workspace.store'
import { ImageViewer } from './ImageViewer'

export const ImageWorkspace = memo(() => {
	const { images } = useSnapshot(imageWorkspaceStore.state)

	return (
		<div className="workspace relative min-h-0 w-full flex-1 overflow-hidden">
			{images.map((image) => (
				<ScopeProvider key={image.key} scope={ImageViewerScope} value={{ image }}>
					<ImageViewer />
				</ScopeProvider>
			))}
		</div>
	)
})
