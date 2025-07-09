import { createScope, molecule, onMount } from 'bunshi'
import { BusMolecule } from 'src/shared/bus'
import { DEFAULT_MOUNT, type Mount, type MountUpdated, type TargetCoordinateType, type TrackMode } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { EquipmentMolecule } from './equipment'

export interface MountScopeValue {
	readonly mount: Mount
}

export interface MountState {
	readonly mount: Mount
	connecting: boolean
	readonly targetCoordinate: {
		type: TargetCoordinateType
		rightAscension: string
		declination: string
	}
}

export const MountScope = createScope<MountScopeValue>({ mount: DEFAULT_MOUNT })

const mountStateMap = new Map<string, MountState>()

// Molecule that manages the mount device
export const MountMolecule = molecule((m, s) => {
	const scope = s(MountScope)
	const bus = m(BusMolecule)
	const equipment = m(EquipmentMolecule)

	const state =
		mountStateMap.get(scope.mount.name) ??
		proxy<MountState>({
			mount: equipment.get('mount', scope.mount.name) as Mount,
			connecting: false,
			targetCoordinate: simpleLocalStorage.get<MountState['targetCoordinate']>(`mount.${scope.mount.name}.targetCoordinate`, () => ({ type: 'J2000', rightAscension: '00 00 00', declination: '+000 00 00' })),
		})

	mountStateMap.set(scope.mount.name, state)

	// Fetches the mount
	Api.Mount.get(scope.mount.name).then((mount) => {
		if (!mount) return
		Object.assign(state.mount, mount)
	})

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<MountUpdated>('mount:update', (event) => {
			if (event.device.name === state.mount.name) {
				if (event.property === 'connected') {
					state.connecting = false
				}
			}
		})

		unsubscribers[1] = subscribe(state.targetCoordinate, () => simpleLocalStorage.set(`mount.${scope.mount.name}.targetCoordinate`, state.targetCoordinate))

		return () => {
			unsubscribers.forEach((e) => e())
		}
	})

	// Connects or disconnects the mount based on its current state
	async function connectOrDisconnect() {
		state.connecting = true

		if (state.mount.connected) {
			await Api.Indi.disconnect(state.mount)
		} else {
			await Api.Indi.connect(state.mount)
		}
	}

	function updateTargetCoordinate<K extends keyof MountState['targetCoordinate']>(key: K, value: MountState['targetCoordinate'][K]) {
		state.targetCoordinate[key] = value
	}

	function park() {
		return Api.Mount.park(scope.mount)
	}

	function unpark() {
		return Api.Mount.unpark(scope.mount)
	}

	function togglePark() {
		return scope.mount.parked ? unpark() : park()
	}

	function home() {
		return Api.Mount.home(scope.mount)
	}

	function tracking(enabled: boolean) {
		return Api.Mount.tracking(scope.mount, enabled)
	}

	function trackMode(mode: TrackMode) {
		return Api.Mount.trackMode(scope.mount, mode)
	}

	function slewRate(rate: string) {
		return Api.Mount.slewRate(scope.mount, rate)
	}

	return { state, scope, connectOrDisconnect, updateTargetCoordinate, park, unpark, togglePark, home, tracking, trackMode, slewRate }
})
