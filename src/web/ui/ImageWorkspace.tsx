import { homeState } from '@/stores/home'
import { useSnapshot } from 'valtio'
import { ImageViewer } from './ImageViewer'

export function ImageWorkspace() {
	const home = useSnapshot(homeState)

	return (
		<div className='workspace relative h-full w-full'>
			{Object.keys(home.images).map((key) => (
				<ImageViewer key={key} image={home.images[key]} />
			))}
		</div>
	)
}
