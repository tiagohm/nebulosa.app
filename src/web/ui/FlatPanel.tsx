import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { flatPanelStore } from '@/stores/flatpanel.store'
import { useStore } from '../hooks/store.hook'
import { FlatPanelDeviceContext, FlatPanelStoreContext } from '../shared/context'
import { Slider } from './components/Slider'
import { Switch } from './components/Switch'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

function formatIntensity(value: number) {
	return Number.isFinite(value) ? value : 0
}

export const FlatPanel = memo(() => {
	const device = useContext(FlatPanelDeviceContext)
	const flatPanel = useStore(() => flatPanelStore(device), [device])

	return (
		<FlatPanelStoreContext value={flatPanel}>
			<Modal header={<Header />} id={`flat-panel-${device.id}`} initialWidth="256px" onHide={flatPanel.hide}>
				<Body />
			</Modal>
		</FlatPanelStoreContext>
	)
})

const Header = memo(() => {
	const flatPanel = useContext(FlatPanelStoreContext)
	const { connecting, connected, name } = useSnapshot(flatPanel.state.flatPanel)

	return (
		<div className="flex w-full min-w-0 flex-row items-center justify-between gap-2">
			<div className="flex shrink-0 flex-row items-center gap-1">
				<ConnectButton connected={connected} loading={connecting} onClick={flatPanel.connect} />
				<IndiPanelControlButton device={flatPanel.state.flatPanel} />
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Flat Panel</span>
				<span className="max-w-full truncate text-xs font-normal text-neutral-400">{name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => (
	<div className="mt-0 grid grid-cols-12 gap-3">
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
