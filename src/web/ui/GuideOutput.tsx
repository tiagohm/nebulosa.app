import { NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { GuideOutputMolecule } from '@/molecules/indi/guideoutput'
import { INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'
import { Nudge } from './Nudge'

export const GuideOutput = memo(() => {
	const guideOutput = useMolecule(GuideOutputMolecule)
	const { connecting } = useSnapshot(guideOutput.state)
	const { connected, pulseGuiding } = useSnapshot(guideOutput.state.guideOutput)
	const { north, south, west, east } = useSnapshot(guideOutput.state.request, { sync: true })

	return (
		<Modal
			header={
				<div className='flex flex-row items-center justify-between'>
					<div className='flex flex-row items-center gap-1'>
						<ConnectButton isConnected={connected} isDisabled={pulseGuiding} isLoading={connecting} onPointerUp={guideOutput.connect} />
						<IndiPanelControlButton device={guideOutput.scope.guideOutput.name} />
					</div>
					<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
						<span className='leading-5'>Guide Output</span>
						<span className='text-xs font-normal text-gray-400 max-w-full'>{guideOutput.scope.guideOutput.name}</span>
					</div>
				</div>
			}
			maxWidth='340px'
			name={`guide-output-${guideOutput.scope.guideOutput.name}`}
			onClose={guideOutput.close}>
			<div className='mt-0 grid grid-cols-6 gap-1'>
				<NumberInput className='col-start-3 col-span-2' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={pulseGuiding} label='North (ms)' maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('north', value)} size='sm' value={north.duration} />
				<NumberInput className='row-start-3 col-span-2' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={pulseGuiding} label='West (ms)' maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('west', value)} size='sm' value={west.duration} />
				<Nudge
					className='col-start-3 row-start-2 col-span-2 row-span-3'
					isCancelDisabled={!pulseGuiding}
					isDisabled={pulseGuiding}
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
				<NumberInput className='row-start-3 col-span-2' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={pulseGuiding} label='East (ms)' maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('east', value)} size='sm' value={east.duration} />
				<NumberInput className='col-start-3 row-start-5 col-span-2' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={pulseGuiding} label='South (ms)' maxValue={60000} minValue={0} onValueChange={(value) => guideOutput.update('south', value)} size='sm' value={south.duration} />
			</div>
		</Modal>
	)
})
