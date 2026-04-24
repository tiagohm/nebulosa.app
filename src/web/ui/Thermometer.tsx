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
		<Modal header={<Header />} id={`thermometer-${thermometer.scope.thermometer.name}`} maxWidth="256px" onHide={thermometer.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const thermometer = useMolecule(ThermometerMolecule)
	const { connecting, connected } = useSnapshot(thermometer.state.thermometer)

	return (
		<div className="flex w-full flex-row items-center justify-between">
			<div className="flex flex-row items-center gap-1">
				<ConnectButton isConnected={connected} loading={connecting} onPointerUp={thermometer.connect} />
				<IndiPanelControlButton device={thermometer.scope.thermometer.name} />
			</div>
			<div className="flex flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Thermometer</span>
				<span className="max-w-full text-xs font-normal text-gray-400">{thermometer.scope.thermometer.name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	const thermometer = useMolecule(ThermometerMolecule)
	const { temperature } = useSnapshot(thermometer.state.thermometer)

	return (
		<div className="mt-0 text-center text-5xl font-bold">
			{temperature.toFixed(1)} <small className="font-thin">°C</small>
		</div>
	)
})
