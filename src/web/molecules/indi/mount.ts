import { createScope, molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import { DEFAULT_MOUNT, DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION, type EquatorialCoordinate, type Framing, type GeographicCoordinate, type Mount, type MountEquatorialCoordinatePosition, type MountUpdated, type TargetCoordinateType, type TrackMode } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import type { NudgeDirection } from '@/ui/Nudge'
import { EquipmentMolecule } from './equipment'

export type TargetCoordinateAction = 'goto' | 'slew' | 'sync' | 'frame'

export interface MountScopeValue {
	readonly mount: Mount
}

export interface MountTargetCoordinate extends EquatorialCoordinate<string> {
	type: TargetCoordinateType
	action: TargetCoordinateAction
}

export interface MountState {
	readonly mount: Mount
	connecting: boolean
	readonly targetCoordinate: MountTargetCoordinate
	readonly currentCoordinate: MountEquatorialCoordinatePosition
	readonly location: {
		show: boolean
		coordinate: Mount['geographicCoordinate']
	}
	readonly time: {
		show: boolean
		time: Mount['time']
	}
}

const DEFAULT_TARGET_COORDINATE: MountState['targetCoordinate'] = {
	type: 'J2000',
	rightAscension: '00 00 00',
	declination: '+00 00 00',
	action: 'goto',
}

export const MountScope = createScope<MountScopeValue>({ mount: DEFAULT_MOUNT })

const mountStateMap = new Map<string, MountState>()

export const MountMolecule = molecule((m, s) => {
	const scope = s(MountScope)
	const equipment = m(EquipmentMolecule)

	const state =
		mountStateMap.get(scope.mount.name) ??
		proxy<MountState>({
			mount: equipment.get('mount', scope.mount.name)!,
			connecting: false,
			targetCoordinate: simpleLocalStorage.get<MountState['targetCoordinate']>(`mount.${scope.mount.name}.targetCoordinate`, () => structuredClone(DEFAULT_TARGET_COORDINATE)),
			currentCoordinate: DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION,
			location: {
				show: false,
				coordinate: scope.mount.geographicCoordinate,
			},
			time: {
				show: false,
				time: scope.mount.time,
			},
		})

	mountStateMap.set(scope.mount.name, state)

	Api.Mounts.get(scope.mount.name).then((mount) => {
		if (!mount) return
		Object.assign(state.mount, mount)
		state.connecting = false

		if (mount.connected && !mount.parked) {
			void updateCurrentCoordinate()
		}
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

		const updateCurrentCoordinateTimer = setInterval(() => {
			if (state.mount.connected && !state.mount.parked) {
				void updateCurrentCoordinate()
			}
		}, 5000)

		return () => {
			unsubscribe(unsubscribers)
			clearInterval(updateCurrentCoordinateTimer)
		}
	})

	async function connect() {
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

	async function updateCurrentCoordinate() {
		const position = await Api.Mounts.position(scope.mount)
		if (!position) return
		Object.assign(state.currentCoordinate, position)
	}

	function handleTargetCoordinateAction() {
		switch (state.targetCoordinate.action) {
			case 'goto':
				return Api.Mounts.goTo(scope.mount, state.targetCoordinate)
			case 'slew':
				return Api.Mounts.slew(scope.mount, state.targetCoordinate)
			case 'sync':
				return Api.Mounts.sync(scope.mount, state.targetCoordinate)
			case 'frame': {
				const request: Partial<Framing> = {
					// TODO: Use computed target coordinates RA/DEC
					rightAscension: state.targetCoordinate.rightAscension,
					declination: state.targetCoordinate.declination,
				}

				bus.emit('framing:load', request)
			}
		}
	}

	function park() {
		return Api.Mounts.park(scope.mount)
	}

	function unpark() {
		return Api.Mounts.unpark(scope.mount)
	}

	function togglePark() {
		return scope.mount.parked ? unpark() : park()
	}

	function home() {
		return Api.Mounts.home(scope.mount)
	}

	function tracking(enabled: boolean) {
		return Api.Mounts.tracking(scope.mount, enabled)
	}

	function trackMode(mode: TrackMode) {
		return Api.Mounts.trackMode(scope.mount, mode)
	}

	function slewRate(rate: string) {
		return Api.Mounts.slewRate(scope.mount, rate)
	}

	function moveTo(direction: NudgeDirection, down: boolean) {
		switch (direction) {
			case 'upLeft':
				return Promise.all([Api.Mounts.moveNorth(scope.mount, down), Api.Mounts.moveWest(scope.mount, down)])
			case 'upRight':
				return Promise.all([Api.Mounts.moveNorth(scope.mount, down), Api.Mounts.moveEast(scope.mount, down)])
			case 'downLeft':
				return Promise.all([Api.Mounts.moveSouth(scope.mount, down), Api.Mounts.moveWest(scope.mount, down)])
			case 'downRight':
				return Promise.all([Api.Mounts.moveSouth(scope.mount, down), Api.Mounts.moveEast(scope.mount, down)])
			case 'up':
				return Api.Mounts.moveNorth(scope.mount, down)
			case 'down':
				return Api.Mounts.moveSouth(scope.mount, down)
			case 'left':
				return Api.Mounts.moveWest(scope.mount, down)
			case 'right':
				return Api.Mounts.moveEast(scope.mount, down)
		}
	}

	function location(coordinate: GeographicCoordinate) {
		return Api.Mounts.location(scope.mount, coordinate)
	}

	function time(time: Mount['time']) {
		return Api.Mounts.time(scope.mount, time)
	}

	function stop() {
		return Api.Mounts.stop(scope.mount)
	}

	function toggleLocation(force?: boolean) {
		state.location.show = force ?? !state.location.show
	}

	function toggleTime(force?: boolean) {
		state.time.show = force ?? !state.time.show
	}

	function close() {
		equipment.close('mount', scope.mount)
	}

	return { state, scope, connect, updateTargetCoordinate, handleTargetCoordinateAction, toggleLocation, toggleTime, park, unpark, togglePark, home, tracking, trackMode, slewRate, moveTo, location, time, stop, close } as const
})
