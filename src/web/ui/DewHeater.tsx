import { useDevice } from '@hooks/device.hook'
import { DewHeaterStoreContext } from '@shared/context'
import { dewHeaterStore } from '@stores/dewheater.store'
import { Slider } from '@ui/components/Slider'
import { Tab, TabPanel, Tabs } from '@ui/components/Tabs'
import { ConnectButton } from '@ui/ConnectButton'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import type { IDockviewPanelProps } from 'dockview-react'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export const DewHeater = memo(({ params }: IDockviewPanelProps<Device>) => {
	const dewHeater = useDevice('dewHeater', params.id, dewHeaterStore)

	if (!dewHeater) return <div className="flex h-full w-full items-center justify-center">Not available</div>

	return (
		<DewHeaterStoreContext value={dewHeater.store}>
			<Tabs className="h-full p-3" startContent={<TabStartContent />}>
				<Tab id="main">Dew Heater</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="main">
					<Main />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={dewHeater.device} />
				</TabPanel>
			</Tabs>
		</DewHeaterStoreContext>
	)
})

const TabStartContent = memo(() => {
	const dewHater = useContext(DewHeaterStoreContext)
	const { connected, connecting } = useSnapshot(dewHater.state.dewHeater)

	return <ConnectButton connected={connected} loading={connecting} onClick={dewHater.connect} />
})

const Main = memo(() => {
	const dewHeater = useContext(DewHeaterStoreContext)
	const { connected, dutyCycle } = useSnapshot(dewHeater.state.dewHeater)
	const { min, max, value } = dutyCycle
	const color = dutyCycleColor(value, min, max)

	return (
		<div className="flex w-full flex-col items-center justify-center gap-1">
			<Slider color={color} disabled={!connected} endContent={max} fullWidth maxValue={max} minValue={min} onValueChange={dewHeater.update} onValueChangeEnd={dewHeater.dutyCycle} size="lg" startContent={min} value={value} />
			<span className="text-lg font-bold">{value}</span>
		</div>
	)
})

function dutyCycleRatio(value: number, min: number, max: number) {
	if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0
	if (max <= min) return 0
	return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

function dutyCycleColor(value: number, min: number, max: number) {
	const ratio = dutyCycleRatio(value, min, max)
	return ratio < 0.5 ? 'primary' : ratio < 0.9 ? 'warning' : 'danger'
}
