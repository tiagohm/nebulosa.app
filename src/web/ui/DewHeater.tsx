import { Slider } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { DewHeaterMolecule } from '@/molecules/indi/dewheater'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const DewHeater = memo(() => {
	const dewHeater = useMolecule(DewHeaterMolecule)
	const { connecting, connected, pwm } = useSnapshot(dewHeater.state.dewHeater)

	const Header = (
		<div className='flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={dewHeater.connect} />
				<IndiPanelControlButton device={dewHeater.scope.dewHeater.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='leading-5'>Dew Heater</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{dewHeater.scope.dewHeater.name}</span>
			</div>
		</div>
	)

	const color = pwm.value < pwm.max * 0.5 ? 'primary' : pwm.value < pwm.max * 0.9 ? 'warning' : 'danger'

	return (
		<Modal header={Header} id={`dew-heater-${dewHeater.scope.dewHeater.name}`} maxWidth='260px' onHide={dewHeater.hide}>
			<div className='mt-0 col-span-full flex flex-col items-center justify-center'>
				<div className='w-full flex flex-col justify-center items-center gap-1'>
					<Slider color={color} disableThumbScale endContent={pwm.max} isDisabled={!connected} maxValue={pwm.max} minValue={pwm.min} onChange={dewHeater.update} onChangeEnd={(value) => dewHeater.pwm(value as never)} size='lg' startContent={pwm.min} value={pwm.value} />
					<span className='text-lg font-bold'>{pwm.value}</span>
				</div>
			</div>
		</Modal>
	)
})
