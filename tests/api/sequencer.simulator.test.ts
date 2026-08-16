import { afterEach, describe, expect, test } from 'bun:test'
import { action, frame } from './sequencer.fixture'
import { commandNames, disposeNight, disposeProcess, openProcess, runNight } from './sequencer.simulator'
import type { NightResult, SimulatorProcess } from './sequencer.simulator'

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
})
