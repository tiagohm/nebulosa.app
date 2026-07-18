import { ThermometerStoreContext } from '@shared/context'
import { formatNumber } from '@shared/util'
import { equipmentStore } from '@stores/equipment.store'
import { thermometerStore, type ThermometerStore } from '@stores/thermometer.store'
import { TabPanel, Tab, Tabs } from '@ui/components/Tabs'
import { ConnectButton } from '@ui/ConnectButton'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import type { IDockviewPanelProps } from 'dockview-react'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { memo, useContext, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'

export const Thermometer = memo(({ params }: IDockviewPanelProps<Device>) => {
	const storeRef = useRef<ThermometerStore | undefined>(undefined)

	useEffect(() => storeRef.current?.mount(), [])

	const { length } = useSnapshot(equipmentStore.state.thermometer) // used only to rerender this component
	const thermometer = length > 0 && equipmentStore.state.thermometer.find((e) => e.id === params.id)

	if (!thermometer) {
		storeRef.current?.unmount()
		storeRef.current = undefined
		return <div className="flex h-full w-full items-center justify-center">Not available</div>
	}

	const store = storeRef.current ?? thermometerStore(thermometer)
	storeRef.current = store

	return (
		<ThermometerStoreContext value={store}>
			<Tabs className="p-3">
				<Tab id="control">Thermometer</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="control">
					<Main />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={thermometer} />
				</TabPanel>
			</Tabs>
		</ThermometerStoreContext>
	)
})

const Main = memo(() => {
	const thermometer = useContext(ThermometerStoreContext)
	const { connecting, connected, temperature } = useSnapshot(thermometer.state.thermometer)
	const value = connected ? formatNumber(temperature, 1) : '--'

	return (
		<div className="flex w-full min-w-0 flex-col gap-2">
			<div className="flex flex-row items-center">
				<ConnectButton connected={connected} loading={connecting} onClick={thermometer.connect} />
			</div>
			<div className="text-center text-5xl font-bold tabular-nums">
				{value} <small className="font-thin">°C</small>
			</div>
		</div>
	)
})
