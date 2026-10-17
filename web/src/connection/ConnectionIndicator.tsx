import { tv } from 'tailwind-variants'
import { useSnapshot } from 'valtio'
import { activeProfile, profileState } from '../profile/profile'
import { connectionState, serverOf } from './connection'

// Top bar indicator of the connection selected by the tab's active profile and the real state of its
// server: a pulsing dot while the server holds it open, a fading accent dot while connecting, and a
// hollow dot while it is closed or none is selected. Opens the connections modal when clicked.

// Display state of the indicator, derived from connectionState.
type IndicatorStatus = 'connected' | 'connecting' | 'disconnected'

// Styles of the status dot and its pulse ring for each status.
const indicator = tv({
	slots: {
		dot: 'relative inline-flex size-2 rounded-full',
		ring: 'absolute inline-flex size-full rounded-full',
	},
	variants: {
		status: {
			connected: { dot: 'bg-success shadow-[0_0_8px_var(--color-success)]', ring: 'animate-ping bg-success opacity-60' },
			connecting: { dot: 'animate-pulse bg-accent', ring: 'hidden' },
			disconnected: { dot: 'border-[1.5px] border-ink-300 box-border', ring: 'hidden' },
		},
	},
})

// Button with the selected connection's name and server status.
export function ConnectionIndicator() {
	const { connections, servers, loading } = useSnapshot(connectionState)
	const profiles = useSnapshot(profileState)
	const connectionId = profiles.profiles.length > 0 ? activeProfile(profiles).connectionId : undefined
	const connection = connections.find((c) => c.id === connectionId)
	const status: IndicatorStatus = serverOf(servers, connection) ? 'connected' : connection && loading?.kind === 'connect' && loading.connectionId === connection.id ? 'connecting' : 'disconnected'
	const label = status === 'connecting' ? 'Connecting…' : (connection?.name ?? 'No connection')
	const title = !connection ? 'No connection selected' : status === 'connected' ? `Connected to ${connection.name}` : status === 'connecting' ? `Connecting to ${connection.name}` : `${connection.name} · Not connected`
	const { dot, ring } = indicator({ status })

	return (
		<button
			type="button"
			title={title}
			onClick={() => (connectionState.open = true)}
			className="flex h-8 max-w-56 cursor-pointer items-center gap-2 rounded-full border border-line-100 bg-base-100 px-3 text-xs text-ink-200 transition-colors duration-150 hover:border-line-200 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-sm:px-2.5"
		>
			<span className="relative flex size-2 flex-none">
				<span className={ring()} />
				<span className={dot()} />
			</span>
			<span className={status === 'disconnected' ? 'truncate text-ink-300 max-sm:hidden' : 'truncate max-sm:hidden'}>{label}</span>
		</button>
	)
}
