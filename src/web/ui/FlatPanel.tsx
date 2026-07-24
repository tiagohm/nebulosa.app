import { useDevice } from '@hooks/device.hook'
import { FlatPanelStoreContext } from '@shared/context'
import { flatPanelStore } from '@stores/flatpanel.store'
import { Slider } from '@ui/components/Slider'
import { Switch } from '@ui/components/Switch'
import { Tab, TabPanel, Tabs } from '@ui/components/Tabs'
import { ConnectButton } from '@ui/ConnectButton'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import type { IDockviewPanelProps } from 'dockview-react'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export const FlatPanel = memo(({ params }: IDockviewPanelProps<Device>) => {
	const flatPanel = useDevice('flatPanel', params.id, flatPanelStore)

	if (!flatPanel) return <div className="flex h-full w-full items-center justify-center">Not available</div>

	return (
		<FlatPanelStoreContext value={flatPanel.store}>
			<Tabs className="h-full p-3" startContent={<TabStartContent />}>
				<Tab id="main">Filter Wheel</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="main">
					<Main />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={flatPanel.device} />
				</TabPanel>
			</Tabs>
		</FlatPanelStoreContext>
	)
})

const TabStartContent = memo(() => {
	const flatPanel = useContext(FlatPanelStoreContext)
	const { connected, connecting } = useSnapshot(flatPanel.state.flatPanel)

	return <ConnectButton connected={connected} loading={connecting} onClick={flatPanel.connect} />
})

const Main = memo(() => (
	<div className="grid grid-cols-12 gap-2">
		<Toggle />
		<Intensity />
	</div>
))

const Toggle = memo(() => {
	const flatPanel = useContext(FlatPanelStoreContext)
	const { connected, enabled } = useSnapshot(flatPanel.state.flatPanel)

	return (
		<div className="col-span-full flex flex-row items-center justify-center">
			<Switch disabled={!connected} onValueChange={flatPanel.toggle} value={enabled} label="Enabled" />
		</div>
	)
})

const Intensity = memo(() => {
	const flatPanel = useContext(FlatPanelStoreContext)
	const { connected, enabled, intensity } = useSnapshot(flatPanel.state.flatPanel)

	return (
		<div className="col-span-full flex flex-col items-center justify-center gap-1">
			<Slider disabled={!connected || !enabled} endContent={intensity.max} fullWidth maxValue={intensity.max} minValue={intensity.min} onValueChange={flatPanel.update} onValueChangeEnd={flatPanel.intensity} size="lg" startContent={intensity.min} value={intensity.value} />
			<span className="text-lg font-bold">{formatIntensity(intensity.value)}</span>
		</div>
	)
})

function formatIntensity(value: number) {
	return Number.isFinite(value) ? value : 0
}
