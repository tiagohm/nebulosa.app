import { proxy } from 'valtio'
import { initProxy } from '@/shared/proxy'

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

export interface CalculatorState {
	show: boolean
	readonly focalLength: FocalLengthRatio
	readonly focalRatio: FocalLengthRatio
	readonly dawesLimit: ResolutionLimit
	readonly rayleighLimit: ResolutionLimit
	readonly limitingMagnitude: LimitingMagnitude
	readonly lightGraspRatio: LightGraspRatio
	readonly ccdResolution: CcdResolution
}

const CALCULATOR_SECTIONS = ['focalLength', 'focalRatio', 'dawesLimit', 'rayleighLimit', 'limitingMagnitude', 'lightGraspRatio', 'ccdResolution'] as const

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
})

initProxy(state, 'calculator', ['p:show', 'o:focalLength', 'o:focalRatio', 'o:dawesLimit', 'o:rayleighLimit', 'o:limitingMagnitude', 'o:lightGraspRatio', 'o:ccdResolution'])

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

export const calculator = {
	state,
	show,
	hide,
	update,
} as const
