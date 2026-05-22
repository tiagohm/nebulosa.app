import { formatDEC, formatRA } from 'nebulosa/src/angle'
import type { Mount, MountTargetCoordinate, MountTargetCoordinateType, TrackMode } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import { DEFAULT_COORDINATE_INFO, type CoordinateInfo, type MountRemoteControlProtocol, type MountRemoteControlStatus } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import type { NudgeDirection } from '../ui/Nudge'
import { equipmentStore, type DeviceState } from './equipment.store'
import { framingStore } from './framing.store'

export type MountStore = ReturnType<typeof mountStore>

export interface MountState {
	mount: DeviceState<Mount>
	readonly target: {
		readonly coordinate: MountTargetCoordinate
		readonly position: CoordinateInfo
	}
	readonly current: {
		readonly position: CoordinateInfo
	}
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
		pendingAction?: 'start' | 'stop'
		readonly status: MountRemoteControlStatus
		readonly request: {
			protocol: MountRemoteControlProtocol
			host: string
			port: number
		}
	}
}

const DEFAULT_TARGET_COORDINATE: MountState['target']['coordinate'] = {
	type: 'J2000',
	J2000: { x: '00 00 00', y: '+00 00 00' },
	JNOW: { x: '00 00 00', y: '+00 00 00' },
	ALTAZ: { x: '000 00 00', y: '+00 00 00' },
	ECLIPTIC: { x: '000 00 00', y: '+00 00 00' },
	GALACTIC: { x: '000 00 00', y: '+00 00 00' },
}

export function mountStore(mount: Mount) {
	const state = proxy<MountState>({
		mount,
		target: {
			coordinate: structuredClone(DEFAULT_TARGET_COORDINATE),
			position: structuredClone(DEFAULT_COORDINATE_INFO),
		},
		current: {
			position: structuredClone(DEFAULT_COORDINATE_INFO),
		},
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

	console.info('mount created:', mount.name)

	const u: VoidFunction[] = []
	let timer: number | undefined
	let mounted = false

	function _mount() {
		if (mounted) return

		console.info('mount mounted:', mount.name)

		mounted = true

		u[0] = initProxy(state.target, `mount.${mount.id}.targetcoordinate`, ['o:coordinate'])
		u[1] = subscribeKey(state.mount, 'slewing', updateCoordinatePosition)
		u[2] = subscribeKey(state.mount, 'connected', updateCoordinatePosition)

		timer = window.setInterval(updateCoordinatePosition, 5000)

		updateCoordinatePosition()
	}

	function unmount() {
		if (!mounted) return
		console.info('mount unmounted:', mount.name)
		unsubscribe(u)
		window.clearInterval(timer)
		timer = undefined
		mounted = false
	}

	function connect() {
		return equipmentStore.connect(mount)
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

	function updateTargetCoordinateType(value: MountTargetCoordinateType) {
		state.target.coordinate.type = value
	}

	function updateTargetCoordinateX(value: string) {
		state.target.coordinate[state.target.coordinate.type]!.x = value
	}

	function updateTargetCoordinateY(value: string) {
		state.target.coordinate[state.target.coordinate.type]!.y = value
	}

	async function updateCurrentCoordinatePosition() {
		const position = await Api.Mounts.currentPosition(mount)
		position && Object.assign(state.current.position, position)
	}

	async function updateTargetCoordinatePosition() {
		const position = await Api.Mounts.targetPosition(mount, state.target.coordinate)
		position && Object.assign(state.target.position, position)
	}

	function updateCoordinatePosition() {
		if (!mount.connected) return
		void updateCurrentCoordinatePosition()
		void updateTargetCoordinatePosition()
	}

	function goTo() {
		return Api.Mounts.goTo(mount, state.target.coordinate)
	}

	function sync() {
		return Api.Mounts.sync(mount, state.target.coordinate)
	}

	function frame() {
		return framingStore.load({
			rightAscension: formatRA(state.target.position.equatorialJ2000[0]),
			declination: formatDEC(state.target.position.equatorialJ2000[1]),
		})
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
			default:
				return undefined
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

	function show() {
		equipmentStore.show(mount)
	}

	function hide() {
		equipmentStore.hide(mount)
	}

	return {
		state,
		mount: _mount,
		unmount,
		connect,
		updateRemoteControl,
		startRemoteControl,
		stopRemoteControl,
		updateTargetCoordinateType,
		updateTargetCoordinateX,
		updateTargetCoordinateY,
		updateCurrentCoordinatePosition,
		updateTargetCoordinatePosition,
		goTo,
		sync,
		frame,
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
		show,
		hide,
	} as const
}
