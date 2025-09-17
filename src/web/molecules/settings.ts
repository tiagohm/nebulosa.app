import { molecule, onMount } from 'bunshi'
import { unsubscribe } from 'src/shared/bus'
import { DEFAULT_PLATE_SOLVE_START, type PlateSolverType, type PlateSolveStart } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { storage } from '@/shared/storage'

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

export const SettingsMolecule = molecule(() => {
	const state = proxy<SettingsState>({
		solver: {
			ASTAP: storage.get('settings.solver.ASTAP', () => structuredClone(DEFAULT_PLATE_SOLVE_START_SETTINGS)),
			ASTROMETRY_NET: storage.get('settings.solver.ASTROMETRY_NET', () => structuredClone(DEFAULT_PLATE_SOLVE_START_SETTINGS)),
			NOVA_ASTROMETRY_NET: storage.get('settings.solver.NOVA_ASTROMETRY_NET', () => structuredClone(DEFAULT_PLATE_SOLVE_START_SETTINGS)),
		},
	})

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = subscribe(state.solver.ASTAP, () => {
			storage.set('settings.solver.ASTAP', state.solver.ASTAP)
		})

		unsubscribers[1] = subscribe(state.solver.ASTROMETRY_NET, () => {
			storage.set('settings.solver.ASTROMETRY_NET', state.solver.ASTROMETRY_NET)
		})

		unsubscribers[2] = subscribe(state.solver.NOVA_ASTROMETRY_NET, () => {
			storage.set('settings.solver.NOVA_ASTROMETRY_NET', state.solver.NOVA_ASTROMETRY_NET)
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function updateSolver<K extends keyof typeof DEFAULT_PLATE_SOLVE_START_SETTINGS>(type: PlateSolverType, key: K, value: PlateSolveStart[K]) {
		state.solver[type][key] = value
	}

	return { state, updateSolver } as const
})
