import { ConnectionModal } from './connection/ConnectionModal'
import { TopBar } from './layout/TopBar'

export function App() {
	return (
		<div className="flex h-screen flex-col bg-base-100">
			<TopBar />
			<main className="flex-1" />
			<ConnectionModal />
		</div>
	)
}
