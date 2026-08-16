import { afterEach, describe, expect, test } from 'bun:test'
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
})
