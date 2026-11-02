import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readImageFromFits } from 'nebulosa/src/imaging/model/image'
import { type FitsHeader, readFits, writeFits } from 'nebulosa/src/io/formats/fits/fits'
import { readFitsProvenance } from 'nebulosa/src/io/formats/fits/provenance'
import { bufferSink, bufferSource } from 'nebulosa/src/io/io'
import { CalibrationLibrary, type CalibrationLibraryEvent } from './calibrationlibrary'
import { integrateMaster, IntegrationError, type IntegrationFrame, type IntegrationProgress, type MasterWorkerRequest } from './calibrationlibrary.analysis'
import type { Integrator } from './calibrationlibrary.jobs'
import { CalibrationLibraryStore, MANIFEST_FILE, MASTER_FILE } from './calibrationlibrary.store'
import { type DarkCapturePlan, type DarkFrameRecord, DarkPlanStore, STAGING_DIRECTORY } from './darklibrarywizard.store'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-calibration-test-'))
const libraries: CalibrationLibrary[] = []

afterEach(() => {
	for (const library of libraries.splice(0)) library.close()
})

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const WIDTH = 16
const HEIGHT = 12

// Deterministic generator of small noise, in DN.
function noise(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) % 4294967296
		return Math.round((seed / 4294967296 - 0.5) * 8)
	}
}

// Writes a 16-bit FITS file of digital numbers and returns its path.
async function writeFrame(path: string, value: (x: number, y: number) => number, keywords: FitsHeader = {}) {
	const header: FitsHeader = { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: WIDTH, NAXIS2: HEIGHT, BZERO: 32768, BSCALE: 1, ...keywords }
	const raw = new Float64Array(WIDTH * HEIGHT)
	for (let y = 0, i = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++, i++) raw[i] = value(x, y) / 65535
	const buffer = Buffer.alloc(8 * 2880 + WIDTH * HEIGHT * 2)
	const sink = bufferSink(buffer)
	await writeFits(sink, [{ header, raw }], { type: false })
	writeFileSync(path, buffer.subarray(0, sink.position))
	return path
}

function directory(name: string) {
	const path = mkdtempSync(join(root, `${name}-`))
	return path
}

// A library in a directory of its own, over a plan store of its own.
function open(integrator?: Integrator, busy?: () => boolean, base = directory('library')) {
	const events: CalibrationLibraryEvent[] = []
	const plans = new DarkPlanStore(join(base, 'plans'))
	const store = new CalibrationLibraryStore(join(base, 'library'))
	const library = new CalibrationLibrary(store, plans, (event) => events.push(event), busy, integrator)
	libraries.push(library)
	return { library, plans, store, events, base }
}

// Runs integrations in this thread, so tests stay deterministic and need no worker.
const local: Integrator = { integrate: (request, onProgress) => integrateMaster(request, onProgress) }

// Holds its job until it is aborted.
function blockedIntegrator(): Integrator {
	return {
		integrate: async (_request, _onProgress, signal) => {
			const { promise, reject } = Promise.withResolvers<never>()
			signal.addEventListener('abort', () => {
				reject(new Error('Aborted'))
			})
			return await promise
		},
	}
}

// Waits until a job ends, and returns it.
async function settled(library: CalibrationLibrary, jobId: string) {
	for (let attempt = 0; attempt < 500; attempt++) {
		const job = await library.job(jobId)
		if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') return job
		await Bun.sleep(10)
	}

	throw new Error('The job never ended')
}

// Writes a complete plan with `frames` accepted dark frames in its store.
async function plan(plans: DarkPlanStore, base: string, frames: number, required = frames, patch: Partial<DarkCapturePlan> = {}) {
	const group = { groupId: 'g', key: 'g', directory: join(base, 'frames'), exposure: 60, temperature: -10, count: required }
	mkdirSync(join(group.directory, STAGING_DIRECTORY), { recursive: true })

	const dark: DarkCapturePlan = {
		version: 1,
		planId: 'plan',
		createdAt: 1,
		camera: { hardwareId: 'camera', name: 'Camera', driver: { executable: 'x', version: '1' } },
		directory: base,
		capture: { gain: 100, offset: 50, binX: 1, binY: 1, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: 'RAW16' },
		groups: [group],
		protection: { closeCover: false, panelOff: false, manualCap: true, verifyFirstFrame: true },
		thermal: { tolerance: 0.5, hold: 120, timeout: 1800 },
		maximumRejections: 3,
		...patch,
	}

	await plans.create(dark, 'session')
	const random = noise(7)

	for (let sequence = 1; sequence <= frames; sequence++) {
		const path = await writeFrame(join(group.directory, `${sequence}.fit`), (x, y) => 1000 + x + (x === 3 && y === 2 ? 3000 : 0) + random(), { IMAGETYP: 'Dark Frame', EXPTIME: 60, GAIN: 100, OFFSET: 50, XBINNING: 1, YBINNING: 1, 'CCD-TEMP': -10, READOUTM: 'RAW16' })
		const frame: DarkFrameRecord = {
			frameId: `f${sequence}`,
			groupId: 'g',
			sequence,
			path,
			size: statSync(path).size,
			time: sequence,
			verdict: 'accepted',
			planes: [],
			rejections: [],
			suspicions: [],
			notes: [],
			header: { frameType: 'Dark Frame', exposure: 60, gain: 100, offset: 50, width: WIDTH, height: HEIGHT, binning: { x: 1, y: 1 } },
		}
		await plans.append('plan', { type: 'publishing', frame })
		await plans.append('plan', { type: 'committed', frameId: frame.frameId, at: sequence })
	}

	await plans.append('plan', { type: 'status', at: 100, status: 'completed' })
	return dark
}

// Hashes every file under a directory.
function hashes(path: string) {
	const entries: Record<string, string> = {}
	for (const name of readdirSync(path, { recursive: true }) as string[]) {
		const file = join(path, name)
		if (statSync(file).isFile()) entries[name] = Bun.hash(readFileSync(file)).toString()
	}
	return entries
}

// Reads a FITS file in digital numbers.
async function readMaster(path: string) {
	const source = bufferSource(readFileSync(path))
	const fits = await readFits(source)
	return (await readImageFromFits(fits!, source, { sampleScale: 'digital', raw: 64 }))!
}

describe('plans', () => {
	test('indexes accepted frames without changing a plan, and groups them with their exact settings', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 3, 3)
		const before = hashes(join(base, 'plans'))
		const framesBefore = hashes(join(base, 'frames'))

		const { items, total } = await library.groups({}, 0, 50)

		expect(total).toBe(1)
		expect(items[0].kind).toBe('dark')
		expect(items[0].usable).toBe(3)
		expect(items[0].metadata.exposure).toEqual({ value: 60000000, evidence: 'verified' })
		expect(items[0].metadata.setTemperature).toEqual({ value: -10, evidence: 'planDeclared' })
		expect(items[0].readiness).toBe('ready')
		expect(library.snapshot().cameras).toEqual([{ id: 'camera', name: 'Camera' }])
		expect(hashes(join(base, 'plans'))).toEqual(before)
		expect(hashes(join(base, 'frames'))).toEqual(framesBefore)
	})

	test('a group short of its plan is incomplete, and a master of it is a provisional decision', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 2, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		expect(group.readiness).toBe('incomplete')

		expect(library.requestMaster({ groupId: group.groupId })).rejects.toThrow('provisional')

		const { jobId } = await library.requestMaster({ groupId: group.groupId, acknowledged: true })
		expect((await settled(library, jobId!)).state).toBe('completed')
		const [master] = (await library.masters({}, 0, 10)).items
		expect(master.status).toBe('warning')
	})

	test('a dark-flat plan stays apart from darks', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 2, 2, { purpose: 'darkFlat' })
		expect((await library.groups({}, 0, 50)).items[0].kind).toBe('darkFlat')
	})

	test('a missing file comes back, because the plan is never told it was lost', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 2)
		await library.ready()
		const path = join(base, 'frames', '1.fit')
		renameSync(path, `${path}.away`)

		await library.refresh()
		expect((await library.groups({}, 0, 50)).items[0].readiness).toBe('missingFiles')
		expect((await plans.frames('plan'))!.lost.size).toBe(0)

		renameSync(`${path}.away`, path)
		await library.refresh()
		expect((await library.groups({}, 0, 50)).items[0].unavailable).toBe(0)
	})
})

describe('catalog', () => {
	test('is rebuilt from plans, journal, and manifests when it is deleted', async () => {
		const opened = open(local)
		const { library, plans, base, store } = opened
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId, masterId } = await library.requestMaster({ groupId: group.groupId })
		await settled(library, jobId!)
		await library.prefer(masterId, 1)
		const source = store.sourcesOf()[0]
		await library.exclude(source.sourceId, 'Satellite')
		library.close()
		libraries.length = 0

		for (const name of readdirSync(join(base, 'library'))) if (name.startsWith('catalog.')) rmSync(join(base, 'library', name))

		const reopened = open(local, undefined, base)
		const master = await reopened.library.master(masterId, 1)
		expect(master.preferred).toBeTrue()
		expect(master.status).toBe('warning')
		expect((await reopened.library.source(source.sourceId)).excluded).toBe('Satellite')
	})

	test('leaves a catalog of a newer version alone', async () => {
		const { library, base } = open(local)
		await library.ready()
		library.close()
		libraries.length = 0

		const { Database } = await import('bun:sqlite')
		const database = new Database(join(base, 'library', 'catalog.sqlite'))
		database.run('PRAGMA user_version = 99')
		database.close()

		const reopened = open(local, undefined, base)
		await reopened.library.ready()
		expect(reopened.library.snapshot().unavailable).toBeTrue()
		expect(reopened.library.sources({}, 0, 10)).rejects.toThrow('newer version')
	})
})

describe('imports', () => {
	async function imported(library: CalibrationLibrary, path: string) {
		const job = await library.startImport({ path, recursive: true })
		return settled(library, job.jobId)
	}

	test('recognizes roles from headers only, skips work in progress and lights, and adds by reference', async () => {
		const { library } = open(local)
		const folder = directory('import')
		mkdirSync(join(folder, 'nested'))
		mkdirSync(join(folder, STAGING_DIRECTORY))
		const keywords = { GAIN: 0, OFFSET: 10, XBINNING: 1, YBINNING: 1, INSTRUME: 'Model' }
		await writeFrame(join(folder, 'dark-by-name.fit'), () => 100, { ...keywords, IMAGETYP: 'Bias Frame' })
		await writeFrame(join(folder, 'nested', 'b.fit'), () => 100, { ...keywords, IMAGETYP: 'Bias Frame' })
		await writeFrame(join(folder, 'light.fit'), () => 100, { ...keywords, IMAGETYP: 'Light Frame' })
		await writeFrame(join(folder, 'unknown.fit'), () => 100, keywords)
		await writeFrame(join(folder, STAGING_DIRECTORY, 'staged.fit'), () => 100, keywords)
		const before = hashes(folder)

		const job = await imported(library, folder)
		expect(job.found).toBe(4)

		const { items } = await library.importCandidates(job.jobId, 0, 50)
		expect(items.map(({ name, kind, rejectedRole }) => [name.replaceAll('\\', '/'), kind, rejectedRole])).toEqual([
			['dark-by-name.fit', 'bias', undefined],
			['light.fit', undefined, 'light'],
			['nested/b.fit', 'bias', undefined],
			['unknown.fit', undefined, undefined],
		])

		const { committed } = await library.commitImport(job.jobId, {})
		expect(committed).toBe(2)
		expect(hashes(folder)).toEqual(before)

		const [group] = (await library.groups({}, 0, 50)).items
		expect(group.total).toBe(2)
		expect(group.readiness).toBe('needsReview')
		expect(group.findings.map(({ field }) => field)).toContain('cameraId')
	})

	test('a role can be declared with its reason, and what a file states cannot be replaced', async () => {
		const { library, store } = open(local)
		const folder = directory('import')
		await writeFrame(join(folder, 'a.fit'), () => 100, { GAIN: 0 })
		const job = await imported(library, folder)
		const { items } = await library.importCandidates(job.jobId, 0, 50)

		await library.commitImport(job.jobId, { classifications: { [items[0].path]: { kind: 'bias', reason: 'Zero exposure session' } } })

		const [source] = store.sourcesOf()
		expect(source.kind).toBe('bias')
		expect(source.warnings[0]).toContain('Zero exposure session')

		expect(library.override(source.sourceId, 'gain', 5, 'No')).rejects.toThrow('cannot be replaced')

		const overridden = await library.override(source.sourceId, 'offset', 10, 'Known setup')
		expect(overridden.metadata.offset).toEqual({ value: 10, evidence: 'operatorDeclared' })
		expect(overridden.groupId).not.toBe(source.groupId)
	})

	test('copies leave the original and record it', async () => {
		const { library, store } = open(local)
		const folder = directory('import')
		await writeFrame(join(folder, 'a.fit'), () => 100, { IMAGETYP: 'Bias Frame' })
		const job = await imported(library, folder)

		await library.commitImport(job.jobId, { copy: true })

		const [source] = store.sourcesOf()
		expect(source.path).not.toContain(folder)
		expect(source.warnings.at(-1)).toContain(folder)
		expect(readdirSync(folder)).toEqual(['a.fit'])
	})

	test('a commit runs once', async () => {
		const { library } = open(local)
		const folder = directory('import')
		await writeFrame(join(folder, 'a.fit'), () => 100, { IMAGETYP: 'Bias Frame' })
		const job = await imported(library, folder)
		await library.commitImport(job.jobId, {})
		expect(library.commitImport(job.jobId, {})).rejects.toThrow('cannot be committed')
	})
})

describe('masters', () => {
	test('publishes an immutable product that reads back in digital numbers with a truthful header', async () => {
		const { library, plans, base, store } = open(local)
		await plan(plans, base, 5)
		const before = hashes(join(base, 'frames'))
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId, masterId } = await library.requestMaster({ groupId: group.groupId, acknowledged: true })
		const job = await settled(library, jobId!)
		expect(job.state).toBe('completed')
		expect(job.revision).toBe(1)

		const master = await library.master(masterId, 1)
		expect(master.calibrationState).toBe('rawBiasIncluded')
		expect(master.units).toBe('DN')
		expect(master.sourceDigests).toHaveLength(5)
		expect(master.diagnostics.lowSampleCount).toBeTrue()
		expect(master.diagnostics.hotPixels).toBeGreaterThanOrEqual(1)

		const image = await readMaster(master.path)
		expect(image.metadata.bitpix).toBe(-32)
		expect(Math.abs(image.raw[0] - 1000)).toBeLessThan(3)
		expect(Math.abs(image.raw[2 * WIDTH + 3] - 4003)).toBeLessThan(3)

		const provenance = readFitsProvenance(image.header)
		expect(provenance.frameType).toBe('dark')
		expect(provenance.master).toBeTrue()
		expect(image.header.EXPTIME).toBe(60)
		expect(image.header.BZERO).toBeUndefined()

		const manifest = JSON.parse(readFileSync(join(store.revisionDirectory(masterId, 1), MANIFEST_FILE), 'utf8'))
		expect(manifest.contentDigest).toBe(master.contentDigest)
		expect(hashes(join(base, 'frames'))).toEqual(before)
		expect(readdirSync(join(base, 'library', 'staging'))).toEqual([])
	})

	test('an equal request returns the product, and new parameters make a new revision', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const first = await library.requestMaster({ groupId: group.groupId })
		await settled(library, first.jobId!)

		const repeated = await library.requestMaster({ groupId: group.groupId })
		expect(repeated).toEqual({ masterId: first.masterId, revision: 1, state: 'completed' })

		const other = await library.requestMaster({ groupId: group.groupId, recipe: { method: 'median' } })
		const job = await settled(library, other.jobId!)
		expect(job.revision).toBe(2)
		expect((await library.masters({ masterId: first.masterId }, 0, 10)).total).toBe(2)
	})

	test('concurrent identical requests make one job, and a token its own job once', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const [a, b] = await Promise.all([library.requestMaster({ groupId: group.groupId, token: 't' }), library.requestMaster({ groupId: group.groupId, token: 't' })])
		expect(a.jobId).toBe(b.jobId)
		await settled(library, a.jobId!)
		expect((await library.masters({}, 0, 10)).total).toBe(1)
	})

	test('refuses incompatible frames with an explanation', async () => {
		const { library, plans, base, store } = open(local)
		await plan(plans, base, 2)
		await library.ready()
		const folder = directory('import')
		await writeFrame(join(folder, 'other.fit'), () => 100, { IMAGETYP: 'Dark Frame', EXPTIME: 30 })
		const job = await settled(library, (await library.startImport({ path: folder })).jobId)
		await library.commitImport(job.jobId, {})
		const sourceIds = store.sourcesOf().map(({ sourceId }) => sourceId)

		const validation = await library.validate({ sourceIds })
		expect(validation.valid).toBeFalse()
		expect(validation.findings.find(({ field }) => field === 'exposure')?.severity).toBe('blocker')
		expect(library.requestMaster({ sourceIds, acknowledged: true })).rejects.toThrow('Camera is known for some frames')
	})

	test('a frame changed after the request stops the job and publishes nothing', async () => {
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const delayed: Integrator = {
			integrate: async (request, onProgress) => {
				const result = await integrateMaster(request, onProgress)
				await gate
				return result
			},
		}

		const { library, plans, base } = open(delayed)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		await Bun.sleep(150)

		const path = join(base, 'frames', '1.fit')
		writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.alloc(2880)]))
		release()

		const job = await settled(library, jobId!)
		expect(job.state).toBe('failed')
		expect(job.code).toBe('sourceChanged')
		expect(job.error).toBe('A frame changed: 1.fit')
		expect((await library.masters({}, 0, 10)).total).toBe(0)
	})

	test('a failed job can be retried, and its failure stays in the job', async () => {
		let attempts = 0
		const flaky: Integrator = {
			integrate: (request, onProgress) => {
				if (attempts++ === 0) throw new IntegrationError('processingFailed', 'Boom')
				return integrateMaster(request, onProgress)
			},
		}

		const { library, plans, base } = open(flaky)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		expect((await settled(library, jobId!)).error).toBe('Boom')

		await library.retry(jobId!)
		expect((await settled(library, jobId!)).state).toBe('completed')
	})

	test('a job that was working when the server stopped is interrupted, never published', async () => {
		const blocked = blockedIntegrator()
		const { library, plans, base } = open(blocked)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		await Bun.sleep(30)
		library.close()
		libraries.length = 0

		const reopened = open(local, undefined, base)
		await reopened.library.ready()
		expect((await reopened.library.job(jobId!)).state).toBe('interrupted')
		expect((await reopened.library.masters({}, 0, 10)).total).toBe(0)

		await reopened.library.retry(jobId!)
		expect((await settled(reopened.library, jobId!)).state).toBe('completed')
	})

	test('a queued job resumes after a restart', async () => {
		const { library, plans, base } = open(local, () => true)
		const dark = await plan(plans, base, 3)
		expect(dark.planId).toBe('plan')
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId }, true)
		expect((await library.job(jobId!)).state).toBe('queued')
		library.close()
		libraries.length = 0

		const reopened = open(local, undefined, base)
		await reopened.library.ready()
		expect((await settled(reopened.library, jobId!)).state).toBe('completed')
	})

	test('cancels a job and removes its staging', async () => {
		const blocked = blockedIntegrator()
		const { library, plans, base } = open(blocked)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		await Bun.sleep(30)

		expect((await library.cancel(jobId!)).state).toBe('cancelled')
		await Bun.sleep(30)
		expect(readdirSync(join(base, 'library', 'staging'))).toEqual([])
		expect(library.cancel(jobId!)).rejects.toThrow('has ended')
	})

	test('a preferred revision is a pointer', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId, masterId } = await library.requestMaster({ groupId: group.groupId })
		await settled(library, jobId!)
		const file = (await library.master(masterId, 1)).path
		const before = readFileSync(file)

		expect((await library.prefer(masterId, 1)).preferred).toBeTrue()
		expect(readFileSync(file).equals(before)).toBeTrue()
	})

	test('events carry no server path', async () => {
		const { library, plans, base, events } = open(local)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		await settled(library, jobId!)

		expect(events.map(({ type }) => type)).toContain('calibrationLibrary:masterUpdated')
		expect(JSON.stringify(events)).not.toContain(join(base, 'frames').replaceAll('\\', '\\\\'))
	})
})

describe('worker', () => {
	test('integrates on a worker of its own', async () => {
		const { library, plans, base } = open()
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId, masterId } = await library.requestMaster({ groupId: group.groupId })

		expect((await settled(library, jobId!)).state).toBe('completed')
		expect((await library.master(masterId, 1)).sourceDigests).toHaveLength(3)
	})
})

describe('automatic masters', () => {
	test('a plan that asked for masters gets them once it ends, and only complete groups', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 3, 3, { generateMasters: true })
		await library.planEnded('plan')

		const { items } = await library.masters({}, 0, 10)
		const started = (await library.listJobs(0, 10)).items
		expect(started[0].automatic).toBeTrue()
		await settled(library, started[0].jobId)
		expect(items.length + (await library.masters({}, 0, 10)).total).toBe(1)
	})

	test('a plan short of frames starts nothing', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 2, 3, { generateMasters: true })
		await library.planEnded('plan')
		expect((await library.listJobs(0, 10)).total).toBe(0)
	})

	test('a plan that did not ask starts nothing', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 3)
		await library.planEnded('plan')
		expect((await library.listJobs(0, 10)).total).toBe(0)
	})

	test('a master that ended while the server was down is started on the next open, once', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 3, 3, { generateMasters: true })
		await library.ready()
		const [job] = (await library.listJobs(0, 10)).items
		expect(job.automatic).toBeTrue()
		await settled(library, job.jobId)
		library.close()
		libraries.length = 0

		const reopened = open(local, undefined, base)
		await reopened.library.ready()
		expect((await reopened.library.listJobs(0, 10)).total).toBe(1)
	})

	test('an automatic job waits for camera operations, and a manual one does not', async () => {
		let busy = true
		const { library, plans, base } = open(local, () => busy)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const automatic = await library.requestMaster({ groupId: group.groupId, token: 'a' }, true)
		await Bun.sleep(30)
		expect((await library.job(automatic.jobId!)).state).toBe('queued')

		busy = false
		library.jobs.pump()
		expect((await settled(library, automatic.jobId!)).state).toBe('completed')
	})
})

describe('flats', () => {
	const flatKeywords = { IMAGETYP: 'Flat Frame', EXPTIME: 2, GAIN: 100, OFFSET: 50, XBINNING: 1, YBINNING: 1, FILTER: 'L', TELESCOP: 'Scope', READOUTM: 'RAW16' }
	const response = (x: number, y: number) => (x === 5 && y === 5 ? 0.7 : 1) * (1 - 0.01 * x)

	// A master dark-flat at the exposure of the flats, and flats of different brightness, all registered.
	async function prepared(library: CalibrationLibrary, plans: DarkPlanStore, base: string, pedestal: number) {
		await plan(plans, base, 3, 3, { purpose: 'darkFlat', groups: [{ groupId: 'g', key: 'g', directory: join(base, 'frames'), exposure: 2, temperature: -10, count: 3 }] })
		const [darkFlat] = (await library.groups({ kind: 'darkFlat' }, 0, 50)).items
		const correction = await library.requestMaster({ groupId: darkFlat.groupId })
		await settled(library, correction.jobId!)

		const folder = directory('flats')

		for (let frame = 0; frame < 4; frame++) {
			const path = await writeFrame(join(folder, `${frame}.fit`), (x, y) => pedestal + (20000 + frame * 2000) * response(x, y), flatKeywords)
			await library.registerFlat({ path, sessionId: 's', cameraId: 'camera', cameraName: 'Camera' })
		}

		const [flat] = (await library.groups({ kind: 'flat' }, 0, 50)).items
		return { flat, correction: { masterId: correction.masterId, revision: 1 } }
	}

	test('a flat without a correction never becomes a master', async () => {
		const { library } = open(local)
		const folder = directory('flats')
		const path = await writeFrame(join(folder, 'a.fit'), () => 20000, flatKeywords)
		await library.registerFlat({ path, sessionId: 's', cameraId: 'camera', cameraName: 'Camera' })
		const [flat] = (await library.groups({ kind: 'flat' }, 0, 50)).items

		const validation = await library.validate({ groupId: flat.groupId })
		expect(validation.valid).toBeFalse()
		expect(validation.findings.map(({ code }) => code)).toContain('invalidFlatCorrection')
		expect(library.requestMaster({ groupId: flat.groupId })).rejects.toThrow('needs a master')
	})

	test('a calibrated normalized master keeps structure, drops pedestal, and depends on its correction', async () => {
		const { library, plans, base } = open(local)
		const { flat, correction } = await prepared(library, plans, base, 1000)

		const { jobId, masterId } = await library.requestMaster({ groupId: flat.groupId, correction, acknowledged: true })
		const job = await settled(library, jobId!)
		expect(job.error).toBeUndefined()

		const master = await library.master(masterId, 1)
		expect(master.calibrationState).toBe('calibratedNormalized')
		expect(master.units).toBe('dimensionless')
		expect(master.dependencies[0].masterId).toBe(correction.masterId)

		const image = await readMaster(master.path)
		expect(image.metadata.bitpix).toBe(-32)
		const at = (x: number, y: number) => image.raw[y * WIDTH + x]
		expect(at(10, 0) / at(0, 0)).toBeCloseTo(0.9, 2)
		expect(at(5, 5) / at(4, 5)).toBeCloseTo((0.7 * 0.95) / 0.96, 2)
		expect(readFitsProvenance(image.header).calibration).toEqual(['dark'])
		expect(image.header.EXPTIME).toBeUndefined()
	})

	test('a correction with another operating point is refused', async () => {
		const { library, plans, base } = open(local)
		const { flat, correction } = await prepared(library, plans, base, 1000)
		const folder = directory('bias')
		const path = await writeFrame(join(folder, 'other.fit'), () => 20000, { ...flatKeywords, GAIN: 0 })
		await library.registerFlat({ path, sessionId: 's', cameraId: 'camera', cameraName: 'Camera' })
		const other = (await library.groups({ kind: 'flat' }, 0, 50)).items.find(({ groupId }) => groupId !== flat.groupId)!

		const validation = await library.validate({ groupId: other.groupId, correction })
		expect(validation.findings.find(({ code }) => code === 'invalidFlatCorrection')?.message).toContain('Gain')
	})

	test('a saturated flat is left out and the master says so', async () => {
		const { library, plans, base } = open(local)
		const { flat, correction } = await prepared(library, plans, base, 1000)
		const path = await writeFrame(join(directory('flats'), 'hot.fit'), () => 65000, flatKeywords)
		await library.registerFlat({ path, sessionId: 's', cameraId: 'camera', cameraName: 'Camera' })

		const { jobId, masterId } = await library.requestMaster({ groupId: flat.groupId, correction, acknowledged: true })
		await settled(library, jobId!)

		const { diagnostics } = await library.master(masterId, 1)
		expect(diagnostics.integratedFrames).toBe(4)
		expect(diagnostics.excludedFrames?.[0].reason).toContain('saturation')
	})
})

describe('integration on files', () => {
	test('respects a small memory budget and gives the same pixels', async () => {
		const folder = directory('budget')
		const frames: IntegrationFrame[] = []

		for (let index = 0; index < 4; index++) {
			const path = await writeFrame(join(folder, `${index}.fit`), (x, y) => 500 + x * y + index)
			const { size, mtimeMs } = statSync(path)
			frames.push({ sourceId: `${index}`, path, bytes: size, mtimeMillis: mtimeMs })
		}

		async function run(name: string, memoryBudget: number) {
			const staging = join(folder, name)
			mkdirSync(staging)
			const seen: IntegrationProgress[] = []
			const request: MasterWorkerRequest = { jobId: name, kind: 'bias', frames, recipe: { method: 'mean', sigmaLow: 3, sigmaHigh: 3, maxIterations: 5 }, staging, header: {}, memoryBudget }
			await integrateMaster(request, (progress) => seen.push(progress))
			return { image: await readMaster(join(staging, 'product', MASTER_FILE)), seen }
		}

		const small = await run('small', 1)
		const large = await run('large', 1 << 24)
		expect(small.image.raw).toEqual(large.image.raw)
		expect(small.seen.at(-1)?.rowsCombined).toBe(HEIGHT)
		expect(small.image.raw[WIDTH + 2]).toBe(503.5)
	})

	test('refuses a frame of another shape', async () => {
		const folder = directory('shape')
		const first = await writeFrame(join(folder, 'a.fit'), () => 1)
		const buffer = Buffer.alloc(4 * 2880)
		const sink = bufferSink(buffer)
		await writeFits(sink, [{ header: { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: 4, NAXIS2: 4, BZERO: 32768, BSCALE: 1 }, raw: new Float64Array(16) }], { type: false })
		const second = join(folder, 'b.fit')
		writeFileSync(second, buffer.subarray(0, sink.position))
		const frames = [first, second].map((path, index) => ({ sourceId: `${index}`, path, bytes: statSync(path).size, mtimeMillis: statSync(path).mtimeMs }))
		const staging = join(folder, 'staging')
		mkdirSync(staging)

		expect(integrateMaster({ jobId: 'j', kind: 'bias', frames, recipe: { method: 'mean', sigmaLow: 3, sigmaHigh: 3, maxIterations: 5 }, staging, header: {}, memoryBudget: 1 << 20 }, () => undefined)).rejects.toThrow('other samples')
	})
})

describe('resolve preview', () => {
	test('explains matches from metadata alone', async () => {
		const { library, plans, base } = open(local)
		await plan(plans, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		await settled(library, jobId!)

		const exact = await library.resolvePreview({ cameraId: 'camera', width: WIDTH, height: HEIGHT, channels: 1, binX: 1, binY: 1, gain: 100, offset: 50, readoutMode: 'RAW16', exposure: 60, temperature: -10 })
		expect(exact.candidates[0].verdict).toBe('compatible')
		expect(exact.missingKinds).toEqual(['bias', 'flat'])

		const other = await library.resolvePreview({ cameraId: 'camera', width: WIDTH, height: HEIGHT, channels: 1, binX: 1, binY: 1, gain: 100, offset: 50, readoutMode: 'RAW16', exposure: 59, temperature: -10 })
		expect(other.candidates[0].verdict).toBe('incompatible')
	})
})
