import { tv } from 'tailwind-variants'
import { useSnapshot } from 'valtio'
import { connectionState } from './connection'

// Top bar indicator of the tab's active connection: a pulsing dot and the connection name while
// connected, a fading accent dot while connecting, and a hollow dot while disconnected. Opens the
// connections modal when clicked.

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

// Button with the tab's connection status and the active connection name.
export function ConnectionIndicator() {
	const { connections, active, loading } = useSnapshot(connectionState)
	const name = active && connections.find((c) => c.id === active.connectionId)?.name
	const status: IndicatorStatus = active ? 'connected' : loading === 'connect' ? 'connecting' : 'disconnected'
	const label = status === 'connected' ? (name ?? 'Connected') : status === 'connecting' ? 'Connecting…' : 'Not connected'
	const { dot, ring } = indicator({ status })

	return (
		<button
			type="button"
			title={status === 'connected' ? `Connected to ${label}` : label}
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
