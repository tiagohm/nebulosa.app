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
const MIN_SENSOR_SIZE = 0.01
const MIN_EYEPIECE_FOCAL_LENGTH = 0.1
const MIN_FIELD_STOP = 0.1
const MIN_APPARENT_FIELD = 0.1
const MIN_IMAGE_SCALE = 0.01
const MIN_SEEING = 0.01
const MIN_WAVELENGTH = 0.01
const MIN_DISTANCE = 0.000001
const MIN_AREA = 0.01
const MIN_HUMIDITY = 1
const MAX_HUMIDITY = 100
const MIN_ALTITUDE = 0.1
const MAX_ALTITUDE = 90
const MIN_DECLINATION = -90
const MAX_DECLINATION = 90
const MIN_LATITUDE = -90
const MAX_LATITUDE = 90
const MIN_AIRMASS = 1
const MAX_ZENITH_DISTANCE = 89.9
const MAX_OVERLAP = 99

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
		<Tabs className="max-h-100" classNames={{ panelContainer: 'overflow-y-auto pr-1', tabList: 'max-h-100 w-44', tab: 'min-h-7' }} placement="start">
			{FORMULA_TABS.map(({ id, label }) => (
				<Tab id={id} key={id}>
					{label}
				</Tab>
			))}
			{FORMULA_TABS.map(({ Component, id }) => (
				<TabPanel id={id} key={id}>
					<Component />
				</TabPanel>
			))}
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
	const { largerAperture, ratio, smallerAperture } = useSnapshot(calculatorStore.state.lightGraspRatio)

	return (
		<Formula description="Calculate the light grasp ratio between two telescopes" expression="(Larger Aperture / Smaller Aperture)²">
			<NumberInput endContent="mm" fullWidth label="Smaller Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('lightGraspRatio', 'smallerAperture', value)} value={smallerAperture} />
			<NumberInput endContent="mm" fullWidth label="Larger Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('lightGraspRatio', 'largerAperture', value)} value={largerAperture} />
			<NumberInput fractionDigits={2} fullWidth label="Ratio" readOnly value={ratio} />
		</Formula>
	)
})

const Magnification = memo(() => {
	const { eyepieceFocalLength, magnification, telescopeFocalLength } = useSnapshot(calculatorStore.state.magnification)

	return (
		<Formula description="Calculate visual magnification from telescope and eyepiece focal lengths" expression="Telescope Focal Length / Eyepiece Focal Length">
			<NumberInput endContent="mm" fullWidth label="Telescope Focal Length" minValue={MIN_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('magnification', 'telescopeFocalLength', value)} value={telescopeFocalLength} />
			<NumberInput endContent="mm" fractionDigits={1} fullWidth label="Eyepiece Focal Length" minValue={MIN_EYEPIECE_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('magnification', 'eyepieceFocalLength', value)} step={0.1} value={eyepieceFocalLength} />
			<NumberInput endContent="x" fractionDigits={1} fullWidth label="Magnification" readOnly value={magnification} />
		</Formula>
	)
})

const ExitPupil = memo(() => {
	const { aperture, exitPupil, magnification } = useSnapshot(calculatorStore.state.exitPupil)

	return (
		<Formula description="Calculate exit pupil from aperture and magnification" expression="Aperture / Magnification">
			<NumberInput endContent="mm" fullWidth label="Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('exitPupil', 'aperture', value)} value={aperture} />
			<NumberInput endContent="x" fractionDigits={1} fullWidth label="Magnification" minValue={0.1} onValueChange={(value) => calculatorStore.update('exitPupil', 'magnification', value)} step={0.1} value={magnification} />
			<NumberInput endContent="mm" fractionDigits={2} fullWidth label="Exit Pupil" readOnly value={exitPupil} />
		</Formula>
	)
})

const ExitPupilByFocalRatio = memo(() => {
	const { exitPupil, eyepieceFocalLength, focalRatio } = useSnapshot(calculatorStore.state.exitPupilByFocalRatio)

	return (
		<Formula description="Calculate exit pupil from eyepiece focal length and focal ratio" expression="Eyepiece Focal Length / Focal Ratio">
			<NumberInput endContent="mm" fractionDigits={1} fullWidth label="Eyepiece Focal Length" minValue={MIN_EYEPIECE_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('exitPupilByFocalRatio', 'eyepieceFocalLength', value)} step={0.1} value={eyepieceFocalLength} />
			<NumberInput fractionDigits={2} fullWidth label="Focal Ratio" minValue={MIN_FOCAL_RATIO} onValueChange={(value) => calculatorStore.update('exitPupilByFocalRatio', 'focalRatio', value)} startContent="F/" step={0.1} value={focalRatio} />
			<NumberInput endContent="mm" fractionDigits={2} fullWidth label="Exit Pupil" readOnly value={exitPupil} />
		</Formula>
	)
})

const EyepieceTrueFov = memo(() => {
	const { fieldStop, telescopeFocalLength, trueField } = useSnapshot(calculatorStore.state.eyepieceTrueFov)

	return (
		<Formula description="Estimate eyepiece true field of view from field stop diameter" expression="57.2958 * Field Stop / Telescope Focal Length">
			<NumberInput endContent="mm" fractionDigits={1} fullWidth label="Field Stop" minValue={MIN_FIELD_STOP} onValueChange={(value) => calculatorStore.update('eyepieceTrueFov', 'fieldStop', value)} step={0.1} value={fieldStop} />
			<NumberInput endContent="mm" fullWidth label="Telescope Focal Length" minValue={MIN_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('eyepieceTrueFov', 'telescopeFocalLength', value)} value={telescopeFocalLength} />
			<NumberInput endContent="deg" fractionDigits={2} fullWidth label="True Field" readOnly value={trueField} />
		</Formula>
	)
})

const PlateScale = memo(() => {
	const { focalLength, scale } = useSnapshot(calculatorStore.state.plateScale)

	return (
		<Formula description="Calculate focal-plane plate scale" expression="206265 / Focal Length">
			<NumberInput endContent="mm" fullWidth label="Focal Length" minValue={MIN_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('plateScale', 'focalLength', value)} value={focalLength} />
			<NumberInput endContent="arcsec/mm" fractionDigits={2} fullWidth label="Plate Scale" readOnly value={scale} />
		</Formula>
	)
})

const PixelScale = memo(() => {
	const { focalLength, pixelSize, resolution } = useSnapshot(calculatorStore.state.pixelScale)

	return (
		<Formula description="Calculate the resolution in arcseconds per pixel of a camera and telescope" expression="206.265 * Pixel Size / Focal Length">
			<NumberInput endContent="µm" fractionDigits={2} fullWidth label="Pixel Size" minValue={MIN_PIXEL_SIZE} onValueChange={(value) => calculatorStore.update('pixelScale', 'pixelSize', value)} step={0.01} value={pixelSize} />
			<NumberInput endContent="mm" fullWidth label="Focal Length" minValue={MIN_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('pixelScale', 'focalLength', value)} value={focalLength} />
			<NumberInput endContent="arcsec/px" fractionDigits={2} fullWidth label="Resolution" readOnly value={resolution} />
		</Formula>
	)
})

const SamplingRatio = memo(() => {
	const { pixelScale, ratio, seeing } = useSnapshot(calculatorStore.state.samplingRatio)

	return (
		<Formula description="Calculate sampling ratio from seeing and image scale" expression="Seeing / Pixel Scale">
			<NumberInput endContent="arcsec" fractionDigits={2} fullWidth label="Seeing" minValue={MIN_SEEING} onValueChange={(value) => calculatorStore.update('samplingRatio', 'seeing', value)} step={0.01} value={seeing} />
			<NumberInput endContent="arcsec/px" fractionDigits={2} fullWidth label="Pixel Scale" minValue={MIN_IMAGE_SCALE} onValueChange={(value) => calculatorStore.update('samplingRatio', 'pixelScale', value)} step={0.01} value={pixelScale} />
			<NumberInput fractionDigits={2} fullWidth label="Sampling" readOnly value={ratio} />
		</Formula>
	)
})

const RecommendedFocalLength = memo(() => {
	const { focalLength, pixelSize, seeing, targetSampling } = useSnapshot(calculatorStore.state.recommendedFocalLength)

	return (
		<Formula description="Estimate focal length for a target sampling ratio and seeing" expression="206.265 * Pixel Size * Sampling / Seeing">
			<NumberInput endContent="µm" fractionDigits={2} fullWidth label="Pixel Size" minValue={MIN_PIXEL_SIZE} onValueChange={(value) => calculatorStore.update('recommendedFocalLength', 'pixelSize', value)} step={0.01} value={pixelSize} />
			<NumberInput fractionDigits={2} fullWidth label="Target Sampling" minValue={0.1} onValueChange={(value) => calculatorStore.update('recommendedFocalLength', 'targetSampling', value)} step={0.1} value={targetSampling} />
			<NumberInput endContent="arcsec" fractionDigits={2} fullWidth label="Seeing" minValue={MIN_SEEING} onValueChange={(value) => calculatorStore.update('recommendedFocalLength', 'seeing', value)} step={0.01} value={seeing} />
			<NumberInput endContent="mm" fractionDigits={1} fullWidth label="Focal Length" readOnly value={focalLength} />
		</Formula>
	)
})

const AiryDiskSize = memo(() => {
	const { diameter, focalRatio, wavelength } = useSnapshot(calculatorStore.state.airyDiskSize)

	return (
		<Formula description="Estimate Airy disk diameter at the focal plane" expression="2.44 * Wavelength * Focal Ratio">
			<NumberInput endContent="µm" fractionDigits={2} fullWidth label="Wavelength" minValue={MIN_WAVELENGTH} onValueChange={(value) => calculatorStore.update('airyDiskSize', 'wavelength', value)} step={0.01} value={wavelength} />
			<NumberInput fractionDigits={2} fullWidth label="Focal Ratio" minValue={MIN_FOCAL_RATIO} onValueChange={(value) => calculatorStore.update('airyDiskSize', 'focalRatio', value)} startContent="F/" step={0.1} value={focalRatio} />
			<NumberInput endContent="µm" fractionDigits={2} fullWidth label="Airy Diameter" readOnly value={diameter} />
		</Formula>
	)
})

const AiryDiskInPixels = memo(() => {
	const { airyDiameter, diameter, pixelSize } = useSnapshot(calculatorStore.state.airyDiskInPixels)

	return (
		<Formula description="Convert Airy disk diameter to pixels" expression="Airy Diameter / Pixel Size">
			<NumberInput endContent="µm" fractionDigits={2} fullWidth label="Airy Diameter" minValue={MIN_WAVELENGTH} onValueChange={(value) => calculatorStore.update('airyDiskInPixels', 'airyDiameter', value)} step={0.01} value={airyDiameter} />
			<NumberInput endContent="µm" fractionDigits={2} fullWidth label="Pixel Size" minValue={MIN_PIXEL_SIZE} onValueChange={(value) => calculatorStore.update('airyDiskInPixels', 'pixelSize', value)} step={0.01} value={pixelSize} />
			<NumberInput endContent="px" fractionDigits={2} fullWidth label="Airy Diameter" readOnly value={diameter} />
		</Formula>
	)
})

const CriticalFocusZone = memo(() => {
	const { focalRatio, wavelength, zone } = useSnapshot(calculatorStore.state.criticalFocusZone)

	return (
		<Formula description="Estimate critical focus zone" expression="4.88 * Wavelength * Focal Ratio²">
			<NumberInput endContent="µm" fractionDigits={2} fullWidth label="Wavelength" minValue={MIN_WAVELENGTH} onValueChange={(value) => calculatorStore.update('criticalFocusZone', 'wavelength', value)} step={0.01} value={wavelength} />
			<NumberInput fractionDigits={2} fullWidth label="Focal Ratio" minValue={MIN_FOCAL_RATIO} onValueChange={(value) => calculatorStore.update('criticalFocusZone', 'focalRatio', value)} startContent="F/" step={0.1} value={focalRatio} />
			<NumberInput endContent="µm" fractionDigits={1} fullWidth label="Critical Focus Zone" readOnly value={zone} />
		</Formula>
	)
})

const EffectiveAperture = memo(() => {
	const { aperture, effectiveAperture, obstruction } = useSnapshot(calculatorStore.state.effectiveAperture)

	return (
		<Formula description="Estimate effective aperture after a central obstruction" expression="sqrt(Aperture² - Obstruction²)">
			<NumberInput endContent="mm" fullWidth label="Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('effectiveAperture', 'aperture', value)} value={aperture} />
			<NumberInput endContent="mm" fullWidth label="Obstruction" maxValue={Math.max(0, aperture - 0.01)} minValue={0} onValueChange={(value) => calculatorStore.update('effectiveAperture', 'obstruction', value)} value={obstruction} />
			<NumberInput endContent="mm" fractionDigits={2} fullWidth label="Effective Aperture" readOnly value={effectiveAperture} />
		</Formula>
	)
})

const ObstructionRatio = memo(() => {
	const { aperture, obstruction, ratio } = useSnapshot(calculatorStore.state.obstructionRatio)

	return (
		<Formula description="Calculate central obstruction as a percentage of aperture" expression="100 * Obstruction / Aperture">
			<NumberInput endContent="mm" fullWidth label="Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('obstructionRatio', 'aperture', value)} value={aperture} />
			<NumberInput endContent="mm" fullWidth label="Obstruction" maxValue={aperture} minValue={0} onValueChange={(value) => calculatorStore.update('obstructionRatio', 'obstruction', value)} value={obstruction} />
			<NumberInput endContent="%" fractionDigits={2} fullWidth label="Obstruction Ratio" readOnly value={ratio} />
		</Formula>
	)
})

const SensorDiagonalFieldOfView = memo(() => {
	const { fieldOfView, focalLength, sensorDiagonal } = useSnapshot(calculatorStore.state.sensorDiagonalFieldOfView)

	return (
		<Formula description="Calculate diagonal field of view using the arctangent formula" expression="2 * atan(Sensor Diagonal / (2 * Focal Length))">
			<NumberInput endContent="mm" fractionDigits={2} fullWidth label="Sensor Diagonal" minValue={MIN_SENSOR_SIZE} onValueChange={(value) => calculatorStore.update('sensorDiagonalFieldOfView', 'sensorDiagonal', value)} step={0.01} value={sensorDiagonal} />
			<NumberInput endContent="mm" fullWidth label="Focal Length" minValue={MIN_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('sensorDiagonalFieldOfView', 'focalLength', value)} value={focalLength} />
			<NumberInput endContent="deg" fractionDigits={2} fullWidth label="Diagonal FOV" readOnly value={fieldOfView} />
		</Formula>
	)
})

const SensorFieldOfView = memo(() => {
	const { focalLength, height, sensorHeight, sensorWidth, width } = useSnapshot(calculatorStore.state.sensorFieldOfView)

	return (
		<Formula description="Calculate the angular field of view covered by a camera sensor" expression="Sensor Size / Focal Length * 57.2958">
			<NumberInput endContent="mm" fractionDigits={2} fullWidth label="Sensor Width" minValue={MIN_SENSOR_SIZE} onValueChange={(value) => calculatorStore.update('sensorFieldOfView', 'sensorWidth', value)} step={0.01} value={sensorWidth} />
			<NumberInput endContent="mm" fractionDigits={2} fullWidth label="Sensor Height" minValue={MIN_SENSOR_SIZE} onValueChange={(value) => calculatorStore.update('sensorFieldOfView', 'sensorHeight', value)} step={0.01} value={sensorHeight} />
			<NumberInput endContent="mm" fullWidth label="Focal Length" minValue={MIN_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('sensorFieldOfView', 'focalLength', value)} value={focalLength} />
			<NumberInput endContent="deg" fractionDigits={2} fullWidth label="Width" readOnly value={width} />
			<NumberInput endContent="deg" fractionDigits={2} fullWidth label="Height" readOnly value={height} />
		</Formula>
	)
})

const EyepieceView = memo(() => {
	const { aperture, apparentField, exitPupil, eyepieceFocalLength, magnification, telescopeFocalLength, trueField } = useSnapshot(calculatorStore.state.eyepieceView)

	return (
		<Formula description="Calculate visual magnification, true field and exit pupil for an eyepiece" expression="Telescope Focal Length / Eyepiece Focal Length">
			<NumberInput endContent="mm" fullWidth label="Aperture" minValue={MIN_APERTURE} onValueChange={(value) => calculatorStore.update('eyepieceView', 'aperture', value)} value={aperture} />
			<NumberInput endContent="mm" fullWidth label="Telescope Focal Length" minValue={MIN_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('eyepieceView', 'telescopeFocalLength', value)} value={telescopeFocalLength} />
			<NumberInput endContent="mm" fractionDigits={1} fullWidth label="Eyepiece Focal Length" minValue={MIN_EYEPIECE_FOCAL_LENGTH} onValueChange={(value) => calculatorStore.update('eyepieceView', 'eyepieceFocalLength', value)} step={0.1} value={eyepieceFocalLength} />
			<NumberInput endContent="deg" fractionDigits={1} fullWidth label="Apparent Field" minValue={MIN_APPARENT_FIELD} onValueChange={(value) => calculatorStore.update('eyepieceView', 'apparentField', value)} step={0.1} value={apparentField} />
			<NumberInput endContent="x" fractionDigits={1} fullWidth label="Magnification" readOnly value={magnification} />
			<NumberInput endContent="deg" fractionDigits={2} fullWidth label="True Field" readOnly value={trueField} />
			<NumberInput endContent="mm" fractionDigits={2} fullWidth label="Exit Pupil" readOnly value={exitPupil} />
		</Formula>
	)
})

const MosaicPanelCount = memo(() => {
	const { cameraField, overlap, panels, targetField } = useSnapshot(calculatorStore.state.mosaicPanelCount)

	return (
		<Formula description="Calculate one-axis mosaic panel count with overlap" expression="ceil(Target FOV / (Camera FOV * (1 - Overlap)))">
			<NumberInput endContent="deg" fractionDigits={2} fullWidth label="Target FOV" minValue={0.01} onValueChange={(value) => calculatorStore.update('mosaicPanelCount', 'targetField', value)} step={0.01} value={targetField} />
			<NumberInput endContent="deg" fractionDigits={2} fullWidth label="Camera FOV" minValue={0.01} onValueChange={(value) => calculatorStore.update('mosaicPanelCount', 'cameraField', value)} step={0.01} value={cameraField} />
			<NumberInput endContent="%" fullWidth label="Overlap" maxValue={MAX_OVERLAP} minValue={0} onValueChange={(value) => calculatorStore.update('mosaicPanelCount', 'overlap', value)} value={overlap} />
			<NumberInput fullWidth label="Panels" readOnly value={panels} />
		</Formula>
	)
})

const GuidingError = memo(() => {
	const { error, imageScale, rms } = useSnapshot(calculatorStore.state.guidingError)

	return (
		<Formula description="Convert RMS guiding error from arcseconds to pixels" expression="RMS / Image Scale">
			<NumberInput endContent="arcsec" fractionDigits={2} fullWidth label="RMS Error" minValue={0} onValueChange={(value) => calculatorStore.update('guidingError', 'rms', value)} step={0.01} value={rms} />
			<NumberInput endContent="arcsec/px" fractionDigits={2} fullWidth label="Image Scale" minValue={MIN_IMAGE_SCALE} onValueChange={(value) => calculatorStore.update('guidingError', 'imageScale', value)} step={0.01} value={imageScale} />
			<NumberInput endContent="px" fractionDigits={2} fullWidth label="Guiding Error" readOnly value={error} />
		</Formula>
	)
})

const PeriodicError = memo(() => {
	const { error, imageScale, periodicError } = useSnapshot(calculatorStore.state.periodicError)

	return (
		<Formula description="Convert mount periodic error from arcseconds to pixels" expression="Periodic Error / Image Scale">
			<NumberInput endContent="arcsec" fractionDigits={2} fullWidth label="Periodic Error" minValue={0} onValueChange={(value) => calculatorStore.update('periodicError', 'periodicError', value)} step={0.01} value={periodicError} />
			<NumberInput endContent="arcsec/px" fractionDigits={2} fullWidth label="Image Scale" minValue={MIN_IMAGE_SCALE} onValueChange={(value) => calculatorStore.update('periodicError', 'imageScale', value)} step={0.01} value={imageScale} />
			<NumberInput endContent="px" fractionDigits={2} fullWidth label="Periodic Error" readOnly value={error} />
		</Formula>
	)
})

const StarTrailLength = memo(() => {
	const { declination, exposure, imageScale, trail } = useSnapshot(calculatorStore.state.starTrailLength)

	return (
		<Formula description="Estimate unguided star trail length in pixels" expression="15.041 * cos(Declination) * Exposure / Image Scale">
			<NumberInput endContent="deg" fractionDigits={1} fullWidth label="Declination" maxValue={MAX_DECLINATION} minValue={MIN_DECLINATION} onValueChange={(value) => calculatorStore.update('starTrailLength', 'declination', value)} step={0.1} value={declination} />
			<NumberInput endContent="s" fullWidth label="Exposure" minValue={0} onValueChange={(value) => calculatorStore.update('starTrailLength', 'exposure', value)} value={exposure} />
			<NumberInput endContent="arcsec/px" fractionDigits={2} fullWidth label="Image Scale" minValue={MIN_IMAGE_SCALE} onValueChange={(value) => calculatorStore.update('starTrailLength', 'imageScale', value)} step={0.01} value={imageScale} />
			<NumberInput endContent="px" fractionDigits={2} fullWidth label="Trail Length" readOnly value={trail} />
		</Formula>
	)
})

const MaxExposureBeforeTrail = memo(() => {
	const { declination, exposure, imageScale, trailLimit } = useSnapshot(calculatorStore.state.maxExposureBeforeTrail)

	return (
		<Formula description="Estimate maximum exposure before star trails exceed a pixel limit" expression="Trail Limit * Image Scale / (15.041 * cos(Declination))">
			<NumberInput endContent="px" fractionDigits={2} fullWidth label="Trail Limit" minValue={0} onValueChange={(value) => calculatorStore.update('maxExposureBeforeTrail', 'trailLimit', value)} step={0.01} value={trailLimit} />
			<NumberInput endContent="arcsec/px" fractionDigits={2} fullWidth label="Image Scale" minValue={MIN_IMAGE_SCALE} onValueChange={(value) => calculatorStore.update('maxExposureBeforeTrail', 'imageScale', value)} step={0.01} value={imageScale} />
			<NumberInput endContent="deg" fractionDigits={1} fullWidth label="Declination" maxValue={89.9} minValue={-89.9} onValueChange={(value) => calculatorStore.update('maxExposureBeforeTrail', 'declination', value)} step={0.1} value={declination} />
			<NumberInput endContent="s" fractionDigits={2} fullWidth label="Max Exposure" readOnly value={exposure} />
		</Formula>
	)
})

const SignalToNoiseRatio = memo(() => {
	const { background, darkCurrent, pixelCount, ratio, readNoise, signal } = useSnapshot(calculatorStore.state.signalToNoiseRatio)

	return (
		<Formula description="Estimate signal-to-noise ratio from accumulated signal and noise terms" expression="S / sqrt(S + n * (B + D + RN²))">
			<NumberInput endContent="e-" fullWidth label="Signal" minValue={0} onValueChange={(value) => calculatorStore.update('signalToNoiseRatio', 'signal', value)} value={signal} />
			<NumberInput fullWidth label="Pixels" minValue={1} onValueChange={(value) => calculatorStore.update('signalToNoiseRatio', 'pixelCount', value)} value={pixelCount} />
			<NumberInput endContent="e-/px" fractionDigits={2} fullWidth label="Background" minValue={0} onValueChange={(value) => calculatorStore.update('signalToNoiseRatio', 'background', value)} step={0.01} value={background} />
			<NumberInput endContent="e-/px" fractionDigits={2} fullWidth label="Dark Current" minValue={0} onValueChange={(value) => calculatorStore.update('signalToNoiseRatio', 'darkCurrent', value)} step={0.01} value={darkCurrent} />
			<NumberInput endContent="e-" fractionDigits={2} fullWidth label="Read Noise" minValue={0} onValueChange={(value) => calculatorStore.update('signalToNoiseRatio', 'readNoise', value)} step={0.01} value={readNoise} />
			<NumberInput fractionDigits={2} fullWidth label="SNR" readOnly value={ratio} />
		</Formula>
	)
})

const StackingSnrGain = memo(() => {
	const { frameCount, gain } = useSnapshot(calculatorStore.state.stackingSnrGain)

	return (
		<Formula description="Calculate signal-to-noise gain from stacking frames" expression="sqrt(Frame Count)">
			<NumberInput fullWidth label="Frame Count" minValue={1} onValueChange={(value) => calculatorStore.update('stackingSnrGain', 'frameCount', value)} value={frameCount} />
			<NumberInput endContent="x" fractionDigits={2} fullWidth label="SNR Gain" readOnly value={gain} />
		</Formula>
	)
})

const StackingMagnitudeGain = memo(() => {
	const { frameCount, gain } = useSnapshot(calculatorStore.state.stackingMagnitudeGain)

	return (
		<Formula description="Estimate limiting-magnitude gain from stacking frames" expression="1.25 * log10(Frame Count)">
			<NumberInput fullWidth label="Frame Count" minValue={1} onValueChange={(value) => calculatorStore.update('stackingMagnitudeGain', 'frameCount', value)} value={frameCount} />
			<NumberInput endContent="mag" fractionDigits={2} fullWidth label="Magnitude Gain" readOnly value={gain} />
		</Formula>
	)
})

const DynamicRange = memo(() => {
	const { fullWell, range, readNoise, stops } = useSnapshot(calculatorStore.state.dynamicRange)

	return (
		<Formula description="Calculate camera dynamic range and photographic stops" expression="Full Well / Read Noise">
			<NumberInput endContent="e-" fullWidth label="Full Well" minValue={1} onValueChange={(value) => calculatorStore.update('dynamicRange', 'fullWell', value)} value={fullWell} />
			<NumberInput endContent="e-" fractionDigits={2} fullWidth label="Read Noise" minValue={0.01} onValueChange={(value) => calculatorStore.update('dynamicRange', 'readNoise', value)} step={0.01} value={readNoise} />
			<NumberInput fractionDigits={2} fullWidth label="Dynamic Range" readOnly value={range} />
			<NumberInput endContent="stops" fractionDigits={2} fullWidth label="Dynamic Range" readOnly value={stops} />
		</Formula>
	)
})

const SaturationTime = memo(() => {
	const { fullWell, signalRate, time } = useSnapshot(calculatorStore.state.saturationTime)

	return (
		<Formula description="Estimate time until a pixel reaches full well" expression="Full Well / Signal Rate">
			<NumberInput endContent="e-" fullWidth label="Full Well" minValue={1} onValueChange={(value) => calculatorStore.update('saturationTime', 'fullWell', value)} value={fullWell} />
			<NumberInput endContent="e-/s" fullWidth label="Signal Rate" minValue={0.01} onValueChange={(value) => calculatorStore.update('saturationTime', 'signalRate', value)} step={0.01} value={signalRate} />
			<NumberInput endContent="s" fractionDigits={2} fullWidth label="Saturation Time" readOnly value={time} />
		</Formula>
	)
})

const SkyLimitedExposure = memo(() => {
	const { exposure, readNoise, skyRate } = useSnapshot(calculatorStore.state.skyLimitedExposure)

	return (
		<Formula description="Estimate when sky noise dominates read noise" expression="10 * Read Noise² / Sky Rate">
			<NumberInput endContent="e-" fractionDigits={2} fullWidth label="Read Noise" minValue={0} onValueChange={(value) => calculatorStore.update('skyLimitedExposure', 'readNoise', value)} step={0.01} value={readNoise} />
			<NumberInput endContent="e-/s" fractionDigits={2} fullWidth label="Sky Rate" minValue={0.01} onValueChange={(value) => calculatorStore.update('skyLimitedExposure', 'skyRate', value)} step={0.01} value={skyRate} />
			<NumberInput endContent="s" fractionDigits={2} fullWidth label="Exposure" readOnly value={exposure} />
		</Formula>
	)
})

const TotalIntegrationTime = memo(() => {
	const { exposure, frameCount, total } = useSnapshot(calculatorStore.state.totalIntegrationTime)

	return (
		<Formula description="Calculate total integration time" expression="Frame Count * Exposure">
			<NumberInput fullWidth label="Frame Count" minValue={0} onValueChange={(value) => calculatorStore.update('totalIntegrationTime', 'frameCount', value)} value={frameCount} />
			<NumberInput endContent="s" fullWidth label="Exposure" minValue={0} onValueChange={(value) => calculatorStore.update('totalIntegrationTime', 'exposure', value)} value={exposure} />
			<NumberInput endContent="s" fullWidth label="Total Time" readOnly value={total} />
		</Formula>
	)
})

const SubframeCount = memo(() => {
	const { count, subExposure, totalTime } = useSnapshot(calculatorStore.state.subframeCount)

	return (
		<Formula description="Calculate fractional subframe count for a target integration time" expression="Total Time / Sub Exposure">
			<NumberInput endContent="s" fullWidth label="Total Time" minValue={0} onValueChange={(value) => calculatorStore.update('subframeCount', 'totalTime', value)} value={totalTime} />
			<NumberInput endContent="s" fullWidth label="Sub Exposure" minValue={0.01} onValueChange={(value) => calculatorStore.update('subframeCount', 'subExposure', value)} step={0.01} value={subExposure} />
			<NumberInput fractionDigits={2} fullWidth label="Subframes" readOnly value={count} />
		</Formula>
	)
})

const RequiredSubframeCount = memo(() => {
	const { count, subExposure, totalTime } = useSnapshot(calculatorStore.state.requiredSubframeCount)

	return (
		<Formula description="Calculate whole subframe count needed to cover a target integration time" expression="ceil(Total Time / Sub Exposure)">
			<NumberInput endContent="s" fullWidth label="Total Time" minValue={0} onValueChange={(value) => calculatorStore.update('requiredSubframeCount', 'totalTime', value)} value={totalTime} />
			<NumberInput endContent="s" fullWidth label="Sub Exposure" minValue={0.01} onValueChange={(value) => calculatorStore.update('requiredSubframeCount', 'subExposure', value)} step={0.01} value={subExposure} />
			<NumberInput fullWidth label="Required Subframes" readOnly value={count} />
		</Formula>
	)
})

const Airmass = memo(() => {
	const { airmass, zenithDistance } = useSnapshot(calculatorStore.state.airmass)

	return (
		<Formula description="Calculate simple secant airmass from zenith distance" expression="1 / cos(Zenith Distance)">
			<NumberInput endContent="deg" fractionDigits={1} fullWidth label="Zenith Distance" maxValue={MAX_ZENITH_DISTANCE} minValue={0} onValueChange={(value) => calculatorStore.update('airmass', 'zenithDistance', value)} step={0.1} value={zenithDistance} />
			<NumberInput fractionDigits={2} fullWidth label="Airmass" readOnly value={airmass} />
		</Formula>
	)
})

const AirmassKastenYoung = memo(() => {
	const { airmass, altitude } = useSnapshot(calculatorStore.state.airmassKastenYoung)

	return (
		<Formula description="Estimate airmass near the horizon with the Kasten-Young approximation" expression="1 / (sin(h) + 0.50572 * (h + 6.07995)^-1.6364)">
			<NumberInput endContent="deg" fractionDigits={1} fullWidth label="Altitude" maxValue={MAX_ALTITUDE} minValue={MIN_ALTITUDE} onValueChange={(value) => calculatorStore.update('airmassKastenYoung', 'altitude', value)} step={0.1} value={altitude} />
			<NumberInput fractionDigits={2} fullWidth label="Airmass" readOnly value={airmass} />
		</Formula>
	)
})

const AtmosphericExtinction = memo(() => {
	const { airmass, coefficient, magnitudeLoss } = useSnapshot(calculatorStore.state.atmosphericExtinction)

	return (
		<Formula description="Estimate magnitude loss from atmospheric extinction" expression="Extinction Coefficient * Airmass">
			<NumberInput endContent="mag/airmass" fractionDigits={2} fullWidth label="Coefficient" minValue={0} onValueChange={(value) => calculatorStore.update('atmosphericExtinction', 'coefficient', value)} step={0.01} value={coefficient} />
			<NumberInput fractionDigits={2} fullWidth label="Airmass" minValue={MIN_AIRMASS} onValueChange={(value) => calculatorStore.update('atmosphericExtinction', 'airmass', value)} step={0.01} value={airmass} />
			<NumberInput endContent="mag" fractionDigits={2} fullWidth label="Magnitude Loss" readOnly value={magnitudeLoss} />
		</Formula>
	)
})

const AtmosphericRefraction = memo(() => {
	const { altitude, refraction } = useSnapshot(calculatorStore.state.atmosphericRefraction)

	return (
		<Formula description="Estimate atmospheric refraction correction" expression="1.02 / tan(h + 10.3 / (h + 5.11))">
			<NumberInput endContent="deg" fractionDigits={1} fullWidth label="Altitude" maxValue={MAX_ALTITUDE} minValue={MIN_ALTITUDE} onValueChange={(value) => calculatorStore.update('atmosphericRefraction', 'altitude', value)} step={0.1} value={altitude} />
			<NumberInput endContent="arcmin" fractionDigits={2} fullWidth label="Refraction" readOnly value={refraction} />
		</Formula>
	)
})

const DewPoint = memo(() => {
	const { dewPoint, humidity, temperature } = useSnapshot(calculatorStore.state.dewPoint)

	return (
		<Formula description="Estimate dew point from ambient temperature and relative humidity" expression="Magnus: b * α / (a - α)">
			<NumberInput endContent="°C" fractionDigits={1} fullWidth label="Temperature" minValue={-100} onValueChange={(value) => calculatorStore.update('dewPoint', 'temperature', value)} step={0.1} value={temperature} />
			<NumberInput endContent="%" fullWidth label="Humidity" maxValue={MAX_HUMIDITY} minValue={MIN_HUMIDITY} onValueChange={(value) => calculatorStore.update('dewPoint', 'humidity', value)} value={humidity} />
			<NumberInput endContent="°C" fractionDigits={1} fullWidth label="Dew Point" readOnly value={dewPoint} />
		</Formula>
	)
})

const AltitudeAtTransit = memo(() => {
	const { altitude, declination, latitude } = useSnapshot(calculatorStore.state.altitudeAtTransit)

	return (
		<Formula description="Calculate object altitude at meridian transit" expression="90° - abs(Latitude - Declination)">
			<NumberInput endContent="deg" fractionDigits={1} fullWidth label="Latitude" maxValue={MAX_LATITUDE} minValue={MIN_LATITUDE} onValueChange={(value) => calculatorStore.update('altitudeAtTransit', 'latitude', value)} step={0.1} value={latitude} />
			<NumberInput endContent="deg" fractionDigits={1} fullWidth label="Declination" maxValue={MAX_DECLINATION} minValue={MIN_DECLINATION} onValueChange={(value) => calculatorStore.update('altitudeAtTransit', 'declination', value)} step={0.1} value={declination} />
			<NumberInput endContent="deg" fractionDigits={1} fullWidth label="Altitude" readOnly value={altitude} />
		</Formula>
	)
})

const ObjectAngularDiameter = memo(() => {
	const { angularDiameter, distance, objectDiameter } = useSnapshot(calculatorStore.state.objectAngularDiameter)

	return (
		<Formula description="Calculate angular diameter from object size and distance" expression="2 * atan(Diameter / (2 * Distance))">
			<NumberInput fullWidth label="Object Diameter" minValue={MIN_DISTANCE} onValueChange={(value) => calculatorStore.update('objectAngularDiameter', 'objectDiameter', value)} value={objectDiameter} />
			<NumberInput fullWidth label="Distance" minValue={MIN_DISTANCE} onValueChange={(value) => calculatorStore.update('objectAngularDiameter', 'distance', value)} value={distance} />
			<NumberInput endContent="deg" fractionDigits={3} fullWidth label="Angular Diameter" readOnly value={angularDiameter} />
		</Formula>
	)
})

const SurfaceBrightness = memo(() => {
	const { area, magnitude, surfaceBrightness } = useSnapshot(calculatorStore.state.surfaceBrightness)

	return (
		<Formula description="Estimate surface brightness from integrated magnitude and apparent area" expression="Magnitude + 2.5 * log10(Area)">
			<NumberInput fractionDigits={2} fullWidth label="Magnitude" onValueChange={(value) => calculatorStore.update('surfaceBrightness', 'magnitude', value)} step={0.1} value={magnitude} />
			<NumberInput endContent="arcsec²" fractionDigits={2} fullWidth label="Area" minValue={MIN_AREA} onValueChange={(value) => calculatorStore.update('surfaceBrightness', 'area', value)} step={0.01} value={area} />
			<NumberInput endContent="mag/arcsec²" fractionDigits={2} fullWidth label="Surface Brightness" readOnly value={surfaceBrightness} />
		</Formula>
	)
})

const CometMagnitude = memo(() => {
	const { absoluteMagnitude, activityCoefficient, delta, heliocentricDistance, magnitude } = useSnapshot(calculatorStore.state.cometMagnitude)

	return (
		<Formula description="Estimate comet apparent magnitude from distance and activity coefficient" expression="H + 5 * log10(Δ) + k * log10(r)">
			<NumberInput fractionDigits={2} fullWidth label="Absolute Magnitude" onValueChange={(value) => calculatorStore.update('cometMagnitude', 'absoluteMagnitude', value)} step={0.1} value={absoluteMagnitude} />
			<NumberInput endContent="AU" fractionDigits={3} fullWidth label="Observer Distance" minValue={MIN_DISTANCE} onValueChange={(value) => calculatorStore.update('cometMagnitude', 'delta', value)} step={0.001} value={delta} />
			<NumberInput endContent="AU" fractionDigits={3} fullWidth label="Heliocentric Distance" minValue={MIN_DISTANCE} onValueChange={(value) => calculatorStore.update('cometMagnitude', 'heliocentricDistance', value)} step={0.001} value={heliocentricDistance} />
			<NumberInput fractionDigits={2} fullWidth label="Activity Coefficient" onValueChange={(value) => calculatorStore.update('cometMagnitude', 'activityCoefficient', value)} step={0.1} value={activityCoefficient} />
			<NumberInput fractionDigits={2} fullWidth label="Magnitude" readOnly value={magnitude} />
		</Formula>
	)
})

const AsteroidMagnitude = memo(() => {
	const { absoluteMagnitude, delta, heliocentricDistance, magnitude, phaseCorrection } = useSnapshot(calculatorStore.state.asteroidMagnitude)

	return (
		<Formula description="Estimate asteroid apparent magnitude from distances and phase correction" expression="H + 5 * log10(r * Δ) + Phase">
			<NumberInput fractionDigits={2} fullWidth label="Absolute Magnitude" onValueChange={(value) => calculatorStore.update('asteroidMagnitude', 'absoluteMagnitude', value)} step={0.1} value={absoluteMagnitude} />
			<NumberInput endContent="AU" fractionDigits={3} fullWidth label="Heliocentric Distance" minValue={MIN_DISTANCE} onValueChange={(value) => calculatorStore.update('asteroidMagnitude', 'heliocentricDistance', value)} step={0.001} value={heliocentricDistance} />
			<NumberInput endContent="AU" fractionDigits={3} fullWidth label="Observer Distance" minValue={MIN_DISTANCE} onValueChange={(value) => calculatorStore.update('asteroidMagnitude', 'delta', value)} step={0.001} value={delta} />
			<NumberInput endContent="mag" fractionDigits={2} fullWidth label="Phase Correction" onValueChange={(value) => calculatorStore.update('asteroidMagnitude', 'phaseCorrection', value)} step={0.1} value={phaseCorrection} />
			<NumberInput fractionDigits={2} fullWidth label="Magnitude" readOnly value={magnitude} />
		</Formula>
	)
})

const FORMULA_TABS = [
	{ id: 'focalLength', label: 'Focal Length', Component: FocalLength },
	{ id: 'focalRatio', label: 'Focal Ratio', Component: FocalRatio },
	{ id: 'dawes', label: 'Dawes Limit', Component: DawesLimit },
	{ id: 'rayleigh', label: 'Rayleigh Limit', Component: RayleighLimit },
	{ id: 'limitingMagnitude', label: 'Limiting Magnitude', Component: LimitingMagnitude },
	{ id: 'lightGraspRatio', label: 'Light Grasp Ratio', Component: LightGraspRatio },
	{ id: 'magnification', label: 'Magnification', Component: Magnification },
	{ id: 'exitPupil', label: 'Exit Pupil', Component: ExitPupil },
	{ id: 'exitPupilByFocalRatio', label: 'Exit Pupil F/R', Component: ExitPupilByFocalRatio },
	{ id: 'eyepieceTrueFov', label: 'Eyepiece True FOV', Component: EyepieceTrueFov },
	{ id: 'plateScale', label: 'Plate Scale', Component: PlateScale },
	{ id: 'pixelScale', label: 'Pixel Scale', Component: PixelScale },
	{ id: 'samplingRatio', label: 'Sampling Ratio', Component: SamplingRatio },
	{ id: 'recommendedFocalLength', label: 'Recommended FL', Component: RecommendedFocalLength },
	{ id: 'airyDiskSize', label: 'Airy Disk Size', Component: AiryDiskSize },
	{ id: 'airyDiskInPixels', label: 'Airy Disk Pixels', Component: AiryDiskInPixels },
	{ id: 'criticalFocusZone', label: 'Critical Focus Zone', Component: CriticalFocusZone },
	{ id: 'effectiveAperture', label: 'Effective Aperture', Component: EffectiveAperture },
	{ id: 'obstructionRatio', label: 'Obstruction Ratio', Component: ObstructionRatio },
	{ id: 'sensorDiagonalFieldOfView', label: 'Sensor Diagonal FOV', Component: SensorDiagonalFieldOfView },
	{ id: 'sensorFieldOfView', label: 'Sensor FOV', Component: SensorFieldOfView },
	{ id: 'eyepieceView', label: 'Eyepiece View', Component: EyepieceView },
	{ id: 'mosaicPanelCount', label: 'Mosaic Panels', Component: MosaicPanelCount },
	{ id: 'guidingError', label: 'Guiding Error', Component: GuidingError },
	{ id: 'periodicError', label: 'Periodic Error', Component: PeriodicError },
	{ id: 'starTrailLength', label: 'Star Trail Length', Component: StarTrailLength },
	{ id: 'maxExposureBeforeTrail', label: 'Max Exposure', Component: MaxExposureBeforeTrail },
	{ id: 'signalToNoiseRatio', label: 'SNR', Component: SignalToNoiseRatio },
	{ id: 'stackingSnrGain', label: 'Stacking SNR Gain', Component: StackingSnrGain },
	{ id: 'stackingMagnitudeGain', label: 'Stacking Mag Gain', Component: StackingMagnitudeGain },
	{ id: 'dynamicRange', label: 'Dynamic Range', Component: DynamicRange },
	{ id: 'saturationTime', label: 'Saturation Time', Component: SaturationTime },
	{ id: 'skyLimitedExposure', label: 'Sky Limited Exp.', Component: SkyLimitedExposure },
	{ id: 'totalIntegrationTime', label: 'Total Integration', Component: TotalIntegrationTime },
	{ id: 'subframeCount', label: 'Subframe Count', Component: SubframeCount },
	{ id: 'requiredSubframeCount', label: 'Required Subframes', Component: RequiredSubframeCount },
	{ id: 'airmass', label: 'Airmass', Component: Airmass },
	{ id: 'airmassKastenYoung', label: 'Kasten-Young', Component: AirmassKastenYoung },
	{ id: 'atmosphericExtinction', label: 'Extinction', Component: AtmosphericExtinction },
	{ id: 'atmosphericRefraction', label: 'Refraction', Component: AtmosphericRefraction },
	{ id: 'dewPoint', label: 'Dew Point', Component: DewPoint },
	{ id: 'altitudeAtTransit', label: 'Transit Altitude', Component: AltitudeAtTransit },
	{ id: 'objectAngularDiameter', label: 'Angular Diameter', Component: ObjectAngularDiameter },
	{ id: 'surfaceBrightness', label: 'Surface Brightness', Component: SurfaceBrightness },
	{ id: 'cometMagnitude', label: 'Comet Magnitude', Component: CometMagnitude },
	{ id: 'asteroidMagnitude', label: 'Asteroid Magnitude', Component: AsteroidMagnitude },
].sort((a, b) => a.label.localeCompare(b.label))
