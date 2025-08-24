import { molecule, onMount } from 'bunshi'
import { proxy, subscribe } from 'valtio'
import { simpleLocalStorage } from '@/shared/storage'
import { HomeMolecule } from './home'

export interface CalculatorState {
	show: boolean
	readonly focalLength: {
		aperture: number
		focalRatio: number
		focalLength: number
	}
	readonly focalRatio: {
		focalLength: number
		aperture: number
		focalRatio: number
	}
	readonly dawes: {
		aperture: number
		resolution: number
	}
	readonly rayleigh: {
		aperture: number
		resolution: number
	}
	readonly limitingMagnitude: {
		aperture: number
		magnitude: number
	}
	readonly lightGraspRatio: {
		smallerAperture: number
		largerAperture: number
		ratio: number
	}
	readonly ccdResolution: {
		pixelSize: number
		focalLength: number
		resolution: number
	}
}

export const CalculatorMolecule = molecule((m) => {
	const home = m(HomeMolecule)

	const state = proxy<CalculatorState>({
		show: false,
		focalLength: simpleLocalStorage.get<CalculatorState['focalLength']>('calculator.focalLength', () => ({ focalLength: 1368, aperture: 152, focalRatio: 9 })),
		focalRatio: simpleLocalStorage.get<CalculatorState['focalRatio']>('calculator.focalRatio', () => ({ focalLength: 1368, aperture: 152, focalRatio: 9 })),
		dawes: simpleLocalStorage.get<CalculatorState['dawes']>('calculator.dawes', () => ({ aperture: 152, resolution: 0.763 })),
		rayleigh: simpleLocalStorage.get<CalculatorState['rayleigh']>('calculator.rayleigh', () => ({ aperture: 152, resolution: 0.908 })),
		limitingMagnitude: simpleLocalStorage.get<CalculatorState['limitingMagnitude']>('calculator.limitingMagnitude', () => ({ aperture: 152, magnitude: 13.609 })),
		lightGraspRatio: simpleLocalStorage.get<CalculatorState['lightGraspRatio']>('calculator.lightGraspRatio', () => ({ smallerAperture: 7, largerAperture: 152, ratio: 471.51 })),
		ccdResolution: simpleLocalStorage.get<CalculatorState['ccdResolution']>('calculator.ccdResolution', () => ({ pixelSize: 4.63, focalLength: 1368, resolution: 0.698 })),
	})

	onMount(() => {
		const unsubscriber = subscribe(state, () => {
			simpleLocalStorage.set('calculator.focalLength', state.focalLength)
			simpleLocalStorage.set('calculator.focalRatio', state.focalRatio)
			simpleLocalStorage.set('calculator.dawes', state.dawes)
			simpleLocalStorage.set('calculator.rayleigh', state.rayleigh)
			simpleLocalStorage.set('calculator.limitingMagnitude', state.limitingMagnitude)
			simpleLocalStorage.set('calculator.lightGraspRatio', state.lightGraspRatio)
			simpleLocalStorage.set('calculator.ccdResolution', state.ccdResolution)
		})

		return () => unsubscriber()
	})

	function show() {
		home.toggleMenu(false)
		state.show = true
	}

	function close() {
		state.show = false
	}

	function update<P extends keyof Omit<CalculatorState, 'show'>, K extends keyof CalculatorState[P]>(property: P, key: K, value: CalculatorState[P][K]) {
		state[property][key] = value

		if (property === 'focalLength') state.focalLength.focalLength = state.focalLength.aperture * state.focalLength.focalRatio
		else if (property === 'focalRatio') state.focalRatio.focalRatio = state.focalRatio.focalLength / state.focalRatio.aperture
		else if (property === 'dawes') state.dawes.resolution = 116 / state.dawes.aperture
		else if (property === 'rayleigh') state.rayleigh.resolution = 138 / state.rayleigh.aperture
		else if (property === 'limitingMagnitude') state.limitingMagnitude.magnitude = 2.7 + 5 * Math.log10(state.limitingMagnitude.aperture)
		else if (property === 'lightGraspRatio') state.lightGraspRatio.ratio = (state.lightGraspRatio.largerAperture / state.lightGraspRatio.smallerAperture) ** 2
		else if (property === 'ccdResolution') state.ccdResolution.resolution = (state.ccdResolution.pixelSize / state.ccdResolution.focalLength) * 206.265
	}

	return { state, show, close, update } as const
})
