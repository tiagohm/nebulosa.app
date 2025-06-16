import { useDraggableModal } from '@/shared/hooks'
import { ConnectionMolecule } from '@/shared/molecules'
import { stopPropagation } from '@/shared/utils'
// biome-ignore format:
import { Button, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Select, SelectItem, type SharedSelection, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { format } from 'date-fns'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { ConnectButton } from './ConnectButton'
import { ConnectionEdit } from './ConnectionEdit'

export interface ConnectionBoxProps {
	readonly isDisabled?: boolean
}

export function ConnectionBox({ isDisabled = false }: ConnectionBoxProps) {
	const connectionModal = useDraggableModal({ name: 'connection' })
	const connection = useMolecule(ConnectionMolecule)
	const state = useSnapshot(connection.state)

	function connectionChanged(keys: SharedSelection) {
		if (keys instanceof Set) {
			const id = keys.values().next().value
			typeof id === 'string' && connection.selectWith(id)
		}
	}

	return (
		<>
			<div className='w-full flex flex-row items-center gap-2'>
				<Tooltip content='New Connection' showArrow>
					<Button isIconOnly color='success' variant='light' onPointerUp={() => connection.create(connectionModal)} isDisabled={isDisabled}>
						<Lucide.Plus />
					</Button>
				</Tooltip>
				<Select
					className='flex-1'
					size='lg'
					disallowEmptySelection
					selectionMode='single'
					isDisabled={isDisabled}
					items={state.connections}
					selectedKeys={new Set([state.selected.id])}
					onSelectionChange={connectionChanged}
					renderValue={(selected) => {
						return selected.map((item) => (
							<div key={item.data?.id} className='p-1 flex items-center justify-between gap-0'>
								<div className='flex flex-col gap-0'>
									<span className='font-bold'>{item.data?.name}</span>
									<span className='text-default-500 text-tiny flex gap-1 items-center'>
										{item.data?.host}:{item.data?.port}
									</span>
								</div>
								<div className='hidden sm:flex items-center'>
									<Chip size='sm' color='primary'>
										{item.data?.type}
									</Chip>
								</div>
							</div>
						))
					}}>
					{(item) => (
						<SelectItem key={item.id} textValue={item.name}>
							<div className='flex items-center justify-between gap-2'>
								<div className='flex flex-1 items-center justify-between gap-1'>
									<div className='flex flex-col gap-1 mt-1'>
										<span className='font-bold flex items-center gap-2'>
											{item.name}
											<Chip size='sm' color='primary'>
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
											<Button isIconOnly variant='light' onPointerUp={stopPropagation}>
												<Lucide.EllipsisVertical />
											</Button>
										</DropdownTrigger>
										<DropdownMenu aria-label='Static Actions' disabledKeys={state.connections.length === 1 ? ['delete'] : []}>
											<DropdownItem key='edit' startContent={<Lucide.Pencil size={12} />} onPointerUp={() => connection.edit(item, connectionModal)}>
												Edit
											</DropdownItem>
											<DropdownItem key='duplicate' startContent={<Lucide.Copy size={12} />} onPointerUp={() => connection.duplicate(item)}>
												Duplicate
											</DropdownItem>
											<DropdownItem key='delete' startContent={<Lucide.Trash size={12} />} className='text-danger' color='danger' onPointerUp={() => connection.remove(item)}>
												Delete
											</DropdownItem>
										</DropdownMenu>
									</Dropdown>
								</div>
							</div>
						</SelectItem>
					)}
				</Select>
				<ConnectButton isLoading={state.loading} isConnected={!!state.connected} isDisabled={isDisabled} onPointerUp={() => connection.connect()} />
			</div>
			<ConnectionEdit draggable={connectionModal} />
		</>
	)
}
