import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { formatNumber } from '@/shared/util'
import { thermometerStore } from '@/stores/thermometer.store'
import { useStore } from '../hooks/store.hook'
import { ThermometerDeviceContext, ThermometerStoreContext } from '../shared/context'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Thermometer = memo(() => {
	const device = useContext(ThermometerDeviceContext)
	const thermometer = useStore(() => thermometerStore(device), [device])

	return (
		<ThermometerStoreContext value={thermometer}>
			<Modal header={<Header />} id={`thermometer-${device.id}`} initialWidth="256px" onHide={thermometer.hide}>
				<Body />
			</Modal>
		</ThermometerStoreContext>
	)
})

const Header = memo(() => {
	const thermometer = useContext(ThermometerStoreContext)
	const { connecting, connected, name } = useSnapshot(thermometer.state.thermometer)

	return (
		<div className="flex w-full min-w-0 flex-row items-center justify-between gap-2">
			<div className="flex shrink-0 flex-row items-center gap-1">
				<ConnectButton connected={connected} loading={connecting} onClick={thermometer.connect} />
				<IndiPanelControlButton device={thermometer.state.thermometer} />
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Thermometer</span>
				<span className="max-w-full truncate text-xs font-normal text-neutral-400">{name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	const thermometer = useContext(ThermometerStoreContext)
	const { connected, temperature } = useSnapshot(thermometer.state.thermometer)
	const value = connected ? formatNumber(temperature, 1) : '--'

	return (
		<div className="mt-0 text-center text-5xl font-bold tabular-nums">
			{value} <small className="font-thin">°C</small>
		</div>
	)
})
