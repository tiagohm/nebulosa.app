import type { AlpacaDeviceServer } from 'nebulosa/src/alpaca.discovery'
import { memo, useRef } from 'react'
import { useSnapshot } from 'valtio'
import type { Connection } from '@/shared/types'
import { Button } from '@/ui/components/Button'
import { connectionStore } from '../store/connection.store'
import { ClientTypeSelect } from './ClientTypeSelect'
import { Checkbox } from './components/Checkbox'
import { IconButton } from './components/IconButton'
import { List, ListItem } from './components/List'
import { NumberInput } from './components/NumberInput'
import { Popover, type PopoverMethods } from './components/Popover'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { Modal } from './Modal'

const CONNECTION_PORT_PLACEHOLDER = {
	INDI: '7624',
	ALPACA: '32323',
	SIMULATOR: '0',
} satisfies Record<Connection['type'], string>

function isNetworkConnection(type: Connection['type']) {
	return type !== 'SIMULATOR'
}

function canSaveConnection({ host, name, port, type }: Pick<Connection, 'host' | 'name' | 'port' | 'type'>) {
	if (name.trim().length === 0) return false
	if (!isNetworkConnection(type)) return true
	if (!Number.isInteger(port) || port < 1 || port > 65535) return false
	return host.trim().length > 0
}

export const ConnectionEdit = memo(() => {
	const { mode } = useSnapshot(connectionStore.state)

	return (
		<Modal footer={<Footer />} header="Connection" id="connection" maxWidth="264px" onHide={connectionStore.hide} subHeader={mode}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const { name, host, port, type, secured } = useSnapshot(connectionStore.state.edited)
	const networkConnection = isNetworkConnection(type)

	return (
		<div className="mt-0 grid grid-cols-12 items-center gap-2">
			<TextInput className="col-span-full" label="Name" maxLength={64} onValueChange={(value) => connectionStore.update('name', value)} placeholder="Local" value={name} />
			<TextInput className="col-span-7" disabled={!networkConnection} label="Host" maxLength={128} onValueChange={(value) => connectionStore.update('host', value)} placeholder="localhost" value={host} />
			<NumberInput className="col-span-5" disabled={!networkConnection} label="Port" maxValue={65535} minValue={1} onValueChange={(value) => connectionStore.update('port', value)} placeholder={CONNECTION_PORT_PLACEHOLDER[type]} value={port} />
			<ClientTypeSelect className="col-span-5" onValueChange={(value) => connectionStore.update('type', value)} value={type} />
			<Checkbox className="col-span-5" disabled={type !== 'ALPACA'} label="Secured" onValueChange={(value) => connectionStore.update('secured', value)} value={secured} />
			<div className="col-span-2">
				<AlpacaDeviceServerDiscovery />
			</div>
		</div>
	)
})

const Footer = memo(() => {
	const edited = useSnapshot(connectionStore.state.edited)

	return <Button color="success" disabled={!canSaveConnection(edited)} label="Save" onClick={connectionStore.save} startContent={<Icons.Check />} />
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

		connectionStore.update('host', item.address)
		connectionStore.update('port', item.port)
		popoverRef.current?.hide()
	}

	return (
		<Popover ref={popoverRef} trigger={<IconButton color="secondary" disabled={edited.type !== 'ALPACA'} icon={Icons.Radar} tooltipContent="Discovery" />}>
			<div className="mt-0 grid max-w-100 grid-cols-12 items-center gap-2 p-4">
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
