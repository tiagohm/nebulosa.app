import { connectionState } from './connection/connection'
import { ConnectionModal } from './connection/ConnectionModal'
import { Button } from './ui/Button'

export function App() {
	return (
		<div className="flex h-screen flex-col bg-base-100">
			<header className="box-border flex h-14 items-center justify-between gap-4 border-b border-line-100 bg-base-000 px-4">
				<div className="text-lg leading-[26px] font-semibold">Nebulosa</div>
				<Button variant="secondary" onClick={() => (connectionState.open = true)}>
					Connections
				</Button>
			</header>
			<main className="flex-1" />
			<ConnectionModal />
		</div>
	)
}
