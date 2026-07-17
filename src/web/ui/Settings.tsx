import { settingsStore } from '@stores/settings.store'
import { NumberInput } from '@ui/components/NumberInput'
import { LocationMap } from '@ui/LocationMap'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'

export const Settings = memo(({ api }: IDockviewPanelProps) => (
	<div className="flex flex-col gap-2 p-3">
		<Time />
		<Location />
	</div>
))

const Time = memo(() => {
	const { offset } = useSnapshot(settingsStore.state.time)

	return (
		<div className="flex flex-col gap-2">
			<span className="font-bold">TIMEZONE</span>
			<NumberInput className="w-full" label="Offset (min)" maxValue={720} minValue={-720} onValueChange={(value) => (settingsStore.state.time.offset = value)} step={30} value={offset} />
		</div>
	)
})

const Location = memo(() => {
	const location = useSnapshot(settingsStore.state.location)

	return (
		<div className="flex flex-col gap-2">
			<span className="font-bold">LOCATION</span>
			<LocationMap mode="settings" {...location} />
		</div>
	)
})
