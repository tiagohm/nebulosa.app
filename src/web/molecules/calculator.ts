import { molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import { proxy, subscribe } from 'valtio'
import { simpleLocalStorage } from '@/shared/storage'

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

const state = proxy<CalculatorState>({
	show: false,
	focalLength: simpleLocalStorage.get<FocalLengthRatio>('calculator.focalLength', () => ({ focalLength: 1368, aperture: 152, focalRatio: 9 })),
	focalRatio: simpleLocalStorage.get<FocalLengthRatio>('calculator.focalRatio', () => ({ focalLength: 1368, aperture: 152, focalRatio: 9 })),
	dawesLimit: simpleLocalStorage.get<ResolutionLimit>('calculator.dawesLimit', () => ({ aperture: 152, resolution: 0.763 })),
	rayleighLimit: simpleLocalStorage.get<ResolutionLimit>('calculator.rayleighLimit', () => ({ aperture: 152, resolution: 0.908 })),
	limitingMagnitude: simpleLocalStorage.get<LimitingMagnitude>('calculator.limitingMagnitude', () => ({ aperture: 152, magnitude: 13.609 })),
	lightGraspRatio: simpleLocalStorage.get<LightGraspRatio>('calculator.lightGraspRatio', () => ({ smallerAperture: 7, largerAperture: 152, ratio: 471.51 })),
	ccdResolution: simpleLocalStorage.get<CcdResolution>('calculator.ccdResolution', () => ({ pixelSize: 4.63, focalLength: 1368, resolution: 0.698 })),
})

function subscribeTo(property: keyof Omit<CalculatorState, 'show'>) {
	return subscribe(state[property], () => simpleLocalStorage.set(`calculator.${property}`, state[property]))
}

export const CalculatorMolecule = molecule(() => {
	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function hide() {
		state.show = false
	}

	function update<P extends keyof Omit<CalculatorState, 'show'>, K extends keyof CalculatorState[P]>(property: P, key: K, value: CalculatorState[P][K]) {
		state[property][key] = value

		if (property === 'focalLength') state.focalLength.focalLength = state.focalLength.aperture * state.focalLength.focalRatio
		else if (property === 'focalRatio') state.focalRatio.focalRatio = state.focalRatio.focalLength / state.focalRatio.aperture
		else if (property === 'dawesLimit') state.dawesLimit.resolution = 116 / state.dawesLimit.aperture
		else if (property === 'rayleighLimit') state.rayleighLimit.resolution = 138 / state.rayleighLimit.aperture
		else if (property === 'limitingMagnitude') state.limitingMagnitude.magnitude = 2.7 + 5 * Math.log10(state.limitingMagnitude.aperture)
		else if (property === 'lightGraspRatio') state.lightGraspRatio.ratio = (state.lightGraspRatio.largerAperture / state.lightGraspRatio.smallerAperture) ** 2
		else if (property === 'ccdResolution') state.ccdResolution.resolution = (state.ccdResolution.pixelSize / state.ccdResolution.focalLength) * 206.265
	}

	onMount(() => {
		const unsubscribers = (Object.keys(state) as Array<keyof CalculatorState>).filter((e) => e !== 'show').map(subscribeTo)

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	return { state, show, hide, update } as const
})
