import { useDraggableModal } from '@/shared/hooks'
import { type Connection, DEFAULT_CONNECTION } from '@/shared/types'
import { stopPropagation } from '@/shared/utils'
import { homeState, homeStore } from '@/stores/home'
// biome-ignore format:
import { Button, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Select, SelectItem, type SharedSelection, Tooltip } from '@heroui/react'
import { format } from 'date-fns'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { deepClone } from 'valtio/utils'
import { ConnectButton } from './ConnectButton'

export interface ConnectionBoxProps {
	readonly isDisabled?: boolean
}

export function ConnectionBox({ isDisabled = false }: ConnectionBoxProps) {
	const home = useSnapshot(homeState)
	const modal = useDraggableModal()

	function create() {
		homeState.connection.edited = structuredClone(DEFAULT_CONNECTION)
		modal.show()
	}

	function edit(connection: Connection) {
		homeState.connection.edited = deepClone(connection)
		modal.show()
	}

	function save() {
		homeStore.saveConnection()
		modal.close()
	}

	function handleConnectionChange(keys: SharedSelection) {
		if (keys instanceof Set) {
			const key = keys.values().next().value
			const selected = homeState.connections.find((c) => c.id === key)

			if (selected) {
				homeState.connection.selected = selected
			}
		}
	}

	return (
		<>
			<div className='w-full flex flex-row items-center gap-2'>
				<Tooltip content='New Connection' showArrow>
					<Button isIconOnly color='success' variant='light' onPointerUp={create} isDisabled={isDisabled}>
						<Lucide.Plus />
					</Button>
				</Tooltip>
				<Select
					className='flex-1'
					size='lg'
					disallowEmptySelection
					selectionMode='single'
					isDisabled={isDisabled}
					items={home.connections}
					selectedKeys={new Set([home.connection.selected.id])}
					onSelectionChange={handleConnectionChange}
					renderValue={(selected) => {
						return selected.map((item) => (
							<div key={item.data?.id} className='p-1 flex items-center justify-between gap-0'>
								<div className='flex flex-col gap-0'>
									<span className='font-bold'>{item.data?.name}</span>
									<span className='text-default-500 text-tiny flex gap-1 items-center'>
										{item.data?.host}:{item.data?.port}
									</span>
								</div>
								<div className='flex items-center'>
									<Chip color='primary'>{item.data?.type}</Chip>
								</div>
							</div>
						))
					}}>
					{(item) => (
						<SelectItem key={item.id} textValue={item.name}>
							<div className='flex items-center justify-between gap-2'>
								<div className='flex flex-1 items-center justify-between gap-0'>
									<div className='flex flex-col gap-1 mt-1'>
										<span className='font-bold'>{item.name}</span>
										<span className='text-default-500 text-tiny flex gap-1 items-center'>
											<Lucide.Computer size={12} />
											{item.host}:{item.port}
											<Lucide.Clock size={12} />
											{item.connectedAt ? format(item.connectedAt, 'yyyy-MM-dd HH:mm:ss') : 'never'}
										</span>
									</div>
									<div className='flex items-center'>
										<Chip color='primary'>{item.type}</Chip>
									</div>
								</div>
								<div className='flex justify-center items-center'>
									<Dropdown>
										<DropdownTrigger>
											<Button isIconOnly variant='light' onPointerUp={stopPropagation}>
												<Lucide.EllipsisVertical />
											</Button>
										</DropdownTrigger>
										<DropdownMenu aria-label='Static Actions' disabledKeys={home.connections.length === 1 ? ['delete'] : []}>
											<DropdownItem key='edit' startContent={<Lucide.Pencil size={12} />} onPointerUp={() => edit(item)}>
												Edit
											</DropdownItem>
											<DropdownItem key='delete' startContent={<Lucide.Trash size={12} />} className='text-danger' color='danger' onPointerUp={() => homeStore.removeConnection(item)}>
												Delete
											</DropdownItem>
										</DropdownMenu>
									</Dropdown>
								</div>
							</div>
						</SelectItem>
					)}
				</Select>
				<ConnectButton isConnected={!!home.connection.connected} isDisabled={isDisabled} onPointerUp={() => homeStore.connect()} />
			</div>
			<Modal size='sm' ref={modal.targetRef} isOpen={modal.isOpen} onOpenChange={modal.onOpenChange}>
				<ModalContent>
					{(onClose) => (
						<>
							<ModalHeader {...modal.moveProps} className='flex flex-row gap-1'>
								Connection
							</ModalHeader>
							<ModalBody>
								<div className='flex w-full flex-col flex-wrap md:flex-nowrap gap-4'>
									<Input label='Name' size='sm' placeholder='Local' type='text' maxLength={64} value={home.connection.edited?.name ?? ''} onValueChange={(value) => (homeState.connection.edited!.name = value)} />
									<Input label='Host' size='sm' placeholder='localhost' type='text' maxLength={128} value={home.connection.edited?.host} onValueChange={(value) => (homeState.connection.edited!.host = value)} />
									<NumberInput label='Port' size='sm' placeholder='7624' minValue={80} maxValue={65535} value={home.connection.edited?.port} onValueChange={(value) => (homeState.connection.edited!.port = value)} />
								</div>
							</ModalBody>
							<ModalFooter>
								<Button color='danger' variant='light' startContent={<Lucide.X />} onPointerUp={onClose}>
									Close
								</Button>
								<Button isDisabled={!home.connection.edited?.name || !home.connection.edited?.host || !home.connection.edited?.port} color='success' variant='light' startContent={<Lucide.Check />} onPointerUp={save}>
									Save
								</Button>
							</ModalFooter>
						</>
					)}
				</ModalContent>
			</Modal>
		</>
	)
}
