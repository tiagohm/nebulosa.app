import { useMolecule } from 'bunshi/react'
import { formatTemporal } from 'nebulosa/src/temporal'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConnectionMolecule } from '@/molecules/connection'
import type { Connection } from '@/shared/types'
import { Chip } from './components/Chip'
import { Dropdown, DropdownItem } from './components/Dropdown'
import { IconButton } from './components/IconButton'
import { Select } from './components/Select'
import { ConnectButton } from './ConnectButton'
import { ConnectionEdit } from './ConnectionEdit'
import { Icons } from './Icon'

function ConnectionItem(item: Connection, index: number, selected: boolean, placement: 'trigger' | 'list') {
	if (placement === 'trigger') {
		return (
			<div className="flex items-center justify-between gap-2 p-1 text-xs">
				<div className="flex flex-col gap-0">
					<span className="font-bold">{item.name}</span>
					<Activity mode={item.type === 'SIMULATOR' ? 'hidden' : 'visible'}>
						<span className="text-default-500 text-tiny flex items-center gap-1">
							{item.host}:{item.port}
						</span>
					</Activity>
				</div>
				<div className="hidden items-center sm:flex">
					<Chip color="primary" label={item.type} size="sm" />
				</div>
			</div>
		)
	}

	return (
		<div className="flex items-center justify-between gap-2 text-xs">
			<div className="flex flex-1 items-center justify-between gap-1">
				<div className="mt-1 flex flex-col gap-1">
					<span className="flex items-center gap-2 font-bold">
						{item.name}
						<Chip color="primary" label={item.type} size="sm" />
					</span>
					<span className="text-default-500 text-tiny flex items-center gap-1">
						<Activity mode={item.type === 'SIMULATOR' ? 'hidden' : 'visible'}>
							<Icons.Laptop />
							<span>
								{item.host}:{item.port}
							</span>
						</Activity>
						<Icons.Clock />
						{item.connectedAt ? formatTemporal(item.connectedAt, 'YYYY-MM-DD HH:mm:ss') : 'never'}
					</span>
				</div>
			</div>
			<EditDropdown item={item} />
		</div>
	)
}

export const ConnectionBox = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { connections, loading, selected, connected, show } = useSnapshot(connection.state)

	function handleValueChange(value: Connection) {
		connection.select(value)
	}

	return (
		<>
			<div className="flex w-full flex-row items-center gap-2">
				<IconButton color="success" disabled={loading || !!connected} icon={Icons.Plus} onPointerUp={connection.create} tooltipContent="New Connection" />
				<Select className="flex-1" disabled={loading || !!connected} items={connections} onValueChange={handleValueChange} value={selected} size="lg">
					{ConnectionItem}
				</Select>
				<ConnectButton disabled={!selected} connected={!!connected} loading={loading} onPointerUp={connection.connect} />
			</div>
			<Activity mode={show && !connected ? 'visible' : 'hidden'}>
				<ConnectionEdit />
			</Activity>
		</>
	)
})

interface EditDropdownProps {
	readonly item: Connection
}

const EditDropdown = memo(({ item }: EditDropdownProps) => {
	const connection = useMolecule(ConnectionMolecule)
	const { connections } = useSnapshot(connection.state)

	return (
		<Dropdown hideChevron itemHeight={28} label={<Icons.VerticalMenu color="var(--color-neutral-500)" />} color="default" variant="ghost" size="sm">
			<DropdownItem label="Edit" onPointerUp={() => connection.edit(item)} startContent={<Icons.Edit />} />
			<DropdownItem label="Duplicate" onPointerUp={() => connection.duplicate(item)} startContent={<Icons.Copy />} />
			<DropdownItem label="Delete" disabled={connections.length === 1} color="danger" onPointerUp={() => connection.remove(item)} startContent={<Icons.Trash />} variant="flat" />
		</Dropdown>
	)
})
