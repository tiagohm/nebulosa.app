import { Slider, Switch } from '@heroui/react'
import { useDebounce } from '@uidotdev/usehooks'
import { useMolecule } from 'bunshi/react'
import { memo, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { FlatPanelMolecule } from '@/molecules/indi/flatpanel'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const FlatPanel = memo(() => {
	const flatPanel = useMolecule(FlatPanelMolecule)
	const { connecting, connected, intensity, enabled } = useSnapshot(flatPanel.state.flatPanel)
	const [intensityValue, setIntensityValue] = useState(intensity.value)
	const debouncedIntensity = useDebounce(intensityValue, 500)

	useEffect(() => {
		flatPanel.intensity(debouncedIntensity)
	}, [debouncedIntensity])

	return (
		<Modal
			header={
				<div className='flex flex-row items-center justify-between'>
					<div className='flex flex-row items-center gap-1'>
						<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={flatPanel.connect} />
						<IndiPanelControlButton device={flatPanel.scope.flatPanel.name} />
					</div>
					<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
						<span className='leading-5'>Flat Panel</span>
						<span className='text-xs font-normal text-gray-400 max-w-full'>{flatPanel.scope.flatPanel.name}</span>
					</div>
				</div>
			}
			maxWidth='260px'
			name={`flat-panel-${flatPanel.scope.flatPanel.name}`}
			onHide={flatPanel.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<div className='col-span-full flex flex-row items-center justify-center'>
					<Switch isDisabled={!connected} isSelected={enabled} onValueChange={(enabled) => (enabled ? flatPanel.enable() : flatPanel.disable())} />
				</div>
				<div className='col-span-full flex flex-col justify-center items-center gap-1'>
					<Slider endContent={intensity.max} isDisabled={!connected || !enabled} maxValue={intensity.max} minValue={intensity.min} onChange={(value) => setIntensityValue(value as never)} size='lg' startContent={intensity.min} value={intensityValue} />
					<span className='text-lg font-bold'>{intensityValue}</span>
				</div>
			</div>
		</Modal>
	)
})
