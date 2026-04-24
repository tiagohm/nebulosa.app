import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { DewHeaterMolecule } from '@/molecules/indi/dewheater'
import { Slider } from './components/Slider'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const DewHeater = memo(() => {
	const dewHeater = useMolecule(DewHeaterMolecule)

	return (
		<Modal header={<Header />} id={`dew-heater-${dewHeater.scope.dewHeater.name}`} maxWidth="256px" onHide={dewHeater.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const dewHeater = useMolecule(DewHeaterMolecule)
	const { connecting, connected } = useSnapshot(dewHeater.state.dewHeater)

	return (
		<div className="flex w-full flex-row items-center justify-between">
			<div className="flex flex-row items-center gap-1">
				<ConnectButton isConnected={connected} loading={connecting} onPointerUp={dewHeater.connect} />
				<IndiPanelControlButton device={dewHeater.scope.dewHeater.name} />
			</div>
			<div className="flex flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Dew Heater</span>
				<span className="max-w-full text-xs font-normal text-gray-400">{dewHeater.scope.dewHeater.name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	const dewHeater = useMolecule(DewHeaterMolecule)
	const { connected, dutyCycle } = useSnapshot(dewHeater.state.dewHeater)
	const { min, max, value } = dutyCycle

	const color = value < max * 0.5 ? 'primary' : value < max * 0.9 ? 'warning' : 'danger'

	return (
		<div className="col-span-full mt-0 flex flex-col items-center justify-center">
			<div className="flex w-full flex-col items-center justify-center gap-1">
				<Slider color={color} disabled={!connected} endContent={max} maxValue={max} minValue={min} onValueChange={dewHeater.update} onValueChangeEnd={dewHeater.dutyCycle} size="lg" startContent={min} value={value} />
				<span className="text-lg font-bold">{value}</span>
			</div>
		</div>
	)
})
