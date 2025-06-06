import { useDraggableModal } from '@/shared/hooks'
import { stopPropagation } from '@/shared/utils'
// biome-ignore format:
import { Button, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Select, SelectItem, type SharedSelection, Tooltip } from '@heroui/react'
import { useLocalStorage } from '@uidotdev/usehooks'
import { format } from 'date-fns'
import * as Lucide from 'lucide-react'
import { useState } from 'react'
import type { Connect, ConnectionStatus } from 'src/api/types'
import { ConnectButton } from './ConnectButton'

export interface Connection extends Connect {
	id: string
	name: string
	connectedAt?: number
	status?: ConnectionStatus
}

export const DEFAULT_CONNECTION: Connection = {
	id: '0',
	name: 'Local',
	host: 'localhost',
	port: 7624,
	type: 'INDI',
}

export interface ConnectionBoxProps {
	readonly isConnected?: boolean
	readonly isDisabled?: boolean
	readonly onConnected?: (connection: Connection) => void
	readonly onConnectionChange?: (connection: Connection) => void
}

export function ConnectionBox({ isConnected = false, isDisabled = false, onConnected, onConnectionChange }: ConnectionBoxProps) {
	const [connections, setConnections] = useLocalStorage<Connection[]>('home.connections', [DEFAULT_CONNECTION])
	const [connection, setConnection] = useState(new Set([connections[0].id]))

	// Connection Modal
	const connectionModalRef = useDraggableModal()
	const [editedConnection, setEditedConnection] = useState<Connection>(DEFAULT_CONNECTION)

	function showNewConnectionModal() {
		setEditedConnection(structuredClone(DEFAULT_CONNECTION))
		connectionModalRef.show()
	}

	function showEditConnectionModal(connection: Connection) {
		setEditedConnection(structuredClone(connection))
		connectionModalRef.show()
	}

	function handleEditedConnectionInputChange(key: keyof Connection, value: unknown) {
		setEditedConnection({ ...editedConnection, [key]: value })
	}

	function saveEditedConnection() {
		if (editedConnection.id === DEFAULT_CONNECTION.id) {
			editedConnection.id = Date.now().toString()
			setConnections([editedConnection, ...connections.filter((c) => c.id !== DEFAULT_CONNECTION.id)])
			setConnection(new Set([editedConnection.id]))
		} else {
			const updatedConnections = connections.map((c) => (c.id === editedConnection.id ? editedConnection : c))
			setConnections(updatedConnections)
		}

		connectionModalRef.close()
	}

	function removeConnection(connectionToRemove: Connection) {
		const updatedConnections = connections.filter((c) => c.id !== connectionToRemove.id)

		if (updatedConnections.length === 0) {
			updatedConnections.push(DEFAULT_CONNECTION)
		}

		setConnections(updatedConnections)

		if (connectionToRemove.id === connection.values().next().value) {
			setConnection(new Set([updatedConnections[0].id]))
		}
	}

	function connectionChanged(keys: SharedSelection) {
		if (keys instanceof Set) {
			const key = keys.values().next().value
			const selectedConnection = connections.find((c) => c.id === key)

			if (selectedConnection) {
				setConnection(keys as never)
				onConnectionChange?.(selectedConnection)
			}
		}
	}

	function connectOrDisconnect() {
		if (onConnected) {
			const key = connection.values().next().value
			const selectedConnection = connections.find((c) => c.id === key)

			if (selectedConnection) {
				onConnected(selectedConnection)
			}
		}
	}

	return (
		<>
			<div className='w-full flex flex-row items-center gap-2'>
				<Tooltip content='New Connection' showArrow>
					<Button isIconOnly color='success' variant='light' onPointerUp={showNewConnectionModal} isDisabled={isDisabled}>
						<Lucide.Plus />
					</Button>
				</Tooltip>
				<Select
					className='flex-1'
					size='lg'
					disallowEmptySelection
					isDisabled={isDisabled}
					items={connections}
					selectedKeys={connection}
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
										<DropdownMenu aria-label='Static Actions' disabledKeys={connections.length === 1 ? ['delete'] : []}>
											<DropdownItem key='edit' startContent={<Lucide.Pencil size={12} />} onPointerUp={() => showEditConnectionModal(item)}>
												Edit
											</DropdownItem>
											<DropdownItem key='delete' startContent={<Lucide.Trash size={12} />} className='text-danger' color='danger' onPointerUp={() => removeConnection(item)}>
												Delete
											</DropdownItem>
										</DropdownMenu>
									</Dropdown>
								</div>
							</div>
						</SelectItem>
					)}
				</Select>
				<ConnectButton isConnected={isConnected} isDisabled={isDisabled} onPointerUp={connectOrDisconnect} />
			</div>
			<Modal size='sm' ref={connectionModalRef.targetRef} isOpen={connectionModalRef.isOpen} onOpenChange={connectionModalRef.onOpenChange}>
				<ModalContent>
					{(onClose) => (
						<>
							<ModalHeader {...connectionModalRef.moveProps} className='flex flex-row gap-1'>
								Connection
							</ModalHeader>
							<ModalBody>
								<div className='flex w-full flex-col flex-wrap md:flex-nowrap gap-4'>
									<Input label='Name' size='sm' placeholder='Local' type='text' maxLength={64} value={editedConnection.name} onValueChange={(value) => handleEditedConnectionInputChange('name', value)} />
									<Input label='Host' size='sm' placeholder='localhost' type='text' maxLength={128} value={editedConnection.host} onValueChange={(value) => handleEditedConnectionInputChange('host', value)} />
									<NumberInput label='Port' size='sm' placeholder='7624' minValue={80} maxValue={65535} value={editedConnection.port} onValueChange={(value) => handleEditedConnectionInputChange('port', value)} />
								</div>
							</ModalBody>
							<ModalFooter>
								<Button color='danger' variant='light' startContent={<Lucide.X />} onPointerUp={onClose}>
									Close
								</Button>
								<Button isDisabled={!editedConnection.name || !editedConnection.host || !editedConnection.port} color='success' variant='light' startContent={<Lucide.Check />} onPointerUp={saveEditedConnection}>
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
