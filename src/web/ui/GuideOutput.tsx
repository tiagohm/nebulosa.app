import { memo, useContext, useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { GuideOutputDeviceContext, GuideOutputStoreContext } from '../shared/context'
import { guideOutputStore } from '../store/guideoutput.store'
import { NumberInput } from './components/NumberInput'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'
import { Nudge } from './Nudge'

export const GuideOutput = memo(() => {
	const device = useContext(GuideOutputDeviceContext)
	const guideOutput = useMemo(() => guideOutputStore(device), [device])
	useEffect(guideOutput.mount, [guideOutput])

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

const Body = memo(() => {
	const guideOutput = useContext(GuideOutputStoreContext)
	const { connected, pulsing } = useSnapshot(guideOutput.state.guideOutput)
	const { north, south, west, east } = useSnapshot(guideOutput.state.request)
	const canPulseNorth = hasPulseDuration(north.duration)
	const canPulseSouth = hasPulseDuration(south.duration)
	const canPulseWest = hasPulseDuration(west.duration)
	const canPulseEast = hasPulseDuration(east.duration)

	return (
		<div className="mt-0 grid grid-cols-6 gap-1">
			<NumberInput className="col-span-2 col-start-3 min-w-0" disabled={pulsing} label="North (ms)" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('north', value)} value={north.duration} />
			<NumberInput className="col-span-2 row-start-3 min-w-0" disabled={pulsing} label="West (ms)" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('west', value)} value={west.duration} />
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
			<NumberInput className="col-span-2 row-start-3 min-w-0" disabled={pulsing} label="East (ms)" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('east', value)} value={east.duration} />
			<NumberInput className="col-span-2 col-start-3 row-start-5 min-w-0" disabled={pulsing} label="South (ms)" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('south', value)} value={south.duration} />
		</div>
	)
})

function hasPulseDuration(duration: number) {
	return Number.isFinite(duration) && duration > 0
}
