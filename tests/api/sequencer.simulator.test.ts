import { afterEach, describe, expect, test } from 'bun:test'
import { localGuiderCameraKey, localGuiderOutputKey, remoteGuiderKey } from 'src/api/guider.session'
import type { ResourceArbiter } from 'src/api/resource'
import { action, frame } from './sequencer.fixture'
import { commandNames, disposeNight, disposeProcess, openProcess, RETRY, runNight } from './sequencer.simulator'
import type { NightControl, NightResult, SimulatorProcess } from './sequencer.simulator'

const nights: NightResult[] = []
const processes: SimulatorProcess[] = []

afterEach(async () => {
	await Promise.all(nights.splice(0).map((night) => disposeNight(night)))
	await Promise.all(processes.splice(0).map((process) => disposeProcess(process)))
})

describe('canonical night', () => {
	test('A.01 full LRGB night', async () => {
		const night = await runNight()

		nights.push(night)

		const names = commandNames(night.log)
		const committed = night.artifacts.filter((artifact) => artifact.status === 'committed')
		const wheelMoves = night.log.filter((entry) => entry.name === 'wheel.move')
		const lights = night.files.filter((path) => path.includes('/LIGHT/') && path.endsWith('.fits'))

		expect(night.session.state).toBe('completed')
		expect(names.indexOf('unpark')).toBeGreaterThan(-1)
		expect(names.indexOf('cover.open')).toBeGreaterThan(names.indexOf('unpark'))
		expect(names.indexOf('cooler.set')).toBeGreaterThan(names.indexOf('cover.open'))
		expect(names.indexOf('guider.start')).toBeGreaterThan(names.indexOf('cooler.set'))
		expect(names.indexOf('slew')).toBeGreaterThan(names.indexOf('guider.start'))
		expect(names.indexOf('rotator.move')).toBeGreaterThan(names.indexOf('slew'))
		expect(names.indexOf('solve')).toBeGreaterThan(names.indexOf('rotator.move'))
		expect(night.log.filter((entry) => entry.name === 'autofocus.run')).toHaveLength(4)
		expect(wheelMoves.map((entry) => entry.detail)).toEqual(['L', 'R', 'G', 'B'])
		expect(night.log.filter((entry) => entry.name === 'guider.dither')).toHaveLength(4)
		expect(names.indexOf('guider.stop')).toBeGreaterThan(names.lastIndexOf('camera.expose'))
		expect(names.indexOf('park')).toBeGreaterThan(names.indexOf('guider.stop'))
		expect(names.indexOf('cover.close')).toBeGreaterThan(names.indexOf('park'))
		expect(names.indexOf('cooler.off')).toBeGreaterThan(names.indexOf('cover.close'))
		expect(committed).toHaveLength(9)
		expect(lights).toHaveLength(9)
		expect(committed.every((artifact) => artifact.path !== undefined && lights.includes(artifact.path))).toBeTrue()
		expect(night.artifacts.some((artifact) => artifact.logicalSlotId.includes('autofocus') || artifact.logicalSlotId.includes('center'))).toBeFalse()
		expect(night.devices.mount.parked).toBeTrue()
		expect(night.devices.cover.parked).toBeTrue()
		expect(night.devices.camera.temperature).toBe(15)
		expect(night.devices.camera.cooler).toBeFalse()
		expect(night.devices.guiderConnected).toBeFalse()
		expect(night.arbiter.availability('hw-camera')).toBe('available')
		expect(night.arbiter.availability('hw-mount')).toBe('available')
		expect(JSON.stringify(night.session)).not.toContain('ReservationToken')
	}, 30_000)

	test('A.02 snapshot during the first autofocus', async () => {
		let duringAutofocus: { readonly state: string; readonly exposure?: unknown; readonly type?: string; readonly name?: string } | undefined
		const night = await runNight({
			control: async (api) => {
				const snapshot = await api.waitUntil((current) => current.foreground?.type === 'trigger.autofocus')

				duringAutofocus = { state: snapshot.state, exposure: snapshot.capture.exposure, type: snapshot.foreground?.type, name: snapshot.foreground?.name }
			},
		})

		nights.push(night)

		expect(duringAutofocus).toEqual({ state: 'running', exposure: undefined, type: 'trigger.autofocus', name: 'trigger.autofocus' })
		expect(night.session.state).toBe('completed')
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
		expect(night.log.filter((entry) => entry.name === 'autofocus.run')).toHaveLength(4)
	}, 30_000)

	test('A.03 second run of the same definition', async () => {
		const first = await runNight()

		nights.push(first)

		const second = await runNight({ root: first.root })

		nights.push(second)

		const firstCommitted = first.artifacts.filter((artifact) => artifact.status === 'committed')
		const secondCommitted = second.artifacts.filter((artifact) => artifact.status === 'committed')
		const firstPaths = firstCommitted.map((artifact) => artifact.path)
		const secondPaths = secondCommitted.map((artifact) => artifact.path)
		const lights = second.files.filter((path) => path.includes('/LIGHT/') && path.endsWith('.fits'))

		expect(first.session.state).toBe('completed')
		expect(second.session.state).toBe('completed')
		expect(second.session.id).not.toBe(first.session.id)
		expect(firstCommitted).toHaveLength(9)
		expect(secondCommitted).toHaveLength(9)
		expect(secondCommitted.map((artifact) => artifact.logicalSlotId)).toEqual(firstCommitted.map((artifact) => artifact.logicalSlotId))
		expect(firstPaths.every((path) => path !== undefined)).toBeTrue()
		expect(secondPaths.every((path) => path !== undefined)).toBeTrue()
		expect(secondPaths.some((path) => firstPaths.includes(path))).toBeFalse()
		expect(lights).toHaveLength(18)
		expect(firstPaths.every((path) => path !== undefined && second.files.includes(path))).toBeTrue()
		expect(secondPaths.every((path) => path !== undefined && second.files.includes(path))).toBeTrue()
	}, 60_000)

	test('A.04 without guiding', async () => {
		const night = await runNight({
			patch: {
				guiding: { enabled: false },
				dither: { enabled: false },
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true })],
				},
				shutdown: {
					actions: [action('stopTrack', { type: 'stopTracking' }), action('park', { type: 'parkMount', required: true }), action('close', { type: 'closeCover' }), action('warm', { type: 'warmCamera' })],
				},
			},
		})

		nights.push(night)

		const names = commandNames(night.log)
		const committed = night.artifacts.filter((artifact) => artifact.status === 'committed')

		expect(night.session.state).toBe('completed')
		expect(names.some((name) => name.startsWith('guider.'))).toBeFalse()
		expect(committed).toHaveLength(9)
		expect(names.indexOf('park')).toBeGreaterThan(names.lastIndexOf('camera.expose'))
		expect(night.devices.mount.parked).toBeTrue()
		expect(night.devices.guiderConnected).toBeFalse()
	}, 30_000)

	test('A.05 without a wheel', async () => {
		const night = await runNight({
			patch: {
				devices: { wheel: undefined },
				capture: { frames: [frame('lum', { name: 'Luminance', count: 4, exposureTime: 2 })] },
			},
		})

		nights.push(night)

		expect(night.session.state).toBe('completed')
		expect(night.log.filter((entry) => entry.name === 'wheel.move')).toHaveLength(0)
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(4)
		expect(night.log.filter((entry) => entry.name === 'autofocus.run')).toHaveLength(1)
	}, 30_000)

	test('A.06 without a cover or flat panel', async () => {
		const night = await runNight({
			patch: {
				devices: { cover: undefined, flatPanel: undefined },
				cover: { enabled: false },
				flatPanel: { enabled: false },
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true }), action('cool', { type: 'coolCamera', required: true }), action('guide', { type: 'startGuiding', required: true })],
				},
				shutdown: {
					actions: [action('stopGuide', { type: 'stopGuiding', required: true }), action('stopTrack', { type: 'stopTracking' }), action('park', { type: 'parkMount', required: true }), action('warm', { type: 'warmCamera' })],
				},
			},
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(names.some((name) => name.startsWith('cover.') || name.startsWith('panel.'))).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
	}, 30_000)

	test('A.07 with startup and shutdown disabled', async () => {
		const night = await runNight({
			patch: {
				guiding: { enabled: false },
				dither: { enabled: false },
				cooling: { enabled: false },
				startup: { enabled: false },
				shutdown: { enabled: false },
			},
			sim: {
				mount: { parked: false, tracking: true },
				camera: { cooler: true, temperature: -10 },
				cover: { parked: false },
			},
		})

		nights.push(night)

		const names = commandNames(night.log)
		const committed = night.artifacts.filter((artifact) => artifact.status === 'committed')

		expect(night.session.state).toBe('completed')
		expect(names.some((name) => name === 'connect' || name.endsWith('.connect'))).toBeFalse()
		expect(names.includes('unpark')).toBeFalse()
		expect(names.includes('park')).toBeFalse()
		expect(names.some((name) => name === 'cooler.set' || name === 'cooler.off' || name === 'cooler.on')).toBeFalse()
		expect(committed).toHaveLength(9)
		expect(night.devices.mount.parked).toBeFalse()
		expect(night.devices.cover.parked).toBeFalse()
		expect(night.devices.camera.temperature).toBe(-10)
		expect(night.devices.camera.cooler).toBeTrue()
		expect(night.arbiter.availability('hw-camera')).toBe('available')
		expect(night.arbiter.availability('hw-mount')).toBe('available')
	}, 30_000)

	test('A.08 OSC rig without a wheel or rotator', async () => {
		const night = await runNight({
			patch: {
				devices: { wheel: undefined, rotator: undefined, cover: undefined, flatPanel: undefined },
				rotator: { enabled: false },
				cover: { enabled: false },
				flatPanel: { enabled: false },
				capture: { frames: [frame('lum', { name: 'Luminance', count: 4, exposureTime: 2 })] },
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true }), action('cool', { type: 'coolCamera', required: true }), action('guide', { type: 'startGuiding', required: true })],
				},
				shutdown: {
					actions: [action('stopGuide', { type: 'stopGuiding', required: true }), action('stopTrack', { type: 'stopTracking' }), action('park', { type: 'parkMount', required: true }), action('warm', { type: 'warmCamera' })],
				},
			},
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(names.includes('wheel.move')).toBeFalse()
		expect(names.includes('rotator.move')).toBeFalse()
		expect(names.some((name) => name.startsWith('cover.') || name.startsWith('panel.'))).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(4)
		expect(night.log.filter((entry) => entry.name === 'autofocus.run')).toHaveLength(1)
	}, 30_000)

	test('A.09 unguided field rig', async () => {
		const night = await runNight({
			patch: {
				devices: { wheel: undefined },
				guiding: { enabled: false },
				dither: { enabled: false },
				cooling: { enabled: false },
				meridianFlip: { enabled: false },
				capture: { frames: [frame('lum', { name: 'Luminance', count: 8, exposureTime: 0.5 })] },
				startup: { enabled: false },
				shutdown: { enabled: false },
			},
			sim: {
				mount: { parked: false, tracking: true },
				camera: { cooler: true, temperature: -10 },
				cover: { parked: false },
			},
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(names.some((name) => name.startsWith('guider.'))).toBeFalse()
		expect(names.some((name) => name.startsWith('cover.') || name.startsWith('panel.'))).toBeFalse()
		expect(names.includes('guider.dither')).toBeFalse()
		expect(names.includes('flip')).toBeFalse()
		expect(names.includes('park')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(8)
		expect(night.devices.mount.parked).toBeFalse()
	}, 30_000)

	test('A.10 narrowband Ha OIII SII night', async () => {
		const night = await runNight({
			patch: {
				capture: {
					frames: [
						frame('ha', { name: 'Hydrogen-alpha', count: 2, exposureTime: 2, filter: { type: 'name', name: 'Ha' } }),
						frame('o3', { name: 'Oxygen-III', count: 2, exposureTime: 2, filter: { type: 'name', name: 'O3' } }),
						frame('s2', { name: 'Sulfur-II', count: 2, exposureTime: 2, filter: { type: 'name', name: 'S2' } }),
					],
				},
				autofocus: {
					capture: { filter: { type: 'name', name: 'L' } },
					filterOffsets: [
						{ filter: { type: 'name', name: 'L' }, offset: 0 },
						{ filter: { type: 'name', name: 'Ha' }, offset: 100 },
						{ filter: { type: 'name', name: 'O3' }, offset: 200 },
						{ filter: { type: 'name', name: 'S2' }, offset: 300 },
					],
				},
			},
		})

		nights.push(night)

		const wheelMoves = night.log.filter((entry) => entry.name === 'wheel.move')
		const focusMoves = night.log.filter((entry) => entry.name === 'focuser.move')
		const lights = night.files.filter((path) => path.includes('/LIGHT/') && path.endsWith('.fits'))

		expect(night.session.state).toBe('completed')
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(6)
		expect(night.log.filter((entry) => entry.name === 'autofocus.run')).toHaveLength(3)
		expect(wheelMoves.map((entry) => entry.detail)).toEqual(['L', 'Dark', 'Ha', 'L', 'Ha', 'O3', 'L', 'O3', 'S2'])
		expect(focusMoves.map((entry) => entry.detail)).toEqual(['25100', '25000', '25100', '25200', '25000', '25200', '25300'])
		expect(lights.filter((path) => path.includes('-Ha-'))).toHaveLength(2)
		expect(lights.filter((path) => path.includes('-O3-'))).toHaveLength(2)
		expect(lights.filter((path) => path.includes('-S2-'))).toHaveLength(2)
	}, 30_000)

	test('A.11 lucky imaging planetary night', async () => {
		const night = await runNight({
			patch: {
				guiding: { enabled: false },
				dither: { enabled: false },
				autofocus: { enabled: false },
				meridianFlip: { enabled: false },
				target: { center: { enabled: false } },
				capture: { delay: 0, frames: [frame('lum', { name: 'Luminance', count: 40, exposureTime: 0.5, filter: { type: 'name', name: 'L' } })] },
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true })],
				},
				shutdown: {
					actions: [action('stopTrack', { type: 'stopTracking' }), action('park', { type: 'parkMount', required: true }), action('close', { type: 'closeCover' }), action('warm', { type: 'warmCamera' })],
				},
			},
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(night.log.filter((entry) => entry.name === 'camera.expose')).toHaveLength(40)
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(40)
		expect(names.some((name) => name.startsWith('guider.'))).toBeFalse()
		expect(names.includes('autofocus.run')).toBeFalse()
		expect(names.includes('flip')).toBeFalse()
		expect(names.includes('solve')).toBeFalse()
		expect(night.log.filter((entry) => entry.name === 'wheel.move')).toHaveLength(1)
	}, 30_000)
})

describe('admission', () => {
	test('B.01 one start per process with disjoint resources', async () => {
		const process = await openProcess()

		processes.push(process)

		const east = process.addObservatory('east')
		const west = process.addObservatory('west')
		const short = {
			guiding: { enabled: false },
			dither: { enabled: false },
			autofocus: { enabled: false },
			meridianFlip: { enabled: false },
			target: { center: { enabled: false } },
			capture: { delay: 0, frames: [frame('lum', { name: 'Luminance', count: 1, exposureTime: 0.5, filter: { type: 'name', name: 'L' } })] },
			startup: { actions: [action('unpark', { type: 'unparkMount', required: true }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true })] },
			shutdown: { actions: [action('stopTrack', { type: 'stopTracking' }), action('park', { type: 'parkMount', required: true }), action('close', { type: 'closeCover' }), action('warm', { type: 'warmCamera' })] },
		} as const
		const created = [process.handler.createSession(process.definition(east, { id: 'east', ...short })), process.handler.createSession(process.definition(west, { id: 'west', ...short }))]

		expect(created.every((session) => session.ok)).toBeTrue()

		if (!created[0].ok || !created[1].ok) return

		const starts = [process.runtime.start(created[0].session.id), process.runtime.start(created[1].session.id)]
		const admitted = starts.find((start) => start.ok)
		const refused = starts.find((start) => !start.ok)

		expect(starts.filter((start) => start.ok)).toHaveLength(1)
		expect(refused).toMatchObject({ ok: false, reason: 'busy', sessionId: admitted && admitted.ok ? admitted.session.id : undefined })

		if (admitted === undefined || !admitted.ok || refused === undefined || refused.ok) return

		const admittedDevices = admitted.session.id === created[0].session.id ? east : west
		const refusedDevices = admitted.session.id === created[0].session.id ? west : east

		const refusedId = admitted.session.id === created[0].session.id ? created[1].session.id : created[0].session.id

		expect(['reserved', 'leased']).toContain(process.arbiter.availability(admittedDevices.camera.hardwareId))
		expect(process.arbiter.snapshot(admittedDevices.camera.hardwareId).reservationOwner).toEqual({ id: admitted.session.id, kind: 'sequencer' })
		expect(process.arbiter.availability(refusedDevices.camera.hardwareId)).toBe('available')
		expect(process.arbiter.snapshot(refusedDevices.camera.hardwareId).reservationOwner).toBeUndefined()
		expect(process.store.session(refusedId)?.state).toBe('created')

		const session = await process.runtime.settled(admitted.session.id)

		expect(session?.state).toBe('completed')
		expect(process.arbiter.availability(admittedDevices.camera.hardwareId)).toBe('available')
		expect(process.arbiter.availability(refusedDevices.camera.hardwareId)).toBe('available')
	}, 30_000)

	test('B.02 reentrant start of the same session', async () => {
		const process = await openProcess()

		processes.push(process)

		const observatory = process.addObservatory('east')
		const created = process.handler.createSession(
			process.definition(observatory, {
				id: 'east',
				guiding: { enabled: false },
				dither: { enabled: false },
				autofocus: { enabled: false },
				meridianFlip: { enabled: false },
				target: { center: { enabled: false } },
				capture: { delay: 0, frames: [frame('lum', { name: 'Luminance', count: 1, exposureTime: 0.5, filter: { type: 'name', name: 'L' } })] },
				startup: { actions: [action('unpark', { type: 'unparkMount', required: true }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true })] },
				shutdown: { actions: [action('stopTrack', { type: 'stopTracking' }), action('park', { type: 'parkMount', required: true }), action('close', { type: 'closeCover' }), action('warm', { type: 'warmCamera' })] },
			}),
		)

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		const first = process.runtime.start(created.session.id)
		const snapshot = structuredClone(process.handler.snapshot(created.session.id))
		const second = process.runtime.start(created.session.id)
		const again = process.handler.snapshot(created.session.id)

		expect(first).toMatchObject({ ok: true, reentrant: false })
		expect(second).toMatchObject({ ok: true, reentrant: true })

		if (!first.ok || !second.ok) return

		expect(second.session).toEqual(first.session)
		expect(again).toEqual(snapshot)
		expect(['reserved', 'leased']).toContain(process.arbiter.availability(observatory.camera.hardwareId))
		expect(process.arbiter.snapshot(observatory.camera.hardwareId).reservationOwner).toEqual({ id: created.session.id, kind: 'sequencer' })

		const session = await process.runtime.settled(created.session.id)

		expect(session?.state).toBe('completed')
		expect(process.log.filter((entry) => entry.name === 'unpark')).toHaveLength(1)
		expect(process.log.filter((entry) => entry.name === 'camera.expose')).toHaveLength(1)
		expect(process.arbiter.availability(observatory.camera.hardwareId)).toBe('available')
	}, 30_000)

	test('B.03 a reservation failure releases the process gate', async () => {
		const process = await openProcess()

		processes.push(process)

		const observatory = process.addObservatory('east')
		const created = process.handler.createSession(
			process.definition(observatory, {
				id: 'east',
				dither: { enabled: false },
				autofocus: { enabled: false },
				meridianFlip: { enabled: false },
				target: { center: { enabled: false } },
				capture: { delay: 0, frames: [frame('lum', { name: 'Luminance', count: 1, exposureTime: 0.5, filter: { type: 'name', name: 'L' } })] },
			}),
		)

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		const key = remoteGuiderKey('127.0.0.1', 4400)
		const third = process.arbiter.reserve({ id: 'phd2', kind: 'guider' }, [{ key }])

		expect(third.ok).toBeTrue()

		if (!third.ok) return

		const refused = process.runtime.start(created.session.id)

		expect(refused).toEqual({ ok: false, reason: 'resourcesUnavailable', detail: `${key} is held by guider phd2` })
		expect(process.runtime.activeSessionId).toBeUndefined()
		expect(process.store.session(created.session.id)?.state).toBe('created')
		expect(process.arbiter.availability(observatory.camera.hardwareId)).toBe('available')
		expect(process.arbiter.snapshot(key).reservationOwner).toEqual({ id: 'phd2', kind: 'guider' })

		third.reservation.release()

		const admitted = process.runtime.start(created.session.id)

		expect(admitted).toMatchObject({ ok: true, reentrant: false })
		expect(process.arbiter.snapshot(key).reservationOwner).toEqual({ id: created.session.id, kind: 'sequencer' })

		const session = await process.runtime.settled(created.session.id)

		expect(session?.state).toBe('completed')
		expect(process.arbiter.availability(key)).toBe('available')
		expect(process.runtime.activeSessionId).toBeUndefined()
	}, 30_000)

	test('B.04 an idle guider session refuses start before any dither', async () => {
		const process = await openProcess()

		processes.push(process)

		const observatory = process.addObservatory('east')
		const created = process.handler.createSession(
			process.definition(observatory, {
				id: 'east',
				autofocus: { enabled: false },
				meridianFlip: { enabled: false },
				target: { center: { enabled: false } },
				capture: { delay: 0, frames: [frame('lum', { name: 'Luminance', count: 2, exposureTime: 0.5, filter: { type: 'name', name: 'L' } })] },
				dither: { everyFrames: 1 },
			}),
		)

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		const key = remoteGuiderKey('127.0.0.1', 4400)
		const idle = process.arbiter.acquire({ id: 'phd2', kind: 'guiderSession' }, [{ key }])

		expect(idle.ok).toBeTrue()

		if (!idle.ok) return

		const refused = process.runtime.start(created.session.id)

		expect(refused).toEqual({ ok: false, reason: 'resourcesUnavailable', detail: `${key} is held by guiderSession phd2` })
		expect(process.runtime.activeSessionId).toBeUndefined()
		expect(process.store.session(created.session.id)?.state).toBe('created')
		expect(process.log.filter((entry) => entry.name === 'unpark')).toHaveLength(0)
		expect(process.log.filter((entry) => entry.name === 'camera.expose')).toHaveLength(0)
		expect(process.log.filter((entry) => entry.name === 'guider.dither')).toHaveLength(0)
		expect(process.arbiter.availability(observatory.camera.hardwareId)).toBe('available')
		expect(process.arbiter.availability(key)).toBe('leased')

		idle.lease.release()
	}, 30_000)

	test('B.05 a distinct guide camera is reserved with the imaging camera', async () => {
		const process = await openProcess()

		processes.push(process)

		const observatory = process.addObservatory('east')
		const created = process.handler.createSession(
			process.definition(observatory, {
				id: 'east',
				autofocus: { enabled: false },
				meridianFlip: { enabled: false },
				target: { center: { enabled: false } },
				capture: { delay: 0, frames: [frame('lum', { name: 'Luminance', count: 1, exposureTime: 0.5, filter: { type: 'name', name: 'L' } })] },
				guiding: {
					connection: {
						mode: 'local',
						focalLength: 200,
						capture: { exposureTime: 3, frameType: 'LIGHT', binX: 2, binY: 2, gain: 100, offset: 10, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: '', transferFormat: 'FITS', compressed: false },
					},
				},
			}),
		)

		expect(created.ok).toBeTrue()
		expect(observatory.camera.hardwareId).not.toBe(observatory.guideCamera.hardwareId)

		if (!created.ok) return

		const started = process.runtime.start(created.session.id)
		const cameraKey = observatory.camera.hardwareId
		const guideCameraKey = observatory.guideCamera.hardwareId
		const logicalCamera = localGuiderCameraKey(observatory.guideCamera)
		const logicalOutput = localGuiderOutputKey(observatory.guideOutput)
		const manual = process.arbiter.acquire({ id: 'manual', kind: 'capture' }, [{ key: cameraKey, device: observatory.camera }])

		expect(started).toMatchObject({ ok: true, reentrant: false })
		expect(['reserved', 'leased']).toContain(process.arbiter.availability(cameraKey))
		expect(['reserved', 'leased']).toContain(process.arbiter.availability(guideCameraKey))
		expect(process.arbiter.snapshot(cameraKey).reservationOwner).toEqual({ id: created.session.id, kind: 'sequencer' })
		expect(process.arbiter.snapshot(guideCameraKey).reservationOwner).toEqual({ id: created.session.id, kind: 'sequencer' })
		expect(['reserved', 'leased']).toContain(process.arbiter.availability(logicalCamera))
		expect(['reserved', 'leased']).toContain(process.arbiter.availability(logicalOutput))
		expect(process.arbiter.availability(remoteGuiderKey('127.0.0.1', 4400))).toBe('available')
		expect(manual.ok).toBeFalse()

		if (manual.ok) return

		expect(manual.conflicts).toEqual([{ key: cameraKey, by: 'reservation', ownerId: created.session.id, ownerKind: 'sequencer', causes: [] }])

		const session = await process.runtime.settled(created.session.id)

		expect(session?.state).toBe('completed')
		expect(process.arbiter.availability(cameraKey)).toBe('available')
		expect(process.arbiter.availability(guideCameraKey)).toBe('available')
		expect(process.arbiter.availability(logicalCamera)).toBe('available')
		expect(process.arbiter.availability(logicalOutput)).toBe('available')
	}, 30_000)

	test('B.06 the cover is reserved from the start', async () => {
		let manual: ReturnType<ResourceArbiter['acquire']> | undefined
		const night = await runNight({
			holdFirstExposure: true,
			control: async (api) => {
				await api.waitUntil((current) => current.capture.exposure !== undefined)

				expect(api.arbiter.snapshot(api.devices.cover.hardwareId).reservationOwner).toMatchObject({ kind: 'sequencer' })

				manual = api.arbiter.acquire({ id: 'manual', kind: 'cover' }, [{ key: api.devices.cover.hardwareId, device: api.devices.cover }])
			},
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(manual?.ok).toBeFalse()

		if (manual === undefined || manual.ok) return

		expect(manual.conflicts).toEqual([{ key: night.devices.cover.hardwareId, by: 'reservation', ownerKind: 'sequencer', ownerId: night.session.id, causes: [] }])
		expect(night.session.state).toBe('completed')
		expect(night.log.filter((entry) => entry.name === 'cover.close')).toHaveLength(1)
		expect(names.indexOf('cover.close')).toBeGreaterThan(names.lastIndexOf('camera.expose'))
		expect(night.devices.cover.parked).toBeTrue()
		expect(night.arbiter.availability(night.devices.cover.hardwareId)).toBe('available')
	}, 30_000)

	test('B.07 an external slew is busy during capture', async () => {
		let external: { readonly ok: boolean; readonly reason?: string; readonly error?: string } | undefined
		const night = await runNight({
			holdFirstExposure: true,
			control: async (api) => {
				await api.waitUntil((current) => current.capture.exposure !== undefined)

				external = await api.coordinator.start('slew', [{ key: api.devices.mount.hardwareId, device: api.devices.mount }], () => ({ ok: true, value: undefined })).result
			},
		})

		nights.push(night)

		expect(external).toMatchObject({ ok: false, reason: 'busy' })
		expect(external?.error).toContain(`${night.devices.mount.hardwareId} is reserved by sequencer ${night.session.id}`)
		expect(night.session.state).toBe('completed')
		expect(night.log.filter((entry) => entry.name === 'slew')).toHaveLength(1)
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
	}, 30_000)

	test('B.08 two camera operations still conflict inside the reservation', async () => {
		let during: { readonly availability: string; readonly owners: number; readonly kind?: string; readonly type?: string; readonly exposure?: unknown } | undefined
		let overlap: { readonly ok: boolean; readonly reason?: string; readonly error?: string } | undefined
		const night = await runNight({
			holdFirstExposure: true,
			control: async (api) => {
				const snapshot = await api.waitUntil((current) => current.capture.exposure !== undefined)
				const camera = { key: api.devices.camera.hardwareId, device: api.devices.camera }
				const focuser = { key: api.devices.focuser.hardwareId, device: api.devices.focuser }
				const leased = api.arbiter.snapshot(camera.key)
				const owner = leased.reservationOwner

				during = { availability: leased.availability, owners: api.arbiter.ownersOf(camera.key).length, kind: leased.owner?.kind, type: snapshot.foreground?.type, exposure: snapshot.capture.exposure }

				if (owner === undefined) return

				const reserved = api.arbiter.reserve(owner, [camera])

				if (!reserved.ok) return

				overlap = await api.coordinator.reservedScope(reserved.reservation).start('autoFocus', [camera, focuser], () => ({ ok: true, value: undefined })).result

				expect(api.arbiter.ownersOf(camera.key)).toHaveLength(1)
			},
		})

		nights.push(night)

		expect(during).toMatchObject({ availability: 'leased', owners: 1, kind: 'cameraCapture', type: 'capture.frame' })
		expect(during?.exposure).toBeDefined()
		expect(overlap).toMatchObject({ ok: false, reason: 'busy' })
		expect(overlap?.error).toContain(`${night.devices.camera.hardwareId} is owned by cameraCapture`)
		expect(night.session.state).toBe('completed')
		expect(night.log.filter((entry) => entry.name === 'autofocus.run')).toHaveLength(4)
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
	}, 30_000)

	test('B.09 distinct resources may lease in parallel but V1 does not', async () => {
		let during: Record<string, string> | undefined
		let parallel: { readonly camera: string; readonly mount: string } | undefined
		let commands = 0
		const night = await runNight({
			holdFirstExposure: true,
			control: async (api) => {
				await api.waitUntil((current) => current.capture.exposure !== undefined)

				const camera = { key: api.devices.camera.hardwareId, device: api.devices.camera }
				const mount = { key: api.devices.mount.hardwareId, device: api.devices.mount }
				const owner = api.arbiter.snapshot(camera.key).reservationOwner

				during = {
					camera: api.arbiter.availability(camera.key),
					mount: api.arbiter.availability(mount.key),
					wheel: api.arbiter.availability(api.devices.wheel.hardwareId),
					focuser: api.arbiter.availability(api.devices.focuser.hardwareId),
					rotator: api.arbiter.availability(api.devices.rotator.hardwareId),
					cover: api.arbiter.availability(api.devices.cover.hardwareId),
					flatPanel: api.arbiter.availability(api.devices.flatPanel.hardwareId),
				}
				commands = api.log.length

				if (owner === undefined) return

				const reserved = api.arbiter.reserve(owner, [camera])

				if (!reserved.ok) return

				const probe = api.arbiter.acquire({ id: 'probe', kind: 'slew' }, [mount], reserved.reservation.token)

				if (!probe.ok) return

				parallel = { camera: api.arbiter.availability(camera.key), mount: api.arbiter.availability(mount.key) }
				probe.lease.release()

				expect(api.arbiter.availability(mount.key)).toBe('reserved')
				expect(api.log).toHaveLength(commands)
			},
		})

		nights.push(night)

		expect(during).toEqual({ camera: 'leased', mount: 'reserved', wheel: 'reserved', focuser: 'reserved', rotator: 'reserved', cover: 'reserved', flatPanel: 'reserved' })
		expect(parallel).toEqual({ camera: 'leased', mount: 'leased' })
		expect(night.session.state).toBe('completed')
		expect(night.log.filter((entry) => entry.name === 'autofocus.run')).toHaveLength(4)
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
	}, 30_000)

	test('B.10 removing the camera does not drop the reservation', async () => {
		let afterReadd: { readonly owner?: string; readonly available: boolean; readonly acquired: boolean; readonly reserved: boolean } | undefined
		const night = await runNight({
			holdFirstExposure: true,
			control: async (api) => {
				const snapshot = await api.waitUntil((current) => current.capture.exposure !== undefined)
				const device = api.devices.camera
				const key = device.hardwareId

				api.arbiter.markUnavailable({ key, device })
				api.arbiter.markDeviceUnavailable(key)
				void api.coordinator.cancelByDevice(key, 'removed')
				expect(api.arbiter.disassociate(key, device)).toBeTrue()
				expect(api.arbiter.reservationOwnerOf(key)).toMatchObject({ kind: 'sequencer', id: snapshot.id })

				const readded = structuredClone(device)

				readded.id = `${device.id}-readded`
				api.arbiter.markUnavailable({ key, device: readded })
				api.arbiter.markAvailable({ key, device: readded })
				api.arbiter.markDeviceAvailable(key)

				afterReadd = {
					owner: api.arbiter.reservationOwnerOf(key)?.id,
					available: api.arbiter.availability(key) === 'available',
					acquired: api.arbiter.acquire({ id: 'manual', kind: 'capture' }, [{ key, device: readded }]).ok,
					reserved: api.arbiter.reserve({ id: 'other', kind: 'sequencer' }, [{ key, device: readded }]).ok,
				}
			},
		})

		nights.push(night)

		expect(afterReadd).toEqual({ owner: night.session.id, available: false, acquired: false, reserved: false })
		expect(night.session.state).toBe('failed')
		expect(night.session.failure?.reason).toBe('removed')
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(0)
		expect(night.arbiter.availability(night.devices.camera.hardwareId)).toBe('available')
	}, 30_000)

	test('B.11 a stop mid-exposure releases only after the cleanups', async () => {
		let during: { readonly camera: string; readonly owners: number } | undefined
		let stopping: ReturnType<NightControl['stop']> | undefined
		const night = await runNight({
			holdFirstExposure: true,
			control: async (api) => {
				await api.waitUntil((current) => current.capture.exposure !== undefined)

				during = { camera: api.arbiter.availability(api.devices.camera.hardwareId), owners: api.arbiter.ownersOf(api.devices.camera.hardwareId).length }
				stopping = api.stop()
			},
		})

		nights.push(night)

		const stopped = await stopping
		const names = commandNames(night.log)
		const keys = [night.devices.camera.hardwareId, night.devices.mount.hardwareId, night.devices.wheel.hardwareId, night.devices.focuser.hardwareId, night.devices.rotator.hardwareId, night.devices.cover.hardwareId, night.devices.flatPanel.hardwareId, remoteGuiderKey('127.0.0.1', 4400)]

		expect(during).toEqual({ camera: 'leased', owners: 1 })
		expect(stopped).toMatchObject({ ok: true, effect: 'stop' })
		expect(night.session.state).toBe('stopped')
		expect(night.session.failure).toBeUndefined()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(1)
		expect(night.files.filter((path) => path.includes('/LIGHT/') && path.endsWith('.fits'))).toHaveLength(1)
		expect(names.lastIndexOf('camera.done')).toBeGreaterThan(names.lastIndexOf('camera.expose'))
		expect(names.indexOf('guider.stop')).toBeGreaterThan(names.lastIndexOf('camera.done'))
		expect(names.indexOf('park')).toBeGreaterThan(names.indexOf('guider.stop'))
		expect(names.indexOf('cover.close')).toBeGreaterThan(names.indexOf('park'))
		expect(names.indexOf('cooler.off')).toBeGreaterThan(names.indexOf('cover.close'))
		expect(names.indexOf('guider.disconnect')).toBeGreaterThan(names.indexOf('cooler.off'))
		expect(night.devices.guiderConnected).toBeFalse()

		for (const key of keys) {
			expect(night.arbiter.availability(key)).toBe('available')
			expect(night.arbiter.ownersOf(key)).toHaveLength(0)
		}
	}, 30_000)

	test('B.12 camera and wheel on the same hardware share one reservation key', async () => {
		let reserved: readonly string[] | undefined
		const night = await runNight({
			sim: { wheel: { hardwareId: 'hw-camera' } },
			holdFirstExposure: true,
			control: async (api) => {
				await api.waitUntil((current) => current.capture.exposure !== undefined)

				const key = api.devices.camera.hardwareId
				const owner = api.arbiter.snapshot(key).reservationOwner

				expect(api.devices.wheel.hardwareId).toBe(key)

				if (owner === undefined) return

				const extended = api.arbiter.reserve(owner, [{ key, device: api.devices.camera }])

				if (!extended.ok) return

				reserved = extended.reservation.resources
			},
		})

		nights.push(night)

		const key = night.devices.camera.hardwareId

		expect(night.devices.wheel.hardwareId).toBe(key)
		expect(reserved?.filter((item) => item === key)).toEqual([key])
		expect(reserved?.includes('hw-wheel')).toBeFalse()
		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(night.log.filter((entry) => entry.name === 'wheel.move').map((entry) => entry.detail)).toEqual(['L', 'R', 'G', 'B'])
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
		expect(night.arbiter.availability(key)).toBe('available')
		expect(night.arbiter.availability('hw-wheel')).toBe('available')
	}, 30_000)
})

describe('startup', () => {
	test('D.01 startup actions run in declared order', async () => {
		const night = await runNight()

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(names.indexOf('unpark')).toBeGreaterThan(-1)
		expect(names.indexOf('cover.open')).toBeGreaterThan(names.indexOf('unpark'))
		expect(names.indexOf('cooler.set')).toBeGreaterThan(names.indexOf('cover.open'))
		expect(names.indexOf('guider.start')).toBeGreaterThan(names.indexOf('cooler.set'))
		expect(names.indexOf('slew')).toBeGreaterThan(names.indexOf('guider.start'))
	}, 30_000)

	test('D.02 inverted startup actions keep the declared order', async () => {
		const night = await runNight({
			patch: {
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true }), action('cool', { type: 'coolCamera', required: true }), action('open', { type: 'openCover' }), action('guide', { type: 'startGuiding', required: true })],
				},
			},
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(names.indexOf('unpark')).toBeGreaterThan(-1)
		expect(names.indexOf('cooler.set')).toBeGreaterThan(names.indexOf('unpark'))
		expect(names.indexOf('cover.open')).toBeGreaterThan(names.indexOf('cooler.set'))
		expect(names.indexOf('guider.start')).toBeGreaterThan(names.indexOf('cover.open'))
		expect(names.indexOf('slew')).toBeGreaterThan(names.indexOf('guider.start'))
	}, 30_000)

	test('D.03 unpark succeeds when the mount is already unparked', async () => {
		const night = await runNight({ sim: { mount: { parked: false } } })

		nights.push(night)

		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(night.log.filter((entry) => entry.name === 'unpark')).toHaveLength(0)
		expect(night.log.filter((entry) => entry.name === 'park')).toHaveLength(1)
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
	}, 30_000)

	test('D.04 a required unpark failure stops the night before the target', async () => {
		const night = await runNight({ sim: { options: { mount: { unpark: 'fail' } } } })

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('failed')
		expect(night.session.failure).toMatchObject({ reason: 'commandFailed', detail: 'the mount did not unpark: the mount refused to unpark' })
		expect(night.log.filter((entry) => entry.name === 'unpark')).toHaveLength(3)
		expect(names.includes('slew')).toBeFalse()
		expect(names.includes('cover.open')).toBeFalse()
		expect(names.includes('camera.expose')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(0)
		expect(night.devices.mount.parked).toBeTrue()
		expect(night.events.some((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toBeTrue()
		expect(names.includes('guider.disconnect')).toBeTrue()
	}, 30_000)

	test('D.05 an optional unpark failure still runs later required actions', async () => {
		const night = await runNight({
			patch: {
				startup: {
					actions: [action('unpark', { type: 'unparkMount' }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true }), action('guide', { type: 'startGuiding', required: true })],
				},
			},
			sim: { options: { mount: { unpark: 'fail' } } },
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('failed')
		expect(night.session.failure).toMatchObject({ reason: 'unexpectedState', detail: 'the mount did not reach the target: mount Mount Simulator is parked' })
		expect(night.log.filter((entry) => entry.name === 'unpark')).toHaveLength(3)
		expect(names.includes('cover.open')).toBeFalse()
		expect(names.includes('cooler.set')).toBeTrue()
		expect(names.includes('guider.start')).toBeTrue()
		expect(names.includes('slew')).toBeTrue()
		expect(names.includes('camera.expose')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(0)
		expect(night.devices.mount.parked).toBeTrue()
		expect(night.events.some((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toBeTrue()
		expect(names.includes('guider.disconnect')).toBeTrue()
	}, 30_000)

	test('D.06 an optional unpark failure still runs later optional actions when continueOnFailure is true', async () => {
		const night = await runNight({
			patch: {
				startup: {
					continueOnFailure: true,
					actions: [action('unpark', { type: 'unparkMount' }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true }), action('guide', { type: 'startGuiding', required: true })],
				},
			},
			sim: { options: { mount: { unpark: 'fail' } } },
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('failed')
		expect(night.session.failure).toMatchObject({ reason: 'unexpectedState', detail: 'the mount did not reach the target: mount Mount Simulator is parked' })
		expect(night.log.filter((entry) => entry.name === 'unpark')).toHaveLength(3)
		expect(names.includes('cover.open')).toBeTrue()
		expect(names.includes('cooler.set')).toBeTrue()
		expect(names.includes('guider.start')).toBeTrue()
		expect(names.indexOf('cover.open')).toBeGreaterThan(names.indexOf('unpark'))
		expect(names.indexOf('cooler.set')).toBeGreaterThan(names.indexOf('cover.open'))
		expect(names.indexOf('guider.start')).toBeGreaterThan(names.indexOf('cooler.set'))
		expect(names.includes('slew')).toBeTrue()
		expect(names.includes('camera.expose')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(0)
		expect(night.devices.mount.parked).toBeTrue()
		expect(night.events.some((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toBeTrue()
		expect(names.includes('guider.disconnect')).toBeTrue()
	}, 30_000)

	test('D.07 coolCamera commands the SequencerCooling setpoint', async () => {
		const night = await runNight({ patch: { cooling: { temperature: -15 } } })

		nights.push(night)

		const firstExpose = night.log.findIndex((entry) => entry.name === 'camera.expose')
		const startupSetpoints = night.log
			.slice(0, firstExpose)
			.filter((entry) => entry.name === 'cooler.set')
			.map((entry) => entry.detail)

		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(firstExpose).toBeGreaterThan(-1)
		expect(startupSetpoints.at(-1)).toBe('-15')
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
		expect(night.devices.camera.temperature).toBe(15)
	}, 30_000)

	test('D.08 coolCamera succeeds when the cooler is already at the target', async () => {
		const night = await runNight({ sim: { camera: { temperature: -10, cooler: true } } })

		nights.push(night)

		const firstExpose = night.log.findIndex((entry) => entry.name === 'camera.expose')
		const startupCooling = night.log.slice(0, firstExpose).filter((entry) => entry.name === 'cooler.set' || entry.name === 'cooler.on')

		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(firstExpose).toBeGreaterThan(-1)
		expect(startupCooling).toHaveLength(0)
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
	}, 30_000)

	test('D.09 a required coolCamera timeout stops the night before the target', async () => {
		const night = await runNight({
			patch: {
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true, timeout: 1 }), action('guide', { type: 'startGuiding', required: true })],
				},
			},
			sim: { options: { camera: { temperature: 'timeout' } } },
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('failed')
		expect(night.session.failure).toMatchObject({ reason: 'timeout', detail: 'the sensor setpoint could not be commanded: the cooler never reached the setpoint' })
		expect(night.log.filter((entry) => entry.name === 'cooler.set')).toHaveLength(6)
		expect(names.includes('slew')).toBeFalse()
		expect(names.includes('camera.expose')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(0)
		expect(names.indexOf('park')).toBeGreaterThan(names.indexOf('unpark'))
		expect(names.lastIndexOf('cooler.set')).toBeGreaterThan(names.indexOf('park'))
		expect(night.devices.camera.temperature).toBe(20)
		expect(night.events.some((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toBeTrue()
		expect(names.includes('guider.disconnect')).toBeTrue()
	}, 30_000)

	test('D.10 a required startGuiding failure stops the night before the target', async () => {
		const night = await runNight({ sim: { options: { guider: { start: 'fail' } } } })

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('failed')
		expect(night.session.failure).toMatchObject({ reason: 'commandFailed', detail: 'the guider did not start guiding: the guider refused to start' })
		expect(night.log.filter((entry) => entry.name === 'guider.start')).toHaveLength(3)
		expect(names.includes('slew')).toBeFalse()
		expect(names.includes('camera.expose')).toBeFalse()
		expect(names.includes('guider.stop')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(0)
		expect(night.devices.guiderRunning).toBeFalse()
		expect(night.events.some((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toBeTrue()
		expect(names.includes('guider.disconnect')).toBeTrue()
	}, 30_000)

	test('D.11 an optional startGuiding action is refused when guiding is enabled', async () => {
		const process = await openProcess()

		processes.push(process)

		const started = await process.handler.start(
			process.definition(process.addObservatory('d11'), {
				dither: { enabled: false },
				startup: {
					continueOnFailure: true,
					actions: [action('unpark', { type: 'unparkMount', required: true }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true }), action('guide', { type: 'startGuiding' })],
				},
			}),
		)

		expect(started.ok).toBeFalse()

		if (started.ok) return

		expect(started.reason).toBe('invalidDefinition')
		expect(started.preflight?.diagnostics).toEqual([{ path: 'startup.actions[3].required', message: 'the guiding block declares the guider the capture runs under, and this action does not fail the session when it cannot start guiding, so every frame would be captured unguided' }])
		expect(process.log).toHaveLength(0)
		expect(process.runtime.activeSessionId).toBeUndefined()
	}, 30_000)

	test('D.12 calibrateBeforeStart calibrates before the first light', async () => {
		const night = await runNight({ patch: { guiding: { calibrateBeforeStart: true } } })

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(names.indexOf('guider.calibrate')).toBeGreaterThan(-1)
		expect(names.indexOf('guider.calibrate')).toBeGreaterThan(names.indexOf('cooler.set'))
		expect(names.indexOf('guider.calibrate')).toBeLessThan(names.indexOf('slew'))
		if (names.includes('guider.start')) expect(names.indexOf('guider.start')).toBeGreaterThan(names.indexOf('guider.calibrate'))
		expect(names.indexOf('guider.calibrate')).toBeLessThan(names.indexOf('camera.expose'))
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
	}, 30_000)

	test('D.13 openCover runs before slew and light does not reopen it', async () => {
		const night = await runNight()

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(night.log.filter((entry) => entry.name === 'cover.open')).toHaveLength(1)
		expect(names.indexOf('cover.open')).toBeGreaterThan(names.indexOf('unpark'))
		expect(names.indexOf('cover.open')).toBeLessThan(names.indexOf('slew'))
		expect(names.indexOf('cover.open')).toBeLessThan(names.indexOf('solve'))
		expect(names.indexOf('cover.close')).toBeGreaterThan(names.lastIndexOf('camera.expose'))
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
		expect(night.devices.cover.parked).toBeTrue()
	}, 30_000)

	test('D.14 a disabled openCover is skipped and light opens the cover', async () => {
		const night = await runNight({
			patch: {
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true }), action('open', { type: 'openCover', enabled: false }), action('cool', { type: 'coolCamera', required: true }), action('guide', { type: 'startGuiding', required: true })],
				},
			},
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(night.log.filter((entry) => entry.name === 'cover.open')).toHaveLength(1)
		expect(names.indexOf('cover.open')).toBeGreaterThan(names.indexOf('slew'))
		expect(names.indexOf('cover.open')).toBeLessThan(names.lastIndexOf('camera.expose'))
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
		expect(night.devices.cover.parked).toBeTrue()
	}, 30_000)

	test('D.15 a transient unpark failure is retried and the night completes', async () => {
		const night = await runNight({ sim: { options: { mount: { unpark: 2 } } } })

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(night.log.filter((entry) => entry.name === 'unpark')).toHaveLength(3)
		expect(names.includes('slew')).toBeTrue()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
		expect(night.devices.mount.parked).toBeTrue()
	}, 30_000)

	test('D.16 exhausting startup retry fails the night and shuts down once', async () => {
		const night = await runNight({
			patch: {
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true, retry: RETRY }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true }), action('guide', { type: 'startGuiding', required: true })],
				},
			},
			sim: { options: { mount: { unpark: 'fail' } } },
		})

		nights.push(night)

		const names = commandNames(night.log)
		const lastUnpark = names.lastIndexOf('unpark')
		const afterUnpark = night.log.slice(lastUnpark + 1)

		expect(night.session.state).toBe('failed')
		expect(night.session.failure).toMatchObject({ reason: 'commandFailed', detail: 'the mount did not unpark: the mount refused to unpark' })
		expect(night.log.filter((entry) => entry.name === 'unpark')).toHaveLength(3)
		expect(names.includes('slew')).toBeFalse()
		expect(names.includes('cover.open')).toBeFalse()
		expect(names.includes('camera.expose')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(0)
		expect(night.devices.mount.parked).toBeTrue()
		expect(night.events.filter((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toHaveLength(1)
		expect(afterUnpark.filter((entry) => entry.name === 'guider.stop')).toHaveLength(1)
		expect(afterUnpark.filter((entry) => entry.name === 'park')).toHaveLength(0)
		expect(afterUnpark.filter((entry) => entry.name === 'cooler.off')).toHaveLength(1)
		expect(afterUnpark.filter((entry) => entry.name === 'guider.disconnect')).toHaveLength(1)
		expect(night.log.filter((entry) => entry.name === 'guider.stop')).toHaveLength(1)
		expect(night.log.filter((entry) => entry.name === 'guider.disconnect')).toHaveLength(1)
		expect(names.indexOf('guider.stop')).toBeGreaterThan(lastUnpark)
		expect(names.indexOf('guider.disconnect')).toBeGreaterThan(names.indexOf('guider.stop'))
		expect(names.lastIndexOf('cooler.off')).toBeGreaterThan(names.indexOf('guider.stop'))
	}, 30_000)

	test('D.17 startTracking uses the target tracking mode before the slew', async () => {
		const night = await runNight({
			patch: {
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true }), action('track', { type: 'startTracking', required: true }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true }), action('guide', { type: 'startGuiding', required: true })],
				},
			},
			sim: { mount: { trackMode: 'LUNAR' } },
		})

		nights.push(night)

		const names = commandNames(night.log)
		const modes = night.log.filter((entry) => entry.name === 'track.mode').map((entry) => entry.detail)

		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(modes.length).toBeGreaterThan(0)
		expect(modes.every((mode) => mode === 'SIDEREAL')).toBeTrue()
		expect(names.indexOf('track.mode')).toBeGreaterThan(names.indexOf('unpark'))
		expect(names.indexOf('track.mode')).toBeLessThan(names.indexOf('slew'))
		expect(names.indexOf('track')).toBeGreaterThan(names.indexOf('unpark'))
		expect(names.indexOf('track')).toBeLessThan(names.indexOf('slew'))
		expect(night.log.find((entry) => entry.name === 'track')?.detail).toBe('on')
		expect(night.devices.mount.trackMode).toBe('SIDEREAL')
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
	}, 30_000)

	test('D.18 a disconnected required device refuses start before the night begins', async () => {
		const process = await openProcess()

		processes.push(process)

		const devices = process.addObservatory('d18', { camera: { connected: false } })
		const started = await process.handler.start(process.definition(devices))

		expect(started.ok).toBeFalse()

		if (started.ok) return

		expect(started.reason).toBe('disconnected')
		expect(started.detail).toBe(`device ${devices.camera.name} of role camera is not connected`)
		expect(process.log).toHaveLength(0)
		expect(process.runtime.activeSessionId).toBeUndefined()
		expect(process.arbiter.availability(devices.camera.hardwareId)).toBe('available')
		expect(process.arbiter.snapshot(devices.camera.hardwareId).reservationOwner).toBeUndefined()
		expect(process.store.sessions().some((session) => session.state === 'failed')).toBeFalse()
		expect(process.store.sessions().every((session) => session.state === 'created' || session.state === 'stopped')).toBeTrue()
	}, 30_000)

	test('D.19 a disabled startup does not unpark a parked mount', async () => {
		const night = await runNight({
			patch: {
				guiding: { enabled: false },
				dither: { enabled: false },
				cooling: { enabled: false },
				startup: { enabled: false },
				shutdown: {
					runOnFailure: true,
					actions: [action('stopTrack', { type: 'stopTracking' }), action('park', { type: 'parkMount', required: true }), action('close', { type: 'closeCover' })],
				},
			},
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('failed')
		expect(night.session.failure).toMatchObject({ reason: 'unexpectedState', detail: 'the mount did not reach the target: mount Mount Simulator is parked' })
		expect(names.includes('unpark')).toBeFalse()
		expect(names.includes('slew')).toBeTrue()
		expect(names.includes('camera.expose')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(0)
		expect(night.devices.mount.parked).toBeTrue()
		expect(night.events.some((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toBeTrue()
	}, 30_000)

	test('D.20 a start with every device connected is admitted without connecting them', async () => {
		const night = await runNight()

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.started.ok).toBeTrue()
		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(night.devices.camera.connected).toBeTrue()
		expect(night.devices.mount.connected).toBeTrue()
		expect(night.devices.wheel.connected).toBeTrue()
		expect(night.devices.cover.connected).toBeTrue()
		expect(names.some((name) => name === 'connect' || (name.endsWith('.connect') && name !== 'guider.connect'))).toBeFalse()
	}, 30_000)

	test('D.21 startGuiding succeeds when the guider is already running', async () => {
		const night = await runNight({ sim: { options: { guider: { running: true } } } })

		nights.push(night)

		const names = commandNames(night.log)
		const firstSlew = names.indexOf('slew')
		const startup = night.log.slice(0, firstSlew)

		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(firstSlew).toBeGreaterThan(-1)
		expect(startup.some((entry) => entry.name === 'guider.start' || entry.name === 'guider.calibrate')).toBeFalse()
		expect(names.includes('guider.calibrate')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
	}, 30_000)

	test('D.22 openCover succeeds when the cover is already open', async () => {
		const night = await runNight({ sim: { cover: { parked: false } } })

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('completed')
		expect(night.session.failure).toBeUndefined()
		expect(night.log.filter((entry) => entry.name === 'cover.open')).toHaveLength(0)
		expect(night.log.filter((entry) => entry.name === 'cover.close')).toHaveLength(1)
		expect(names.indexOf('cover.close')).toBeGreaterThan(names.lastIndexOf('camera.expose'))
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(9)
		expect(night.devices.cover.parked).toBeTrue()
	}, 30_000)

	test('D.23 a disabled required unpark is dropped and does not fail as notRun', async () => {
		const night = await runNight({
			patch: {
				startup: {
					actions: [action('unpark', { type: 'unparkMount', required: true, enabled: false }), action('open', { type: 'openCover' }), action('cool', { type: 'coolCamera', required: true }), action('guide', { type: 'startGuiding', required: true })],
				},
			},
		})

		nights.push(night)

		const names = commandNames(night.log)

		expect(night.session.state).toBe('failed')
		expect(night.session.failure).toMatchObject({ reason: 'unexpectedState', detail: 'the mount did not reach the target: mount Mount Simulator is parked' })
		expect(night.session.failure?.detail?.includes('did not run')).toBeFalse()
		expect(names.includes('unpark')).toBeFalse()
		expect(names.includes('cooler.set')).toBeTrue()
		expect(names.includes('guider.start')).toBeTrue()
		expect(names.includes('slew')).toBeTrue()
		expect(names.includes('camera.expose')).toBeFalse()
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(0)
		expect(night.devices.mount.parked).toBeTrue()
		expect(night.events.some((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toBeTrue()
	}, 30_000)

	test('D.24 coolCamera ramps the setpoint at the declared rate', async () => {
		const night = await runNight({
			patch: {
				cooling: { ramp: 2, temperature: -10 },
				guiding: { enabled: false },
				dither: { enabled: false },
				autofocus: { enabled: false },
				meridianFlip: { enabled: false },
				target: { center: { enabled: false } },
				capture: { delay: 0, frames: [frame('lum', { name: 'Luminance', count: 1, exposureTime: 0.5, filter: { type: 'name', name: 'L' } })] },
				startup: { actions: [action('unpark', { type: 'unparkMount', required: true }), action('cool', { type: 'coolCamera', required: true })] },
				shutdown: { actions: [action('park', { type: 'parkMount', required: true })] },
			},
			sim: { camera: { temperature: 20 } },
		})

		nights.push(night)

		const startup: { readonly temperature: number; readonly at: number }[] = []

		for (const entry of night.log) {
			if (entry.name !== 'cooler.set' || entry.detail === undefined) continue

			const temperature = Number(entry.detail)

			startup.push({ temperature, at: entry.at })
			if (temperature === -10) break
		}

		expect(night.session.state).toBe('completed')
		expect(startup.length).toBeGreaterThan(1)
		expect(startup[0]?.temperature).toBeLessThan(20)
		expect(startup.at(-1)?.temperature).toBe(-10)

		for (let i = 1; i < startup.length; i++) {
			const previous = startup[i - 1]
			const current = startup[i]
			const minutes = (current.at - previous.at) / 60_000

			expect(current.temperature).toBeLessThan(previous.temperature)
			expect(minutes).toBeGreaterThan(0)
			expect(Math.abs(current.temperature - previous.temperature) / minutes).toBeLessThanOrEqual(2 + 1e-9)
		}
	}, 30_000)

	test('D.25 initial slew and center run under the guiding interlock', async () => {
		const night = await runNight({
			patch: {
				autofocus: { enabled: false },
				dither: { enabled: false },
				meridianFlip: { enabled: false },
				capture: { delay: 0, frames: [frame('lum', { name: 'Luminance', count: 1, exposureTime: 0.5, filter: { type: 'name', name: 'L' } })] },
			},
		})

		nights.push(night)

		const names = commandNames(night.log)
		const firstStart = names.indexOf('guider.start')
		const firstSlew = names.indexOf('slew')
		const firstSolve = names.indexOf('solve')
		const lastSolve = names.lastIndexOf('solve')
		const suspend = names.indexOf('guider.loop', firstStart)
		const resume = names.indexOf('guider.start', lastSolve)
		const light = names.indexOf('camera.expose', lastSolve)

		expect(night.session.state).toBe('completed')
		expect(firstStart).toBeGreaterThan(-1)
		expect(firstStart).toBeLessThan(firstSlew)
		expect(suspend).toBeGreaterThan(firstStart)
		expect(suspend).toBeLessThan(firstSlew)
		expect(suspend).toBeLessThan(firstSolve)
		expect(lastSolve).toBeGreaterThan(firstSlew)
		expect(resume).toBeGreaterThan(lastSolve)
		expect(light).toBeGreaterThan(resume)
		expect(names.indexOf('guider.start', suspend + 1)).toBe(resume)
		expect(names.indexOf('guider.calibrate')).toBe(-1)
		expect(night.artifacts.filter((artifact) => artifact.status === 'committed')).toHaveLength(1)
	}, 30_000)
})
