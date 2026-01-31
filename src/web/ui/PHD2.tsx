import { Checkbox, Chip, Input, NumberInput } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { Bar, type BarProps, ComposedChart, Line, type LineProps, XAxis, YAxis } from 'recharts'
import { useSnapshot } from 'valtio'
import { PHD2Molecule } from '@/molecules/phd2'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { Modal } from './Modal'

export const PHD2 = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { profile } = useSnapshot(phd2.state)

	return (
		<Modal footer={<Footer />} header='PHD2' id='phd2' maxWidth='408px' onHide={phd2.hide} subHeader={profile}>
			<div className='mt-0 grid grid-cols-12 gap-2'>
				<Connection />
				<Status />
				<Settle />
				<Dither />
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
		<>
			<Input className='col-span-7' isDisabled={connected} label='Host' maxLength={128} onValueChange={(value) => phd2.updateConnection('host', value)} placeholder='localhost' size='sm' type='text' value={host} />
			<NumberInput className='col-span-3' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={connected} label='Port' maxValue={65535} minValue={80} onValueChange={(value) => phd2.updateConnection('port', value)} placeholder='4400' size='sm' value={port} />
			<div className='col-span-2 flex flex-row justify-center items-center gap-2'>
				<ConnectButton isConnected={connected} onPointerUp={phd2.connect} />
			</div>
		</>
	)
})

const Settle = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { connected } = useSnapshot(phd2.state)
	const { pixels, time, timeout } = useSnapshot(phd2.state.connection.dither.settle)

	return (
		<>
			<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={connected} label='Settle tolerance (px)' maxValue={25} minValue={1} onValueChange={(value) => phd2.updateSettle('pixels', value)} placeholder='1.5' size='sm' step={0.1} value={pixels} />
			<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={connected} label='Min settle time (s)' maxValue={60} minValue={1} onValueChange={(value) => phd2.updateSettle('time', value)} placeholder='10' size='sm' value={time} />
			<NumberInput className='col-span-4' formatOptions={INTEGER_NUMBER_FORMAT} isDisabled={connected} label='Settle timeout (s)' maxValue={60} minValue={1} onValueChange={(value) => phd2.updateSettle('timeout', value)} placeholder='30' size='sm' value={timeout} />
		</>
	)
})

const Dither = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { connected } = useSnapshot(phd2.state)
	const { amount, raOnly } = useSnapshot(phd2.state.connection.dither)

	return (
		<>
			<NumberInput className='col-span-4' formatOptions={DECIMAL_NUMBER_FORMAT} isDisabled={connected} label='Dither pixels (px)' maxValue={25} minValue={1} onValueChange={(value) => phd2.updateDither('amount', value)} placeholder='5' size='sm' step={0.1} value={amount} />
			<Checkbox className='col-span-8' isDisabled={connected} isSelected={raOnly} onValueChange={(value) => phd2.updateDither('raOnly', value)}>
				RA only
			</Checkbox>
		</>
	)
})

const Status = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { state, snr, starMass, hfd } = useSnapshot(phd2.state.event)

	return (
		<div className='mt-2 col-span-full flex flex-row items-center justify-start gap-1'>
			<Chip color='primary' size='sm'>
				{state === 'IDLE' ? 'idle' : state === 'CALIBRATING' ? 'calibrating' : state === 'GUIDING' ? 'guiding' : state === 'LOOPING' ? 'looping' : state === 'SETTLING' ? 'settling' : state === 'PAUSED' ? 'paused' : 'star lost'}
			</Chip>
			<Chip color='success' size='sm'>
				SNR: {snr.toFixed(0)}
			</Chip>
			<Chip color='warning' size='sm'>
				HFD: {hfd.toFixed(2)}
			</Chip>
			<Chip color='secondary' size='sm'>
				Star mass: {starMass.toFixed(0)}
			</Chip>
		</div>
	)
})

const DEFAULT_BAR_PROPS: Partial<BarProps> = { opacity: 0.5, isAnimationActive: false, stroke: 'transparent', type: 'monotone', strokeWidth: 8, barSize: 8 }
const DEFAULT_LINE_PROPS: Partial<LineProps> = { dot: false, isAnimationActive: false, strokeWidth: 1, type: 'monotone' }
const X_DOMAIN = [0, 99] as const
const Y_LEFT_DOMAIN = [-10, 10] as const
const Y_RIGHT_DOMAIN = [-500, 500] as const

const Chart = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { history } = useSnapshot(phd2.state)

	return (
		<div className='col-span-full'>
			<ComposedChart data={[...history]} height={240} margin={{ top: 0, right: 8, left: 8, bottom: 0 }} responsive>
				<YAxis allowDataOverflow={false} domain={Y_LEFT_DOMAIN} fontSize={10} width={25} yAxisId='angle' />
				<YAxis allowDataOverflow={false} domain={Y_RIGHT_DOMAIN} fontSize={10} orientation='right' width={25} yAxisId='duration' />
				<XAxis domain={X_DOMAIN} fontSize={10} interval={9} />
				<Line dataKey='ra' stroke='#F44336' type='linear' yAxisId='angle' {...DEFAULT_LINE_PROPS} />
				<Line dataKey='dec' stroke='#42A5F5' type='linear' yAxisId='angle' {...DEFAULT_LINE_PROPS} />
				<Bar dataKey='raCorrection' fill='#F44336' stackId='correction' yAxisId='duration' {...DEFAULT_BAR_PROPS} />
				<Bar dataKey='decCorrection' fill='#42A5F5' stackId='correction' yAxisId='duration' {...DEFAULT_BAR_PROPS} />
				<Bar dataKey='dx' fill='#FFEE58' stackId='dither' yAxisId='duration' {...DEFAULT_BAR_PROPS} />
				<Bar dataKey='dy' fill='#FFEE58' stackId='dither' yAxisId='duration' {...DEFAULT_BAR_PROPS} />
				{/* <ChartTooltip content={chartTooltipContent} /> */}
			</ComposedChart>
		</div>
	)
})

const Footer = memo(() => {
	const phd2 = useMolecule(PHD2Molecule)
	const { rmsRA, rmsDEC } = useSnapshot(phd2.state.event)

	return (
		<div className='w-full flex justify-center items-center gap-2'>
			<span>RA: {rmsRA.toFixed(2)}"</span>
			<span>DEC: {rmsDEC.toFixed(2)}"</span>
			<span>Total: {Math.hypot(rmsRA, rmsDEC).toFixed(2)}"</span>
			<IconButton color='primary' icon={Icons.Broom} onPointerUp={phd2.clear} />
		</div>
	)
})
