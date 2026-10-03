import { equipmentStore } from '@stores/equipment.store'
import { statusBarStore } from '@stores/statusbar.store'
import type { StatusBarItem } from '@stores/statusbar.store'
import { Icons } from '@ui/Icon'
import type { DeviceType, Focuser, Mount, Rotator, Wheel } from 'nebulosa/src/devices/indi/device'
import { formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { unsubscribe } from 'src/shared/util'
import { subscribeKey } from 'valtio/utils'
import type { DeviceTypeMap } from '#/device'

const u: VoidFunction[] = []

function mount() {
	u[0] = makeStatusBarForDeviceType('mount', 0, mountStatusBar)
	u[2] = makeStatusBarForDeviceType('wheel', 2, wheelStatusBar)
	u[3] = makeStatusBarForDeviceType('focuser', 3, focuserStatusBar)
	u[4] = makeStatusBarForDeviceType('rotator', 4, rotatorStatusBar)

	return unmount
}

function makeStatusBarForDeviceType<D extends DeviceType>(type: D, index: number, action: (device: DeviceTypeMap[D], index: number) => typeof unsubscribe) {
	const u: VoidFunction[] = []

	const devices = equipmentStore.state[type]

	u[0] = subscribeKey(devices, 'length', (length) => {
		const sortedDevices = [...devices].sort((a, b) => a.name.localeCompare(b.name))

		for (let i = length - 1, k = 1; i >= 0; i--, k++) {
			u[k]?.()
			u[k] = action(sortedDevices[i] as never, index)
		}
	})

	return () => unsubscribe(u)
}

function mountStatusBar(mount: Mount, index: number) {
	const u: VoidFunction[] = []

	const item: StatusBarItem = {
		id: `mount.${mount.id}`,
		startContent: Icons.Telescope,
		label: mount.name,
		visible: mount.connected,
		items: [
			{
				id: `mount.${mount.id}.ra`,
				startContent: 'RA:',
				startContentClassName: 'font-bold',
				label: '00 00 00.00',
				items: [],
			},
			{
				id: `mount.${mount.id}.dec`,
				startContent: 'DEC:',
				startContentClassName: 'font-bold',
				label: '00 00 00.00',
				items: [],
			},
			{
				id: `mount.${mount.id}.status`,
				labelClassName: 'text-blue-500 uppercase',
				label: 'idle',
				items: [],
			},
		],
	}

	u[0] = subscribeKey(mount, 'connected', (connected) => {
		item.visible = connected
	})
	u[1] = subscribeKey(mount, 'equatorialCoordinate', ({ rightAscension, declination }) => {
		item.items[0].label = formatRA(rightAscension)
		item.items[1].label = formatDEC(declination)
	})

	function status() {
		const status = mount.parking ? 'parking' : mount.parked ? 'parked' : mount.homing ? 'homing' : mount.moving ? 'moving' : mount.slewing ? 'slewing' : mount.tracking ? 'tracking' : 'idle'
		item.items[3].label = status
	}

	u[2] = subscribeKey(mount, 'parking', status)
	u[3] = subscribeKey(mount, 'parked', status)
	u[4] = subscribeKey(mount, 'homing', status)
	u[5] = subscribeKey(mount, 'moving', status)
	u[6] = subscribeKey(mount, 'slewing', status)
	u[7] = subscribeKey(mount, 'tracking', status)

	statusBarStore.add(item, index)

	return () => unsubscribe(u)
}

function wheelStatusBar(wheel: Wheel, index: number) {
	const u: VoidFunction[] = []

	const item: StatusBarItem = {
		id: `wheel.${wheel.id}`,
		startContent: Icons.FilterWheel,
		label: wheel.name,
		visible: wheel.connected,
		items: [
			{
				id: `wheel.${wheel.id}.filter`,
				labelClassName: 'text-green-500',
				label: '--',
				items: [],
			},
			{
				id: `wheel.${wheel.id}.status`,
				labelClassName: 'text-blue-500 uppercase',
				label: 'idle',
				items: [],
			},
		],
	}

	u[0] = subscribeKey(wheel, 'connected', (connected) => {
		item.visible = connected
	})

	function filter() {
		item.items[0].label = wheel.names[wheel.position] || `Slot ${wheel.position + 1}`
	}

	u[1] = subscribeKey(wheel, 'names', filter)
	u[2] = subscribeKey(wheel, 'position', filter)
	u[3] = subscribeKey(wheel, 'moving', (moving) => {
		item.items[1].label = moving ? 'moving' : 'idle'
	})

	statusBarStore.add(item, index)

	return () => unsubscribe(u)
}

function focuserStatusBar(focuser: Focuser, index: number) {
	const u: VoidFunction[] = []

	const item: StatusBarItem = {
		id: `focuser.${focuser.id}`,
		startContent: Icons.Focus,
		label: focuser.name,
		visible: focuser.connected,
		items: [
			{
				id: `focuser.${focuser.id}.position`,
				labelClassName: 'text-green-500',
				label: '--',
				items: [],
			},
			{
				id: `focuser.${focuser.id}.status`,
				labelClassName: 'text-blue-500 uppercase',
				label: 'idle',
				items: [],
			},
		],
	}

	u[0] = subscribeKey(focuser, 'connected', (connected) => {
		item.visible = connected
	})
	u[1] = subscribeKey(focuser, 'position', (position) => {
		item.items[0].label = position.value.toFixed(0)
	})
	u[2] = subscribeKey(focuser, 'moving', (moving) => {
		item.items[1].label = moving ? 'moving' : 'idle'
	})

	statusBarStore.add(item, index)

	return () => unsubscribe(u)
}

function rotatorStatusBar(rotator: Rotator, index: number) {
	const u: VoidFunction[] = []

	const item: StatusBarItem = {
		id: `rotator.${rotator.id}`,
		startContent: Icons.RotateRight,
		label: rotator.name,
		visible: rotator.connected,
		items: [
			{
				id: `rotator.${rotator.id}.angle`,
				labelClassName: 'text-green-500',
				label: '--',
				items: [],
			},
			{
				id: `rotator.${rotator.id}.status`,
				labelClassName: 'text-blue-500 uppercase',
				label: 'idle',
				items: [],
			},
		],
	}

	u[0] = subscribeKey(rotator, 'connected', (connected) => {
		item.visible = connected
	})
	u[1] = subscribeKey(rotator, 'angle', (angle) => {
		item.items[0].label = angle.value.toFixed(1)
	})
	u[2] = subscribeKey(rotator, 'moving', (moving) => {
		item.items[1].label = moving ? 'moving' : 'idle'
	})

	statusBarStore.add(item, index)

	return () => unsubscribe(u)
}

function unmount() {
	unsubscribe(u)
}

export const equipmentStatusBarStore = {
	mount,
	unmount,
} as const
