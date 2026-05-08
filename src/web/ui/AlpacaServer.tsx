import { useMolecule } from 'bunshi/react'
import type { AlpacaConfiguredDevice } from 'nebulosa/src/alpaca.types'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { AlpacaMolecule, MAX_ALPACA_PORT, MIN_ALPACA_PORT } from '@/molecules/alpaca'
import { Button } from '@/ui/components/Button'
import { NumberInput } from '@/ui/components/NumberInput'
import { List, ListItem } from './components/List'
import { Icons } from './Icon'
import { Modal } from './Modal'

function formatDeviceCount(count: number) {
	return `${count} ${count === 1 ? 'device' : 'devices'}`
}

export const AlpacaServer = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { devices, running } = useSnapshot(alpaca.state.status)

	return (
		<Modal footer={<Footer />} header="ASCOM Alpaca Server" id="alpaca" maxWidth="296px" onHide={alpaca.hide} subHeader={running ? formatDeviceCount(devices.length) : undefined}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-1 gap-2">
		<DeviceList />
	</div>
))

function DeviceItem({ item }: { readonly item?: AlpacaConfiguredDevice }) {
	if (item === undefined) return null

	return <ListItem description={item.DeviceType} label={`${item.DeviceName} (#${item.DeviceNumber})`} />
}

const DeviceList = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { devices } = useSnapshot(alpaca.state.status)

	return (
		<List emptyContent="No devices" fullWidth itemCount={devices.length}>
			{(i) => <DeviceItem item={devices[i]} />}
		</List>
	)
})

const Footer = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { running } = useSnapshot(alpaca.state.status)
	const { port, pendingAction } = useSnapshot(alpaca.state)
	const disabled = pendingAction !== undefined

	return (
		<>
			<NumberInput className="flex flex-1" disabled={running || disabled} label="Port" placeholder="2222" maxValue={MAX_ALPACA_PORT} minValue={MIN_ALPACA_PORT} onValueChange={alpaca.updatePort} value={port} />
			<Button color="danger" disabled={!running || disabled} label="Stop" loading={pendingAction === 'stop'} onClick={alpaca.start} startContent={<Icons.Stop />} />
			<Button color="success" disabled={running || disabled} label="Start" loading={pendingAction === 'start'} onClick={alpaca.stop} startContent={<Icons.Play />} />
		</>
	)
})
