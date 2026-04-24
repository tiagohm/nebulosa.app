import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { GuideOutputMolecule } from '@/molecules/indi/guideoutput'
import { NumberInput } from './components/NumberInput'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'
import { Nudge } from './Nudge'

export const GuideOutput = memo(() => {
	const guideOutput = useMolecule(GuideOutputMolecule)
	const { connecting, connected, pulsing } = useSnapshot(guideOutput.state.guideOutput)
	const { north, south, west, east } = useSnapshot(guideOutput.state.request)

	const Header = (
		<div className="flex w-full flex-row items-center justify-between">
			<div className="flex flex-row items-center gap-1">
				<ConnectButton disabled={pulsing} isConnected={connected} loading={connecting} onPointerUp={guideOutput.connect} />
				<IndiPanelControlButton device={guideOutput.scope.guideOutput.name} />
			</div>
			<div className="flex flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Guide Output</span>
				<span className="max-w-full text-xs font-normal text-gray-400">{guideOutput.scope.guideOutput.name}</span>
			</div>
		</div>
	)

	return (
		<Modal header={Header} id={`guide-output-${guideOutput.scope.guideOutput.name}`} maxWidth="336px" onHide={guideOutput.hide}>
			<div className="mt-0 grid grid-cols-6 gap-1">
				<NumberInput className="col-span-2 col-start-3" disabled={pulsing} label="North (ms)" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('north', value)} value={north.duration} />
				<NumberInput className="col-span-2 row-start-3" disabled={pulsing} label="West (ms)" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('west', value)} value={west.duration} />
				<Nudge
					className="col-span-2 col-start-3 row-span-3 row-start-2"
					disabled={pulsing}
					isCancelDisabled={!pulsing}
					isDownDisabled={!south.duration}
					isDownLeftDisabled={!south.duration || !west.duration}
					isDownRightDisabled={!south.duration || !east.duration}
					isLeftDisabled={!west.duration}
					isRightDisabled={!east.duration}
					isUpDisabled={!north.duration}
					isUpLeftDisabled={!north.duration || !west.duration}
					isUpRightDisabled={!north.duration || !east.duration}
					onCancel={guideOutput.stop}
					onNudge={guideOutput.pulse}
				/>
				<NumberInput className="col-span-2 row-start-3" disabled={pulsing} label="East (ms)" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('east', value)} value={east.duration} />
				<NumberInput className="col-span-2 col-start-3 row-start-5" disabled={pulsing} label="South (ms)" maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('south', value)} value={south.duration} />
			</div>
		</Modal>
	)
})
