import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { DewHeaterMolecule } from '@/molecules/indi/dewheater'
import { Slider } from './components/Slider'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

function dutyCycleRatio(value: number, min: number, max: number) {
	if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0
	if (max <= min) return 0
	return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

function dutyCycleColor(value: number, min: number, max: number) {
	const ratio = dutyCycleRatio(value, min, max)
	return ratio < 0.5 ? 'primary' : ratio < 0.9 ? 'warning' : 'danger'
}

export const DewHeater = memo(() => {
	const dewHeater = useMolecule(DewHeaterMolecule)

	return (
		<Modal header={<Header />} id={`dew-heater-${dewHeater.scope.dewHeater.id}`} maxWidth="256px" onHide={dewHeater.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const dewHeater = useMolecule(DewHeaterMolecule)
	const { connecting, connected, name } = useSnapshot(dewHeater.state.dewHeater)

	return (
		<div className="flex w-full min-w-0 flex-row items-center justify-between gap-2">
			<div className="flex shrink-0 flex-row items-center gap-1">
				<ConnectButton connected={connected} loading={connecting} onClick={dewHeater.connect} />
				<IndiPanelControlButton device={dewHeater.scope.dewHeater} />
			</div>
			<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0">
				<span className="leading-5 font-semibold">Dew Heater</span>
				<span className="max-w-full truncate text-xs font-normal text-neutral-400">{name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	const dewHeater = useMolecule(DewHeaterMolecule)
	const { connected, dutyCycle } = useSnapshot(dewHeater.state.dewHeater)
	const { min, max, value } = dutyCycle
	const color = dutyCycleColor(value, min, max)

	return (
		<div className="mt-0 flex flex-col items-center justify-center">
			<div className="mt-4 flex w-full flex-col items-center justify-center gap-1">
				<Slider color={color} disabled={!connected} endContent={max} fullWidth maxValue={max} minValue={min} onValueChange={dewHeater.update} onValueChangeEnd={dewHeater.dutyCycle} size="lg" startContent={min} value={value} />
				<span className="text-lg font-bold">{value}</span>
			</div>
		</div>
	)
})
