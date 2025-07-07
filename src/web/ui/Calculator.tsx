import { Card, CardBody, CardHeader, Chip, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, Tab, Tabs } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { CalculatorMolecule } from '@/molecules/calculator'
import { useModal } from '@/shared/hooks'

export const Calculator = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const modal = useModal(() => calculator.close())

	return (
		<Modal {...modal.props} classNames={{ base: 'max-w-[440px] max-h-[70vh]', wrapper: 'pointer-events-none' }}>
			<ModalContent>
				{() => (
					<>
						<ModalHeader {...modal.moveProps} className='flex flex-row items-center'>
							Calculator
						</ModalHeader>
						<ModalBody>
							<div className='w-full px-1 py-2'>
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
						</ModalBody>
						<ModalFooter {...modal.moveProps}></ModalFooter>
					</>
				)}
			</ModalContent>
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
	const { focalLength } = useSnapshot(calculator.state)

	return (
		<Formula description='Calculate the focal length of your telescope' expression='Aperture * Focal Ratio'>
			<NumberInput className='w-full' endContent='mm' label='Aperture' minValue={0} onValueChange={(value) => calculator.update('focalLength', 'aperture', value)} value={focalLength.aperture} />
			<NumberInput className='w-full' label='Focal Ratio' minValue={0} onValueChange={(value) => calculator.update('focalLength', 'focalRatio', value)} startContent='F/' value={focalLength.focalRatio} />
			<NumberInput className='w-full' endContent='mm' isReadOnly label='Focal Length' value={focalLength.focalLength} />
		</Formula>
	)
})

export const FocalRatio = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { focalRatio } = useSnapshot(calculator.state)

	return (
		<Formula description='Calculate the focal ratio of your telescope' expression='Focal Length / Aperture'>
			<NumberInput className='w-full' endContent='mm' label='Focal Length' minValue={0} onValueChange={(value) => calculator.update('focalRatio', 'focalLength', value)} value={focalRatio.focalLength} />
			<NumberInput className='w-full' endContent='mm' label='Aperture' minValue={0} onValueChange={(value) => calculator.update('focalRatio', 'aperture', value)} value={focalRatio.aperture} />
			<NumberInput className='w-full' isReadOnly label='Focal Ratio' startContent='F/' value={focalRatio.focalRatio} />
		</Formula>
	)
})

export const DawesLimit = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { dawes } = useSnapshot(calculator.state)

	return (
		<Formula description='Calculate the maximum resolving power of your telescope using the Dawes Limit formula' expression='116 / Aperture'>
			<NumberInput className='w-full' endContent='mm' label='Aperture' minValue={0} onValueChange={(value) => calculator.update('dawes', 'aperture', value)} value={dawes.aperture} />
			<NumberInput className='w-full' endContent='arcsec' isReadOnly label='Resolution' value={dawes.resolution} />
		</Formula>
	)
})

export const RayleighLimit = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { rayleigh } = useSnapshot(calculator.state)

	return (
		<Formula description='Calculate the maximum resolving power of your telescope using the Rayleigh Limit formula' expression='138 / Aperture'>
			<NumberInput className='w-full' endContent='mm' label='Aperture' minValue={0} onValueChange={(value) => calculator.update('rayleigh', 'aperture', value)} value={rayleigh.aperture} />
			<NumberInput className='w-full' endContent='arcsec' isReadOnly label='Resolution' value={rayleigh.resolution} />
		</Formula>
	)
})

export const LimitingMagnitude = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { limitingMagnitude } = useSnapshot(calculator.state)

	return (
		<Formula description='Calculate a telescopes approximate limiting magnitude' expression='2.7 + 5 * Log(Aperture)'>
			<NumberInput className='w-full' endContent='mm' label='Aperture' minValue={0} onValueChange={(value) => calculator.update('limitingMagnitude', 'aperture', value)} value={limitingMagnitude.aperture} />
			<NumberInput className='w-full' isReadOnly label='Magnitude' value={limitingMagnitude.magnitude} />
		</Formula>
	)
})

export const LightGraspRatio = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { lightGraspRatio } = useSnapshot(calculator.state)

	return (
		<Formula description='Calculate the light grasp ratio between two telescopes' expression='(Smaller Aperture / Larger Aperture)²'>
			<NumberInput className='w-full' endContent='mm' label='Smaller Aperture' minValue={0} onValueChange={(value) => calculator.update('lightGraspRatio', 'smallerAperture', value)} value={lightGraspRatio.smallerAperture} />
			<NumberInput className='w-full' endContent='mm' label='Larger Aperture' minValue={0} onValueChange={(value) => calculator.update('lightGraspRatio', 'largerAperture', value)} value={lightGraspRatio.largerAperture} />
			<NumberInput className='w-full' isReadOnly label='Ratio' value={lightGraspRatio.ratio} />
		</Formula>
	)
})

export const CCDResolution = memo(() => {
	const calculator = useMolecule(CalculatorMolecule)
	const { ccdResolution } = useSnapshot(calculator.state)

	return (
		<Formula description='Calculate the resoution in arcseconds per pixel of a CCD with a particular telescope' expression='Pixel Size / Focal Length * 206.265'>
			<NumberInput className='w-full' endContent='µm' label='Pixel Size' minValue={0} onValueChange={(value) => calculator.update('ccdResolution', 'pixelSize', value)} value={ccdResolution.pixelSize} />
			<NumberInput className='w-full' endContent='mm' label='Focal Length' minValue={0} onValueChange={(value) => calculator.update('ccdResolution', 'focalLength', value)} value={ccdResolution.focalLength} />
			<NumberInput className='w-full' endContent='arcsec/px' isReadOnly label='Resolution' value={ccdResolution.resolution} />
		</Formula>
	)
})
