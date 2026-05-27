import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'

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

export interface CcdResolution {
	pixelSize: number
	focalLength: number
	resolution: number
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

export interface DewPoint {
	temperature: number
	humidity: number
	dewPoint: number
}

export interface CalculatorState {
	show: boolean
	readonly focalLength: FocalLengthRatio
	readonly focalRatio: FocalLengthRatio
	readonly dawesLimit: ResolutionLimit
	readonly rayleighLimit: ResolutionLimit
	readonly limitingMagnitude: LimitingMagnitude
	readonly lightGraspRatio: LightGraspRatio
	readonly ccdResolution: CcdResolution
	readonly sensorFieldOfView: SensorFieldOfView
	readonly eyepieceView: EyepieceView
	readonly dewPoint: DewPoint
}

const CALCULATOR_SECTIONS = ['focalLength', 'focalRatio', 'dawesLimit', 'rayleighLimit', 'limitingMagnitude', 'lightGraspRatio', 'ccdResolution', 'sensorFieldOfView', 'eyepieceView', 'dewPoint'] as const

type CalculatorSection = (typeof CALCULATOR_SECTIONS)[number]

const state = proxy<CalculatorState>({
	show: false,
	focalLength: { focalLength: 1368, aperture: 152, focalRatio: 9 },
	focalRatio: { focalLength: 1368, aperture: 152, focalRatio: 9 },
	dawesLimit: { aperture: 152, resolution: 0.763 },
	rayleighLimit: { aperture: 152, resolution: 0.908 },
	limitingMagnitude: { aperture: 152, magnitude: 13.609 },
	lightGraspRatio: { smallerAperture: 7, largerAperture: 152, ratio: 471.51 },
	ccdResolution: { pixelSize: 4.63, focalLength: 1368, resolution: 0.698 },
	sensorFieldOfView: { sensorWidth: 22.3, sensorHeight: 14.9, focalLength: 1368, width: 0.933, height: 0.624 },
	eyepieceView: { aperture: 152, telescopeFocalLength: 1368, eyepieceFocalLength: 25, apparentField: 52, magnification: 54.72, trueField: 0.95, exitPupil: 2.78 },
	dewPoint: { temperature: 10, humidity: 80, dewPoint: 6.71 },
})

initProxy(state, 'calculator', ['p:show', 'o:focalLength', 'o:focalRatio', 'o:dawesLimit', 'o:rayleighLimit', 'o:limitingMagnitude', 'o:lightGraspRatio', 'o:ccdResolution', 'o:sensorFieldOfView', 'o:eyepieceView', 'o:dewPoint'])

function finiteOrZero(value: number) {
	return Number.isFinite(value) ? value : 0
}

function positive(value: number) {
	return Number.isFinite(value) && value > 0 ? value : 0
}

function divideOrZero(dividend: number, divisor: number) {
	const denominator = positive(divisor)
	return denominator > 0 ? positive(dividend) / denominator : 0
}

function refreshDerivedValue(property: CalculatorSection) {
	if (property === 'focalLength') state.focalLength.focalLength = positive(state.focalLength.aperture) * positive(state.focalLength.focalRatio)
	else if (property === 'focalRatio') state.focalRatio.focalRatio = divideOrZero(state.focalRatio.focalLength, state.focalRatio.aperture)
	else if (property === 'dawesLimit') state.dawesLimit.resolution = divideOrZero(116, state.dawesLimit.aperture)
	else if (property === 'rayleighLimit') state.rayleighLimit.resolution = divideOrZero(138, state.rayleighLimit.aperture)
	else if (property === 'limitingMagnitude') state.limitingMagnitude.magnitude = positive(state.limitingMagnitude.aperture) > 0 ? 2.7 + 5 * Math.log10(state.limitingMagnitude.aperture) : 0
	else if (property === 'lightGraspRatio') state.lightGraspRatio.ratio = divideOrZero(state.lightGraspRatio.largerAperture, state.lightGraspRatio.smallerAperture) ** 2
	else if (property === 'ccdResolution') state.ccdResolution.resolution = divideOrZero(state.ccdResolution.pixelSize, state.ccdResolution.focalLength) * 206.265
	else if (property === 'sensorFieldOfView') {
		state.sensorFieldOfView.width = divideOrZero(state.sensorFieldOfView.sensorWidth, state.sensorFieldOfView.focalLength) * 57.2958
		state.sensorFieldOfView.height = divideOrZero(state.sensorFieldOfView.sensorHeight, state.sensorFieldOfView.focalLength) * 57.2958
	} else if (property === 'eyepieceView') {
		state.eyepieceView.magnification = divideOrZero(state.eyepieceView.telescopeFocalLength, state.eyepieceView.eyepieceFocalLength)
		state.eyepieceView.trueField = divideOrZero(state.eyepieceView.apparentField, state.eyepieceView.magnification)
		state.eyepieceView.exitPupil = divideOrZero(state.eyepieceView.aperture, state.eyepieceView.magnification)
	} else if (property === 'dewPoint') {
		const temperature = finiteOrZero(state.dewPoint.temperature)
		const humidity = Math.min(Math.max(positive(state.dewPoint.humidity), 1), 100)
		const gamma = 243.04 + temperature > 0 ? Math.log(humidity / 100) + (17.625 * temperature) / (243.04 + temperature) : 0
		const denominator = 17.625 - gamma
		state.dewPoint.dewPoint = denominator !== 0 && Number.isFinite(gamma) ? (243.04 * gamma) / denominator : 0
	}
}

function refreshDerivedValues() {
	for (const property of CALCULATOR_SECTIONS) refreshDerivedValue(property)
}

refreshDerivedValues()

function update<P extends keyof Omit<CalculatorState, 'show'>, K extends keyof CalculatorState[P]>(property: P, key: K, value: CalculatorState[P][K]) {
	state[property][key] = value
	refreshDerivedValue(property)
}

function show() {
	state.show = true
}

function hide() {
	state.show = false
}

export const calculatorStore = {
	state,
	show,
	hide,
	update,
} as const
