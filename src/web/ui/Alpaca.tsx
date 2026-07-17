import { alpacaStore, MAX_ALPACA_PORT, MIN_ALPACA_PORT } from '@stores/alpaca.store'
import { Button } from '@ui/components/Button'
import { List, ListItem } from '@ui/components/List'
import { NumberInput } from '@ui/components/NumberInput'
import { Icons } from '@ui/Icon'
import type { AlpacaConfiguredDevice } from 'nebulosa/src/devices/alpaca/types'
import { memo } from 'react'
import { useSnapshot } from 'valtio'

export const Alpaca = memo(() => (
	<div className="grid grid-cols-12 items-center gap-2 p-3">
		<DeviceList />
		<Footer />
	</div>
))

function DeviceList() {
	const { devices } = useSnapshot(alpacaStore.state.status)

	return (
		<List className="col-span-full" emptyContent="No routed devices" fullWidth itemCount={devices.length}>
			{(i) => <DeviceItem item={devices[i]} />}
		</List>
	)
}

function DeviceItem({ item }: { readonly item?: AlpacaConfiguredDevice }) {
	return item && <ListItem description={item.DeviceType} label={`${item.DeviceName} (#${item.DeviceNumber})`} />
}

function Footer() {
	const { running } = useSnapshot(alpacaStore.state.status)
	const { port, pendingAction } = useSnapshot(alpacaStore.state)
	const disabled = pendingAction !== undefined

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<NumberInput className="flex-1" disabled={running || disabled} label="Port" placeholder="2222" maxValue={MAX_ALPACA_PORT} minValue={MIN_ALPACA_PORT} onValueChange={alpacaStore.updatePort} value={port} />
			<Button color="danger" disabled={!running || disabled} label="Stop" loading={pendingAction === 'stop'} onClick={alpacaStore.stop} startContent={<Icons.Stop />} />
			<Button color="success" disabled={running || disabled} label="Start" loading={pendingAction === 'start'} onClick={alpacaStore.start} startContent={<Icons.Play />} />
		</div>
	)
}
