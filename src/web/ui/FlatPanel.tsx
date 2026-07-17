import { FlatPanelStoreContext } from '@shared/context'
import { equipmentStore } from '@stores/equipment.store'
import { flatPanelStore, type FlatPanelStore } from '@stores/flatpanel.store'
import { Slider } from '@ui/components/Slider'
import { Switch } from '@ui/components/Switch'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo, useContext, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'

export interface FlatPanelParams {
	readonly id: string
}

export const FlatPanel = memo(({ params }: IDockviewPanelProps<FlatPanelParams>) => {
	const storeRef = useRef<FlatPanelStore | undefined>(undefined)

	useEffect(() => storeRef.current?.mount(), [])

	const { length } = useSnapshot(equipmentStore.state.flatPanel) // used only to rerender this component
	const flatPanel = length > 0 && equipmentStore.state.flatPanel.find((e) => e.id === params.id)

	if (!flatPanel) {
		storeRef.current?.unmount()
		storeRef.current = undefined
		return <div className="flex h-full w-full items-center justify-center">Not available</div>
	}

	const store = storeRef.current ?? flatPanelStore(flatPanel)
	storeRef.current = store

	return (
		<FlatPanelStoreContext value={store}>
			<div className="mt-0 grid grid-cols-12 gap-3">
				<Toggle />
				<Intensity />
			</div>
		</FlatPanelStoreContext>
	)
})

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
