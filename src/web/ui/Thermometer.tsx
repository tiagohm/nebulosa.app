import { useDevice } from '@hooks/device.hook'
import { ThermometerStoreContext } from '@shared/context'
import { formatNumber } from '@shared/util'
import { thermometerStore } from '@stores/thermometer.store'
import { TabPanel, Tab, Tabs } from '@ui/components/Tabs'
import { ConnectButton } from '@ui/ConnectButton'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import type { IDockviewPanelProps } from 'dockview-react'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export const Thermometer = memo(({ params }: IDockviewPanelProps<Device>) => {
	const thermometer = useDevice('thermometer', params.id, thermometerStore)

	if (!thermometer) return <div className="flex h-full w-full items-center justify-center">Not available</div>

	return (
		<ThermometerStoreContext value={thermometer.store}>
			<Tabs className="h-full p-3" startContent={<TabStartContent />}>
				<Tab id="main">Thermometer</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="main">
					<Main />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={thermometer.device} />
				</TabPanel>
			</Tabs>
		</ThermometerStoreContext>
	)
})

const TabStartContent = memo(() => {
	const thermometer = useContext(ThermometerStoreContext)
	const { connected, connecting } = useSnapshot(thermometer.state.thermometer)

	return <ConnectButton connected={connected} loading={connecting} onClick={thermometer.connect} />
})

const Main = memo(() => {
	const thermometer = useContext(ThermometerStoreContext)
	const { connected, temperature } = useSnapshot(thermometer.state.thermometer)
	const value = connected ? formatNumber(temperature, 1) : '--'

	return (
		<div className="flex w-full min-w-0 flex-col gap-2">
			<div className="text-center text-5xl font-bold tabular-nums">
				{value} <small className="font-thin">°C</small>
			</div>
		</div>
	)
})
