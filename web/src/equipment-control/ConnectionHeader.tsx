import { cn } from 'cn'
import { connectionState } from '../connection/connection'
import { useSelectedConnection } from '../connection/useSelectedConnection'
import { deviceState, refreshDevices } from '../equipment/equipment'
import { operationsState, refreshOperations } from '../operations'
import { Button } from '../ui/Button'
import { controlRuntime, refreshStates } from './control'

// Header of the Equipment Control page: the connection the active profile works with, its type, and the
// real state of its server. The page never opens or closes a connection: changing it is done in
// Management → Connections, and refreshing only fetches the server's state again.

// Display text of each connection status.
const STATUS_LABELS = { connected: 'Connected', connecting: 'Connecting', disconnected: 'Not connected' } as const

// Header with the connection of the page.
export function ConnectionHeader() {
	const { connection, status } = useSelectedConnection()

	function refresh() {
		void refreshDevices(deviceState)
		void refreshStates(controlRuntime)
		void refreshOperations(operationsState)
	}

	return (
		<header className="flex min-h-12 flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-100 bg-base-100 px-4 py-1.5">
			<h1 className="m-0 flex-none text-sm font-semibold text-ink-100">Equipment Control</h1>
			<div className="flex min-w-0 items-center gap-2 text-xs text-ink-200">
				<span className={cn('size-1.5 flex-none rounded-full', status === 'connected' ? 'bg-success' : status === 'connecting' ? 'bg-accent' : 'border border-ink-300')} />
				<span className="truncate">{connection ? `${connection.name} · ${connection.type} · ${STATUS_LABELS[status]}` : 'No connection selected'}</span>
			</div>
			<div className="ml-auto flex flex-none items-center gap-2">
				<Button variant="secondary" onClick={refresh} disabled={status !== 'connected'}>
					Refresh
				</Button>
				<Button variant="secondary" onClick={() => (connectionState.open = true)}>
					Connections
				</Button>
			</div>
		</header>
	)
}
