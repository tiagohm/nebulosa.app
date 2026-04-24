import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Select, type SelectedItemProps, type SelectedItems, SelectItem, type SharedSelection } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatTemporal } from 'nebulosa/src/temporal'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConnectionMolecule } from '@/molecules/connection'
import type { Connection } from '@/shared/types'
import { stopPropagationDesktopOnly } from '@/shared/util'
import { Chip } from './components/Chip'
import { ConnectButton } from './ConnectButton'
import { ConnectionEdit } from './ConnectionEdit'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

const ConnectionItem = (item: Connection) => (
	<SelectItem key={item.id} textValue={item.name}>
		<div className="flex items-center justify-between gap-2">
			<div className="flex flex-1 items-center justify-between gap-1">
				<div className="mt-1 flex flex-col gap-1">
					<span className="flex items-center gap-2 font-bold">
						{item.name}
						<Chip color="primary" label={item.type} />
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
	</SelectItem>
)

const SelectedConnectionItem = (item: SelectedItemProps<Connection>) => (
	<div className="flex items-center justify-between gap-0 p-1" key={item.data?.id}>
		<div className="flex flex-col gap-0">
			<span className="font-bold">{item.data?.name}</span>
			<Activity mode={item.data?.type === 'SIMULATOR' ? 'hidden' : 'visible'}>
				<span className="text-default-500 text-tiny flex items-center gap-1">
					{item.data?.host}:{item.data?.port}
				</span>
			</Activity>
		</div>
		<div className="hidden items-center sm:flex">
			<Chip color="primary">{item.data?.type}</Chip>
		</div>
	</div>
)

const SelectedConnectionItems = (items: SelectedItems<Connection>) => items.map(SelectedConnectionItem)

export const ConnectionBox = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { connections, loading, selected, connected, show } = useSnapshot(connection.state)

	function handleSelectionChange(keys: SharedSelection) {
		if (keys instanceof Set) {
			const id = keys.values().next().value
			typeof id === 'string' && connection.select(id)
		}
	}

	return (
		<>
			<div className="flex w-full max-w-120 flex-row items-center gap-2">
				<IconButton color="success" disabled={loading || !!connected} icon={Icons.Plus} onPointerUp={connection.create} tooltipContent="New Connection" />
				<Select className="flex-1" disallowEmptySelection isDisabled={loading || !!connected} items={connections} onSelectionChange={handleSelectionChange} renderValue={SelectedConnectionItems} selectedKeys={new Set([selected?.id ?? ''])} selectionMode="single" size="lg">
					{ConnectionItem}
				</Select>
				<ConnectButton disabled={!selected} isConnected={!!connected} loading={loading} onPointerUp={connection.connect} />
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
		<div className="flex items-center justify-center">
			<Dropdown>
				<DropdownTrigger>
					<IconButton icon={Icons.VerticalMenu} onPointerUp={stopPropagationDesktopOnly} />
				</DropdownTrigger>
				<DropdownMenu disabledKeys={connections.length === 1 ? ['delete'] : []}>
					<DropdownItem key="edit" onPointerUp={() => connection.edit(item)} startContent={<Icons.Edit />}>
						Edit
					</DropdownItem>
					<DropdownItem key="duplicate" onPointerUp={() => connection.duplicate(item)} startContent={<Icons.Copy />}>
						Duplicate
					</DropdownItem>
					<DropdownItem className="text-danger" color="danger" key="delete" onPointerUp={() => connection.remove(item)} startContent={<Icons.Trash />}>
						Delete
					</DropdownItem>
				</DropdownMenu>
			</Dropdown>
		</div>
	)
})
