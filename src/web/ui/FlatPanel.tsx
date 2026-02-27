import { Slider, Switch } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { FlatPanelMolecule } from '@/molecules/indi/flatpanel'
import { ConnectButton } from './ConnectButton'
import { IndiPanelControlButton } from './IndiPanelControlButton'
import { Modal } from './Modal'

export const FlatPanel = memo(() => {
	const flatPanel = useMolecule(FlatPanelMolecule)

	return (
		<Modal header={<Header />} id={`flat-panel-${flatPanel.scope.flatPanel.name}`} maxWidth='256px' onHide={flatPanel.hide}>
			<Body />
		</Modal>
	)
})

const Header = memo(() => {
	const flatPanel = useMolecule(FlatPanelMolecule)
	const { connecting, connected } = useSnapshot(flatPanel.state.flatPanel)

	return (
		<div className='w-full flex flex-row items-center justify-between'>
			<div className='flex flex-row items-center gap-1'>
				<ConnectButton isConnected={connected} isLoading={connecting} onPointerUp={flatPanel.connect} />
				<IndiPanelControlButton device={flatPanel.scope.flatPanel.name} />
			</div>
			<div className='flex flex-col flex-1 gap-0 justify-center items-center'>
				<span className='font-semibold leading-5'>Flat Panel</span>
				<span className='text-xs font-normal text-gray-400 max-w-full'>{flatPanel.scope.flatPanel.name}</span>
			</div>
		</div>
	)
})

const Body = memo(() => {
	const flatPanel = useMolecule(FlatPanelMolecule)
	const { connected, enabled, intensity } = useSnapshot(flatPanel.state.flatPanel)

	return (
		<div className='mt-0 grid grid-cols-12 gap-2'>
			<Toggle />
			<Intensity />
		</div>
	)
})

const Toggle = memo(() => {
	const flatPanel = useMolecule(FlatPanelMolecule)
	const { connected, enabled } = useSnapshot(flatPanel.state.flatPanel)

	return (
		<div className='col-span-full flex flex-row items-center justify-center'>
			<Switch isDisabled={!connected} isSelected={enabled} onValueChange={flatPanel.toggle} />
		</div>
	)
})

const Intensity = memo(() => {
	const flatPanel = useMolecule(FlatPanelMolecule)
	const { connected, enabled, intensity } = useSnapshot(flatPanel.state.flatPanel)

	return (
		<div className='col-span-full flex flex-col justify-center items-center gap-1'>
			<Slider disableThumbScale endContent={intensity.max} isDisabled={!connected || !enabled} maxValue={intensity.max} minValue={intensity.min} onChange={flatPanel.update} onChangeEnd={flatPanel.intensity} size='lg' startContent={intensity.min} value={intensity.value} />
			<span className='text-lg font-bold'>{intensity.value}</span>
		</div>
	)
})
