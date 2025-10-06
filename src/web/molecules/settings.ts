import { molecule } from 'bunshi'
import { DEFAULT_PLATE_SOLVE_START, type PlateSolverType, type PlateSolveStart } from 'src/shared/types'
import { persistProxy } from '@/shared/persist'

const DEFAULT_PLATE_SOLVE_START_SETTINGS = {
	executable: DEFAULT_PLATE_SOLVE_START.executable,
	apiUrl: DEFAULT_PLATE_SOLVE_START.apiUrl,
	apiKey: DEFAULT_PLATE_SOLVE_START.apiKey,
	downsample: DEFAULT_PLATE_SOLVE_START.downsample,
	timeout: DEFAULT_PLATE_SOLVE_START.timeout,
} as const

export interface SettingsState {
	readonly solver: Record<PlateSolverType, Pick<PlateSolveStart, 'executable' | 'apiUrl' | 'apiKey' | 'downsample' | 'timeout'>>
}

const { state } = persistProxy<SettingsState>('settings', () => ({
	solver: {
		ASTAP: structuredClone(DEFAULT_PLATE_SOLVE_START_SETTINGS),
		ASTROMETRY_NET: structuredClone(DEFAULT_PLATE_SOLVE_START_SETTINGS),
		NOVA_ASTROMETRY_NET: structuredClone(DEFAULT_PLATE_SOLVE_START_SETTINGS),
	},
}))

export const SettingsMolecule = molecule(() => {
	function updateSolver<K extends keyof typeof DEFAULT_PLATE_SOLVE_START_SETTINGS>(type: PlateSolverType, key: K, value: PlateSolveStart[K]) {
		state.solver[type][key] = value
	}

	return { state, updateSolver } as const
})
