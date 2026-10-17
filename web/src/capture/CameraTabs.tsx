import { cn } from 'cn'
import { type KeyboardEvent, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { type CameraRole, roleDefinition } from '../equipment/roles'
import { RoleStatusText } from '../equipment/RoleStatusText'
import { useRoleDevice } from '../equipment/useEquipment'
import { activeProfile, activeSetup, profileState } from '../profile/profile'
import { moveIndex } from '../ui/navigation'

// Tabs of the Capture workspace's camera views, one per camera role assigned in the active profile's
// equipment setup. Each tab shows the role, its device, and the device's state as text, and the selected
// tab is underlined, so no state depends on color alone. Only the selected tab is reachable with Tab;
// arrow keys, Home, and End move between tabs and select them. Selecting a tab only changes what is
// shown: nothing is connected, stopped, or redirected.

export interface CameraTabsProps {
	// Camera roles with a tab, in display order.
	readonly tabs: readonly CameraRole[]
	// Camera role of the selected tab.
	readonly selected: CameraRole
	// Selects the view of a camera role.
	readonly onSelect: (role: CameraRole) => void
}

// Camera view tabs.
export function CameraTabs({ tabs, selected, onSelect }: CameraTabsProps) {
	const listRef = useRef<HTMLDivElement>(null)

	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const index = moveIndex(tabs.indexOf(selected), tabs.length, e.key)
		const role = index === undefined ? undefined : tabs[index]
		if (!role) return
		e.preventDefault()
		onSelect(role)
		listRef.current?.querySelector<HTMLButtonElement>(`[data-camera="${role}"]`)?.focus()
	}

	return (
		<div ref={listRef} onKeyDown={handleKeyDown} className="flex h-11 flex-none items-stretch gap-1 overflow-x-auto overflow-y-hidden border-b border-line-100 bg-base-100 px-2">
			{tabs.map((role) => (
				<CameraTab key={role} role={role} selected={role === selected} onSelect={() => onSelect(role)} />
			))}
		</div>
	)
}

interface CameraTabProps {
	// Camera role of the tab.
	readonly role: CameraRole
	// Whether the tab is selected.
	readonly selected: boolean
	// Selects the tab.
	readonly onSelect: () => void
}

// Tab of one camera view: the role, the assigned device's name, and its state.
function CameraTab({ role, selected, onSelect }: CameraTabProps) {
	const { device, status } = useRoleDevice(role)
	const profiles = useSnapshot(profileState)
	const label = roleDefinition(role).label
	const name = device?.name || activeSetup(activeProfile(profiles))[role]?.name

	return (
		<button
			type="button"
			data-camera={role}
			tabIndex={selected ? 0 : -1}
			title={name ? `${label}: ${name}` : label}
			onClick={onSelect}
			className={cn(
				'flex max-w-80 flex-none cursor-pointer items-center gap-2 border-0 border-b-2 bg-transparent px-3 font-mono text-[13px] leading-5 whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none',
				selected ? 'border-accent text-ink-100' : 'border-transparent text-ink-300 hover:text-ink-100',
			)}
		>
			<span className={cn('flex-none', selected && 'font-semibold')}>{label}</span>
			{name && <span className="min-w-0 truncate text-ink-300 max-sm:hidden">{name}</span>}
			<RoleStatusText status={status} className="flex-none text-[11px]" />
		</button>
	)
}
