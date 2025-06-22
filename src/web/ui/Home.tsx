import { HomeNavBar } from './HomeNavBar'
import { ImageWorkspace } from './ImageWorkspace'

export default function Home() {
	return (
		<div className='w-full h-full flex flex-col'>
			<HomeNavBar />
			<ImageWorkspace />
		</div>
	)
}
