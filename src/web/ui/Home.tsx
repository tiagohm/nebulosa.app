import { useMolecule } from 'bunshi/react'
import { WebSocketMolecule } from '@/molecules/ws'
import { HomeNavBar } from './HomeNavBar'
import { ImageWorkspace } from './ImageWorkspace'

export default function Home() {
	const webSocket = useMolecule(WebSocketMolecule)

	return (
		<div className='w-full h-full flex flex-col'>
			<HomeNavBar />
			<ImageWorkspace />
		</div>
	)
}
