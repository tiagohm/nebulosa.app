import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { workspaceSyncState } from './sync'

// Shows its children once the workspace (the saved connections and the profiles) was read from the server, and until
// then says the tab is waiting for it, so nothing ever runs on a profile the server does not hold.

// Renders children once the workspace is loaded.
export function WorkspaceGate({ children }: { readonly children: ReactNode }) {
	const { loaded } = useSnapshot(workspaceSyncState)
	if (loaded) return children

	return <div className="flex h-dvh items-center justify-center bg-base-100 text-sm leading-5 text-ink-300">Connecting to the Nebulosa server…</div>
}
