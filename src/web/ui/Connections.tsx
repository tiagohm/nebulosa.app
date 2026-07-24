import { connectionStore } from '@stores/connection.store'
import { ClientTypeSelect } from '@ui/ClientTypeSelect'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { Chip } from '@ui/components/Chip'
import { IconButton } from '@ui/components/IconButton'
import { List, ListItem } from '@ui/components/List'
import { NumberInput } from '@ui/components/NumberInput'
import { Popover } from '@ui/components/Popover'
import type { PopoverMethods } from '@ui/components/Popover'
import { Select } from '@ui/components/Select'
import { TextInput } from '@ui/components/TextInput'
import { Icons } from '@ui/Icon'
import { formatTemporal } from 'nebulosa/src/astronomy/time/temporal'
import type { AlpacaDeviceServer } from 'nebulosa/src/devices/alpaca/discovery'
import { memo, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { canConnect, DEFAULT_CONNECTION_PORTS, isNetworkConnection } from '#/connection'
import type { Connection, ConnectionStatus } from '#/connection'

export const Connections = memo(() => {
	useEffect(connectionStore.mount, [])

	return (
		<div className="flex flex-col gap-2 p-3">
			<ActiveConnectionList />
			<SavedConnection />
		</div>
	)
})

function ActiveConnectionItem(connection: ConnectionStatus) {
	const EndContent = <IconButton icon={Icons.Close} color="danger" variant="flat" tooltipContent="Disconnect" onClick={() => connectionStore.disconnect(connection)} size="sm" />
	return <ListItem description={connection.type} endContent={EndContent} label={isNetworkConnection(connection.type) ? `${connection.ip}:${connection.port}` : 'simulator'} />
}

const ActiveConnectionList = memo(() => {
	const { activeConnections } = useSnapshot(connectionStore.state)

	return (
		<div className="flex w-full flex-col gap-2">
			<span className="w-full font-bold text-neutral-300">ACTIVE CONNECTIONS:</span>
			<List fullWidth itemCount={activeConnections.length} emptyContent="No active connections">
				{(i) => ActiveConnectionItem(activeConnections[i])}
			</List>
		</div>
	)
})

function ConnectionItem(item: Connection, index: number, selected: boolean, placement: 'trigger' | 'list') {
	const endpoint = `${item.host}:${item.port}`

	if (placement === 'trigger') {
		return (
			<div className="flex min-w-0 items-center justify-between gap-2 p-1 text-xs">
				<div className="flex min-w-0 flex-1 flex-col gap-0">
					<span className="min-w-0 truncate font-bold">{item.name}</span>
					{isNetworkConnection(item.type) && <span className="min-w-0 truncate text-xs text-neutral-500">{endpoint}</span>}
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
						{isNetworkConnection(item.type) && (
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
		</div>
	)
}

const ConnectionSelect = memo(() => {
	const { connections, selected, connecting } = useSnapshot(connectionStore.state)

	return (
		<div className="flex w-full flex-row items-center gap-2">
			<Select className="min-w-0 flex-1" description="Select a connection" disabled={connecting} items={connections} onValueChange={connectionStore.select} value={selected} size="lg">
				{ConnectionItem}
			</Select>
		</div>
	)
})

const ConnectionEdit = memo(() => {
	const { connections } = useSnapshot(connectionStore.state)
	const edited = useSnapshot(connectionStore.state.edited)
	const { name, host, port, type, secured } = edited
	const networkConnection = isNetworkConnection(type)
	const canUpdate = connections.some((e) => e.id === edited.id)
	const canRemove = canUpdate

	return (
		<div className="mt-4 grid w-full grid-cols-12 items-center gap-2">
			<TextInput className="col-span-full" label="Name" maxLength={64} onValueChange={connectionStore.setName} placeholder="Local" value={name} />
			<TextInput className="col-span-7" disabled={!networkConnection} label="Host" maxLength={128} onValueChange={connectionStore.setHost} placeholder="localhost" value={host} />
			<NumberInput className="col-span-5" disabled={!networkConnection} label="Port" maxValue={65535} minValue={1} onValueChange={connectionStore.setPort} placeholder={DEFAULT_CONNECTION_PORTS[type].toFixed(0)} value={port} />
			<ClientTypeSelect className="col-span-5" onValueChange={connectionStore.setType} value={type} />
			<Checkbox className="col-span-5" disabled={type !== 'ALPACA'} label="Secured" onValueChange={connectionStore.setSecured} value={secured} />
			<div className="col-span-2 flex flex-row items-center justify-center">
				<AlpacaDeviceServerDiscovery />
			</div>
			<div className="col-span-full mt-2 flex flex-row items-center justify-between gap-2">
				<Button fullWidth color="primary" disabled={!canConnect(edited)} label="Connect" onClick={connectionStore.connectToEdited} startContent={<Icons.Connect />} />
				<Button fullWidth color="secondary" label="Create" onClick={connectionStore.create} startContent={<Icons.Plus />} />
				<Button fullWidth color="success" disabled={!canSave(edited)} label={canUpdate ? 'Update' : 'Save'} onClick={connectionStore.save} startContent={<Icons.Check />} />
				<Button fullWidth color="danger" disabled={!canRemove} label="Remove" onClick={connectionStore.removeEdited} startContent={<Icons.Trash />} />
			</div>
		</div>
	)
})

function AlpacaDeviceServerItem(item: AlpacaDeviceServer) {
	const devices = item.devices.map((e) => e.DeviceName).join(' | ')
	return <ListItem className="cursor-pointer" description={`${item.address}:${item.port}`} label={devices || 'No devices'} />
}

const AlpacaDeviceServerDiscovery = memo(() => {
	const popoverRef = useRef<PopoverMethods | null>(null)
	const { alpaca, edited } = useSnapshot(connectionStore.state)

	function handleItemAction(index: number) {
		const item = alpaca.servers[index]

		if (!item) return

		connectionStore.setHost(item.address)
		connectionStore.setPort(item.port)
		popoverRef.current?.hide()
	}

	return (
		<Popover ref={popoverRef} trigger={<IconButton color="secondary" disabled={edited.type !== 'ALPACA'} icon={Icons.Radar} tooltipContent="Discovery" />}>
			<div className="grid max-w-100 grid-cols-12 items-center gap-2 p-4">
				<p className="col-span-full text-center font-bold">ALPACA DEVICE SERVER DISCOVERY</p>
				<List className="col-span-full min-w-90" itemCount={alpaca.servers.length} emptyContent="No servers" onAction={handleItemAction}>
					{(i) => AlpacaDeviceServerItem(alpaca.servers[i])}
				</List>
				<div className="col-span-full flex flex-row items-center justify-end">
					<Button color="primary" label="Discovery" loading={alpaca.discovering} onClick={connectionStore.discovery} startContent={<Icons.Reload />} />
				</div>
			</div>
		</Popover>
	)
})

const SavedConnection = memo(() => (
	<div className="flex w-full flex-col gap-2">
		<span className="w-full font-bold text-neutral-300">SAVED CONNECTIONS:</span>
		<ConnectionSelect />
		<ConnectionEdit />
	</div>
))

function canSave({ host, name, port, type }: Pick<Connection, 'host' | 'name' | 'port' | 'type'>) {
	if (name.trim().length === 0) return false
	if (!isNetworkConnection(type)) return true
	if (!Number.isInteger(port) || port < 1 || port > 65535) return false
	return host.trim().length > 0
}
