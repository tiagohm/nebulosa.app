import { memo, type ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { calculatorStore } from '@/stores/calculator.store'
import { Chip } from './components/Chip'
import { NumberInput } from './components/NumberInput'
import { Tab, TabPanel, Tabs } from './components/Tabs'
import { Modal } from './Modal'

const MIN_APERTURE = 1
const MIN_FOCAL_LENGTH = 1
const MIN_FOCAL_RATIO = 0.01
const MIN_PIXEL_SIZE = 0.01

export const Calculator = memo(() => {
	const { show } = useSnapshot(calculatorStore.state)

	if (!show) return null

	return (
		<Modal header="Calculator" id="calculator" maxWidth="440px" onHide={calculatorStore.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => (
	<div className="mt-0 px-1 py-2">
		<Tabs placement="start">
			<Tab id="focalLength">Focal Length</Tab>
			<Tab id="focalRatio">Focal Ratio</Tab>
			<Tab id="dawes">Dawes Limit</Tab>
			<Tab id="rayleigh">Rayleigh Limit</Tab>
			<Tab id="limitingMagnitude">Limiting Magnitude</Tab>
			<Tab id="lightGraspRatio">Light Grasp Ratio</Tab>
			<Tab id="ccdResolution">CCD Resolution</Tab>

			<TabPanel id="focalLength">
				<FocalLength />
			</TabPanel>
			<TabPanel id="focalRatio">
				<FocalRatio />
			</TabPanel>
			<TabPanel id="dawes">
				<DawesLimit />
			</TabPanel>
			<TabPanel id="rayleigh">
				<RayleighLimit />
			</TabPanel>
			<TabPanel id="limitingMagnitude">
				<LimitingMagnitude />
			</TabPanel>
			<TabPanel id="lightGraspRatio">
				<LightGraspRatio />
			</TabPanel>
			<TabPanel id="ccdResolution">
				<CCDResolution />
			</TabPanel>
		</Tabs>
	</div>
))

interface FormulaProps {
	readonly description: string
	readonly expression: string
	readonly children?: ReactNode
}

function Formula({ description, expression, children }: FormulaProps) {
	return (
		<div className="flex h-full w-full flex-col justify-between gap-2">
			<div className="flex flex-1 flex-col items-center justify-center gap-1">
				<p className="text-center text-sm">{description}</p>
				<Chip className="text-medium" color="primary" label={expression} />
			</div>
			<div className="flex flex-1 flex-col items-center justify-center gap-2">{children}</div>
		</div>
	)
}

const FocalLength = memo(() => {
	const { aperture, focalRatio, focalLength } = useSnapshot(calculatorStore.state.focalLength)

	return (
		<Formula description="Calculate the focal length of your telescope" expression="Aperture * Focal Ratio">
			<NumberInput endContent="mm" fullWidth label="Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('focalLength', 'aperture', value)} value={aperture} />
			<NumberInput fractionDigits={2} fullWidth label="Focal Ratio" minValue={MIN_FOCAL_RATIO} onValueChange={(value) => calculatorStore.update('focalLength', 'focalRatio', value)} startContent="F/" step={0.1} value={focalRatio} />
			<NumberInput endContent="mm" fullWidth label="Focal Length" readOnly value={focalLength} />
		</Formula>
	)
})

const FocalRatio = memo(() => {
	const { aperture, focalRatio, focalLength } = useSnapshot(calculatorStore.state.focalRatio)

	return (
		<Formula description="Calculate the focal ratio of your telescope" expression="Focal Length / Aperture">
			<NumberInput endContent="mm" fullWidth label="Focal Length" minValue={MIN_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('focalRatio', 'focalLength', value)} value={focalLength} />
			<NumberInput endContent="mm" fullWidth label="Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('focalRatio', 'aperture', value)} value={aperture} />
			<NumberInput fractionDigits={2} fullWidth label="Focal Ratio" readOnly startContent="F/" value={focalRatio} />
		</Formula>
	)
})

const DawesLimit = memo(() => {
	const { aperture, resolution } = useSnapshot(calculatorStore.state.dawesLimit)

	return (
		<Formula description="Calculate the maximum resolving power of your telescope using the Dawes Limit formula" expression="116 / Aperture">
			<NumberInput endContent="mm" fullWidth label="Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('dawesLimit', 'aperture', value)} value={aperture} />
			<NumberInput endContent="arcsec" fractionDigits={2} fullWidth label="Resolution" readOnly value={resolution} />
		</Formula>
	)
})

const RayleighLimit = memo(() => {
	const { aperture, resolution } = useSnapshot(calculatorStore.state.rayleighLimit)

	return (
		<Formula description="Calculate the maximum resolving power of your telescope using the Rayleigh Limit formula" expression="138 / Aperture">
			<NumberInput endContent="mm" fullWidth label="Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('rayleighLimit', 'aperture', value)} value={aperture} />
			<NumberInput endContent="arcsec" fractionDigits={2} fullWidth label="Resolution" readOnly value={resolution} />
		</Formula>
	)
})

const LimitingMagnitude = memo(() => {
	const { aperture, magnitude } = useSnapshot(calculatorStore.state.limitingMagnitude)

	return (
		<Formula description="Calculate a telescope's approximate limiting magnitude" expression="2.7 + 5 * log10(Aperture)">
			<NumberInput endContent="mm" fullWidth label="Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('limitingMagnitude', 'aperture', value)} value={aperture} />
			<NumberInput fractionDigits={2} fullWidth label="Magnitude" readOnly value={magnitude} />
		</Formula>
	)
})

const LightGraspRatio = memo(() => {
	const { smallerAperture, largerAperture, ratio } = useSnapshot(calculatorStore.state.lightGraspRatio)

	return (
		<Formula description="Calculate the light grasp ratio between two telescopes" expression="(Larger Aperture / Smaller Aperture)²">
			<NumberInput endContent="mm" fullWidth label="Smaller Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('lightGraspRatio', 'smallerAperture', value)} value={smallerAperture} />
			<NumberInput endContent="mm" fullWidth label="Larger Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('lightGraspRatio', 'largerAperture', value)} value={largerAperture} />
			<NumberInput fractionDigits={2} fullWidth label="Ratio" readOnly value={ratio} />
		</Formula>
	)
})

const CCDResolution = memo(() => {
	const { pixelSize, focalLength, resolution } = useSnapshot(calculatorStore.state.ccdResolution)

	return (
		<Formula description="Calculate the resolution in arcseconds per pixel of a CCD with a particular telescope" expression="Pixel Size / Focal Length * 206.265">
			<NumberInput endContent="µm" fractionDigits={2} fullWidth label="Pixel Size" minValue={MIN_PIXEL_SIZE} onValueChange={(value) => calculatorStore.update('ccdResolution', 'pixelSize', value)} step={0.01} value={pixelSize} />
			<NumberInput endContent="mm" fullWidth label="Focal Length" minValue={MIN_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('ccdResolution', 'focalLength', value)} value={focalLength} />
			<NumberInput endContent="arcsec/px" fractionDigits={2} fullWidth label="Resolution" readOnly value={resolution} />
		</Formula>
	)
})
