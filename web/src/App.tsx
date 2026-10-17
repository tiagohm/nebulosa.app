import { ConnectionModal } from './connection/ConnectionModal'
import { EquipmentModal } from './equipment/EquipmentModal'
import { useWatchActiveServer } from './equipment/useEquipment'
import { TopBar } from './layout/TopBar'
import { ProfileModal } from './profile/ProfileModal'

// Application shell. Keeps the device runtime watching the active profile's connection for every panel.
export function App() {
	useWatchActiveServer()

	return (
		<div className="flex h-screen flex-col bg-base-100">
			<TopBar />
			<main className="flex-1" />
			<ConnectionModal />
			<EquipmentModal />
			<ProfileModal />
		</div>
	)
}
