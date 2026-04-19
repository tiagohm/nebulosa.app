import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { GuideOutputMolecule } from '@/molecules/indi/guideoutput'
import { ConnectButton } from './ConnectButton'
import { NumberInput } from './components/NumberInput'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'
import { Nudge } from './Nudge'

export const GuideOutput = memo(() => {
	const guideOutput = useMolecule(GuideOutputMolecule)
	const { connecting, connected, pulsing } = useSnapshot(guideOutput.state.guideOutput)
	const { north, south, west, east } = useSnapshot(guideOutput.state.request)

	const Header = (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton disabled={pulsing} isConnected={connected} loading={connecting} onPointerUp={guideOutput.connect} />
				<IndiPanelControlButton device={guideOutput.scope.guideOutput.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Guide Output</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{guideOutput.scope.guideOutput.name}</span>
			</div>
		</div>
	)

	return (
		<Modal header={Header} id={`guide-output-${guideOutput.scope.guideOutput.name}`} maxWidth='336px' onHide={guideOutput.hide}>
			<div className='mt-0 grid grid-cols-6 gap-1'>
				<NumberInput className='col-start-3 col-span-2' disabled={pulsing} label='North (ms)' maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('north', value)} value={north.duration} />
				<NumberInput className='row-start-3 col-span-2' disabled={pulsing} label='West (ms)' maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('west', value)} value={west.duration} />
				<Nudge
					className='col-start-3 row-start-2 col-span-2 row-span-3'
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
				<NumberInput className='row-start-3 col-span-2' disabled={pulsing} label='East (ms)' maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('east', value)} value={east.duration} />
				<NumberInput className='col-start-3 row-start-5 col-span-2' disabled={pulsing} label='South (ms)' maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('south', value)} value={south.duration} />
			</div>
		</Modal>
	)
})
