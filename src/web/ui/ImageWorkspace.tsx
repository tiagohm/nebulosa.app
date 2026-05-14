import { ScopeProvider, useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageViewerScope } from '@/molecules/image/viewer'
import { ImageWorkspaceMolecule } from '@/molecules/image/workspace'
import type { Image } from '@/shared/types'
import { ImageViewer } from './ImageViewer'

interface ImageViewProps {
	readonly image: Image
}

const ImageView = memo(({ image }: ImageViewProps) => (
	<ScopeProvider scope={ImageViewerScope} value={{ image }}>
		<ImageViewer />
	</ScopeProvider>
))

export const ImageWorkspace = memo(() => {
	const workspace = useMolecule(ImageWorkspaceMolecule)
	const { images } = useSnapshot(workspace.state)

	return (
		<div className="workspace relative min-h-0 w-full flex-1 overflow-hidden">
			{images.map((image) => (
				<ImageView image={image} key={image.key} />
			))}
		</div>
	)
})
