import { Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Select, SelectItem, type SharedSelection, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { formatTemporal } from 'nebulosa/src/temporal'
import { Activity, memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConnectionMolecule } from '@/molecules/connection'
import { stopPropagation } from '@/shared/util'
import { ConnectButton } from './ConnectButton'
import { ConnectionEdit } from './ConnectionEdit'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

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
			<div className='w-full flex flex-row items-center gap-2 max-w-120'>
				<Tooltip content='New Connection' showArrow>
					<IconButton color='success' icon={Icons.Plus} isDisabled={loading || !!connected} onPointerUp={connection.create} />
				</Tooltip>
				<Select
					className='flex-1'
					disallowEmptySelection
					isDisabled={loading || !!connected}
					items={connections}
					onSelectionChange={handleSelectionChange}
					renderValue={(selected) => {
						return selected.map((item) => (
							<div className='p-1 flex items-center justify-between gap-0' key={item.data?.id}>
								<div className='flex flex-col gap-0'>
									<span className='font-bold'>{item.data?.name}</span>
									<span className='text-default-500 text-tiny flex gap-1 items-center'>
										{item.data?.host}:{item.data?.port}
									</span>
								</div>
								<div className='hidden sm:flex items-center'>
									<Chip color='primary' size='sm'>
										{item.data?.type}
									</Chip>
								</div>
							</div>
						))
					}}
					selectedKeys={new Set([selected?.id ?? ''])}
					selectionMode='single'
					size='lg'>
					{(item) => (
						<SelectItem key={item.id} textValue={item.name}>
							<div className='flex items-center justify-between gap-2'>
								<div className='flex flex-1 items-center justify-between gap-1'>
									<div className='flex flex-col gap-1 mt-1'>
										<span className='font-bold flex items-center gap-2'>
											{item.name}
											<Chip color='primary' size='sm'>
												{item.type}
											</Chip>
										</span>
										<span className='text-default-500 text-tiny flex gap-1 items-center'>
											<Icons.Laptop size={12} />
											{item.host}:{item.port}
											<Icons.Clock size={12} />
											{item.connectedAt ? formatTemporal(item.connectedAt, 'YYYY-MM-DD HH:mm:ss') : 'never'}
										</span>
									</div>
								</div>
								<div className='flex justify-center items-center'>
									<Dropdown showArrow>
										<DropdownTrigger>
											<IconButton icon={Icons.VerticalMenu} onPointerUp={stopPropagation} size='sm' />
										</DropdownTrigger>
										<DropdownMenu disabledKeys={connections.length === 1 ? ['delete'] : []}>
											<DropdownItem key='edit' onPointerUp={() => connection.edit(item)} startContent={<Icons.Edit size={12} />}>
												Edit
											</DropdownItem>
											<DropdownItem key='duplicate' onPointerUp={() => connection.duplicate(item)} startContent={<Icons.Copy size={12} />}>
												Duplicate
											</DropdownItem>
											<DropdownItem className='text-danger' color='danger' key='delete' onPointerUp={() => connection.remove(item)} startContent={<Icons.Trash size={12} />}>
												Delete
											</DropdownItem>
										</DropdownMenu>
									</Dropdown>
								</div>
							</div>
						</SelectItem>
					)}
				</Select>
				<ConnectButton isConnected={!!connected} isDisabled={!selected} isLoading={loading} onPointerUp={connection.connect} />
			</div>
			<Activity mode={show && !connected ? 'visible' : 'hidden'}>
				<ConnectionEdit />
			</Activity>
		</>
	)
})
