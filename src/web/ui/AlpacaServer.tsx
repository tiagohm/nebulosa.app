import type { AlpacaConfiguredDevice } from 'nebulosa/src/alpaca.types'
import { memo, useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { Button } from '@/ui/components/Button'
import { NumberInput } from '@/ui/components/NumberInput'
import { alpaca, MAX_ALPACA_PORT, MIN_ALPACA_PORT } from '../store/alpaca.store'
import { List, ListItem } from './components/List'
import { Icons } from './Icon'
import { Modal } from './Modal'

export const AlpacaServer = memo(() => {
	useEffect(alpaca.mount, [])

	return (
		<Modal footer={<Footer />} header="ASCOM Alpaca Server" id="alpaca" maxWidth="296px" onHide={alpaca.hide}>
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
	const { devices } = useSnapshot(alpaca.state.status)

	return (
		<List emptyContent="No devices" fullWidth itemCount={devices.length}>
			{(i) => <DeviceItem item={devices[i]} />}
		</List>
	)
})

const Footer = memo(() => {
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
