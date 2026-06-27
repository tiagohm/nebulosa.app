import * as formulas from 'nebulosa/src/astronomy/formulas'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { initProxy, type ProxyProperties } from '@/shared/proxy'

export type CalculatorStore = typeof calculatorStore

export interface FocalLengthRatio {
	aperture: number
	focalRatio: number
	focalLength: number
}

export interface ResolutionLimit {
	aperture: number
	resolution: number
}

export interface LimitingMagnitude {
	aperture: number
	magnitude: number
}

export interface LightGraspRatio {
	smallerAperture: number
	largerAperture: number
	ratio: number
}

export interface Magnification {
	telescopeFocalLength: number
	eyepieceFocalLength: number
	magnification: number
}

export interface ExitPupil {
	aperture: number
	magnification: number
	exitPupil: number
}

export interface ExitPupilByFocalRatio {
	eyepieceFocalLength: number
	focalRatio: number
	exitPupil: number
}

export interface EyepieceTrueFov {
	fieldStop: number
	telescopeFocalLength: number
	trueField: number
}

export interface PlateScale {
	focalLength: number
	scale: number
}

export interface PixelScale {
	pixelSize: number
	focalLength: number
	resolution: number
}

export interface SamplingRatio {
	seeing: number
	pixelScale: number
	ratio: number
}

export interface RecommendedFocalLength {
	pixelSize: number
	targetSampling: number
	seeing: number
	focalLength: number
}

export interface AiryDiskSize {
	wavelength: number
	focalRatio: number
	diameter: number
}

export interface AiryDiskInPixels {
	airyDiameter: number
	pixelSize: number
	diameter: number
}

export interface CriticalFocusZone {
	wavelength: number
	focalRatio: number
	zone: number
}

export interface EffectiveAperture {
	aperture: number
	obstruction: number
	effectiveAperture: number
}

export interface ObstructionRatio {
	aperture: number
	obstruction: number
	ratio: number
}

export interface SensorDiagonalFieldOfView {
	sensorDiagonal: number
	focalLength: number
	fieldOfView: number
}

export interface SensorFieldOfView {
	sensorWidth: number
	sensorHeight: number
	focalLength: number
	width: number
	height: number
}

export interface EyepieceView {
	aperture: number
	telescopeFocalLength: number
	eyepieceFocalLength: number
	apparentField: number
	magnification: number
	trueField: number
	exitPupil: number
}

export interface MosaicPanelCount {
	targetField: number
	cameraField: number
	overlap: number
	panels: number
}

export interface GuidingError {
	rms: number
	imageScale: number
	error: number
}

export interface PeriodicError {
	periodicError: number
	imageScale: number
	error: number
}

export interface StarTrailLength {
	declination: number
	exposure: number
	imageScale: number
	trail: number
}

export interface MaxExposureBeforeTrail {
	trailLimit: number
	imageScale: number
	declination: number
	exposure: number
}

export interface SignalToNoiseRatio {
	signal: number
	pixelCount: number
	background: number
	darkCurrent: number
	readNoise: number
	ratio: number
}

export interface StackingSnrGain {
	frameCount: number
	gain: number
}

export interface StackingMagnitudeGain {
	frameCount: number
	gain: number
}

export interface DynamicRange {
	fullWell: number
	readNoise: number
	range: number
	stops: number
}

export interface SaturationTime {
	fullWell: number
	signalRate: number
	time: number
}

export interface SkyLimitedExposure {
	readNoise: number
	skyRate: number
	exposure: number
}

export interface TotalIntegrationTime {
	frameCount: number
	exposure: number
	total: number
}

export interface SubframeCount {
	totalTime: number
	subExposure: number
	count: number
}

export interface RequiredSubframeCount {
	totalTime: number
	subExposure: number
	count: number
}

export interface Airmass {
	zenithDistance: number
	airmass: number
}

export interface AirmassKastenYoung {
	altitude: number
	airmass: number
}

export interface AtmosphericExtinction {
	coefficient: number
	airmass: number
	magnitudeLoss: number
}

export interface AtmosphericRefraction {
	altitude: number
	refraction: number
}

export interface DewPoint {
	temperature: number
	humidity: number
	dewPoint: number
}

export interface AltitudeAtTransit {
	latitude: number
	declination: number
	altitude: number
}

export interface ObjectAngularDiameter {
	objectDiameter: number
	distance: number
	angularDiameter: number
}

export interface SurfaceBrightness {
	magnitude: number
	area: number
	surfaceBrightness: number
}

export interface CometMagnitude {
	absoluteMagnitude: number
	delta: number
	heliocentricDistance: number
	activityCoefficient: number
	magnitude: number
}

export interface AsteroidMagnitude {
	absoluteMagnitude: number
	heliocentricDistance: number
	delta: number
	phaseCorrection: number
	magnitude: number
}

export interface CalculatorState {
	show: boolean
	favorites: CalculatorSection[]
	readonly focalLength: FocalLengthRatio
	readonly focalRatio: FocalLengthRatio
	readonly dawesLimit: ResolutionLimit
	readonly rayleighLimit: ResolutionLimit
	readonly limitingMagnitude: LimitingMagnitude
	readonly lightGraspRatio: LightGraspRatio
	readonly magnification: Magnification
	readonly exitPupil: ExitPupil
	readonly exitPupilByFocalRatio: ExitPupilByFocalRatio
	readonly eyepieceTrueFov: EyepieceTrueFov
	readonly plateScale: PlateScale
	readonly pixelScale: PixelScale
	readonly samplingRatio: SamplingRatio
	readonly recommendedFocalLength: RecommendedFocalLength
	readonly airyDiskSize: AiryDiskSize
	readonly airyDiskInPixels: AiryDiskInPixels
	readonly criticalFocusZone: CriticalFocusZone
	readonly effectiveAperture: EffectiveAperture
	readonly obstructionRatio: ObstructionRatio
	readonly sensorDiagonalFieldOfView: SensorDiagonalFieldOfView
	readonly sensorFieldOfView: SensorFieldOfView
	readonly eyepieceView: EyepieceView
	readonly mosaicPanelCount: MosaicPanelCount
	readonly guidingError: GuidingError
	readonly periodicError: PeriodicError
	readonly starTrailLength: StarTrailLength
	readonly maxExposureBeforeTrail: MaxExposureBeforeTrail
	readonly signalToNoiseRatio: SignalToNoiseRatio
	readonly stackingSnrGain: StackingSnrGain
	readonly stackingMagnitudeGain: StackingMagnitudeGain
	readonly dynamicRange: DynamicRange
	readonly saturationTime: SaturationTime
	readonly skyLimitedExposure: SkyLimitedExposure
	readonly totalIntegrationTime: TotalIntegrationTime
	readonly subframeCount: SubframeCount
	readonly requiredSubframeCount: RequiredSubframeCount
	readonly airmass: Airmass
	readonly airmassKastenYoung: AirmassKastenYoung
	readonly atmosphericExtinction: AtmosphericExtinction
	readonly atmosphericRefraction: AtmosphericRefraction
	readonly dewPoint: DewPoint
	readonly altitudeAtTransit: AltitudeAtTransit
	readonly objectAngularDiameter: ObjectAngularDiameter
	readonly surfaceBrightness: SurfaceBrightness
	readonly cometMagnitude: CometMagnitude
	readonly asteroidMagnitude: AsteroidMagnitude
}

const CALCULATOR_SECTIONS = [
	'focalLength',
	'focalRatio',
	'dawesLimit',
	'rayleighLimit',
	'limitingMagnitude',
	'lightGraspRatio',
	'magnification',
	'exitPupil',
	'exitPupilByFocalRatio',
	'eyepieceTrueFov',
	'plateScale',
	'pixelScale',
	'samplingRatio',
	'recommendedFocalLength',
	'airyDiskSize',
	'airyDiskInPixels',
	'criticalFocusZone',
	'effectiveAperture',
	'obstructionRatio',
	'sensorDiagonalFieldOfView',
	'sensorFieldOfView',
	'eyepieceView',
	'mosaicPanelCount',
	'guidingError',
	'periodicError',
	'starTrailLength',
	'maxExposureBeforeTrail',
	'signalToNoiseRatio',
	'stackingSnrGain',
	'stackingMagnitudeGain',
	'dynamicRange',
	'saturationTime',
	'skyLimitedExposure',
	'totalIntegrationTime',
	'subframeCount',
	'requiredSubframeCount',
	'airmass',
	'airmassKastenYoung',
	'atmosphericExtinction',
	'atmosphericRefraction',
	'dewPoint',
	'altitudeAtTransit',
	'objectAngularDiameter',
	'surfaceBrightness',
	'cometMagnitude',
	'asteroidMagnitude',
] as const

type CalculatorSection = (typeof CALCULATOR_SECTIONS)[number]

const state = proxy<CalculatorState>({
	show: false,
	favorites: [],
	focalLength: { aperture: 152, focalRatio: 9, focalLength: 1368 },
	focalRatio: { focalLength: 1368, aperture: 152, focalRatio: 9 },
	dawesLimit: { aperture: 152, resolution: 0.763 },
	rayleighLimit: { aperture: 152, resolution: 0.908 },
	limitingMagnitude: { aperture: 152, magnitude: 13.609 },
	lightGraspRatio: { smallerAperture: 7, largerAperture: 152, ratio: 471.51 },
	magnification: { telescopeFocalLength: 1368, eyepieceFocalLength: 25, magnification: 54.72 },
	exitPupil: { aperture: 152, magnification: 54.72, exitPupil: 2.78 },
	exitPupilByFocalRatio: { eyepieceFocalLength: 25, focalRatio: 9, exitPupil: 2.78 },
	eyepieceTrueFov: { fieldStop: 27, telescopeFocalLength: 1368, trueField: 1.13 },
	plateScale: { focalLength: 1368, scale: 150.78 },
	pixelScale: { pixelSize: 4.63, focalLength: 1368, resolution: 0.698 },
	samplingRatio: { seeing: 2, pixelScale: 0.698, ratio: 2.87 },
	recommendedFocalLength: { pixelSize: 4.63, targetSampling: 2, seeing: 2, focalLength: 954.41 },
	airyDiskSize: { wavelength: 0.55, focalRatio: 9, diameter: 12.08 },
	airyDiskInPixels: { airyDiameter: 12.08, pixelSize: 4.63, diameter: 2.61 },
	criticalFocusZone: { wavelength: 0.55, focalRatio: 9, zone: 217.4 },
	effectiveAperture: { aperture: 152, obstruction: 48, effectiveAperture: 144.23 },
	obstructionRatio: { aperture: 152, obstruction: 48, ratio: 31.58 },
	sensorDiagonalFieldOfView: { sensorDiagonal: 26.83, focalLength: 1368, fieldOfView: 1.12 },
	sensorFieldOfView: { sensorWidth: 22.3, sensorHeight: 14.9, focalLength: 1368, width: 0.933, height: 0.624 },
	eyepieceView: { aperture: 152, telescopeFocalLength: 1368, eyepieceFocalLength: 25, apparentField: 52, magnification: 54.72, trueField: 0.95, exitPupil: 2.78 },
	mosaicPanelCount: { targetField: 3, cameraField: 0.93, overlap: 20, panels: 5 },
	guidingError: { rms: 0.7, imageScale: 0.698, error: 1 },
	periodicError: { periodicError: 20, imageScale: 0.698, error: 28.65 },
	starTrailLength: { declination: 0, exposure: 30, imageScale: 0.698, trail: 646.46 },
	maxExposureBeforeTrail: { trailLimit: 2, imageScale: 0.698, declination: 0, exposure: 0.09 },
	signalToNoiseRatio: { signal: 1000, pixelCount: 20, background: 10, darkCurrent: 0.2, readNoise: 1.5, ratio: 27.41 },
	stackingSnrGain: { frameCount: 16, gain: 4 },
	stackingMagnitudeGain: { frameCount: 16, gain: 1.51 },
	dynamicRange: { fullWell: 50000, readNoise: 1.5, range: 33333.33, stops: 15.02 },
	saturationTime: { fullWell: 50000, signalRate: 2500, time: 20 },
	skyLimitedExposure: { readNoise: 1.5, skyRate: 0.5, exposure: 45 },
	totalIntegrationTime: { frameCount: 120, exposure: 60, total: 7200 },
	subframeCount: { totalTime: 7200, subExposure: 60, count: 120 },
	requiredSubframeCount: { totalTime: 7200, subExposure: 60, count: 120 },
	airmass: { zenithDistance: 30, airmass: 1.15 },
	airmassKastenYoung: { altitude: 45, airmass: 1.41 },
	atmosphericExtinction: { coefficient: 0.2, airmass: 1.5, magnitudeLoss: 0.3 },
	atmosphericRefraction: { altitude: 45, refraction: 1.01 },
	dewPoint: { temperature: 10, humidity: 80, dewPoint: 6.71 },
	altitudeAtTransit: { latitude: -23.5, declination: -30, altitude: 83.5 },
	objectAngularDiameter: { objectDiameter: 3474, distance: 384400, angularDiameter: 0.52 },
	surfaceBrightness: { magnitude: 8, area: 3600, surfaceBrightness: 16.89 },
	cometMagnitude: { absoluteMagnitude: 6, delta: 1, heliocentricDistance: 1.5, activityCoefficient: 10, magnitude: 7.76 },
	asteroidMagnitude: { absoluteMagnitude: 12, heliocentricDistance: 2, delta: 1.5, phaseCorrection: 0.3, magnitude: 14.69 },
})

initProxy(state, 'calculator', ['p:show', 'o:favorites', ...CALCULATOR_SECTIONS.map((section) => `o:${section}` as ProxyProperties<typeof state>)])

function refreshDerivedValue(property: CalculatorSection) {
	switch (property) {
		case 'focalLength':
			state.focalLength.focalLength = formulas.focalLength(state.focalLength.aperture, state.focalLength.focalRatio)
			break
		case 'focalRatio':
			state.focalRatio.focalRatio = formulas.focalRatio(state.focalRatio.focalLength, state.focalRatio.aperture)
			break
		case 'dawesLimit':
			state.dawesLimit.resolution = formulas.dawesLimit(state.dawesLimit.aperture)
			break
		case 'rayleighLimit':
			state.rayleighLimit.resolution = formulas.rayleighLimit(state.rayleighLimit.aperture)
			break
		case 'limitingMagnitude':
			state.limitingMagnitude.magnitude = formulas.limitingMagnitude(state.limitingMagnitude.aperture)
			break
		case 'lightGraspRatio':
			state.lightGraspRatio.ratio = formulas.lightGraspRatio(state.lightGraspRatio.largerAperture, state.lightGraspRatio.smallerAperture)
			break
		case 'magnification':
			state.magnification.magnification = formulas.magnification(state.magnification.telescopeFocalLength, state.magnification.eyepieceFocalLength)
			break
		case 'exitPupil':
			state.exitPupil.exitPupil = formulas.exitPupilFromApertureAndMagnification(state.exitPupil.aperture, state.exitPupil.magnification)
			break
		case 'exitPupilByFocalRatio':
			state.exitPupilByFocalRatio.exitPupil = formulas.exitPupilFromEyepieceAndFocalRatio(state.exitPupilByFocalRatio.eyepieceFocalLength, state.exitPupilByFocalRatio.focalRatio)
			break
		case 'eyepieceTrueFov':
			state.eyepieceTrueFov.trueField = formulas.eyepieceTrueFovViaFieldStop(state.eyepieceTrueFov.fieldStop, state.eyepieceTrueFov.telescopeFocalLength)
			break
		case 'plateScale':
			state.plateScale.scale = formulas.plateScale(state.plateScale.focalLength)
			break
		case 'pixelScale':
			state.pixelScale.resolution = formulas.pixelScale(state.pixelScale.pixelSize, state.pixelScale.focalLength)
			break
		case 'samplingRatio':
			state.samplingRatio.ratio = formulas.samplingRatio(state.samplingRatio.seeing, state.samplingRatio.pixelScale)
			break
		case 'recommendedFocalLength':
			state.recommendedFocalLength.focalLength = formulas.recommendedFocalLength(state.recommendedFocalLength.pixelSize, state.recommendedFocalLength.targetSampling, state.recommendedFocalLength.seeing)
			break
		case 'airyDiskSize':
			state.airyDiskSize.diameter = formulas.airyDiskSize(state.airyDiskSize.wavelength, state.airyDiskSize.focalRatio)
			break
		case 'airyDiskInPixels':
			state.airyDiskInPixels.diameter = formulas.airyDiskInPixels(state.airyDiskInPixels.airyDiameter, state.airyDiskInPixels.pixelSize)
			break
		case 'criticalFocusZone':
			state.criticalFocusZone.zone = formulas.criticalFocusZone(state.criticalFocusZone.wavelength, state.criticalFocusZone.focalRatio)
			break
		case 'effectiveAperture':
			state.effectiveAperture.effectiveAperture = formulas.effectiveApertureWithObstruction(state.effectiveAperture.aperture, state.effectiveAperture.obstruction)
			break
		case 'obstructionRatio':
			state.obstructionRatio.ratio = formulas.obstructionRatio(state.obstructionRatio.aperture, state.obstructionRatio.obstruction)
			break
		case 'sensorDiagonalFieldOfView':
			state.sensorDiagonalFieldOfView.fieldOfView = toDeg(formulas.sensorDiagonalFov(state.sensorDiagonalFieldOfView.sensorDiagonal, state.sensorDiagonalFieldOfView.focalLength))
			break
		case 'sensorFieldOfView':
			state.sensorFieldOfView.width = formulas.sensorFieldOfView(state.sensorFieldOfView.sensorWidth, state.sensorFieldOfView.focalLength)
			state.sensorFieldOfView.height = formulas.sensorFieldOfView(state.sensorFieldOfView.sensorHeight, state.sensorFieldOfView.focalLength)
			break
		case 'eyepieceView':
			Object.assign(state.eyepieceView, formulas.eyepieceView(state.eyepieceView.telescopeFocalLength, state.eyepieceView.aperture, state.eyepieceView.eyepieceFocalLength, state.eyepieceView.apparentField))
			break
		case 'mosaicPanelCount':
			state.mosaicPanelCount.panels = formulas.mosaicPanelCount(state.mosaicPanelCount.targetField, state.mosaicPanelCount.cameraField, state.mosaicPanelCount.overlap / 100)
			break
		case 'guidingError':
			state.guidingError.error = formulas.guidingErrorInPixels(state.guidingError.rms, state.guidingError.imageScale)
			break
		case 'periodicError':
			state.periodicError.error = formulas.periodicErrorInPixels(state.periodicError.periodicError, state.periodicError.imageScale)
			break
		case 'starTrailLength':
			state.starTrailLength.trail = formulas.starTrailLength(deg(state.starTrailLength.declination), state.starTrailLength.exposure, state.starTrailLength.imageScale)
			break
		case 'maxExposureBeforeTrail':
			state.maxExposureBeforeTrail.exposure = formulas.maxExposureBeforeTrail(state.maxExposureBeforeTrail.trailLimit, state.maxExposureBeforeTrail.imageScale, deg(state.maxExposureBeforeTrail.declination))
			break
		case 'signalToNoiseRatio':
			state.signalToNoiseRatio.ratio = formulas.signalToNoiseRatio(state.signalToNoiseRatio.signal, state.signalToNoiseRatio.pixelCount, state.signalToNoiseRatio.background, state.signalToNoiseRatio.darkCurrent, state.signalToNoiseRatio.readNoise)
			break
		case 'stackingSnrGain':
			state.stackingSnrGain.gain = formulas.stackingSnrGain(state.stackingSnrGain.frameCount)
			break
		case 'stackingMagnitudeGain':
			state.stackingMagnitudeGain.gain = formulas.stackingMagnitudeGain(state.stackingMagnitudeGain.frameCount)
			break
		case 'dynamicRange':
			state.dynamicRange.range = formulas.dynamicRange(state.dynamicRange.fullWell, state.dynamicRange.readNoise)
			state.dynamicRange.stops = formulas.dynamicRangeInStops(state.dynamicRange.fullWell, state.dynamicRange.readNoise)
			break
		case 'saturationTime':
			state.saturationTime.time = formulas.saturationTime(state.saturationTime.fullWell, state.saturationTime.signalRate)
			break
		case 'skyLimitedExposure':
			state.skyLimitedExposure.exposure = formulas.skyLimitedExposure(state.skyLimitedExposure.readNoise, state.skyLimitedExposure.skyRate)
			break
		case 'totalIntegrationTime':
			state.totalIntegrationTime.total = formulas.totalIntegrationTime(state.totalIntegrationTime.frameCount, state.totalIntegrationTime.exposure)
			break
		case 'subframeCount':
			state.subframeCount.count = formulas.subframeCount(state.subframeCount.totalTime, state.subframeCount.subExposure)
			break
		case 'requiredSubframeCount':
			state.requiredSubframeCount.count = formulas.requiredSubframeCount(state.requiredSubframeCount.totalTime, state.requiredSubframeCount.subExposure)
			break
		case 'airmass':
			state.airmass.airmass = formulas.airmass(deg(state.airmass.zenithDistance))
			break
		case 'airmassKastenYoung':
			state.airmassKastenYoung.airmass = formulas.airmassKastenYoung(deg(state.airmassKastenYoung.altitude))
			break
		case 'atmosphericExtinction':
			state.atmosphericExtinction.magnitudeLoss = formulas.atmosphericExtinction(state.atmosphericExtinction.coefficient, state.atmosphericExtinction.airmass)
			break
		case 'atmosphericRefraction':
			state.atmosphericRefraction.refraction = formulas.atmosphericRefraction(deg(state.atmosphericRefraction.altitude))
			break
		case 'dewPoint':
			state.dewPoint.dewPoint = formulas.dewPoint(state.dewPoint.temperature, state.dewPoint.humidity)
			break
		case 'altitudeAtTransit':
			state.altitudeAtTransit.altitude = toDeg(formulas.altitudeAtTransit(deg(state.altitudeAtTransit.latitude), deg(state.altitudeAtTransit.declination)))
			break
		case 'objectAngularDiameter':
			state.objectAngularDiameter.angularDiameter = toDeg(formulas.objectAngularDiameter(state.objectAngularDiameter.objectDiameter, state.objectAngularDiameter.distance))
			break
		case 'surfaceBrightness':
			state.surfaceBrightness.surfaceBrightness = formulas.surfaceBrightness(state.surfaceBrightness.magnitude, state.surfaceBrightness.area)
			break
		case 'cometMagnitude':
			state.cometMagnitude.magnitude = formulas.cometMagnitudeEstimate(state.cometMagnitude.absoluteMagnitude, state.cometMagnitude.delta, state.cometMagnitude.heliocentricDistance, state.cometMagnitude.activityCoefficient)
			break
		case 'asteroidMagnitude':
			state.asteroidMagnitude.magnitude = formulas.asteroidMagnitudeEstimate(state.asteroidMagnitude.absoluteMagnitude, state.asteroidMagnitude.heliocentricDistance, state.asteroidMagnitude.delta, state.asteroidMagnitude.phaseCorrection)
			break
	}
}

function refreshDerivedValues() {
	for (const property of CALCULATOR_SECTIONS) refreshDerivedValue(property)
}

refreshDerivedValues()

function update<P extends CalculatorSection, K extends keyof CalculatorState[P]>(property: P, key: K, value: CalculatorState[P][K]) {
	state[property][key] = value
	refreshDerivedValue(property)
}

function toggleFavorite(section: CalculatorSection) {
	const index = state.favorites.indexOf(section)

	if (index === -1) {
		state.favorites.push(section)
	} else {
		state.favorites.splice(index, 1)
	}
}

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

export const calculatorStore = {
	state,
	toggleFavorite,
	show,
	hide,
	update,
} as const
