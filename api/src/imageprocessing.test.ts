import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readImageFromPath } from 'nebulosa/src/imaging/model/image'
import { gaussianBlur } from 'nebulosa/src/imaging/processing/convolution'
import { verticalFlip } from 'nebulosa/src/imaging/processing/geometry'
import { multiscaleLinearTransform } from 'nebulosa/src/imaging/processing/mlt'
import { checkPipeline, createImageProcessingRoutes, type ImageProcessingEvent, type ImageProcessingJob, type ImageProcessingOperation, ImageProcessingService, type ImageProcessingStep } from './imageprocessing'
import { type ImageInfo, ImageStore } from './images'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-processing-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Size of a FITS block, in bytes.
const BLOCK = 2880

let files = 0

// Writes an 8-bit FITS file with a gradient (grayscale, or RGB with 3 channels) plus extra header cards, and returns
// its path.
function writeFits(width: number, height: number, channels = 1, extra: readonly string[] = []) {
	const axes = channels === 1 ? ['NAXIS   =                    2'] : ['NAXIS   =                    3']
	const cards = ['SIMPLE  =                    T', 'BITPIX  =                    8', ...axes, `NAXIS1  = ${String(width).padStart(20)}`, `NAXIS2  = ${String(height).padStart(20)}`, ...(channels === 1 ? [] : [`NAXIS3  = ${String(channels).padStart(20)}`]), "OBJECT  = 'M31     '", ...extra, 'END']
	const header = Buffer.alloc(BLOCK, ' ')
	for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
	const size = width * height * channels
	const data = Buffer.alloc(Math.ceil(size / BLOCK) * BLOCK)
	for (let i = 0; i < size; i++) data[i] = (i * 37) % 251
	const path = join(root, `image-${files++}.fits`)
	writeFileSync(path, Buffer.concat([header, data]))
	return path
}

// Writes a 64-bit floating-point FITS file whose samples (1000 + 250.5 i) lie outside 0..1 and returns its path
// and samples.
function writeFloatFits(width: number, height: number) {
	const cards = ['SIMPLE  =                    T', 'BITPIX  =                  -64', 'NAXIS   =                    2', `NAXIS1  = ${String(width).padStart(20)}`, `NAXIS2  = ${String(height).padStart(20)}`, 'END']
	const header = Buffer.alloc(BLOCK, ' ')
	for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
	const samples = Array.from({ length: width * height }, (_, i) => 1000 + i * 250.5)
	const data = Buffer.alloc(Math.ceil((samples.length * 8) / BLOCK) * BLOCK)
	for (const [i, sample] of samples.entries()) data.writeDoubleBE(sample, i * 8)
	const path = join(root, `float-${files++}.fits`)
	writeFileSync(path, Buffer.concat([header, data]))
	return { path, samples }
}

let steps = 0

// Returns a step of an operation with a fresh id.
function step(operation: ImageProcessingOperation): ImageProcessingStep {
	return { id: `step-${steps++}`, operation }
}

// A store and a service of their own, the events they published, and their routes.
function setup(claimGrace?: number) {
	const images = new ImageStore()
	const events: ImageProcessingEvent[] = []
	const service = new ImageProcessingService(images, (event) => events.push(event), claimGrace)
	return { images, events, service, routes: createImageProcessingRoutes(service) }
}

type Handler = (req: Request & { params: Record<string, string> }) => Response | Promise<Response>

function call(routes: ReturnType<typeof createImageProcessingRoutes>, route: keyof ReturnType<typeof createImageProcessingRoutes>, method: 'GET' | 'POST', params: Record<string, string>, body?: unknown) {
	const handler = (routes[route] as Record<string, Handler>)[method]
	const req = Object.assign(new Request('http://localhost/', { method, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
	return Promise.resolve(handler(req))
}

// Waits for the end of a job and returns its final state.
async function ended(events: readonly ImageProcessingEvent[], jobId: string): Promise<ImageProcessingJob> {
	for (let i = 0; i < 1000; i++) {
		const last = events.findLast((event) => event.job.jobId === jobId)?.job
		if (last && (last.state === 'completed' || last.state === 'failed' || last.state === 'cancelled')) return last
		await Bun.sleep(10)
	}

	throw new Error(`job ${jobId} did not end`)
}

// Submits a pipeline through the service and returns its job, failing on any refusal.
function submit(service: ImageProcessingService, imageId: string, pipeline: readonly ImageProcessingStep[]): ImageProcessingJob {
	const outcome = service.submit(imageId, { steps: pipeline })
	if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.status}`)
	return outcome.job
}

const BLUR: ImageProcessingOperation = { type: 'gaussianBlur', sigma: 1.2, size: 5 }
const MLT: ImageProcessingOperation = { type: 'mlt', layers: 2, detailLayers: [{ threshold: 1, amount: 0.5, bias: 0.2 }], residualGain: 1 }

describe('compatibility', () => {
	test('follows the channels and CFA pattern each step produces', () => {
		const debayer = step({ type: 'debayer', pattern: 'auto' })
		const neutralize = step({ type: 'backgroundNeutralization', lowerLimit: 0, upperLimit: 1, targetBackground: 0.05, mode: 'rescaleAsNeeded' })
		const gray = step({ type: 'grayscale', channel: 'GRAY' })
		const blur = step(BLUR)
		const flip = step({ type: 'horizontalFlip' })
		const cosmetic = step({ type: 'cosmeticCorrection', hotSigma: 3, coldSigma: 3, windowRadius: 1, amount: 1 })

		expect(checkPipeline({ channels: 1, cfa: 'RGGB' }, [flip, cosmetic, debayer, neutralize, gray, blur])).toBeUndefined()
		expect(checkPipeline({ channels: 1, cfa: 'RGGB' }, [blur])).toEqual({ stepId: blur.id, error: expect.any(String) })
		expect(checkPipeline({ channels: 1 }, [debayer])?.stepId).toBe(debayer.id)
		expect(checkPipeline({ channels: 1 }, [step({ type: 'debayer', pattern: 'GRBG' })])).toBeUndefined()
		expect(checkPipeline({ channels: 3 }, [debayer])?.stepId).toBe(debayer.id)
		expect(checkPipeline({ channels: 1 }, [neutralize])?.stepId).toBe(neutralize.id)
		expect(checkPipeline({ channels: 3 }, [gray, neutralize])?.stepId).toBe(neutralize.id)
	})
})

describe('execution', () => {
	test('applies the steps in order to a copy and adopts one derived document', async () => {
		const { images, events, service } = setup()
		const source = await images.open(writeFits(32, 16, 1, ["CTYPE1  = 'RA---TAN'", "CTYPE2  = 'DEC--TAN'", 'CRPIX1  =                 10.0', 'CRPIX2  =                  4.0', 'CD1_1   =               0.0001', 'CD2_2   =               0.0001']))
		const before = (await images.processingImage(source.id))!
		const pipeline = [step(BLUR), step({ type: 'verticalFlip' }), step(BLUR), step(MLT)]

		const job = await ended(events, submit(service, source.id, pipeline).jobId)
		const output = (await images.processingImage(job.outputImageId!))!
		const info = service.claim(job.jobId)

		const expected = (await images.processingImage(source.id))!
		gaussianBlur(expected, BLUR)
		verticalFlip(expected)
		gaussianBlur(expected, BLUR)
		multiscaleLinearTransform(expected, MLT)

		expect(job).toMatchObject({ state: 'completed', completedSteps: 4, steps: pipeline })
		expect(job.currentStepIndex).toBeUndefined()
		expect(events.filter((event) => event.job.jobId === job.jobId).map((event) => event.job.currentStepIndex)).toEqual([undefined, undefined, 0, 1, 2, 3, undefined])
		expect(Array.from(output.raw)).toEqual(Array.from(expected.raw))
		expect(Array.from((await images.processingImage(source.id))!.raw)).toEqual(Array.from(before.raw))
		expect(info.status).toBe('claimed')

		const derived = (info as { readonly info: ImageInfo }).info
		expect(derived).toMatchObject({ origin: 'derived', id: job.outputImageId, width: 32, height: 16, channels: 1, provenance: { kind: 'processing', source: source.id, steps: pipeline } })
		expect(derived.header).toMatchObject({ BITPIX: -32, NAXIS: 2, CRPIX2: 13, OBJECT: 'M31' })
		expect(String(derived.header.HISTORY)).toContain('Processing 4/4: {"type":"mlt"')
	})

	test('debayer then grayscale makes a mono image without CFA keywords, and a flip keeps a mosaic in phase', async () => {
		const { images, events, service } = setup()
		const source = await images.open(writeFits(16, 8, 1, ["BAYERPAT= 'RGGB    '"]))

		const gray = await ended(events, submit(service, source.id, [step({ type: 'debayer', pattern: 'auto' }), step({ type: 'grayscale', channel: 'GREEN' })]).jobId)
		const flipped = await ended(events, submit(service, source.id, [step({ type: 'horizontalFlip' })]).jobId)
		const grayInfo = service.claim(gray.jobId) as { readonly info: ImageInfo }
		const flippedInfo = service.claim(flipped.jobId) as { readonly info: ImageInfo }

		expect(grayInfo.info).toMatchObject({ channels: 1, header: { NAXIS: 2 } })
		expect(grayInfo.info.cfa).toBeUndefined()
		expect(grayInfo.info.header.BAYERPAT).toBeUndefined()
		expect(flippedInfo.info).toMatchObject({ channels: 1, cfa: 'GRBG', header: { BAYERPAT: 'GRBG' } })
	})

	test('saving restores the scale of the source', async () => {
		const { images, events, service } = setup()
		const { path, samples } = writeFloatFits(16, 8)
		const source = await images.open(path)
		const job = await ended(events, submit(service, source.id, [step({ type: 'horizontalFlip' })]).jobId)
		const target = join(root, 'processed.fits')

		expect(await images.save(job.outputImageId!, { path: target, format: 'fits' })).toEqual({ status: 'saved', path: target })
		const reread = (await readImageFromPath(target, { sampleScale: 'digital', raw: 64 }))!

		for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) expect(reread.raw[y * 16 + x]).toBeCloseTo(samples[y * 16 + 15 - x], 6)
	})

	test('a step that throws fails the job with its id and adopts nothing', async () => {
		const { images, events, service } = setup()
		const source = await images.open(writeFits(16, 8))
		const bad = step({ type: 'gaussianBlur', sigma: 10, size: 5 })

		const job = await ended(events, submit(service, source.id, [step(BLUR), bad]).jobId)

		expect(job).toMatchObject({ state: 'failed', code: 'processingFailed', errorStepId: bad.id, completedSteps: 1 })
		expect(job.outputImageId).toBeUndefined()
		expect(service.claim(job.jobId)).toEqual({ status: 'invalidState' })

		// The worker survives a step that threw.
		expect((await ended(events, submit(service, source.id, [step(BLUR)]).jobId)).state).toBe('completed')
	})

	test('a source closed while its job waits is still processed', async () => {
		const { images, events, service } = setup()
		const source = await images.open(writeFits(16, 8))
		const { jobId } = submit(service, source.id, [step(BLUR)])
		images.close(source.id)

		expect((await ended(events, jobId)).state).toBe('completed')
		expect(images.name(source.id)).toBeUndefined()
	})
})

describe('scheduling', () => {
	test('refuses a second pipeline of the same image and a full queue', async () => {
		const { images, events, service } = setup()
		const sources = await Promise.all(Array.from({ length: 18 }, () => images.open(writeFits(8, 8))))
		const jobs = sources.slice(0, 17).map((source) => submit(service, source.id, [step(BLUR)]))

		expect(service.submit(sources[0].id, { steps: [step(BLUR)] })).toEqual({ status: 'busy', job: expect.objectContaining({ jobId: jobs[0].jobId }) })
		expect(service.submit(sources[17].id, { steps: [step(BLUR)] })).toEqual({ status: 'queueFull' })

		for (const job of jobs) await ended(events, job.jobId)
	})

	test('cancels a waiting and a running job without adopting a document', async () => {
		const { images, events, service } = setup()
		const first = await images.open(writeFits(16, 8))
		const second = await images.open(writeFits(16, 8))
		const running = submit(service, first.id, [step(BLUR)])
		const waiting = submit(service, second.id, [step(BLUR)])

		expect(service.cancel(waiting.jobId)).toBeTrue()
		expect(service.cancel(running.jobId)).toBeTrue()

		expect(await ended(events, waiting.jobId)).toMatchObject({ state: 'cancelled', code: 'cancelled' })
		expect(await ended(events, running.jobId)).toMatchObject({ state: 'cancelled', code: 'cancelled' })
		expect(service.cancel(running.jobId)).toBeFalse()
		expect(events.some((event) => event.job.outputImageId !== undefined)).toBeFalse()
	})
})

describe('claims', () => {
	test('hand the same document again while it is open, and expire once it is closed', async () => {
		const { images, events, service } = setup()
		const source = await images.open(writeFits(16, 8))
		const job = await ended(events, submit(service, source.id, [step(BLUR)]).jobId)

		const first = service.claim(job.jobId)
		expect(first).toMatchObject({ status: 'claimed', info: { id: job.outputImageId } })
		expect(service.claim(job.jobId)).toEqual(first)

		images.close(job.outputImageId!)
		expect(service.claim(job.jobId)).toEqual({ status: 'expired' })
		expect(service.claim('unknown')).toEqual({ status: 'notFound' })
	})

	test('close the document of a job never claimed after the grace period', async () => {
		const { images, events, service } = setup(20)
		const source = await images.open(writeFits(16, 8))
		const job = await ended(events, submit(service, source.id, [step(BLUR)]).jobId)

		expect(images.name(job.outputImageId!)).toBeDefined()
		await Bun.sleep(60)
		expect(images.name(job.outputImageId!)).toBeUndefined()
		expect(service.claim(job.jobId)).toEqual({ status: 'expired' })
	})
})

describe('routes', () => {
	test('submit, snapshot, job, claim, and refusals', async () => {
		const { images, events, routes } = setup()
		const mono = await images.open(writeFits(16, 8))
		const neutralize = step({ type: 'backgroundNeutralization', lowerLimit: 0, upperLimit: 1, targetBackground: 0.05, mode: 'rescaleAsNeeded' })

		const incompatible = await call(routes, '/api/images/:id/processing', 'POST', { id: mono.id }, { steps: [step(BLUR), neutralize] })
		expect(incompatible.status).toBe(422)
		expect(await incompatible.json()).toMatchObject({ code: 'incompatibleImage', stepId: neutralize.id })
		expect((await call(routes, '/api/images/:id/processing', 'POST', { id: 'missing' }, { steps: [step(BLUR)] })).status).toBe(404)

		const accepted = await call(routes, '/api/images/:id/processing', 'POST', { id: mono.id }, { steps: [step(BLUR)] })
		const job = (await accepted.json()) as ImageProcessingJob
		expect(accepted.status).toBe(202)

		const busy = await call(routes, '/api/images/:id/processing', 'POST', { id: mono.id }, { steps: [step(BLUR)] })
		expect(busy.status).toBe(409)
		expect(await busy.json()).toMatchObject({ code: 'busy', job: { jobId: job.jobId } })
		expect((await call(routes, '/api/image-processing/:jobId/claim', 'POST', { jobId: job.jobId })).status).toBe(409)

		await ended(events, job.jobId)
		expect(((await (await call(routes, '/api/image-processing', 'GET', {})).json()) as { jobs: ImageProcessingJob[] }).jobs.map((j) => j.jobId)).toEqual([job.jobId])
		expect(await (await call(routes, '/api/image-processing/:jobId', 'GET', { jobId: job.jobId })).json()).toMatchObject({ state: 'completed' })
		expect(await (await call(routes, '/api/image-processing/:jobId/claim', 'POST', { jobId: job.jobId })).json()).toMatchObject({ origin: 'derived', provenance: { kind: 'processing' } })
		expect((await call(routes, '/api/image-processing/:jobId/cancel', 'POST', { jobId: job.jobId })).status).toBe(404)
		expect((await call(routes, '/api/image-processing/:jobId', 'GET', { jobId: 'unknown' })).status).toBe(404)
	})
})
