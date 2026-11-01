import { describe, expect, test } from 'bun:test'
import type { CalibrationGroupSummary, CalibrationMetadata } from 'api'
import { bytesText, coverage, exposureText, groupTitle, jobFraction, overrideIsText, temperatureText } from './library'

const unknown = { evidence: 'unknown' } as const
const verified = <T>(value: T) => ({ value, evidence: 'verified' }) as const

function metadata(patch: Partial<CalibrationMetadata> = {}): CalibrationMetadata {
	return {
		cameraId: verified('camera'),
		cameraName: 'Camera',
		exposure: verified(180000000),
		setTemperature: verified(-10),
		sensorTemperature: verified(-10.2),
		gain: verified(100),
		offset: verified(50),
		binX: verified(4),
		binY: verified(4),
		readoutMode: unknown,
		filter: unknown,
		telescope: unknown,
		focalLength: unknown,
		width: 100,
		height: 80,
		channels: 1,
		bitpix: 16,
		...patch,
	}
}

function group(kind: CalibrationGroupSummary['kind'], patch: Partial<CalibrationGroupSummary> = {}): CalibrationGroupSummary {
	return { groupId: kind, kind, metadata: metadata(), total: 1, usable: 1, unavailable: 0, excluded: 0, warned: 0, readiness: 'ready', findings: [], masters: [], ...patch }
}

describe('text', () => {
	test('an exposure keeps the seconds an operator chose', () => {
		expect(exposureText(metadata({ exposure: verified(179900000) }))).toBe('179.9 s')
		expect(exposureText(metadata({ exposure: unknown }))).toBe('—')
	})

	test('a temperature never reads as a setpoint it did not have', () => {
		expect(temperatureText(metadata())).toBe('-10 °C')
		expect(temperatureText(metadata({ setTemperature: unknown }))).toBe('~-10.2 °C')
		expect(temperatureText(metadata({ setTemperature: unknown, sensorTemperature: unknown }))).toBe('Unverified')
	})

	test('a group is named by what distinguishes it in its role', () => {
		expect(groupTitle(group('dark'))).toBe('180 s · -10 °C')
		expect(groupTitle(group('bias'))).toBe('100×80')
		expect(groupTitle(group('flat', { metadata: metadata({ filter: verified('L') }) }))).toBe('L · 180 s')
	})

	test('sizes', () => {
		expect(bytesText(512)).toBe('512 B')
		expect(bytesText(1536)).toBe('1.5 KiB')
		expect(bytesText(1024 ** 3)).toBe('1.00 GiB')
	})

	test('a declared field has the kind of input it needs', () => {
		expect(overrideIsText('filter')).toBeTrue()
		expect(overrideIsText('gain')).toBeFalse()
	})
})

describe('coverage', () => {
	test('shows what exists for each operating point, and an unavailable master does not count', () => {
		const master = { masterId: 'm', revision: 1, kind: 'dark', calibrationState: 'rawBiasIncluded', units: 'DN', metadata: metadata(), frames: 1, method: 'mean', preferred: false, createdAt: 1, status: 'ready', groupId: 'g', dependencies: [] } as const
		const rows = coverage([group('dark', { masters: [master] }), group('dark', { masters: [{ ...master, status: 'unavailable' }] }), group('bias'), group('flat', { metadata: metadata({ gain: verified(0) }) })])

		expect(rows).toHaveLength(2)
		expect(rows[0].kinds.dark).toEqual({ groups: 2, masters: 1 })
		expect(rows[0].kinds.bias).toEqual({ groups: 1, masters: 0 })
		expect(rows[1].kinds.flat.groups).toBe(1)
	})
})

describe('jobs', () => {
	test('progress comes from rows once there are any', () => {
		const progress = { framesValidated: 5, rowsCombined: 0, rowsTotal: 0, bytesWritten: 0 }
		expect(jobFraction({ progress, frames: 10 })).toBe(0.5)
		expect(jobFraction({ progress: { ...progress, rowsCombined: 3, rowsTotal: 12 }, frames: 10 })).toBe(0.25)
		expect(jobFraction({ progress })).toBe(0)
	})
})
