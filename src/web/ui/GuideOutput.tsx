import { useDevice } from '@hooks/device.hook'
import { GuideOutputStoreContext } from '@shared/context'
import { guideOutputStore } from '@stores/guideoutput.store'
import { NumberInput } from '@ui/components/NumberInput'
import { Tab, TabPanel, Tabs } from '@ui/components/Tabs'
import { ConnectButton } from '@ui/ConnectButton'
import { IndiPanelControl } from '@ui/IndiPanelControl'
import { Nudge } from '@ui/Nudge'
import type { IDockviewPanelProps } from 'dockview-react'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'

export const GuideOutput = memo(({ params }: IDockviewPanelProps<Device>) => {
	const guideOutput = useDevice('guideOutput', params.id, guideOutputStore)

	if (!guideOutput) return <div className="flex h-full w-full items-center justify-center">Not available</div>

	return (
		<GuideOutputStoreContext value={guideOutput.store}>
			<Tabs className="h-full p-3" startContent={<TabStartContent />}>
				<Tab id="main">Guide Output</Tab>
				<Tab id="indi">INDI</Tab>

				<TabPanel id="main">
					<Main />
				</TabPanel>
				<TabPanel id="indi">
					<IndiPanelControl device={guideOutput.device} />
				</TabPanel>
			</Tabs>
		</GuideOutputStoreContext>
	)
})

const TabStartContent = memo(() => {
	const guideOutput = useContext(GuideOutputStoreContext)
	const { connected, connecting } = useSnapshot(guideOutput.state.guideOutput)

	return <ConnectButton connected={connected} loading={connecting} onClick={guideOutput.connect} />
})

const Main = memo(() => (
	<div className="grid grid-cols-6 gap-2">
		<North />
		<West />
		<HandControl />
		<East />
		<South />
		<GuideRates />
	</div>
))

const North = memo(() => {
	const guideOutput = useContext(GuideOutputStoreContext)
	const { connected, pulsing } = useSnapshot(guideOutput.state.guideOutput)
	const { north } = useSnapshot(guideOutput.state.request)

	return <NumberInput className="col-span-2 col-start-3 min-w-0" disabled={!connected || pulsing} label="North" endContent="ms" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('north', value)} value={north.duration} />
})

const West = memo(() => {
	const guideOutput = useContext(GuideOutputStoreContext)
	const { connected, pulsing } = useSnapshot(guideOutput.state.guideOutput)
	const { west } = useSnapshot(guideOutput.state.request)

	return <NumberInput className="col-span-2 row-start-3 min-w-0" disabled={!connected || pulsing} label="West" endContent="ms" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('west', value)} value={west.duration} />
})

const HandControl = memo(() => {
	const guideOutput = useContext(GuideOutputStoreContext)
	const { connected, pulsing } = useSnapshot(guideOutput.state.guideOutput)
	const { north, south, west, east } = useSnapshot(guideOutput.state.request)
	const canPulseNorth = hasPulseDuration(north.duration)
	const canPulseSouth = hasPulseDuration(south.duration)
	const canPulseWest = hasPulseDuration(west.duration)
	const canPulseEast = hasPulseDuration(east.duration)

	return (
		<Nudge
			className="col-span-2 col-start-3 row-span-3 row-start-2"
			disabled={!connected}
			isCancelDisabled={!pulsing}
			isDownDisabled={!canPulseSouth}
			isDownLeftDisabled={!canPulseSouth || !canPulseWest}
			isDownRightDisabled={!canPulseSouth || !canPulseEast}
			isLeftDisabled={!canPulseWest}
			isNudgeDisabled={pulsing}
			isRightDisabled={!canPulseEast}
			isUpDisabled={!canPulseNorth}
			isUpLeftDisabled={!canPulseNorth || !canPulseWest}
			isUpRightDisabled={!canPulseNorth || !canPulseEast}
			onCancel={guideOutput.stop}
			onNudge={guideOutput.pulse}
		/>
	)
})

const East = memo(() => {
	const guideOutput = useContext(GuideOutputStoreContext)
	const { connected, pulsing } = useSnapshot(guideOutput.state.guideOutput)
	const { east } = useSnapshot(guideOutput.state.request)

	return <NumberInput className="col-span-2 row-start-3 min-w-0" disabled={!connected || pulsing} label="East" endContent="ms" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('east', value)} value={east.duration} />
})

const South = memo(() => {
	const guideOutput = useContext(GuideOutputStoreContext)
	const { connected, pulsing } = useSnapshot(guideOutput.state.guideOutput)
	const { south } = useSnapshot(guideOutput.state.request)

	return <NumberInput className="col-span-2 col-start-3 row-start-5 min-w-0" disabled={!connected || pulsing} label="South" endContent="ms" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('south', value)} value={south.duration} />
})

const GuideRates = memo(() => {
	const guideOutput = useContext(GuideOutputStoreContext)
	const { connected, pulsing, guideRate, hasGuideRate, canSetGuideRate } = useSnapshot(guideOutput.state.guideOutput)
	const disabled = !hasGuideRate || !connected || pulsing

	return (
		<div className="col-span-full row-start-6 mt-4 flex flex-row gap-2">
			<NumberInput className="flex-1" disabled={disabled} readOnly={!canSetGuideRate} label="Guide rate RA" step={0.01} endContent="x" fractionDigits={2} minValue={0.01} maxValue={1} value={guideRate.rightAscension} onValueChange={guideOutput.guideRateRA} />
			<NumberInput className="flex-1" disabled={disabled} readOnly={!canSetGuideRate} label="Guide rate DEC" step={0.01} endContent="x" fractionDigits={2} minValue={0.01} maxValue={1} value={guideRate.declination} onValueChange={guideOutput.guideRateDEC} />
		</div>
	)
})

function hasPulseDuration(duration: number) {
	return Number.isFinite(duration) && duration > 0
}
