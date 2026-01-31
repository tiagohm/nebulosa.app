import { Chip, Input, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { PHD2Molecule } from '@/molecules/phd2'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const PHD2 = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)

	return (
		<Modal footer={<Footer />} header='PHD2' id='phd2' maxWidth='400px' onHide={phd2.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Connection />
				<Status />
				<Settle />
				<Chart />
			</div>
		</Modal>
	)
})

const Connection = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { connected } = useSnapshot(phd2.state)
	const { host, port } = useSnapshot(phd2.state.connection)

	return (
		<div className='col-span-full grid grid-cols-subgrid items-center gap-2'>
			<Input className='col-span-7' isDisabled={connected} label='Host' maxLength={128} onValueChange={(value) => phd2.updateConnection('host', value)} placeholder='localhost' size='sm' type='text' value={host} />
			<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={connected} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => phd2.updateConnection('port', value)} placeholder='4400' size='sm' value={port} />
			<div className='col-span-2 flex flex-row justify-center items-center gap-2'>
				<ConnectButton isConnected={connected} onPointerUp={phd2.connect} />
			</div>
		</div>
	)
})

const Settle = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { running } = useSnapshot(phd2.state)
	const { pixels, time, timeout } = useSnapshot(phd2.state.connection.dither.settle)

	return (
		<div className='col-span-full grid grid-cols-subgrid items-center gap-2'>
			<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={running} label='Settle tolerance (px)' maxValue={25} minValue={1} onValueChange={(value) => phd2.updateSettle('pixels', value)} placeholder='1.5' size='sm' step={0.1} value={pixels} />
			<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Min settle time (s)' maxValue={60} minValue={1} onValueChange={(value) => phd2.updateSettle('time', value)} placeholder='10' size='sm' value={time} />
			<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={running} label='Settle timeout (s)' maxValue={60} minValue={1} onValueChange={(value) => phd2.updateSettle('timeout', value)} placeholder='30' size='sm' value={timeout} />
		</div>
	)
})

const Status = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { event } = useSnapshot(phd2.state)
	const { state } = event

	return (
		<div className='mt-2 col-span-full flex flex-row items-center justify-start'>
			<Chip color='primary' size='sm'>
				{state === 'IDLE' ? 'idle' : state === 'CALIBRATING' ? 'calibrating' : state === 'GUIDING' ? 'guiding' : state === 'LOOPING' ? 'looping' : state === 'SETTLING' ? 'settling' : 'star lost'}
			</Chip>
		</div>
	)
})

const Chart = memo(() => {
	return <div></div>
})

const Footer = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { connected, running } = useSnapshot(phd2.state)

	return (
		<>
			<TextButton color='danger' isDisabled={!connected || !running} label='Stop' startContent={<Icons.Stop />} />
			<TextButton color='success' isDisabled={!connected || running} label='Start' startContent={<Icons.Play />} />
		</>
	)
})
