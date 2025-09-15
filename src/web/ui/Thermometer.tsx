import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ThermometerMolecule } from '@/molecules/indi/thermometer'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Thermometer = memo(() => {
	const thermometer = useMolecule(ThermometerMolecule)
	const { connecting, connected, temperature } = useSnapshot(thermometer.state.thermometer)

	const Header = (
		<div className='flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={thermometer.connect} />
				<IndiPanelControlButton device={thermometer.scope.thermometer.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='leading-5'>Thermometer</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{thermometer.scope.thermometer.name}</span>
			</div>
		</div>
	)

	return (
		<Modal header={Header} maxWidth='260px' name={`thermometer-${thermometer.scope.thermometer.name}`} onHide={thermometer.hide}>
			<div className='mt-0 text-center font-bold text-5xl'>
				{temperature.toFixed(1)} <small className='font-thin'>°C</small>
			</div>
		</Modal>
	)
})
