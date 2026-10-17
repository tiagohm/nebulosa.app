import { useSnapshot } from 'valtio'
import { ConnectionModal } from '../connection/ConnectionModal'
import { EquipmentModal } from '../equipment/EquipmentModal'
import { TopBar } from '../layout/TopBar'
import { ProfileModal } from '../profile/ProfileModal'
import { NavigationRail } from './NavigationRail'
import { routeState } from './route'
import { StatusBar } from './StatusBar'
import { workspaceDefinition } from './workspaces'

// Persistent frame of the application: top bar, navigation rail, the active workspace, status bar, and
// the management modals. The frame stays mounted while navigating; only the active workspace's
// component is swapped, and unmounting it releases presentation resources only.

// Application shell.
export function ApplicationShell() {
	const { route } = useSnapshot(routeState)
	const Workspace = workspaceDefinition(route.workspace).component

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-base-100">
			<TopBar />
			<div className="flex min-h-0 flex-1">
				<NavigationRail />
				<Workspace />
			</div>
			<StatusBar />
			<ConnectionModal />
			<EquipmentModal />
			<ProfileModal />
		</div>
	)
}
