import { formatTemporal } from 'nebulosa/src/temporal'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import type { Connection } from '@/shared/types'
import { connection } from '../store/connection.store'
import { Chip } from './components/Chip'
import { Dropdown, DropdownItem } from './components/Dropdown'
import { IconButton } from './components/IconButton'
import { Select } from './components/Select'
import { ConnectButton } from './ConnectButton'
import { ConnectionEdit } from './ConnectionEdit'
import { Icons } from './Icon'

function ConnectionItem(item: Connection, index: number, selected: boolean, placement: 'trigger' | 'list') {
	const endpoint = `${item.host}:${item.port}`

	if (placement === 'trigger') {
		return (
			<div className="flex min-w-0 items-center justify-between gap-2 p-1 text-xs">
				<div className="flex min-w-0 flex-1 flex-col gap-0">
					<span className="min-w-0 truncate font-bold">{item.name}</span>
					{item.type !== 'SIMULATOR' && <span className="min-w-0 truncate text-xs text-neutral-500">{endpoint}</span>}
				</div>
				<div className="hidden items-center sm:flex">
					<Chip color="primary" label={item.type} size="sm" />
				</div>
			</div>
		)
	}

	return (
		<div className="flex min-w-0 items-center justify-between gap-2 text-xs">
			<div className="flex min-w-0 flex-1 items-center justify-between gap-1">
				<div className="mt-1 flex min-w-0 flex-1 flex-col gap-1">
					<span className="flex min-w-0 items-center gap-2 font-bold">
						<span className="min-w-0 truncate">{item.name}</span>
						<Chip color="primary" label={item.type} size="sm" />
					</span>
					<span className="flex min-w-0 items-center gap-1 text-xs text-neutral-500">
						{item.type !== 'SIMULATOR' && (
							<>
								<Icons.Laptop />
								<span className="min-w-0 truncate">{endpoint}</span>
							</>
						)}
						<Icons.Clock />
						<span className="shrink-0">{item.connectedAt ? formatTemporal(item.connectedAt, 'YYYY-MM-DD HH:mm:ss') : 'never'}</span>
					</span>
				</div>
			</div>
			<EditDropdown item={item} />
		</div>
	)
}

export const ConnectionBox = memo(() => {
	const { connections, loading, selected, connected, show } = useSnapshot(connection.state)

	return (
		<>
			<div className="flex w-full min-w-0 flex-row items-center gap-2">
				<IconButton color="success" disabled={loading || !!connected} icon={Icons.Plus} onClick={connection.create} tooltipContent="New Connection" />
				<Select className="min-w-0 flex-1" disabled={loading || !!connected} items={connections} onValueChange={connection.select} value={selected} size="lg">
					{ConnectionItem}
				</Select>
				<ConnectButton disabled={!selected} connected={!!connected} loading={loading} onClick={connection.connect} />
			</div>
			{show && !connected && <ConnectionEdit />}
		</>
	)
})

interface EditDropdownProps {
	readonly item: Connection
}

const EditDropdown = memo(({ item }: EditDropdownProps) => {
	const { connections } = useSnapshot(connection.state)

	return (
		<Dropdown hideChevron itemHeight={28} label={<Icons.VerticalMenu color="var(--color-neutral-500)" />} color="default" variant="ghost" size="sm">
			<DropdownItem label="Edit" onClick={() => connection.edit(item)} startContent={<Icons.Edit />} />
			<DropdownItem label="Duplicate" onClick={() => connection.duplicate(item)} startContent={<Icons.Copy />} />
			<DropdownItem label="Delete" disabled={connections.length === 1} color="danger" onClick={() => connection.remove(item)} startContent={<Icons.Trash />} variant="flat" />
		</Dropdown>
	)
})
