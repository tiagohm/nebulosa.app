import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ThermometerMolecule } from '@/molecules/indi/thermometer'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const Thermometer = memo(() => {
	const thermometer = useMolecule(ThermometerMolecule)

	return (
		<Modal header={<Header />} id={`thermometer-${thermometer.scope.thermometer.name}`} maxWidth='256px' onHide={thermometer.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const thermometer = useMolecule(ThermometerMolecule)
	const { connecting, connected } = useSnapshot(thermometer.state.thermometer)

	return (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={thermometer.connect} />
				<IndiPanelControlButton device={thermometer.scope.thermometer.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Thermometer</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{thermometer.scope.thermometer.name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	const thermometer = useMolecule(ThermometerMolecule)
	const { temperature } = useSnapshot(thermometer.state.thermometer)

	return (
		<div className='mt-0 text-center font-bold text-5xl'>
			{temperature.toFixed(1)} <small className='font-thin'>°C</small>
		</div>
	)
})
