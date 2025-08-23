import { Slider } from '@heroui/react'
import { useDebounce } from '@uidotdev/usehooks'
import { useMolecule } from 'bunshi/react'
import { memo, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { DewHeaterMolecule } from '@/molecules/indi/dewheater'
import { ConnectButton } from './ConnectButton'
import { Modal } from './Modal'

export const DewHeater = memo(() => {
	const dewHeater = useMolecule(DewHeaterMolecule)
	const { connecting } = useSnapshot(dewHeater.state)
	const { connected, pwm } = useSnapshot(dewHeater.state.dewHeater)
	const [pwmValue, setPwmValue] = useState(pwm.value)
	const debouncedPwm = useDebounce(pwmValue, 500)

	useEffect(() => {
		dewHeater.pwm(debouncedPwm)
	}, [debouncedPwm])

	return (
		<Modal
			header={
				<div className='flex flex-row items-center justify-between'>
					<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={dewHeater.connect} />
					<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
						<span className='leading-5'>DewHeater</span>
						<span className='text-xs font-normal text-gray-400 max-w-full'>{dewHeater.scope.dewHeater.name}</span>
					</div>
				</div>
			}
			maxWidth='280px'
			name={`dew-heater-${dewHeater.scope.dewHeater.name}`}
			onClose={dewHeater.close}>
			<div className='mt-2 col-span-full flex flex-col items-center justify-center gap-5'>
				<div className='w-full flex flex-col justify-center items-center gap-1'>
					<Slider color={pwmValue < pwm.max * 0.5 ? 'primary' : pwmValue < pwm.max * 0.9 ? 'warning' : 'danger'} endContent={pwm.max} isDisabled={!connected} maxValue={pwm.max} minValue={pwm.min} onChange={(value) => setPwmValue(value as never)} size='lg' startContent={pwm.min} value={pwmValue} />
					<span className='text-lg font-bold'>{pwmValue}</span>
				</div>
			</div>
		</Modal>
	)
})
