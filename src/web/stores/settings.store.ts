import { initProxy } from '@shared/proxy'
import { plateSolverStore } from '@stores/plate.solver.store'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { DEFAULT_GEOGRAPHIC_COORDINATE } from '#/atlas'
import type { PlateSolverType, PlateSolveStart } from '#/platesolver'

export type SettingsStore = typeof settingsStore

export interface SettingsState {
	readonly solver: Record<PlateSolverType, Pick<PlateSolveStart, 'executable' | 'apiUrl' | 'apiKey' | 'downsample' | 'timeout'>>
	readonly location: GeographicCoordinate
	readonly time: UTCTime
}

const astap = plateSolverStore()
const astrometryNet = plateSolverStore()
const novaAstrometryNet = plateSolverStore()

const state = proxy<SettingsState>({
	solver: {
		astap: astap.state,
		astrometryNet: astrometryNet.state,
		novaAstrometryNet: novaAstrometryNet.state,
	},
	location: structuredClone(DEFAULT_GEOGRAPHIC_COORDINATE),
	time: {
		utc: Date.now(),
		offset: 0,
	},
})

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return unmount

	console.info('settings mounted')

	mounted = true

	u[0] = initProxy(state, 'settings', ['o:location', 'o:time', 'o:solver'])

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('settings unmounted')
	unsubscribe(u)
	mounted = false
}

function setLocation(coordinate: GeographicCoordinate) {
	Object.assign(state.location, coordinate)
}

export const settingsStore = {
	state,
	astap,
	astrometryNet,
	novaAstrometryNet,
	mount,
	unmount,
	setLocation,
} as const
