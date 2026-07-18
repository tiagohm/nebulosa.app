import { initProxy } from '@shared/proxy'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_GEOGRAPHIC_COORDINATE, DEFAULT_PLATE_SOLVE_START, type PlateSolverType, type PlateSolveStart } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'

export type SettingsStore = typeof settingsStore

const DEFAULT_PLATE_SOLVE_START_SETTINGS = {
	executable: DEFAULT_PLATE_SOLVE_START.executable,
	apiUrl: DEFAULT_PLATE_SOLVE_START.apiUrl,
	apiKey: DEFAULT_PLATE_SOLVE_START.apiKey,
	downsample: DEFAULT_PLATE_SOLVE_START.downsample,
	timeout: DEFAULT_PLATE_SOLVE_START.timeout,
} as const

export interface SettingsState {
	readonly solver: Record<PlateSolverType, Pick<PlateSolveStart, 'executable' | 'apiUrl' | 'apiKey' | 'downsample' | 'timeout'>>
	readonly location: GeographicCoordinate
	readonly time: UTCTime
}

const state = proxy<SettingsState>({
	solver: {
		astap: structuredClone(DEFAULT_PLATE_SOLVE_START_SETTINGS),
		astrometryNet: structuredClone(DEFAULT_PLATE_SOLVE_START_SETTINGS),
		novaAstrometryNet: structuredClone(DEFAULT_PLATE_SOLVE_START_SETTINGS),
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
	if (mounted) return

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

function updateSolver<K extends keyof typeof state.solver.astap>(type: PlateSolverType, key: K, value: PlateSolveStart[K]) {
	state.solver[type][key] = value
}

export const settingsStore = {
	state,
	mount,
	unmount,
	updateSolver,
}
