import { memo } from 'react'
import { useStore } from '../hooks/store.hook'
import { wsStore } from '../stores/ws.store'
import { Workspace } from './workspace/Workspace'

export const Home = memo(() => {
	useStore(wsStore, [])

	return (
		<div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] text-white">
			<header></header>
			<div className="min-h-0">
				<Workspace />
			</div>
		</div>
	)
})
