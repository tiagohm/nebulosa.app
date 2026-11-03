import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readImageFromFits } from 'nebulosa/src/imaging/model/image'
import { type FitsHeader, readFits, writeFits } from 'nebulosa/src/io/formats/fits/fits'
import { readFitsProvenance } from 'nebulosa/src/io/formats/fits/provenance'
import { bufferSink, bufferSource } from 'nebulosa/src/io/io'
import { CalibrationLibrary, type CalibrationLibraryEvent } from './calibrationlibrary'
import { integrateMaster, IntegrationError, type IntegrationFrame, type IntegrationProgress, type MasterWorkerRequest } from './calibrationlibrary.analysis'
import type { Integrator } from './calibrationlibrary.jobs'
import { CalibrationLibraryStore, MASTER_FILE } from './calibrationlibrary.store'
import { type DarkCapturePlan, type DarkFrameRecord, STAGING_DIRECTORY } from './darklibrarywizard.plan'
import { AppDatabase } from './database'

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

// Database of each directory, kept so a library opened again reads the same frames and masters.
const databases = new Map<string, AppDatabase>()

// A library in a directory of its own, over a database of its own.
function open(integrator?: Integrator, busy?: () => boolean, base = directory('library')) {
	const events: CalibrationLibraryEvent[] = []
	const database = databases.get(base) ?? AppDatabase.memory()
	databases.set(base, database)
	const store = new CalibrationLibraryStore(database, join(base, 'library'))
	const library = new CalibrationLibrary(store, (event) => events.push(event), busy, integrator)
	libraries.push(library)
	return { library, store, events, base }
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
	for (let attempt = 0; attempt < 2000; attempt++) {
		const job = await library.job(jobId)
		if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') return job
		await Bun.sleep(10)
	}

	throw new Error('The job never ended')
}

// Requests a master, waits for its job, and returns the id of what it published.
async function built(library: CalibrationLibrary, request: Parameters<CalibrationLibrary['requestMaster']>[0]) {
	const { jobId } = await library.requestMaster(request)
	const job = await settled(library, jobId)
	expect(job.state).toBe('completed')
	return job.masterId!
}

// Writes `frames` accepted dark frames of a plan and registers them in a library, as its session publishes them.
async function plan(library: CalibrationLibrary, base: string, frames: number, required = frames, patch: Partial<DarkCapturePlan> = {}) {
	const directory = join(base, 'frames')
	const group = { groupId: 'g', key: 'g', exposure: 60, temperature: -10, count: required }
	mkdirSync(directory, { recursive: true })

	const dark: DarkCapturePlan = {
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

	const random = noise(7)

	for (let sequence = 1; sequence <= frames; sequence++) {
		const path = await writeFrame(join(directory, `${sequence}.fit`), (x, y) => 1000 + x + (x === 3 && y === 2 ? 3000 : 0) + random(), { IMAGETYP: 'Dark Frame', EXPTIME: 60, GAIN: 100, OFFSET: 50, XBINNING: 1, YBINNING: 1, 'CCD-TEMP': -10, READOUTM: 'RAW16' })
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
		await library.registerDark({ plan: dark, groupId: 'g', frame })
	}

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

describe('darks', () => {
	test('registers accepted frames without changing them, and groups them with their exact settings', async () => {
		const { library, base } = open(local)
		await plan(library, base, 3, 3)
		const framesBefore = hashes(join(base, 'frames'))

		const { items, total } = await library.groups({}, 0, 50)

		expect(total).toBe(1)
		expect(items[0].kind).toBe('dark')
		expect(items[0].usable).toBe(3)
		expect(items[0].metadata.exposure).toEqual({ value: 60000000, evidence: 'verified' })
		expect(items[0].metadata.setTemperature).toEqual({ value: -10, evidence: 'planDeclared' })
		expect(items[0].readiness).toBe('ready')
		expect(library.snapshot().cameras).toEqual(['Camera'])
		expect(hashes(join(base, 'frames'))).toEqual(framesBefore)
	})

	test('a group short of its plan is incomplete, and a master of it is a provisional decision', async () => {
		const { library, base } = open(local)
		await plan(library, base, 2, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		expect(group.readiness).toBe('incomplete')

		await expect(library.requestMaster({ groupId: group.groupId })).rejects.toThrow('provisional')

		const { jobId } = await library.requestMaster({ groupId: group.groupId, acknowledged: true })
		expect((await settled(library, jobId)).state).toBe('completed')
		const [master] = (await library.masters({}, 0, 10)).items
		expect(master.status).toBe('warning')
	})

	test('a dark-flat plan stays apart from darks', async () => {
		const { library, base } = open(local)
		await plan(library, base, 2, 2, { purpose: 'darkFlat' })
		expect((await library.groups({}, 0, 50)).items[0].kind).toBe('darkFlat')
	})

	test('a missing file comes back once it is there again', async () => {
		const { library, base } = open(local)
		await plan(library, base, 2)
		await library.ready()
		const path = join(base, 'frames', '1.fit')
		renameSync(path, `${path}.away`)

		await library.refresh()
		expect((await library.groups({}, 0, 50)).items[0].readiness).toBe('missingFiles')

		renameSync(`${path}.away`, path)
		await library.refresh()
		expect((await library.groups({}, 0, 50)).items[0].unavailable).toBe(0)
	})
})

// Closes the libraries opened so far, as a stopped server does.
function stop() {
	for (const library of libraries.splice(0)) library.close()
}

// Builds the master of a plan of 3 frames and returns it with its library.
async function published() {
	const opened = open(local)
	await plan(opened.library, opened.base, 3)
	const [group] = (await opened.library.groups({}, 0, 50)).items
	const masterId = await built(opened.library, { groupId: group.groupId })
	return { ...opened, group, masterId, directory: opened.store.masterDirectory(masterId) }
}

// Changes the publication of every master, as a crash in the middle of one leaves it.
function interrupt(store: CalibrationLibraryStore, publication: 'publishing' | 'deleting') {
	store.database.db.run(`UPDATE calibration_masters SET publication = '${publication}'`)
}

describe('restart', () => {
	test('keeps what an operator declared and every master', async () => {
		const opened = open(local)
		const { library, base, store } = opened
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const masterId = await built(library, { groupId: group.groupId })
		const source = store.sourcesOf()[0]
		await library.exclude(source.sourceId, true)
		stop()

		const reopened = open(local, undefined, base)
		const master = await reopened.library.master(masterId)
		expect(master.status).toBe('warning')
		expect((await reopened.library.source(source.sourceId)).excluded).toBeTrue()
	})

	test('a crash after the rename and before the commit publishes the master', async () => {
		const { store, base, masterId } = await published()
		stop()
		interrupt(store, 'publishing')

		const reopened = open(local, undefined, base)
		expect((await reopened.library.master(masterId)).masterId).toBe(masterId)
		expect((await reopened.library.masters({}, 0, 10)).total).toBe(1)
	})

	test('a crash before the rename forgets the master and never uses its id again', async () => {
		const { store, base, masterId, directory, group } = await published()
		stop()
		interrupt(store, 'publishing')
		rmSync(directory, { recursive: true })

		const reopened = open(local, undefined, base)
		await expect(reopened.library.master(masterId)).rejects.toThrow('Unknown master')
		const again = await built(reopened.library, { groupId: group.groupId })
		expect(again).toBe(masterId + 1)
		expect((await reopened.library.masters({}, 0, 10)).items.map((master) => master.masterId)).toEqual([again])
	})

	test('a published file that is not the recorded one is never adopted, and moves to orphaned', async () => {
		const { store, base, masterId, directory } = await published()
		stop()
		interrupt(store, 'publishing')
		writeFileSync(join(directory, MASTER_FILE), 'not the master')

		const reopened = open(local, undefined, base)
		await expect(reopened.library.master(masterId)).rejects.toThrow('Unknown master')
		expect(existsSync(directory)).toBeFalse()
		const [orphan] = readdirSync(join(base, 'library', 'orphaned'))
		expect(orphan.startsWith(`${masterId}-`)).toBeTrue()
		expect(readFileSync(join(base, 'library', 'orphaned', orphan, MASTER_FILE), 'utf8')).toBe('not the master')
	})

	test('a crash while deleting finishes the deletion', async () => {
		const { store, base, masterId, directory } = await published()
		stop()
		interrupt(store, 'deleting')

		const reopened = open(local, undefined, base)
		await expect(reopened.library.master(masterId)).rejects.toThrow('Unknown master')
		expect(existsSync(directory)).toBeFalse()
		expect(store.hasMaster(masterId)).toBeFalse()
	})

	test('a master directory without a row moves to orphaned, never adopted nor deleted', async () => {
		const { library, base } = open(local)
		await library.ready()
		stop()
		const directory = join(base, 'library', 'products', '7')
		mkdirSync(directory, { recursive: true })
		writeFileSync(join(directory, MASTER_FILE), 'kept')

		const reopened = open(local, undefined, base)
		await reopened.library.ready()
		expect(existsSync(directory)).toBeFalse()
		const [orphan] = readdirSync(join(base, 'library', 'orphaned'))
		expect(orphan.startsWith('7-')).toBeTrue()
		expect((await reopened.library.masters({}, 0, 10)).total).toBe(0)
	})

	test('a master whose file went away is unavailable, and ready again once it is back', async () => {
		const { store, base, masterId, directory } = await published()
		stop()
		renameSync(join(directory, MASTER_FILE), join(base, MASTER_FILE))
		expect((await open(local, undefined, base).library.master(masterId)).status).toBe('unavailable')
		expect((await libraries[0].masters({ status: 'unavailable' }, 0, 10)).total).toBe(1)

		stop()
		renameSync(join(base, MASTER_FILE), join(directory, MASTER_FILE))
		expect((await open(local, undefined, base).library.master(masterId)).status).toBe('warning')
		expect(store.allMasters()).toHaveLength(1)
	})

	test('writes no catalog, journal, or manifest', async () => {
		const { base, directory } = await published()
		expect(readdirSync(join(base, 'library')).toSorted()).toEqual(['products', 'staging'])
		expect(readdirSync(directory)).toEqual([MASTER_FILE])
	})
})

describe('imports', () => {
	async function imported(library: CalibrationLibrary, path: string) {
		const job = await library.startImport({ paths: [path], recursive: true })
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
		expect(group.readiness).toBe('ready')
		expect(group.metadata.cameraName).toBe('Model')
	})

	test('scans directories and single files together, finds a file once, and refuses a path it cannot read', async () => {
		const { library } = open(local)
		const folder = directory('import')
		const other = directory('single')
		const keywords = { GAIN: 0, IMAGETYP: 'Bias Frame' }
		await writeFrame(join(folder, 'a.fit'), () => 100, keywords)
		const single = join(other, 'b.fit')
		await writeFrame(single, () => 100, keywords)

		const job = await settled(library, (await library.startImport({ paths: [folder, single, join(folder, 'a.fit')] })).jobId)
		expect(job.found).toBe(2)
		const { items } = await library.importCandidates(job.jobId, 0, 50)
		expect(items.map(({ name, kind }) => [name, kind])).toEqual([
			['a.fit', 'bias'],
			['b.fit', 'bias'],
		])
		expect((await library.commitImport(job.jobId, {})).committed).toBe(2)

		await expect(library.startImport({ paths: [join(other, 'missing.fit')] })).rejects.toThrow('missing.fit cannot be read')
	})

	test('a role can be declared, and what a file states cannot be replaced', async () => {
		const { library, store } = open(local)
		const folder = directory('import')
		await writeFrame(join(folder, 'a.fit'), () => 100, { GAIN: 0 })
		const job = await imported(library, folder)
		const { items } = await library.importCandidates(job.jobId, 0, 50)

		await library.commitImport(job.jobId, { classifications: { [items[0].path]: 'bias' } })

		const [source] = store.sourcesOf()
		expect(source.kind).toBe('bias')
		expect(source.warnings[0]).toBe('Role declared by an operator')

		await expect(library.override(source.sourceId, 'gain', 5)).rejects.toThrow('cannot be replaced')

		const overridden = await library.override(source.sourceId, 'offset', 10)
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
		await expect(library.commitImport(job.jobId, {})).rejects.toThrow('cannot be committed')
	})
})

describe('masters', () => {
	test('publishes an immutable product that reads back in digital numbers with a truthful header', async () => {
		const { library, base, store } = open(local)
		await plan(library, base, 5)
		const before = hashes(join(base, 'frames'))
		const [group] = (await library.groups({}, 0, 50)).items
		const masterId = await built(library, { groupId: group.groupId, acknowledged: true })
		const master = await library.master(masterId)
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

		expect(readdirSync(store.masterDirectory(masterId))).toEqual([MASTER_FILE])
		expect(master.contentDigest).toMatch(/^[0-9a-f]{64}$/)
		expect(hashes(join(base, 'frames'))).toEqual(before)
		expect(readdirSync(join(base, 'library', 'staging'))).toEqual([])
	})

	test('every request builds a new master with the next id, even of the same frames and recipe', async () => {
		const { library, base } = open(local)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const first = await built(library, { groupId: group.groupId })
		const second = await built(library, { groupId: group.groupId })

		expect(second).toBe(first + 1)
		expect((await library.masters({ groupId: group.groupId }, 0, 10)).items.map(({ masterId }) => masterId)).toEqual([second, first])
		expect((await library.group(group.groupId)).masters.map(({ masterId }) => masterId)).toEqual([second, first])
	})

	test('concurrent identical requests make one job, and a token its own job once', async () => {
		const { library, base } = open(local)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const [a, b] = await Promise.all([library.requestMaster({ groupId: group.groupId, token: 't' }), library.requestMaster({ groupId: group.groupId, token: 't' })])
		expect(a.jobId).toBe(b.jobId)
		await settled(library, a.jobId)
		expect((await library.masters({}, 0, 10)).total).toBe(1)
	})

	test('refuses incompatible frames with an explanation', async () => {
		const { library, base, store } = open(local)
		await plan(library, base, 2)
		await library.ready()
		const folder = directory('import')
		await writeFrame(join(folder, 'other.fit'), () => 100, { IMAGETYP: 'Dark Frame', EXPTIME: 30 })
		const job = await settled(library, (await library.startImport({ paths: [folder] })).jobId)
		await library.commitImport(job.jobId, {})
		const sourceIds = store.sourcesOf().map(({ sourceId }) => sourceId)

		const validation = await library.validate({ sourceIds })
		expect(validation.valid).toBeFalse()
		expect(validation.findings.find(({ field }) => field === 'exposure')?.severity).toBe('blocker')
		await expect(library.requestMaster({ sourceIds, acknowledged: true })).rejects.toThrow('known for some frames')
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

		const { library, base } = open(delayed)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		await Bun.sleep(150)

		const path = join(base, 'frames', '1.fit')
		writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.alloc(2880)]))
		release()

		const job = await settled(library, jobId)
		expect(job.state).toBe('failed')
		expect(job.code).toBe('sourceChanged')
		expect(job.error).toBe('A frame changed: 1.fit')
		expect((await library.masters({}, 0, 10)).total).toBe(0)
	})

	test('a failed master keeps its failure in the job, and a new request builds it', async () => {
		let attempts = 0
		const flaky: Integrator = {
			integrate: (request, onProgress) => {
				if (attempts++ === 0) throw new IntegrationError('processingFailed', 'Boom')
				return integrateMaster(request, onProgress)
			},
		}

		const { library, base } = open(flaky)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		expect((await settled(library, jobId)).error).toBe('Boom')

		const again = await library.requestMaster({ groupId: group.groupId })
		expect(again.jobId).not.toBe(jobId)
		expect((await settled(library, again.jobId)).state).toBe('completed')
	})

	test('a job that was working when the server stopped is forgotten with its staging, never published', async () => {
		const blocked = blockedIntegrator()
		const { library, base } = open(blocked)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		await Bun.sleep(30)
		expect(existsSync(join(base, 'library', 'staging', jobId))).toBeTrue()
		library.close()
		libraries.length = 0
		// A stopped server never overlaps the next one, so the cleanup of the cancelled job ends before the library opens again.
		for (let attempt = 0; attempt < 200 && existsSync(join(base, 'library', 'staging', jobId)); attempt++) await Bun.sleep(10)

		const reopened = open(local, undefined, base)
		await reopened.library.ready()
		await expect(reopened.library.job(jobId)).rejects.toThrow('Unknown job')
		expect((await reopened.library.masters({}, 0, 10)).total).toBe(0)
		expect(existsSync(join(base, 'library', 'staging'))).toBeFalse()

		const again = await reopened.library.requestMaster({ groupId: group.groupId })
		expect((await settled(reopened.library, again.jobId)).state).toBe('completed')
	})

	test('deleting a master removes its directory and never reuses its id', async () => {
		const { library, base } = open(local)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const first = await built(library, { groupId: group.groupId })

		await library.deleteMaster(first)
		expect(readdirSync(join(base, 'library', 'products'))).toEqual([])
		expect((await library.masters({}, 0, 10)).total).toBe(0)
		await expect(library.master(first)).rejects.toThrow('Unknown master')

		const second = await built(library, { groupId: group.groupId })
		expect(second).toBe(first + 1)
		expect(readdirSync(join(base, 'library', 'products'))).toEqual([String(second)])

		library.close()
		libraries.length = 0
		const reopened = open(local, undefined, base)
		expect((await reopened.library.masters({}, 0, 10)).items.map(({ masterId }) => masterId)).toEqual([second])
	})

	test('deleting a group removes its files and frames, keeps its masters, and survives a restart', async () => {
		const { library, base } = open(local)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const masterId = await built(library, { groupId: group.groupId })

		expect(await library.deleteGroup(group.groupId)).toEqual({ deleted: 3 })
		expect(readdirSync(join(base, 'frames')).filter((name) => name.endsWith('.fit'))).toEqual([])
		expect((await library.groups({}, 0, 50)).total).toBe(0)
		expect((await library.master(masterId)).status).not.toBe('unavailable')
		await expect(library.deleteGroup(group.groupId)).rejects.toThrow('Unknown group')

		library.close()
		libraries.length = 0
		const reopened = open(local, undefined, base)
		expect((await reopened.library.groups({}, 0, 50)).total).toBe(0)
	})

	test('a group or a frame being built cannot be deleted', async () => {
		const blocked = blockedIntegrator()
		const { library, base } = open(blocked)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		await library.requestMaster({ groupId: group.groupId })
		await expect(library.deleteGroup(group.groupId)).rejects.toThrow('being built')
		const [frame] = (await library.sources({}, 0, 1)).items
		await expect(library.deleteSource(frame.sourceId)).rejects.toThrow('uses this frame')
	})

	test('deleting a frame removes its file and the frame, and survives a restart', async () => {
		const { library, base } = open(local)
		await plan(library, base, 3)
		const [frame] = (await library.sources({}, 0, 1)).items

		expect(await library.deleteSource(frame.sourceId)).toEqual({ deleted: 1 })
		expect(readdirSync(join(base, 'frames')).filter((name) => name.endsWith('.fit'))).toHaveLength(2)
		expect((await library.sources({}, 0, 50)).total).toBe(2)
		await expect(library.deleteSource(frame.sourceId)).rejects.toThrow('Unknown frame')

		library.close()
		libraries.length = 0
		const reopened = open(local, undefined, base)
		expect((await reopened.library.sources({}, 0, 50)).total).toBe(2)
	})

	test('events carry no server path', async () => {
		const { library, base, events } = open(local)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const { jobId } = await library.requestMaster({ groupId: group.groupId })
		await settled(library, jobId)

		expect(events.map(({ type }) => type)).toContain('calibrationLibrary:masterUpdated')
		expect(JSON.stringify(events)).not.toContain(join(base, 'frames').replaceAll('\\', '\\\\'))
	})
})

describe('worker', () => {
	test('integrates on a worker of its own', async () => {
		const { library, base } = open()
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const masterId = await built(library, { groupId: group.groupId })
		expect((await library.master(masterId)).sourceDigests).toHaveLength(3)
	})
})

describe('automatic masters', () => {
	test('a plan that asked for masters gets them once its session ended, and only complete groups', async () => {
		const { library, base } = open(local)
		await library.darkSessionEnded(await plan(library, base, 3, 3, { generateMasters: true }))

		const { items } = await library.masters({}, 0, 10)
		const started = library.jobs.latest(10)
		expect(started[0].automatic).toBeTrue()
		await settled(library, started[0].jobId)
		expect(items.length + (await library.masters({}, 0, 10)).total).toBe(1)
	})

	test('a plan short of frames starts nothing', async () => {
		const { library, base } = open(local)
		await library.darkSessionEnded(await plan(library, base, 2, 3, { generateMasters: true }))
		expect(library.jobs.latest(10)).toHaveLength(0)
	})

	test('a plan that did not ask starts nothing', async () => {
		const { library, base } = open(local)
		await library.darkSessionEnded(await plan(library, base, 3))
		expect(library.jobs.latest(10)).toHaveLength(0)
	})

	test('an automatic job waits for camera operations, and a manual one does not', async () => {
		let busy = true
		const { library, base } = open(local, () => busy)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const automatic = await library.requestMaster({ groupId: group.groupId, token: 'a' }, true)
		await Bun.sleep(30)
		expect((await library.job(automatic.jobId)).state).toBe('queued')

		busy = false
		library.jobs.pump()
		expect((await settled(library, automatic.jobId)).state).toBe('completed')
	})
})

describe('flats', () => {
	const flatKeywords = { IMAGETYP: 'Flat Frame', EXPTIME: 2, GAIN: 100, OFFSET: 50, XBINNING: 1, YBINNING: 1, FILTER: 'L', TELESCOP: 'Scope', READOUTM: 'RAW16' }
	const response = (x: number, y: number) => (x === 5 && y === 5 ? 0.7 : 1) * (1 - 0.01 * x)

	// A master dark-flat at the exposure of the flats, and flats of different brightness, all registered.
	async function prepared(library: CalibrationLibrary, base: string, pedestal: number) {
		await plan(library, base, 3, 3, { purpose: 'darkFlat', groups: [{ groupId: 'g', key: 'g', exposure: 2, temperature: -10, count: 3 }] })
		const [darkFlat] = (await library.groups({ kind: 'darkFlat' }, 0, 50)).items
		const correction = await built(library, { groupId: darkFlat.groupId })

		const folder = directory('flats')

		for (let frame = 0; frame < 4; frame++) {
			const path = await writeFrame(join(folder, `${frame}.fit`), (x, y) => pedestal + (20000 + frame * 2000) * response(x, y), flatKeywords)
			await library.registerFlat({ path, sessionId: 's', cameraName: 'Camera' })
		}

		const [flat] = (await library.groups({ kind: 'flat' }, 0, 50)).items
		return { flat, correction }
	}

	test('a session that asked for masters builds each completed filter with the newest matching correction', async () => {
		const { library, base, store } = open(local)
		const { correction } = await prepared(library, base, 1000)
		const paths = store.sourcesOf('flatWizard').map(({ path }) => path)

		await library.flatSessionEnded({ sessionId: 's', groups: [{ filter: 'L', paths }] })
		const job = library.jobs.latest(10).find(({ automatic }) => automatic)
		expect(job).toBeDefined()
		await settled(library, job!.jobId)

		const { items } = await library.masters({ kind: 'flat' }, 0, 10)
		expect(items).toHaveLength(1)
		expect((await library.master(items[0].masterId)).dependencies[0].masterId).toBe(correction)
	})

	test('a session waits for its last flat, and builds nothing without a correction or with a frame missing', async () => {
		const { library, store } = open(local)
		const folder = directory('flats')
		const paths = await Promise.all([0, 1].map((frame) => writeFrame(join(folder, `${frame}.fit`), () => 20000, flatKeywords)))
		for (const path of paths) void library.registerFlat({ path, sessionId: 's', cameraName: 'Camera' })

		await library.flatSessionEnded({ sessionId: 's', groups: [{ filter: 'L', paths: [...paths, join(folder, 'missing.fit')] }] })
		expect(store.sourcesOf('flatWizard')).toHaveLength(2)
		await library.flatSessionEnded({ sessionId: 's', groups: [{ filter: 'L', paths }] })
		expect(library.jobs.latest(10)).toHaveLength(0)
	})

	test('a flat without a correction never becomes a master', async () => {
		const { library } = open(local)
		const folder = directory('flats')
		const path = await writeFrame(join(folder, 'a.fit'), () => 20000, flatKeywords)
		await library.registerFlat({ path, sessionId: 's', cameraName: 'Camera' })
		const [flat] = (await library.groups({ kind: 'flat' }, 0, 50)).items

		const validation = await library.validate({ groupId: flat.groupId })
		expect(validation.valid).toBeFalse()
		expect(validation.findings.map(({ code }) => code)).toContain('invalidFlatCorrection')
		await expect(library.requestMaster({ groupId: flat.groupId })).rejects.toThrow('needs a master')
	})

	test('a calibrated normalized master keeps structure, drops pedestal, and depends on its correction', async () => {
		const { library, base, store } = open(local)
		const { flat, correction } = await prepared(library, base, 1000)

		const masterId = await built(library, { groupId: flat.groupId, correction, acknowledged: true })
		const master = await library.master(masterId)
		expect(master.calibrationState).toBe('calibratedNormalized')
		expect(master.units).toBe('dimensionless')
		expect(master.dependencies[0].masterId).toBe(correction)
		await expect(library.deleteMaster(correction)).rejects.toThrow('delete that flat first')
		expect(() => store.discardMaster(correction)).toThrow('FOREIGN KEY')

		const image = await readMaster(master.path)
		expect(image.metadata.bitpix).toBe(-32)
		const at = (x: number, y: number) => image.raw[y * WIDTH + x]
		expect(at(10, 0) / at(0, 0)).toBeCloseTo(0.9, 2)
		expect(at(5, 5) / at(4, 5)).toBeCloseTo((0.7 * 0.95) / 0.96, 2)
		expect(readFitsProvenance(image.header).calibration).toEqual(['dark'])
		expect(image.header.EXPTIME).toBeUndefined()
	})

	test('a correction with another operating point is refused', async () => {
		const { library, base } = open(local)
		const { flat, correction } = await prepared(library, base, 1000)
		const folder = directory('bias')
		const path = await writeFrame(join(folder, 'other.fit'), () => 20000, { ...flatKeywords, GAIN: 0 })
		await library.registerFlat({ path, sessionId: 's', cameraName: 'Camera' })
		const other = (await library.groups({ kind: 'flat' }, 0, 50)).items.find(({ groupId }) => groupId !== flat.groupId)!

		const validation = await library.validate({ groupId: other.groupId, correction })
		expect(validation.findings.find(({ code }) => code === 'invalidFlatCorrection')?.message).toContain('Gain')
	})

	test('a saturated flat is left out and the master says so', async () => {
		const { library, base } = open(local)
		const { flat, correction } = await prepared(library, base, 1000)
		const path = await writeFrame(join(directory('flats'), 'hot.fit'), () => 65000, flatKeywords)
		await library.registerFlat({ path, sessionId: 's', cameraName: 'Camera' })

		const masterId = await built(library, { groupId: flat.groupId, correction, acknowledged: true })
		const { diagnostics } = await library.master(masterId)
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

		await expect(integrateMaster({ jobId: 'j', kind: 'bias', frames, recipe: { method: 'mean', sigmaLow: 3, sigmaHigh: 3, maxIterations: 5 }, staging, header: {}, memoryBudget: 1 << 20 }, () => undefined)).rejects.toThrow('other samples')
	})
})

describe('resolve preview', () => {
	test('lists the masters that match from metadata alone, newest first', async () => {
		const { library, base } = open(local)
		await plan(library, base, 3)
		const [group] = (await library.groups({}, 0, 50)).items
		const first = await built(library, { groupId: group.groupId })
		const second = await built(library, { groupId: group.groupId })

		const exact = await library.resolvePreview({ width: WIDTH, height: HEIGHT, channels: 1, binX: 1, binY: 1, gain: 100, offset: 50, readoutMode: 'RAW16', exposure: 60, temperature: -10 })
		expect(exact.candidates.map(({ masterId }) => masterId)).toEqual([second, first])

		const unknown = await library.resolvePreview({ width: WIDTH, height: HEIGHT, channels: 1 })
		expect(unknown.candidates).toHaveLength(2)

		const other = await library.resolvePreview({ width: WIDTH, height: HEIGHT, channels: 1, binX: 1, binY: 1, gain: 100, offset: 50, readoutMode: 'RAW16', exposure: 59, temperature: -10 })
		expect(other.candidates).toEqual([])
	})
})

describe('pins', () => {
	test('a chosen master resolves only with its content, and a lease keeps it from deletion', async () => {
		const { library, masterId } = await published()
		const master = await library.master(masterId)
		const pin = { masterId, digest: master.contentDigest }
		expect((await library.pinnedMaster(pin))?.path).toBe(master.path)
		expect(await library.pinnedMaster({ ...pin, digest: '0'.repeat(64) })).toBeUndefined()

		const release = library.lease([pin])
		const other = library.lease([pin])
		await expect(library.deleteMaster(masterId)).rejects.toThrow('Image Stacking')
		release()
		release()
		await expect(library.deleteMaster(masterId)).rejects.toThrow('Image Stacking')
		other()

		await library.deleteMaster(masterId)
		expect(await library.pinnedMaster(pin)).toBeUndefined()
	})
})
