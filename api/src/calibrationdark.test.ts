import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type FitsHeader, writeFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSink, bufferSource } from 'nebulosa/src/io/io'
import { assessDarkForFrame, DarkCalibrator } from './calibrationdark'
import type { CalibrationMasterSummary } from './calibrationlibrary'
import type { CalibrationMetadata } from './calibrationlibrary.compatibility'
import { readDigitalFrom } from './imagestacking.analysis'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-calibration-dark-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

const UNKNOWN = { evidence: 'unknown' } as const

// Metadata of a 32 × 24 mono 16-bit frame exposed 2 s at gain 100, with fields replaced.
function metadata(patch: Partial<CalibrationMetadata> = {}): CalibrationMetadata {
	const known = <T>(value: T) => ({ value, evidence: 'verified' as const })
	return {
		cameraName: 'ZWO ASI120MM',
		exposure: known(2000000),
		setTemperature: UNKNOWN,
		sensorTemperature: known(18),
		gain: known(100),
		offset: known(10),
		binX: known(1),
		binY: known(1),
		readoutMode: UNKNOWN,
		filter: UNKNOWN,
		telescope: UNKNOWN,
		focalLength: UNKNOWN,
		width: 32,
		height: 24,
		channels: 1,
		bitpix: 16,
		...patch,
	}
}

function master(patch: Partial<CalibrationMetadata> = {}, kind: CalibrationMasterSummary['kind'] = 'dark') {
	return { kind, metadata: metadata(patch) }
}

describe('assessment', () => {
	test('accepts the same frame settings, and reports the camera as unverified', () => {
		expect(assessDarkForFrame(metadata(), master())).toEqual({ eligible: true, unverified: ['camera', 'origin', 'readoutMode'] })
	})

	test('needs exactly the same exposure, in microseconds, and a dark', () => {
		expect(assessDarkForFrame(metadata(), master({ exposure: { value: 2000001, evidence: 'verified' } }))).toMatchObject({ eligible: false, code: 'exposureMismatch' })
		expect(assessDarkForFrame(metadata({ exposure: UNKNOWN }), master())).toMatchObject({ eligible: false, code: 'exposureUnknown' })
		expect(assessDarkForFrame(metadata(), master({ exposure: UNKNOWN }))).toMatchObject({ eligible: false, code: 'exposureUnknown' })
		expect(assessDarkForFrame(metadata(), master({}, 'bias'))).toMatchObject({ eligible: false, code: 'notDark' })
	})

	test('refuses another pixel grid: size, CFA, CFA offsets, subframe origin, or sample depth', () => {
		expect(assessDarkForFrame(metadata(), master({ width: 64 }))).toMatchObject({ code: 'geometryMismatch' })
		expect(assessDarkForFrame(metadata({ cfa: 'RGGB' }), master())).toMatchObject({ code: 'geometryMismatch' })
		expect(assessDarkForFrame(metadata({ cfa: 'RGGB', bayerOffsetX: 1 }), master({ cfa: 'RGGB', bayerOffsetX: 0 }))).toMatchObject({ code: 'geometryMismatch' })
		expect(assessDarkForFrame(metadata({ originX: 16, originY: 8 }), master({ originX: 0, originY: 0 }))).toMatchObject({ code: 'geometryMismatch' })
		// A known nonzero origin is never taken as equal to an unknown one; an unknown origin facing zero stays unverified.
		expect(assessDarkForFrame(metadata({ originX: 16, originY: 8 }), master())).toMatchObject({ code: 'geometryMismatch' })
		expect(assessDarkForFrame(metadata({ originX: 0, originY: 0 }), master())).toMatchObject({ eligible: true, unverified: expect.arrayContaining(['origin']) })
		expect(assessDarkForFrame(metadata({ originX: 0, originY: 0 }), master({ originX: 0, originY: 0 }))).toMatchObject({ eligible: true, unverified: ['camera', 'readoutMode'] })
		expect(assessDarkForFrame(metadata(), master({ bitpix: 8 }))).toMatchObject({ code: 'bitDepthMismatch' })
	})

	test('refuses a known different binning, gain, offset, readout mode, or camera, and reports the unknown ones', () => {
		expect(assessDarkForFrame(metadata(), master({ binX: { value: 2, evidence: 'verified' } }))).toMatchObject({ code: 'binningMismatch' })
		expect(assessDarkForFrame(metadata(), master({ gain: { value: 200, evidence: 'verified' } }))).toMatchObject({ code: 'gainMismatch' })
		expect(assessDarkForFrame(metadata(), master({ offset: { value: 20, evidence: 'verified' } }))).toMatchObject({ code: 'offsetMismatch' })
		expect(assessDarkForFrame(metadata({ readoutMode: { value: 'HIGH', evidence: 'verified' } }), master({ readoutMode: { value: 'LOW', evidence: 'verified' } }))).toMatchObject({ code: 'readoutMismatch' })
		expect(assessDarkForFrame(metadata(), master({ cameraName: 'QHY5III462C' }))).toMatchObject({ code: 'differentCamera' })
		expect(assessDarkForFrame(metadata({ gain: UNKNOWN, offset: UNKNOWN, binX: UNKNOWN }), master())).toEqual({ eligible: true, unverified: ['camera', 'origin', 'binning', 'gain', 'offset', 'readoutMode'] })
		expect(assessDarkForFrame(metadata({ cameraName: undefined }), master({ cameraName: 'QHY5III462C' }))).toMatchObject({ eligible: true })
	})

	test('keeps an uncooled camera without temperature usable, and refuses a known temperature too far', () => {
		expect(assessDarkForFrame(metadata({ sensorTemperature: UNKNOWN }), master())).toMatchObject({ eligible: true, unverified: expect.arrayContaining(['temperature']) })
		expect(assessDarkForFrame(metadata({ sensorTemperature: { value: 18.9, evidence: 'verified' } }), master())).toMatchObject({ eligible: true })
		expect(assessDarkForFrame(metadata({ sensorTemperature: { value: 21, evidence: 'verified' } }), master())).toMatchObject({ eligible: false, code: 'temperatureMismatch' })
		// The master's set point comes first, as the library matches it.
		expect(assessDarkForFrame(metadata(), master({ setTemperature: { value: 0, evidence: 'verified' } }))).toMatchObject({ code: 'temperatureMismatch' })
	})
})

let files = 0

// Writes a 16-bit FITS of 32 × 24 pixels at background DN with hot pixels, and returns its path.
async function fits(background: number, hot: Readonly<Record<number, number>>, extra: FitsHeader = {}, width = 32, height = 24) {
	const raw = new Float32Array(width * height).fill(background / 65535)
	for (const [index, value] of Object.entries(hot)) raw[Number(index)] = value / 65535
	const buffer = Buffer.alloc(4 * 2880 + raw.length * 2)
	const sink = bufferSink(buffer)
	await writeFits(sink, [{ header: { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: width, NAXIS2: height, BZERO: 32768, BSCALE: 1, EXPTIME: 2, ...extra }, raw }])
	const path = join(root, `frame-${files++}.fit`)
	await Bun.write(path, buffer.subarray(0, sink.position))
	return path
}

describe('subtraction', () => {
	// Hot pixel at x 5, y 7 of the 32-pixel rows.
	const HOT = 7 * 32 + 5

	test('subtracts the master from the raw samples on the same grid and leaves the asked keywords out', async () => {
		using calibrator = new DarkCalibrator()
		const framePath = await fits(2000, { [HOT]: 30000 }, { RA: 10, DEC: -80, OBJECT: 'POLE' })
		const darkPath = await fits(1000, { [HOT]: 28500 })

		const outcome = await calibrator.calibrate({ framePath, darkPath, fullScale: 65535, masterKey: '7:digest', omit: ['RA', 'DEC'] })
		if (!('bytes' in outcome)) throw new Error(outcome.failed)
		const calibrated = await readDigitalFrom(bufferSource(Buffer.from(outcome.bytes)), false)

		expect(calibrated.metadata).toMatchObject({ width: 32, height: 24, channels: 1 })
		expect(calibrated.raw[0]).toBeCloseTo(1000, 0)
		expect(calibrated.raw[HOT]).toBeCloseTo(1500, 0)
		expect(calibrated.header.OBJECT).toBe('POLE')
		expect(calibrated.header.EXPTIME).toBe(2)
		expect(calibrated.header.RA).toBeUndefined()
		expect(calibrated.header.DEC).toBeUndefined()
		// The frame file itself is left untouched.
		expect((await readDigitalFrom(bufferSource(Buffer.from(await Bun.file(framePath).arrayBuffer())), false)).raw[HOT]).toBeCloseTo(30000, 0)
	})

	test('clips a negative residual to 0 in the integer scale of the frame', async () => {
		using calibrator = new DarkCalibrator()
		const outcome = await calibrator.calibrate({ framePath: await fits(500, {}), darkPath: await fits(1000, {}), fullScale: 65535, masterKey: '8:digest', omit: [] })
		if (!('bytes' in outcome)) throw new Error(outcome.failed)
		expect((await readDigitalFrom(bufferSource(Buffer.from(outcome.bytes)), false)).raw[0]).toBe(0)
	})

	test('fails without partial output for another geometry or an unreadable master, and keeps working after', async () => {
		using calibrator = new DarkCalibrator()
		const framePath = await fits(2000, {})

		expect(await calibrator.calibrate({ framePath, darkPath: await fits(1000, {}, {}, 16, 16), fullScale: 65535, masterKey: '9:digest', omit: [] })).toMatchObject({ failed: expect.any(String) })
		expect(await calibrator.calibrate({ framePath, darkPath: join(root, 'missing.fit'), fullScale: 65535, masterKey: '10:digest', omit: [] })).toMatchObject({ failed: expect.any(String) })
		expect(await calibrator.calibrate({ framePath, darkPath: await fits(1000, {}), fullScale: 65535, masterKey: '11:digest', omit: [] })).toHaveProperty('bytes')
	})

	test('a stopped calibrator fails the job in progress', async () => {
		const calibrator = new DarkCalibrator()
		const job = calibrator.calibrate({ framePath: await fits(2000, {}), darkPath: await fits(1000, {}), fullScale: 65535, masterKey: '12:digest', omit: [] })
		calibrator[Symbol.dispose]()
		expect(await job).toEqual({ failed: 'The dark worker was stopped' })
	})
})
