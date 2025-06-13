import { useDraggableModal } from '@/shared/hooks'
import { ConnectionMolecule } from '@/shared/molecules'
import { stopPropagation } from '@/shared/utils'
// biome-ignore format:
import { Button, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Select, SelectItem, type SharedSelection, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { format } from 'date-fns'
import * as Lucide from 'lucide-react'
import { useSnapshot } from 'valtio'
import { ConnectButton } from './ConnectButton'

export interface ConnectionBoxProps {
	readonly isDisabled?: boolean
}

export function ConnectionBox({ isDisabled = false }: ConnectionBoxProps) {
	const modal = useDraggableModal()
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
					<Button isIconOnly color='success' variant='light' onPointerUp={() => [connection.create(), modal.show()]} isDisabled={isDisabled}>
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
										<DropdownMenu aria-label='Static Actions' disabledKeys={state.connections.length === 1 ? ['delete'] : []}>
											<DropdownItem key='edit' startContent={<Lucide.Pencil size={12} />} onPointerUp={() => [connection.edit(item), modal.show()]}>
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
				<ConnectButton isConnected={!!state.connected} isDisabled={isDisabled} onPointerUp={() => connection.connect()} />
			</div>
			<Modal size='sm' ref={modal.targetRef} isOpen={modal.isOpen} onOpenChange={modal.onOpenChange} backdrop='transparent' classNames={{ wrapper: 'pointer-events-none' }} isDismissable={false}>
				<ModalContent>
					{(onClose) => (
						<>
							<ModalHeader {...modal.moveProps} className='flex flex-row items-center'>
								Connection
							</ModalHeader>
							<ModalBody>
								<div className='grid grid-cols-6 gap-2'>
									<Input label='Name' size='sm' className='col-span-full' placeholder='Local' type='text' maxLength={64} value={state.edited?.name} onValueChange={(value) => connection.update('name', value)} />
									<Input label='Host' size='sm' className='col-span-4' placeholder='localhost' type='text' maxLength={128} value={state.edited?.host} onValueChange={(value) => connection.update('host', value)} />
									<NumberInput label='Port' size='sm' className='col-span-2' placeholder='7624' minValue={80} maxValue={65535} value={state.edited?.port} onValueChange={(value) => connection.update('port', value)} />
								</div>
							</ModalBody>
							<ModalFooter>
								<Button color='danger' variant='light' startContent={<Lucide.X />} onPointerUp={onClose}>
									Close
								</Button>
								<Button isDisabled={!state.edited?.name || !state.edited?.host || !state.edited?.port} color='success' variant='light' startContent={<Lucide.Check />} onPointerUp={() => [connection.save(), modal.close()]}>
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
