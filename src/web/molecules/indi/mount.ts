import { addToast } from '@heroui/react'
import { createScope, molecule, onMount, use } from 'bunshi'
import { formatDEC, formatRA } from 'nebulosa/src/angle'
import { DEFAULT_MOUNT, type Mount, type MountTargetCoordinate, type TrackMode } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import bus from 'src/shared/bus'
// biome-ignore format: too long!
import { type CoordinateInfo, DEFAULT_COORDINATE_INFO, type Framing, type MountRemoteControlProtocol, type MountRemoteControlStatus, type MountUpdated } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import type { TargetCoordinateAction } from 'src/web/shared/types'
import type { DeepReadonly } from 'utility-types'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import type { NudgeDirection } from '@/ui/Nudge'
import { ConnectionMolecule } from '../connection'
import { type EquipmentDevice, EquipmentMolecule } from './equipment'

export interface MountScopeValue {
	readonly mount: DeepReadonly<Omit<Mount, symbol>>
}

export interface MountState {
	mount: EquipmentDevice<Mount>
	readonly targetCoordinate: {
		readonly coordinate: MountTargetCoordinate & { action: TargetCoordinateAction }
		readonly position: CoordinateInfo
	}
	readonly currentPosition: CoordinateInfo
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
	action: 'GOTO',
	J2000: { x: '00 00 00', y: '+00 00 00' },
	JNOW: { x: '00 00 00', y: '+00 00 00' },
	ALTAZ: { x: '000 00 00', y: '+00 00 00' },
	ECLIPTIC: { x: '000 00 00', y: '+00 00 00' },
	GALACTIC: { x: '000 00 00', y: '+00 00 00' },
}

export const MountScope = createScope<MountScopeValue>({ mount: DEFAULT_MOUNT })

const stateMap = new Map<string, MountState>()

export const MountMolecule = molecule(() => {
	const scope = use(MountScope)
	const equipment = use(EquipmentMolecule)
	const connection = use(ConnectionMolecule)

	const mount = equipment.get('MOUNT', scope.mount.name)!

	const state =
		stateMap.get(mount.name) ??
		proxy<MountState>({
			mount,
			targetCoordinate: {
				coordinate: structuredClone(DEFAULT_TARGET_COORDINATE),
				position: structuredClone(DEFAULT_COORDINATE_INFO),
			},
			currentPosition: structuredClone(DEFAULT_COORDINATE_INFO),
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

	let updateCoordinateTime = 0

	onMount(() => {
		state.mount = equipment.get('MOUNT', state.mount.name)!

		const unsubscribers = new Array<VoidFunction>(3)

		unsubscribers[0] = bus.subscribe<MountUpdated>('mount:update', (event) => {
			if (event.device.id === mount.id) {
				if (event.property === 'connected') {
					if (event.device.connected) {
						updateCoordinatePosition()
					} else if (event.state === 'Alert') {
						addToast({ title: 'MOUNT', description: `Failed to connect to mount ${mount.name}`, color: 'danger' })
					}

					state.mount.connecting = false
				} else if (event.property === 'equatorialCoordinate') {
					const equatorial = state.currentPosition.equatorial as [number, number]
					equatorial[0] = event.device.equatorialCoordinate!.rightAscension
					equatorial[1] = event.device.equatorialCoordinate!.declination
					void updateCoordinatePosition()
				} else if (event.property === 'slewing') {
					if (event.device.slewing === false) {
						updateCoordinatePosition()
					}
				}
			}
		})

		unsubscribers[1] = initProxy(state.targetCoordinate, `mount.${mount.name}.targetcoordinate`, ['o:coordinate'])

		unsubscribers[2] = subscribeKey(state.remoteControl, 'show', (show) => {
			if (show) void updateRemoteControlStatus()
		})

		const timer = setInterval(() => {
			if (mount.connected && connection.state.connected) {
				updateCoordinatePosition()
			}
		}, 60000)

		if (mount.connected) {
			updateCoordinatePosition()
		}

		return () => {
			unsubscribe(unsubscribers)
			clearInterval(timer)
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

	function updateTargetCoordinate<K extends 'action' | 'type'>(key: K, value: MountState['targetCoordinate']['coordinate'][K]) {
		state.targetCoordinate.coordinate[key] = value
		return updateTargetCoordinatePosition()
	}

	function updateTargetCoordinateByType(coord: 'x' | 'y', value: string) {
		state.targetCoordinate.coordinate[state.targetCoordinate.coordinate.type]![coord] = value
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

	function updateCoordinatePosition() {
		const now = Date.now()

		if (now - updateCoordinateTime >= 60000) {
			updateCoordinateTime = now
			void updateCurrentCoordinatePosition()
			void updateTargetCoordinatePosition()
		}
	}

	function updateTargetCoordinateAction(action: React.Key) {
		if (typeof action === 'string') state.targetCoordinate.coordinate.action = action as never
	}

	function handleTargetCoordinateAction() {
		switch (state.targetCoordinate.coordinate.action) {
			case 'GOTO':
				return Api.Mounts.goTo(mount, state.targetCoordinate.coordinate)
			case 'SYNC':
				return Api.Mounts.sync(mount, state.targetCoordinate.coordinate)
			case 'FRAME': {
				const request: Partial<Framing> = {
					rightAscension: formatRA(state.targetCoordinate.position.equatorialJ2000[0]),
					declination: formatDEC(state.targetCoordinate.position.equatorialJ2000[1]),
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

	function findHome() {
		return Api.Mounts.findHome(mount)
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
		updateTargetCoordinateByType,
		updateTargetCoordinateAction,
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
		findHome,
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
