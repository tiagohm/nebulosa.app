import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FlatWizardAnalyzer, type FlatMeasurementOptions } from './flatwizard.analysis'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-flatwizard-'))
const analyzer = new FlatWizardAnalyzer()

afterAll(() => {
	analyzer.dispose()
	rmSync(root, { recursive: true, force: true })
})

// Size of a FITS block, in bytes.
const BLOCK = 2880

// Writes a FITS file whose samples are the digital numbers value(x, y, channel) returns: unsigned 16-bit
// integers stored with BZERO 32768, or 32-bit floats, plus extra header cards. Returns its path.
function writeFits(name: string, width: number, height: number, value: (x: number, y: number, channel: number) => number, { channels = 1, float = false, extra = [] as readonly string[] } = {}) {
	const card = (key: string, value: string | number) => `${key.padEnd(8)}= ${String(value).padStart(20)}`
	const cards = [card('SIMPLE', 'T'), card('BITPIX', float ? -32 : 16), card('NAXIS', channels === 1 ? 2 : 3), card('NAXIS1', width), card('NAXIS2', height), ...(channels === 1 ? [] : [card('NAXIS3', channels)]), ...(float ? [] : [card('BZERO', 32768), card('BSCALE', 1)]), ...extra, 'END']
	const header = Buffer.alloc(Math.ceil((cards.length * 80) / BLOCK) * BLOCK, ' ')
	for (const [i, text] of cards.entries()) header.write(text.padEnd(80), i * 80, 'latin1')
	const size = width * height * channels
	const data = Buffer.alloc(Math.ceil((size * (float ? 4 : 2)) / BLOCK) * BLOCK)

	for (let c = 0, i = 0; c < channels; c++) {
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++, i++) {
				if (float) data.writeFloatBE(value(x, y, c), i * 4)
				else data.writeInt16BE(value(x, y, c) - 32768, i * 2)
			}
		}
	}

	const path = join(root, name)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
}

// Mono target and clipping policy in DN of a 16-bit camera.
const MONO: FlatMeasurementOptions = { effectiveClip: { upper: 65535 }, criteria: { targets: { mono: { levelMode: 'observed', range: [15000, 25000] } }, maximumClippedFraction: 0 } }

// Median of each analyzed plane, in DN.
function medians(planes: readonly { readonly plane: string; readonly observed: { readonly median?: number } }[]) {
	return Object.fromEntries(planes.map((plane) => [plane.plane, plane.observed.median]))
}

test('measures a mono frame in the digital numbers of its source', async () => {
	const path = writeFits('mono.fits', 64, 48, (x, y) => 20000 + ((x + y) % 3) - 1)
	const { analysis, sample } = await analyzer.measure(path, { exposure: 1 }, MONO, false, new AbortController().signal)

	expect(analysis.planes[0].plane).toBe('mono')
	expect(analysis.planes[0].observed.median).toBe(20000)
	expect(analysis.planes[0].clipping.upper).toMatchObject({ source: 'effective', limit: 65535, count: 0, status: 'absent' })
	expect(analysis.assessment.verdict).toBe('accepted')
	expect(sample).toBeUndefined()
})

test('rejects a frame with clipped samples and one outside the DN target', async () => {
	const clipped = writeFits('clipped.fits', 64, 48, (x, y) => (y === 0 && x < 8 ? 65535 : 20000))
	const dim = writeFits('dim.fits', 64, 48, () => 5000)
	const signal = new AbortController().signal

	const saturated = await analyzer.measure(clipped, {}, MONO, false, signal)
	expect(saturated.analysis.planes[0].clipping.upper).toMatchObject({ count: 8, status: 'present' })
	expect(saturated.analysis.assessment.verdict).toBe('rejected')

	const below = await analyzer.measure(dim, {}, MONO, false, signal)
	expect(below.analysis.planes[0].observed.median).toBe(5000)
	expect(below.analysis.assessment.reasons).toContain('targetBelowRange')
})

test('reports unknown effective clipping instead of assuming the storage limit', async () => {
	const path = writeFits('unknown-clip.fits', 64, 48, () => 20000)
	const { analysis } = await analyzer.measure(path, {}, { criteria: MONO.criteria }, false, new AbortController().signal)

	expect(analysis.planes[0].clipping.upper?.source).toBe('storage')
	expect(analysis.diagnostics.map((diagnostic) => diagnostic.code)).toContain('effectiveClipUnknown')
	expect(analysis.assessment.verdict).not.toBe('accepted')
})

test('measures every CFA plane without debayering and honors the CFA offset', async () => {
	// RGGB mosaic: red 10000, greens 20000 and 21000, blue 30000.
	const rggb = (x: number, y: number) => (y % 2 === 0 ? (x % 2 === 0 ? 10000 : 20000) : x % 2 === 0 ? 21000 : 30000)
	const path = writeFits('cfa.fits', 64, 48, rggb, { extra: ["BAYERPAT= 'RGGB    '"] })
	const shifted = writeFits('cfa-offset.fits', 64, 48, (x, y) => rggb(x + 1, y), { extra: ["BAYERPAT= 'RGGB    '", 'XBAYROFF=                    1', 'YBAYROFF=                    0'] })
	const signal = new AbortController().signal

	expect(medians((await analyzer.measure(path, {}, {}, false, signal)).analysis.planes)).toEqual({ red: 10000, green1: 20000, green2: 21000, blue: 30000 })
	expect(medians((await analyzer.measure(shifted, {}, {}, false, signal)).analysis.planes)).toEqual({ red: 10000, green1: 20000, green2: 21000, blue: 30000 })
})

test('measures each channel of an RGB frame', async () => {
	const path = writeFits('rgb.fits', 32, 24, (_x, _y, channel) => 10000 * (channel + 1), { channels: 3 })
	const { analysis } = await analyzer.measure(path, {}, {}, false, new AbortController().signal)

	expect(medians(analysis.planes)).toEqual({ red: 10000, green: 20000, blue: 30000 })
})

test('counts non-finite samples of a floating-point frame', async () => {
	const path = writeFits('nan.fits', 32, 24, (_x, y) => (y === 0 ? Number.NaN : 20000), { float: true })
	const { analysis } = await analyzer.measure(path, {}, { criteria: { maximumNonFiniteFraction: 0 } }, false, new AbortController().signal)

	expect(analysis.planes[0].observed.median).toBe(20000)
	expect(analysis.planes[0].observed.nonFinite).toBeGreaterThan(0)
	expect(analysis.assessment.verdict).toBe('rejected')
})

test('keeps the temporal sample of a final frame with its acquisition context', async () => {
	const path = writeFits('final.fits', 64, 48, () => 20000)
	const { analysis, sample } = await analyzer.measure(path, { id: 'final-1', exposure: 2.5, timestamp: 1_000_000, filter: 'L', illumination: { source: 'panel', brightness: 40 } }, MONO, true, new AbortController().signal)

	expect(sample).toMatchObject({ id: 'final-1', timestamp: 1_000_000, basis: 'observed', metadata: { width: 64, height: 48, channels: 1, exposure: 2.5, filter: 'L', illuminationBrightness: 40, digitalRange: [0, 65535] } })
	expect(sample!.profiles[0]!.row).toHaveLength(48)
	expect(sample!.analysis).toEqual(analysis)
})

test('rejects a file that is not a FITS image and stays usable', async () => {
	const path = join(root, 'text.fits')
	writeFileSync(path, 'not a fits file')
	const signal = new AbortController().signal

	await expect(analyzer.measure(path, {}, {}, false, signal)).rejects.toThrow('flat measurement failed')
	await expect(analyzer.measure(join(root, 'missing.fits'), {}, {}, false, signal)).rejects.toThrow('flat measurement failed')
	expect(
		(
			await analyzer.measure(
				writeFits('after.fits', 16, 8, () => 1000),
				{},
				{},
				false,
				signal,
			)
		).analysis.planes[0].observed.median,
	).toBe(1000)
})

test('terminates a worker that times out and starts a fresh one', async () => {
	const workers: { terminated: boolean }[] = []
	const timed = new FlatWizardAnalyzer(1, () => {
		const worker = new Worker(new URL('./flatwizard.worker.ts', import.meta.url)) as Worker & Pick<Bun.Worker, 'unref'>
		const entry = { terminated: false }
		const terminate = worker.terminate.bind(worker)
		worker.terminate = () => {
			entry.terminated = true
			terminate()
		}
		workers.push(entry)
		return worker
	})
	const path = writeFits('slow.fits', 512, 512, () => 20000)

	await expect(timed.measure(path, {}, {}, false, new AbortController().signal)).rejects.toThrow('did not finish')
	await expect(timed.measure(path, {}, {}, false, new AbortController().signal)).rejects.toThrow('did not finish')
	await Bun.sleep(10)
	expect(workers.map((worker) => worker.terminated)).toEqual([true, true])
	timed.dispose()
})

test('rejects an aborted measurement and terminates its worker', async () => {
	const terminated: boolean[] = []
	const aborting = new FlatWizardAnalyzer(60000, () => {
		const worker = new Worker(new URL('./flatwizard.worker.ts', import.meta.url)) as Worker & Pick<Bun.Worker, 'unref'>
		const index = terminated.push(false) - 1
		const terminate = worker.terminate.bind(worker)
		worker.terminate = () => {
			terminated[index] = true
			terminate()
		}
		return worker
	})
	const controller = new AbortController()
	const measured = aborting.measure(
		writeFits('aborted.fits', 1024, 1024, () => 20000),
		{},
		{},
		false,
		controller.signal,
	)
	setTimeout(() => controller.abort(new Error('stopped')), 5)

	await expect(measured).rejects.toThrow('stopped')
	await Bun.sleep(20)
	expect(terminated).toEqual([true])
	aborting.dispose()
})
