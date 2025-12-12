import { createScope, molecule, onMount, use } from 'bunshi'
import { formatDEC, formatRA } from 'nebulosa/src/angle'
import type { EquatorialCoordinate, HorizontalCoordinate } from 'nebulosa/src/coordinate'
import { DEFAULT_MOUNT, type Mount, type MountTargetCoordinateType, type TrackMode } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import bus, { unsubscribe } from 'src/shared/bus'
// biome-ignore format: too long!
import { DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION, type Framing, type MountEquatorialCoordinatePosition, type MountRemoteControlProtocol, type MountRemoteControlStatus, type MountUpdated } from 'src/shared/types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import type { NudgeDirection } from '@/ui/Nudge'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export type TargetCoordinateAction = 'GOTO' | 'SYNC' | 'FRAME'

export interface MountScopeValue {
	readonly mount: Mount
}

export interface MountState {
	readonly mount: EquipmentDevice<Mount>
	readonly targetCoordinate: {
		readonly coordinate: EquatorialCoordinate<string> & HorizontalCoordinate<string> & { type: MountTargetCoordinateType; action: TargetCoordinateAction }
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

const stateMap = new Map<string, MountState>()

export const MountMolecule = molecule(() => {
	const scope = use(MountScope)
	const equipment = use(EquipmentMolecule)

	const mount = equipment.get('MOUNT', scope.mount.name)!

	const state =
		stateMap.get(mount.name) ??
		proxy<MountState>({
			mount,
			targetCoordinate: {
				coordinate: structuredClone(DEFAULT_TARGET_COORDINATE),
				position: structuredClone(DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION),
			},
			currentPosition: structuredClone(DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION),
			location: {
				show: false,
				coordinate: mount.geographicCoordinate,
			},
			time: {
				show: false,
				time: mount.time,
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

	stateMap.set(mount.name, state)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = bus.subscribe<MountUpdated>('mount:update', (event) => {
			if (event.device.name === mount.name) {
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

		unsubscribers[1] = initProxy(state.targetCoordinate, `mount.${mount.name}.targetcoordinate`, ['o:coordinate'])

		unsubscribers[2] = subscribeKey(state.remoteControl, 'show', (show) => {
			if (show) void updateRemoteControlStatus()
		})

		const updateCurrentCoordinateTimer = setInterval(() => {
			if (mount.connected) {
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
		return equipment.connect(mount)
	}

	function updateRemoteControl<K extends keyof MountState['remoteControl']['request']>(key: K, value: MountState['remoteControl']['request'][K]) {
		state.remoteControl.request[key] = value
	}

	async function updateRemoteControlStatus() {
		const status = await Api.Mounts.RemoteControl.status(mount)
		Object.assign(state.remoteControl.status, status)
	}

	async function startRemoteControl() {
		await Api.Mounts.RemoteControl.start(mount, state.remoteControl.request)
		return updateRemoteControlStatus()
	}

	async function stopRemoteControl() {
		await Api.Mounts.RemoteControl.stop(mount, state.remoteControl.request.protocol)
		return updateRemoteControlStatus()
	}

	function updateTargetCoordinate<K extends keyof MountState['targetCoordinate']['coordinate']>(key: K, value: MountState['targetCoordinate']['coordinate'][K]) {
		state.targetCoordinate.coordinate[key] = value
		return updateTargetCoordinatePosition()
	}

	async function updateCurrentCoordinatePosition() {
		const position = await Api.Mounts.currentPosition(mount)
		position && Object.assign(state.currentPosition, position)
	}

	async function updateTargetCoordinatePosition() {
		const position = await Api.Mounts.targetPosition(mount, state.targetCoordinate.coordinate)
		position && Object.assign(state.targetCoordinate.position, position)
	}

	function handleTargetCoordinateAction() {
		switch (state.targetCoordinate.coordinate.action) {
			case 'GOTO':
				return Api.Mounts.goTo(mount, state.targetCoordinate.coordinate)
			case 'SYNC':
				return Api.Mounts.syncTo(mount, state.targetCoordinate.coordinate)
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
		return Api.Mounts.park(mount)
	}

	function unpark() {
		return Api.Mounts.unpark(mount)
	}

	function togglePark() {
		return mount.parked ? unpark() : park()
	}

	function home() {
		return Api.Mounts.home(mount)
	}

	function tracking(enabled: boolean) {
		return Api.Mounts.tracking(mount, enabled)
	}

	function trackMode(mode: TrackMode) {
		return Api.Mounts.trackMode(mount, mode)
	}

	function slewRate(rate: string) {
		return Api.Mounts.slewRate(mount, rate)
	}

	function moveTo(direction: NudgeDirection, down: boolean) {
		switch (direction) {
			case 'upLeft':
				return Promise.all([Api.Mounts.moveNorth(mount, down), Api.Mounts.moveWest(mount, down)])
			case 'upRight':
				return Promise.all([Api.Mounts.moveNorth(mount, down), Api.Mounts.moveEast(mount, down)])
			case 'downLeft':
				return Promise.all([Api.Mounts.moveSouth(mount, down), Api.Mounts.moveWest(mount, down)])
			case 'downRight':
				return Promise.all([Api.Mounts.moveSouth(mount, down), Api.Mounts.moveEast(mount, down)])
			case 'up':
				return Api.Mounts.moveNorth(mount, down)
			case 'down':
				return Api.Mounts.moveSouth(mount, down)
			case 'left':
				return Api.Mounts.moveWest(mount, down)
			case 'right':
				return Api.Mounts.moveEast(mount, down)
		}
	}

	function location(coordinate: GeographicCoordinate) {
		return Api.Mounts.location(mount, coordinate)
	}

	function time(time: Mount['time']) {
		return Api.Mounts.time(mount, time)
	}

	function stop() {
		return Api.Mounts.stop(mount)
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
		equipment.hide('MOUNT', mount)
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
