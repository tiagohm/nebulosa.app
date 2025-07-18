import { Button, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Select, SelectItem, type SharedSelection, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { format } from 'date-fns'
import * as Lucide from 'lucide-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ConnectionMolecule } from '@/molecules/connection'
import { ConnectButton } from './ConnectButton'
import { ConnectionEdit } from './ConnectionEdit'

export const ConnectionBox = memo(() => {
	const connection = useMolecule(ConnectionMolecule)
	const { connections, loading, selected, connected, showModal } = useSnapshot(connection.state)

	function connectionChanged(keys: SharedSelection) {
		if (keys instanceof Set) {
			const id = keys.values().next().value
			typeof id === 'string' && connection.selectWith(id)
		}
	}

	return (
		<>
			<div className='w-full flex flex-row items-center gap-2 max-w-120'>
				<Tooltip content='New Connection' showArrow>
					<Button color='success' isDisabled={loading || !!connected} isIconOnly onPointerUp={connection.create} variant='light'>
						<Lucide.Plus />
					</Button>
				</Tooltip>
				<Select
					className='flex-1'
					disallowEmptySelection
					isDisabled={loading || !!connected}
					items={connections}
					onSelectionChange={connectionChanged}
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
					selectedKeys={new Set([selected.id])}
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
											<Lucide.Computer size={12} />
											{item.host}:{item.port}
											<Lucide.Clock size={12} />
											{item.connectedAt ? format(item.connectedAt, 'yyyy-MM-dd HH:mm:ss') : 'never'}
										</span>
									</div>
								</div>
								<div className='flex justify-center items-center'>
									<Dropdown showArrow>
										<DropdownTrigger>
											<Button isIconOnly size='sm' variant='light'>
												<Lucide.EllipsisVertical size={18} />
											</Button>
										</DropdownTrigger>
										<DropdownMenu disabledKeys={connections.length === 1 ? ['delete'] : []}>
											<DropdownItem key='edit' onPointerUp={() => connection.edit(item)} startContent={<Lucide.Pencil size={12} />}>
												Edit
											</DropdownItem>
											<DropdownItem key='duplicate' onPointerUp={() => connection.duplicate(item)} startContent={<Lucide.Copy size={12} />}>
												Duplicate
											</DropdownItem>
											<DropdownItem className='text-danger' color='danger' key='delete' onPointerUp={() => connection.remove(item)} startContent={<Lucide.Trash size={12} />}>
												Delete
											</DropdownItem>
										</DropdownMenu>
									</Dropdown>
								</div>
							</div>
						</SelectItem>
					)}
				</Select>
				<ConnectButton isConnected={!!connected} isLoading={loading} onPointerUp={connection.connect} />
			</div>
			{showModal && <ConnectionEdit />}
		</>
	)
})
