import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ThermometerMolecule } from '@/molecules/indi/thermometer'
import { ConnectButton } from './ConnectButton'
import { Modal } from './Modal'

export const Thermometer = memo(() => {
	const thermometer = useMolecule(ThermometerMolecule)
	// biome-ignore format: don't break lines!
	const { thermometer: { connected, temperature }, connecting } = useSnapshot(thermometer.state)

	return (
		<Modal
			header={
				<div className='flex flex-row items-center justify-between'>
					<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={thermometer.connectOrDisconnect} />
					<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
						<span className='leading-5'>Thermometer</span>
						<span className='text-xs font-normal text-gray-400 max-w-full'>{thermometer.scope.thermometer.name}</span>
					</div>
				</div>
			}
			maxWidth='230px'
			name='thermometer'
			onClose={thermometer.close}>
			<div className='mt-0 text-center font-bold text-5xl'>
				{temperature.toFixed(1)} <small className='font-thin'>°C</small>
			</div>
		</Modal>
	)
})
