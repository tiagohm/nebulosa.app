import { afterEach, describe, expect, test } from 'bun:test'
import { action, frame } from './sequencer.fixture'
import { commandNames, disposeNight, runNight } from './sequencer.simulator'
import type { NightResult } from './sequencer.simulator'

const nights: NightResult[] = []

afterEach(async () => {
	await Promise.all(nights.splice(0).map((night) => disposeNight(night)))
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
})
