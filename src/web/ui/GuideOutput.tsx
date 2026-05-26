import { memo, useContext } from 'react'
import { useSnapshot } from 'valtio'
import { guideOutputStore } from '@/stores/guideoutput.store'
import { useStore } from '../hooks/store.hook'
import { GuideOutputDeviceContext, GuideOutputStoreContext } from '../shared/context'
import { NumberInput } from './components/NumberInput'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'
import { Nudge } from './Nudge'

export const GuideOutput = memo(() => {
	const device = useContext(GuideOutputDeviceContext)
	const guideOutput = useStore(() => guideOutputStore(device), [device])

	return (
		<GuideOutputStoreContext value={guideOutput}>
			<Modal header={<Header />} id={`guide-output-${device.id}`} maxWidth="336px" onHide={guideOutput.hide}>
				<Body />
			</Modal>
		</GuideOutputStoreContext>
	)
})

const Header = memo(() => {
	const guideOutput = useContext(GuideOutputStoreContext)
	const { connecting, connected, pulsing, name } = useSnapshot(guideOutput.state.guideOutput)

	return (
		<div className="flex w-full min-w-0 flex-row items-center justify-between gap-2">
			<div className="flex shrink-0 flex-row items-center gap-1">
				<ConnectButton connected={connected} disabled={pulsing} loading={connecting} onClick={guideOutput.connect} />
				<IndiPanelControlButton device={guideOutput.state.guideOutput} />
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Guide Output</span>
				<span className="max-w-full truncate text-xs font-normal text-neutral-400">{name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => (
	<div className="flex flex-col gap-4">
		<div className="mt-0 grid grid-cols-6 gap-1">
			<North />
			<West />
			<HandControl />
			<East />
			<South />
		</div>
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
		<div className="grid grid-cols-2 gap-2">
			<NumberInput disabled={disabled} readOnly={!canSetGuideRate} className="col-span-1" label="Guide rate RA" step={0.01} endContent="x" fractionDigits={2} minValue={0.01} maxValue={1} value={guideRate.rightAscension} onValueChange={guideOutput.guideRateRA} />
			<NumberInput disabled={disabled} readOnly={!canSetGuideRate} className="col-span-1" label="Guide rate DEC" step={0.01} endContent="x" fractionDigits={2} minValue={0.01} maxValue={1} value={guideRate.declination} onValueChange={guideOutput.guideRateDEC} />
		</div>
	)
})

function hasPulseDuration(duration: number) {
	return Number.isFinite(duration) && duration > 0
}
