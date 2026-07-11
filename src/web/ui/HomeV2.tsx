import { memo } from 'react'
import { useStore } from '../hooks/store.hook'
import { wsStore } from '../stores/ws.store'
import { Confirmation } from './Confirmation'
import { ImagePickerButton } from './ImagePickerButton'
import { Workspace } from './workspace/Workspace'

export const Home = memo(() => {
	// Mounts the websocket lifecycle once the home screen is active.
	useStore(wsStore, [])

	return (
		<div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] text-white">
			<header className="flex flex-row justify-center p-2">
				<ImagePickerButton />
			</header>
			<div className="min-h-0">
				<Workspace />
				<Confirmation />
			</div>
		</div>
	)
})
