import { Card, CardBody, CardHeader, Chip, NumberInput, Tab, Tabs } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { CalculatorMolecule } from '@/molecules/calculator'
import { DECIMAL_NUMBER_FORMAT, INTEGER_NUMBER_FORMAT } from '@/shared/constants'
import { Modal } from './Modal'

export const Calculator = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)

	return (
		<Modal header='Calculator' maxWidth='440px' name='calculator' onHide={calculator.hide}>
			<div className='mt-0 px-1 py-2'>
				<Tabs classNames={{ panel: 'w-full' }} isVertical>
					<Tab key='focalLength' title='Focal Length'>
						<FocalLength />
					</Tab>
					<Tab key='focalRatio' title='Focal Ratio'>
						<FocalRatio />
					</Tab>
					<Tab key='dawes' title='Dawes Limit'>
						<DawesLimit />
					</Tab>
					<Tab key='rayleigh' title='Rayleigh Limit'>
						<RayleighLimit />
					</Tab>
					<Tab key='limitingMagnitude' title='Limiting Magnitude'>
						<LimitingMagnitude />
					</Tab>
					<Tab key='lightGraspRatio' title='Light Grasp Ratio'>
						<LightGraspRatio />
					</Tab>
					<Tab key='ccdResolution' title='CCD Resolution'>
						<CCDResolution />
					</Tab>
				</Tabs>
			</div>
		</Modal>
	)
})

export interface FormulaProps {
	readonly description: string
	readonly expression: string
	readonly children?: React.ReactNode[]
}

export function Formula({ description, expression, children }: FormulaProps) {
	return (
		<Card className='w-full'>
			<CardHeader>
				<div className='w-full flex flex-col gap-1 items-center justify-center'>
					<p className='text-sm text-center'>{description}</p>
					<Chip className='text-medium' color='primary'>
						{expression}
					</Chip>
				</div>
			</CardHeader>
			<CardBody>
				<div className='flex flex-col gap-2 w-full'>{children}</div>
			</CardBody>
		</Card>
	)
}

export const FocalLength = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { aperture, focalRatio, focalLength } = useSnapshot(calculator.state.focalLength, { sync: true })

	return (
		<Formula description='Calculate the focal length of your telescope' expression='Aperture * Focal Ratio'>
			<NumberInput className='w-full' endContent='mm' formatOptions={INTEGER_NUMBER_FORMAT} label='Aperture' minValue={0} onValueChange={(value) => calculator.update('focalLength', 'aperture', value)} value={aperture} />
			<NumberInput className='w-full' formatOptions={DECIMAL_NUMBER_FORMAT} label='Focal Ratio' minValue={0} onValueChange={(value) => calculator.update('focalLength', 'focalRatio', value)} startContent='F/' value={focalRatio} />
			<NumberInput className='w-full' endContent='mm' formatOptions={DECIMAL_NUMBER_FORMAT} isReadOnly label='Focal Length' value={focalLength} />
		</Formula>
	)
})

export const FocalRatio = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { aperture, focalRatio, focalLength } = useSnapshot(calculator.state.focalRatio, { sync: true })

	return (
		<Formula description='Calculate the focal ratio of your telescope' expression='Focal Length / Aperture'>
			<NumberInput className='w-full' endContent='mm' formatOptions={INTEGER_NUMBER_FORMAT} label='Focal Length' minValue={0} onValueChange={(value) => calculator.update('focalRatio', 'focalLength', value)} value={focalLength} />
			<NumberInput className='w-full' endContent='mm' formatOptions={INTEGER_NUMBER_FORMAT} label='Aperture' minValue={0} onValueChange={(value) => calculator.update('focalRatio', 'aperture', value)} value={aperture} />
			<NumberInput className='w-full' formatOptions={DECIMAL_NUMBER_FORMAT} isReadOnly label='Focal Ratio' startContent='F/' value={focalRatio} />
		</Formula>
	)
})

export const DawesLimit = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { aperture, resolution } = useSnapshot(calculator.state.dawesLimit, { sync: true })

	return (
		<Formula description='Calculate the maximum resolving power of your telescope using the Dawes Limit formula' expression='116 / Aperture'>
			<NumberInput className='w-full' endContent='mm' formatOptions={INTEGER_NUMBER_FORMAT} label='Aperture' minValue={0} onValueChange={(value) => calculator.update('dawesLimit', 'aperture', value)} value={aperture} />
			<NumberInput className='w-full' endContent='arcsec' formatOptions={DECIMAL_NUMBER_FORMAT} isReadOnly label='Resolution' value={resolution} />
		</Formula>
	)
})

export const RayleighLimit = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { aperture, resolution } = useSnapshot(calculator.state.rayleighLimit, { sync: true })

	return (
		<Formula description='Calculate the maximum resolving power of your telescope using the Rayleigh Limit formula' expression='138 / Aperture'>
			<NumberInput className='w-full' endContent='mm' formatOptions={INTEGER_NUMBER_FORMAT} label='Aperture' minValue={0} onValueChange={(value) => calculator.update('rayleighLimit', 'aperture', value)} value={aperture} />
			<NumberInput className='w-full' endContent='arcsec' formatOptions={DECIMAL_NUMBER_FORMAT} isReadOnly label='Resolution' value={resolution} />
		</Formula>
	)
})

export const LimitingMagnitude = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { aperture, magnitude } = useSnapshot(calculator.state.limitingMagnitude, { sync: true })

	return (
		<Formula description='Calculate a telescopes approximate limiting magnitude' expression='2.7 + 5 * Log(Aperture)'>
			<NumberInput className='w-full' endContent='mm' formatOptions={INTEGER_NUMBER_FORMAT} label='Aperture' minValue={0} onValueChange={(value) => calculator.update('limitingMagnitude', 'aperture', value)} value={aperture} />
			<NumberInput className='w-full' formatOptions={DECIMAL_NUMBER_FORMAT} isReadOnly label='Magnitude' value={magnitude} />
		</Formula>
	)
})

export const LightGraspRatio = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { smallerAperture, largerAperture, ratio } = useSnapshot(calculator.state.lightGraspRatio, { sync: true })

	return (
		<Formula description='Calculate the light grasp ratio between two telescopes' expression='(Smaller Aperture / Larger Aperture)²'>
			<NumberInput className='w-full' endContent='mm' formatOptions={DECIMAL_NUMBER_FORMAT} label='Smaller Aperture' minValue={0} onValueChange={(value) => calculator.update('lightGraspRatio', 'smallerAperture', value)} value={smallerAperture} />
			<NumberInput className='w-full' endContent='mm' formatOptions={DECIMAL_NUMBER_FORMAT} label='Larger Aperture' minValue={0} onValueChange={(value) => calculator.update('lightGraspRatio', 'largerAperture', value)} value={largerAperture} />
			<NumberInput className='w-full' formatOptions={DECIMAL_NUMBER_FORMAT} isReadOnly label='Ratio' value={ratio} />
		</Formula>
	)
})

export const CCDResolution = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { pixelSize, focalLength, resolution } = useSnapshot(calculator.state.ccdResolution, { sync: true })

	return (
		<Formula description='Calculate the resoution in arcseconds per pixel of a CCD with a particular telescope' expression='Pixel Size / Focal Length * 206.265'>
			<NumberInput className='w-full' endContent='µm' formatOptions={DECIMAL_NUMBER_FORMAT} label='Pixel Size' minValue={0} onValueChange={(value) => calculator.update('ccdResolution', 'pixelSize', value)} step={0.01} value={pixelSize} />
			<NumberInput className='w-full' endContent='mm' formatOptions={INTEGER_NUMBER_FORMAT} label='Focal Length' minValue={0} onValueChange={(value) => calculator.update('ccdResolution', 'focalLength', value)} value={focalLength} />
			<NumberInput className='w-full' endContent='arcsec/px' formatOptions={DECIMAL_NUMBER_FORMAT} isReadOnly label='Resolution' value={resolution} />
		</Formula>
	)
})
