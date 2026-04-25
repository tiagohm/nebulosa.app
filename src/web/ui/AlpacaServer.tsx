import { useMolecule } from 'bunshi/react'
import type { AlpacaConfiguredDevice } from 'nebulosa/src/alpaca.types'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { AlpacaMolecule } from '@/molecules/alpaca'
import { Button } from '@/ui/components/Button'
import { NumberInput } from '@/ui/components/NumberInput'
import { List, ListItem } from './components/List'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const AlpacaServer = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { devices, running } = useSnapshot(alpaca.state.status)

	return (
		<Modal footer={<Footer />} header="ASCOM Alpaca Server" id="alpaca" maxWidth="296px" onHide={alpaca.hide} subHeader={running ? `${devices.length} devices` : undefined}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	return (
		<div className="mt-0 grid grid-cols-1 gap-2">
			<DeviceList />
		</div>
	)
})

function DeviceItem(item: AlpacaConfiguredDevice) {
	return <ListItem description={item.DeviceType} label={`${item.DeviceName} (#${item.DeviceNumber})`} />
}

const DeviceList = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { devices } = useSnapshot(alpaca.state.status)

	return (
		<List emptyContent="No devices" itemCount={devices.length}>
			{(i) => DeviceItem(devices[i])}
		</List>
	)
})

const Footer = memo(() => {
	const alpaca = useMolecule(AlpacaMolecule)
	const { running } = useSnapshot(alpaca.state.status)
	const { port } = useSnapshot(alpaca.state)

	return (
		<>
			<NumberInput className="flex flex-1" disabled={running} label="Port" maxValue={65535} minValue={80} onValueChange={(value) => (alpaca.state.port = value)} value={port} />
			<Button color="danger" disabled={!running} label="Stop" onPointerUp={alpaca.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={running} label="Start" onPointerUp={alpaca.start} startContent={<Icons.Play />} />
		</>
	)
})
