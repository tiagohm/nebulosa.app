import { createScope, molecule, onMount } from 'bunshi'
import { formatDEC, formatRA } from 'nebulosa/src/angle'
import bus, { unsubscribe } from 'src/shared/bus'
// biome-ignore format: too long!
import { DEFAULT_MOUNT, DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION, type EquatorialCoordinate, type Framing, type GeographicCoordinate, type HorizontalCoordinate, type Mount, type MountEquatorialCoordinatePosition, type MountRemoteControlProtocol, type MountRemoteControlStatus, type MountUpdated, type TargetCoordinateType, type TrackMode } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { storage } from '@/shared/storage'
import type { NudgeDirection } from '@/ui/Nudge'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export type TargetCoordinateAction = 'GOTO' | 'SLEW' | 'SYNC' | 'FRAME'

export interface MountScopeValue {
	readonly mount: Mount
}

export interface MountState {
	readonly mount: EquipmentDevice<Mount>
	readonly targetCoordinate: {
		readonly coordinate: EquatorialCoordinate<string> & HorizontalCoordinate<string> & { type: TargetCoordinateType; action: TargetCoordinateAction }
		readonly position: MountEquatorialCoordinatePosition
	}
	readonly currentPosition: MountEquatorialCoordinatePosition
	readonly location: {
		show: boolean
		coordinate: Mount['geographicCoordinate']
	}
	readonly time: {
		show: boolean
		time: Mount['time']
	}
	readonly remoteControl: {
		show: boolean
		readonly status: MountRemoteControlStatus
		readonly request: {
			protocol: MountRemoteControlProtocol
			host: string
			port: number
		}
	}
}

const DEFAULT_TARGET_COORDINATE: MountState['targetCoordinate']['coordinate'] = {
	type: 'J2000',
	rightAscension: '00 00 00',
	declination: '+00 00 00',
	azimuth: '000 00 00',
	altitude: '+00 00 00',
	action: 'GOTO',
}

export const MountScope = createScope<MountScopeValue>({ mount: DEFAULT_MOUNT })

const mountStateMap = new Map<string, MountState>()

export const MountMolecule = molecule((m, s) => {
	const scope = s(MountScope)
	const equipment = m(EquipmentMolecule)

	const state =
		mountStateMap.get(scope.mount.name) ??
		proxy<MountState>({
			mount: equipment.get('MOUNT', scope.mount.name)!,
			targetCoordinate: {
				coordinate: storage.get(`mount.${scope.mount.name}.targetCoordinate`, () => structuredClone(DEFAULT_TARGET_COORDINATE)),
				position: structuredClone(DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION),
			},
			currentPosition: structuredClone(DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION),
			location: {
				show: false,
				coordinate: scope.mount.geographicCoordinate,
			},
			time: {
				show: false,
				time: scope.mount.time,
			},
			remoteControl: {
				show: false,
				status: {
					LX200: false,
					STELLARIUM: false,
				},
				request: {
					protocol: 'LX200',
					host: '0.0.0.0',
					port: 10001,
				},
			},
		})

	mountStateMap.set(scope.mount.name, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = bus.subscribe<MountUpdated>('mount:update', (event) => {
			if (event.device.name === state.mount.name) {
				if (event.property === 'connected') {
					if (event.device.connected) {
						void updateCurrentCoordinatePosition()
						void updateTargetCoordinatePosition()
					}
				} else if (event.property === 'equatorialCoordinate') {
					Object.assign(state.currentPosition, event.device.equatorialCoordinate)
				}
			}
		})

		unsubscribers[1] = subscribe(state.targetCoordinate, () => storage.set(`mount.${scope.mount.name}.targetCoordinate`, state.targetCoordinate.coordinate))

		unsubscribers[2] = subscribeKey(state.remoteControl, 'show', (show) => {
			if (show) void updateRemoteControlStatus()
		})

		const updateCurrentCoordinateTimer = setInterval(() => {
			if (state.mount.connected) {
				void updateCurrentCoordinatePosition()
				void updateTargetCoordinatePosition()
			}
		}, 5000)

		void updateCurrentCoordinatePosition()
		void updateTargetCoordinatePosition()

		return () => {
			unsubscribe(unsubscribers)
			clearInterval(updateCurrentCoordinateTimer)
		}
	})

	function connect() {
		return equipment.connect(state.mount)
	}

	function updateRemoteControl<K extends keyof MountState['remoteControl']['request']>(key: K, value: MountState['remoteControl']['request'][K]) {
		state.remoteControl.request[key] = value
	}

	async function updateRemoteControlStatus() {
		const status = await Api.Mounts.RemoteControl.status(scope.mount)
		Object.assign(state.remoteControl.status, status)
	}

	async function startRemoteControl() {
		await Api.Mounts.RemoteControl.start(scope.mount, state.remoteControl.request)
		return updateRemoteControlStatus()
	}

	async function stopRemoteControl() {
		await Api.Mounts.RemoteControl.stop(scope.mount, state.remoteControl.request.protocol)
		return updateRemoteControlStatus()
	}

	function updateTargetCoordinate<K extends keyof MountState['targetCoordinate']['coordinate']>(key: K, value: MountState['targetCoordinate']['coordinate'][K]) {
		state.targetCoordinate.coordinate[key] = value
		return updateTargetCoordinatePosition()
	}

	async function updateCurrentCoordinatePosition() {
		const position = await Api.Mounts.currentPosition(scope.mount)
		position && Object.assign(state.currentPosition, position)
	}

	async function updateTargetCoordinatePosition() {
		const position = await Api.Mounts.targetPosition(scope.mount, state.targetCoordinate.coordinate)
		position && Object.assign(state.targetCoordinate.position, position)
	}

	function handleTargetCoordinateAction() {
		switch (state.targetCoordinate.coordinate.action) {
			case 'GOTO':
				return Api.Mounts.goTo(scope.mount, state.targetCoordinate.coordinate)
			case 'SLEW':
				return Api.Mounts.slewTo(scope.mount, state.targetCoordinate.coordinate)
			case 'SYNC':
				return Api.Mounts.syncTo(scope.mount, state.targetCoordinate.coordinate)
			case 'FRAME': {
				const request: Partial<Framing> = {
					rightAscension: formatRA(state.targetCoordinate.position.rightAscensionJ2000),
					declination: formatDEC(state.targetCoordinate.position.declinationJ2000),
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

	function showLocation() {
		state.location.show = true
	}

	function hideLocation() {
		state.location.show = false
	}

	function showTime() {
		state.time.show = true
	}

	function hideTime() {
		state.time.show = false
	}

	function showRemoteControl() {
		state.remoteControl.show = true
	}

	function hideRemoteControl() {
		state.remoteControl.show = false
	}

	function hide() {
		equipment.hide('MOUNT', scope.mount)
	}

	return {
		state,
		scope,
		connect,
		updateRemoteControl,
		startRemoteControl,
		stopRemoteControl,
		updateTargetCoordinate,
		handleTargetCoordinateAction,
		showLocation,
		hideLocation,
		showTime,
		hideTime,
		showRemoteControl,
		hideRemoteControl,
		park,
		unpark,
		togglePark,
		home,
		tracking,
		trackMode,
		slewRate,
		moveTo,
		location,
		time,
		stop,
		hide,
	} as const
})
