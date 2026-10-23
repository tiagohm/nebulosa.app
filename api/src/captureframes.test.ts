import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type CaptureFrameEvent, type CaptureFrameOrigin, CaptureFrameRegistry, type CaptureFrameRegistryOptions, FRAMES_PER_SOURCE, MAX_LEASED_FRAMES, MAX_SOURCES, parseCaptureFrames } from './captureframes'
import type { CaptureFrame } from './captures'
import { ImageStore } from './images'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-capture-frames-'))
const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

// Size of a FITS block, in bytes.
const BLOCK = 2880

// Returns the bytes of an 8-bit grayscale FITS image.
function fits(width = 8, height = 4) {
	const cards = ['SIMPLE  =                    T', 'BITPIX  =                    8', 'NAXIS   =                    2', `NAXIS1  = ${String(width).padStart(20)}`, `NAXIS2  = ${String(height).padStart(20)}`, 'EXPTIME =                  2.5', 'END']
	const header = Buffer.alloc(BLOCK, ' ')
	for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
	return new Uint8Array(Buffer.concat([header, Buffer.alloc(BLOCK)]))
}

let files = 0

function setup(options: CaptureFrameRegistryOptions = {}) {
	const images = new ImageStore()
	const events: CaptureFrameEvent[] = []
	const file = options.file ?? join(root, `registry-${files++}.json`)
	const registry = new CaptureFrameRegistry(images, (event) => events.push(event), { connected: () => true, ...options, file })
	disposables.push(registry)

	// Decodes a frame of a camera and records it as previewed, as the capture service (or Auto Focus, by origin) does;
	// a frame with a path is saved unless its file state is given.
	async function preview(
		generation: number,
		{
			sessionId = 'session',
			connectionId = 'connection',
			deviceId = 'camera',
			cameraName = 'Camera',
			path,
			file = path ? 'saved' : undefined,
			origin,
		}: { sessionId?: string; connectionId?: string; deviceId?: string; cameraName?: string; path?: string; file?: CaptureFrame['file']; origin?: CaptureFrameOrigin } = {},
	) {
		const time = Date.UTC(2026, 9, 23, 0, 0, generation)
		if (path) writeFileSync(path, fits())
		const info = await images.openCapture(fits(), `${cameraName} #${generation}`, { connectionId, deviceId, frameId: `${sessionId}:${generation}`, time, path })
		const frame: CaptureFrame = { imageId: info.id, sessionId, connectionId, deviceId, generation, time, path, file, frameType: 'LIGHT', width: info.width, height: info.height, channels: info.channels, acquisition: info.acquisition }
		registry.previewed(info, frame, cameraName, origin)
		return info
	}

	return { images, events, registry, file, preview }
}

describe('frames', () => {
	test('the first frame is the latest, in memory, and not saved', async () => {
		const { registry, preview, events } = setup()
		await preview(1)

		const { sources } = registry.snapshot()
		expect(sources).toHaveLength(1)
		expect(sources[0]).toMatchObject({ connectionId: 'connection', deviceId: 'camera', cameraName: 'Camera', connected: true, latestFrameId: 'session:1', latestAvailableFrameId: 'session:1', latestRestored: false, count: 0 })
		const page = await registry.recent('connection', 'camera')
		expect(page.latest).toMatchObject({ frameId: 'session:1', availability: 'memory', width: 8, height: 4, acquisition: { exposure: 2.5 } })
		expect(page.frames).toEqual([])
		expect(events.at(-1)).toMatchObject({ type: 'captureFrame:updated', frame: { frameId: 'session:1' } })
	})

	test('a newer previewed-only frame replaces the latest, whose frame is expired and never listed', async () => {
		const { registry, preview, images } = setup()
		const first = await preview(1)
		await preview(2)

		expect(images.name(first.id)).toBeUndefined()
		const page = await registry.recent('connection', 'camera')
		expect(page.latest?.frameId).toBe('session:2')
		expect(page.frames).toEqual([])
		expect((await registry.frame('session:1'))!).toMatchObject({ availability: 'unavailable', reason: 'expired', imageId: undefined })
		expect(registry.snapshot().sources[0]).toMatchObject({ latestFrameId: 'session:2', latestAvailableFrameId: 'session:2', count: 0 })
	})

	test('a saved latest frame is also the newest saved frame', async () => {
		const { registry, preview } = setup()
		await preview(1, { path: join(root, 'latest-saved-1.fits') })

		const page = await registry.recent('connection', 'camera')
		expect(page.latest?.frameId).toBe('session:1')
		expect(page.frames.map((frame) => frame.frameId)).toEqual(['session:1'])
		expect(registry.snapshot().sources[0].count).toBe(1)
	})

	test('previewed-only frames never evict saved frames', async () => {
		const { registry, preview } = setup()
		await preview(1, { path: join(root, 'kept-1.fits') })
		await preview(2, { path: join(root, 'kept-2.fits') })
		for (let generation = 3; generation <= 102; generation++) await preview(generation)

		const page = await registry.recent('connection', 'camera')
		expect(page.latest?.frameId).toBe('session:102')
		expect(page.frames.map((frame) => [frame.frameId, frame.availability])).toEqual([
			['session:2', 'file'],
			['session:1', 'file'],
		])
	})

	test(`only the latest ${FRAMES_PER_SOURCE} saved frames of a camera are remembered, and a previewed-only latest takes none of them`, async () => {
		const { registry, preview } = setup()
		for (let generation = 1; generation <= FRAMES_PER_SOURCE + 3; generation++) await preview(generation, { path: join(root, `limit-${generation}.fits`) })
		await preview(FRAMES_PER_SOURCE + 4)

		const { latest, frames } = await registry.recent('connection', 'camera')
		expect(latest?.frameId).toBe(`session:${FRAMES_PER_SOURCE + 4}`)
		expect(frames).toHaveLength(FRAMES_PER_SOURCE)
		expect(frames[0].frameId).toBe(`session:${FRAMES_PER_SOURCE + 3}`)
		expect(frames.at(-1)!.frameId).toBe('session:4')
		expect(registry.snapshot().sources[0].count).toBe(FRAMES_PER_SOURCE)
	})

	test('an Auto Focus frame becomes the latest frame of its camera, is never saved, and closes the previous one', async () => {
		const { registry, preview, images } = setup()
		await preview(1, { path: join(root, 'autofocus-saved-1.fits') })
		const first = await preview(1, { sessionId: 'focus', origin: 'autofocus' })

		let page = await registry.recent('connection', 'camera')
		expect(page.latest).toMatchObject({ frameId: 'focus:1', origin: 'autofocus', availability: 'memory' })
		expect(page.latest!.file).toBeUndefined()
		expect(page.frames.map((frame) => [frame.frameId, frame.origin])).toEqual([['session:1', 'capture']])

		await preview(2, { sessionId: 'focus', origin: 'autofocus' })
		expect(images.name(first.id)).toBeUndefined()
		expect((await registry.frame('focus:1'))!).toMatchObject({ availability: 'unavailable', reason: 'expired' })
		page = await registry.recent('connection', 'camera')
		expect(page.latest?.frameId).toBe('focus:2')
		expect(page.frames.map((frame) => frame.frameId)).toEqual(['session:1'])
		expect(registry.snapshot().sources[0]).toMatchObject({ latestFrameId: 'focus:2', latestAvailableFrameId: 'focus:2', count: 1 })
	})

	test('the write of a capture frame completing after an Auto Focus frame never takes the latest frame back', async () => {
		const { registry, preview } = setup()
		const path = join(root, 'late-1.fits')
		await preview(1, { path, file: 'saving' })
		await preview(1, { sessionId: 'focus', origin: 'autofocus' })
		registry.written({ sessionId: 'session', generation: 1, connectionId: 'connection', deviceId: 'camera', time: Date.UTC(2026, 9, 23, 0, 0, 1), frameType: 'LIGHT', path, cameraName: 'Camera' }, 'saved')

		const page = await registry.recent('connection', 'camera')
		expect(page.latest).toMatchObject({ frameId: 'focus:1', origin: 'autofocus' })
		expect(page.frames.map((frame) => [frame.frameId, frame.file, frame.availability])).toEqual([['session:1', 'saved', 'file']])
		expect(page.latest!.sequence).toBeGreaterThan(page.frames[0].sequence)
	})

	test('an Auto Focus frame of one camera never replaces the latest frame of another', async () => {
		const { registry, preview } = setup()
		await preview(1, { deviceId: 'main' })
		await preview(1, { deviceId: 'guide', sessionId: 'focus', origin: 'autofocus' })

		expect((await registry.recent('connection', 'main')).latest).toMatchObject({ frameId: 'session:1', origin: 'capture', availability: 'memory' })
		expect((await registry.recent('connection', 'guide')).latest).toMatchObject({ frameId: 'focus:1', origin: 'autofocus', availability: 'memory' })
	})

	test('a camera without frames has an empty page', async () => {
		const { registry } = setup()
		expect(await registry.recent('connection', 'unknown')).toEqual({ frames: [] })
	})

	test('cameras of the same name on different connections are kept apart', async () => {
		const { registry, preview } = setup()
		await preview(1, { connectionId: 'a', deviceId: 'camera', sessionId: 'sa' })
		await preview(1, { connectionId: 'b', deviceId: 'camera', sessionId: 'sb' })

		const { sources } = registry.snapshot()
		expect(sources.map((source) => source.connectionId).sort()).toEqual(['a', 'b'])
		// The latest frame of one camera never closes the latest frame of another.
		expect((await registry.recent('a', 'camera')).latest).toMatchObject({ frameId: 'sa:1', availability: 'memory' })
		expect((await registry.recent('b', 'camera')).latest).toMatchObject({ frameId: 'sb:1', availability: 'memory' })
	})

	test(`only ${MAX_SOURCES} cameras are remembered`, async () => {
		const { registry, preview } = setup()
		for (let i = 0; i <= MAX_SOURCES; i++) await preview(1, { deviceId: `camera-${i}`, sessionId: `s${i}` })

		const devices = registry.snapshot().sources.map((source) => source.deviceId)
		expect(devices).toHaveLength(MAX_SOURCES)
		expect(devices).not.toContain('camera-0')
	})

	test('a saved frame becomes available from its file once its document is closed', async () => {
		const { registry, preview } = setup()
		const path = join(root, 'saved-1.fits')
		await preview(1, { path })
		await preview(2)

		expect((await registry.frame('session:1'))!).toMatchObject({ availability: 'file', file: 'saved', fileName: 'saved-1.fits' })
		expect(JSON.stringify(await registry.frame('session:1'))).not.toContain(root.replaceAll('\\', '\\\\'))
		expect((await registry.recent('connection', 'camera')).frames.map((frame) => frame.frameId)).toEqual(['session:1'])
	})

	test('a removed saved file makes its frame unavailable, and it stays listed', async () => {
		const { registry, preview } = setup()
		const path = join(root, 'removed-1.fits')
		await preview(1, { path })
		await preview(2)
		rmSync(path)

		expect((await registry.frame('session:1'))!).toMatchObject({ availability: 'unavailable', reason: 'fileMissing' })
		expect(await registry.open('session:1', 'tab')).toEqual({ status: 'refused', code: 'fileMissing' })
		expect((await registry.recent('connection', 'camera')).frames[0]).toMatchObject({ frameId: 'session:1', reason: 'fileMissing' })
	})

	test('a saved frame the preview skipped is recorded from its file; a failed one is not', () => {
		const { registry } = setup()
		const frame = { sessionId: 'session', connectionId: 'connection', deviceId: 'camera', cameraName: 'Camera', time: 0, frameType: 'LIGHT' as const }
		registry.written({ ...frame, generation: 1, path: join(root, 'skipped-1.fits') }, 'saved')
		registry.written({ ...frame, generation: 2, path: join(root, 'skipped-2.fits') }, 'failed')

		expect(registry.snapshot().sources[0]).toMatchObject({ latestFrameId: undefined, latestAvailableFrameId: 'session:1', latestRestored: true, count: 1 })
	})

	test('a latest frame being saved joins the saved frames once written, even after a newer frame', async () => {
		const { registry, preview, images } = setup()
		const path = join(root, 'writing-1.fits')
		writeFileSync(path, fits())
		const time = Date.UTC(2026, 9, 23)
		const info = await images.openCapture(fits(), 'Camera #1', { connectionId: 'connection', deviceId: 'camera', frameId: 'session:1', time, path })
		registry.previewed(info, { imageId: info.id, sessionId: 'session', connectionId: 'connection', deviceId: 'camera', generation: 1, time, path, file: 'saving', frameType: 'LIGHT', width: info.width, height: info.height, channels: info.channels, acquisition: info.acquisition }, 'Camera')
		expect((await registry.recent('connection', 'camera')).frames).toEqual([])

		await preview(2)
		registry.written({ sessionId: 'session', generation: 1, connectionId: 'connection', deviceId: 'camera', cameraName: 'Camera', time, frameType: 'LIGHT', path }, 'saved')

		const page = await registry.recent('connection', 'camera')
		expect(page.latest?.frameId).toBe('session:2')
		expect(page.frames.map((frame) => [frame.frameId, frame.availability])).toEqual([['session:1', 'file']])
	})

	test('a failed write never joins the saved frames', async () => {
		const { registry, preview } = setup()
		const path = join(root, 'failing-1.fits')
		await preview(1, { path })
		registry.written({ sessionId: 'session', generation: 1, connectionId: 'connection', deviceId: 'camera', cameraName: 'Camera', time: 0, frameType: 'LIGHT', path }, 'failed')
		await preview(2)

		expect((await registry.frame('session:1'))!).toMatchObject({ frameId: 'session:1', file: 'failed', availability: 'unavailable', reason: 'saveFailed' })
		expect((await registry.recent('connection', 'camera')).frames).toEqual([])
	})

	test('revisions increase with every change', async () => {
		const { preview, events } = setup()
		await preview(1)
		await preview(2)

		const revisions = events.map((event) => event.source.revision)
		expect(revisions).toEqual(revisions.toSorted((a, b) => a - b))
		expect(new Set(revisions).size).toBe(revisions.length)
	})

	test('disconnecting the camera republishes it and keeps its frames', async () => {
		const { registry, preview, events } = setup()
		await preview(1)
		registry.deviceChanged({ type: 'device:removed', connectionId: 'connection', id: 'camera' })

		expect(events.at(-1)).toMatchObject({ type: 'captureSource:updated', source: { deviceId: 'camera', latestFrameId: 'session:1' } })
		expect((await registry.frame('session:1'))!.availability).toBe('memory')
	})
})

describe('leases', () => {
	test('a leased frame stays open when a newer frame arrives, and closes once released', async () => {
		const { registry, preview, images } = setup()
		const first = await preview(1)
		const opened = await registry.open('session:1', 'tab')
		expect(opened).toMatchObject({ status: 'opened', info: { id: first.id }, frame: { frameId: 'session:1' } })
		await preview(2)

		expect(images.name(first.id)).toBeDefined()
		expect((await registry.frame('session:1'))!.availability).toBe('memory')

		expect(registry.release(opened.status === 'opened' ? opened.lease : '')).toBeTrue()
		expect(images.name(first.id)).toBeUndefined()
		expect((await registry.frame('session:1'))!.availability).toBe('unavailable')
	})

	test('releasing the lease of the latest frame keeps it open', async () => {
		const { registry, preview, images } = setup()
		const info = await preview(1)
		const opened = await registry.open('session:1', 'tab')
		if (opened.status === 'opened') registry.release(opened.lease)

		expect(images.name(info.id)).toBeDefined()
	})

	test('two opens of the same frame share its document', async () => {
		const { registry, preview, images } = setup()
		const first = await preview(1)
		const a = await registry.open('session:1', 'tab')
		const b = await registry.open('session:1', 'other')
		await preview(2)

		if (a.status === 'opened') registry.release(a.lease)
		expect(images.name(first.id)).toBeDefined()
		if (b.status === 'opened') registry.release(b.lease)
		expect(images.name(first.id)).toBeUndefined()
	})

	test('a saved frame is reopened from its file once, as a new document, for concurrent opens', async () => {
		const { registry, preview, images } = setup()
		const path = join(root, 'reopened-1.fits')
		const first = await preview(1, { path })
		await preview(2)

		const [a, b] = await Promise.all([registry.open('session:1', 'tab'), registry.open('session:1', 'tab')])
		expect(a.status).toBe('opened')
		expect(b.status).toBe('opened')
		if (a.status !== 'opened' || b.status !== 'opened') return
		expect(a.info.id).toBe(b.info.id)
		expect(a.info.id).not.toBe(first.id)
		expect(a.info).toMatchObject({ origin: 'file', width: 8, height: 4 })
		expect((await registry.frame('session:1'))!.availability).toBe('memory')

		registry.release(a.lease)
		registry.release(b.lease)
		expect(images.name(a.info.id)).toBeUndefined()
		expect((await registry.frame('session:1'))!.availability).toBe('file')
	})

	test('refuses unknown and expired frames', async () => {
		const { registry, preview } = setup()
		await preview(1)
		await preview(2)

		expect(await registry.open('session:9', 'tab')).toEqual({ status: 'refused', code: 'notFound' })
		expect(await registry.open('session:1', 'tab')).toEqual({ status: 'refused', code: 'expired' })
	})

	test(`refuses to keep more than ${MAX_LEASED_FRAMES} older frames open`, async () => {
		const { registry, preview } = setup()

		for (let i = 0; i < MAX_LEASED_FRAMES; i++) {
			await preview(1, { deviceId: `camera-${i}`, sessionId: `s${i}` })
			expect((await registry.open(`s${i}:1`, 'tab')).status).toBe('opened')
			await preview(2, { deviceId: `camera-${i}`, sessionId: `s${i}` })
		}

		// The latest frame of a camera is always open.
		expect((await registry.open('s0:2', 'tab')).status).toBe('opened')
		await preview(3, { deviceId: 'camera-0', sessionId: 's0' })
		expect(await registry.open('s1:2', 'tab')).toMatchObject({ status: 'opened' })
		await preview(3, { deviceId: 'camera-1', sessionId: 's1' })
		const path = join(root, 'limit.fits')
		await preview(1, { deviceId: 'camera-x', sessionId: 'sx', path })
		await preview(2, { deviceId: 'camera-x', sessionId: 'sx' })
		expect(await registry.open('sx:1', 'tab')).toEqual({ status: 'refused', code: 'limit' })
	})

	test('reconciling releases the leases a client no longer uses and reports the lost ones', async () => {
		const { registry, preview, images } = setup()
		const first = await preview(1)
		const opened = await registry.open('session:1', 'tab')
		await preview(2)
		if (opened.status !== 'opened') throw new Error('not opened')

		expect(registry.reconcile('tab', [opened.lease, 'gone'])).toEqual({ lost: ['gone'] })
		expect(images.name(first.id)).toBeDefined()
		expect(registry.reconcile('tab', [])).toEqual({ lost: [] })
		expect(images.name(first.id)).toBeUndefined()
	})

	test('the leases of a client survive its sockets for the grace period', async () => {
		const { registry, preview, images } = setup({ leaseGrace: 50 })
		const first = await preview(1)
		await registry.open('session:1', 'tab')
		await preview(2)

		registry.connected('tab')
		registry.disconnected('tab')
		await Bun.sleep(20)
		registry.connected('tab')
		await Bun.sleep(60)
		expect(images.name(first.id)).toBeDefined()

		registry.disconnected('tab')
		await Bun.sleep(80)
		expect(images.name(first.id)).toBeUndefined()
	})

	test('a document lost with the image worker leaves its leases and frame', async () => {
		const { registry, preview, images } = setup()
		await preview(1)
		const opened = await registry.open('session:1', 'tab')
		if (opened.status !== 'opened') throw new Error('not opened')
		images.close(opened.info.id)

		// The registry learns of the closed document through the discard listener.
		expect((await registry.frame('session:1'))!.availability).toBe('unavailable')
		expect(registry.reconcile('tab', [opened.lease])).toEqual({ lost: [opened.lease] })
	})
})

describe('persistence', () => {
	test('saved frames survive a restart, without a latest frame; previewed-only ones do not', async () => {
		const { registry, preview, file } = setup()
		const path = join(root, 'persisted-1.fits')
		await preview(1, { path })
		await preview(2)
		await registry.flush()

		const restarted = setup({ file })
		const page = await restarted.registry.recent('connection', 'camera')
		expect(page.latest).toBeUndefined()
		expect(page.frames.map((frame) => [frame.frameId, frame.availability])).toEqual([['session:1', 'file']])
		expect(await restarted.registry.frame('session:2')).toBeUndefined()
		expect(restarted.registry.snapshot().sources[0]).toMatchObject({ latestFrameId: undefined, latestAvailableFrameId: 'session:1', latestRestored: true })
		expect(restarted.registry.snapshot().epoch).not.toBe(registry.snapshot().epoch)

		await restarted.preview(1, { sessionId: 'next' })
		const reloaded = await restarted.registry.recent('connection', 'camera')
		expect(reloaded.latest!.frameId).toBe('next:1')
		expect(reloaded.latest!.sequence).toBeGreaterThan(reloaded.frames[0].sequence)
		expect(restarted.registry.snapshot().sources[0].latestRestored).toBeFalse()
	})

	test('a restart never brings back an Auto Focus frame, which offers the newest saved frame as Latest saved', async () => {
		const { registry, preview, file } = setup()
		await preview(1, { path: join(root, 'restart-saved-1.fits') })
		await preview(1, { sessionId: 'focus', origin: 'autofocus' })
		await registry.flush()
		expect(readFileSync(file, 'utf-8')).not.toContain('focus:1')

		const restarted = setup({ file })
		const page = await restarted.registry.recent('connection', 'camera')
		expect(page.latest).toBeUndefined()
		expect(await restarted.registry.frame('focus:1')).toBeUndefined()
		expect(page.frames.map((frame) => [frame.frameId, frame.origin])).toEqual([['session:1', 'capture']])
		expect(restarted.registry.snapshot().sources[0]).toMatchObject({ latestFrameId: undefined, latestAvailableFrameId: 'session:1', latestRestored: true })
	})

	test('the file holds no document id nor previewed-only frame', async () => {
		const { registry, preview, file } = setup()
		const info = await preview(1)
		await preview(2, { path: join(root, 'persisted-2.fits') })
		await registry.flush()

		const text = readFileSync(file, 'utf-8')
		expect(text).not.toContain(info.id)
		expect(JSON.parse(text)).toMatchObject({ version: 2, sources: [{ connectionId: 'connection', deviceId: 'camera', saved: [{ frameId: 'session:2' }] }] })
		expect(text).not.toContain('session:1')
	})

	test('a version 1 file keeps its saved frames only', async () => {
		const file = join(root, 'version-1.json')
		const path = join(root, 'migrated.fits')
		writeFileSync(path, fits())
		const frame = (generation: number, extra: object = {}) => ({ frameId: `s:${generation}`, sequence: generation, sessionId: 's', generation, time: generation, frameType: 'LIGHT', ...extra })
		const frames = [frame(1), frame(2, { path, file: 'saved' }), frame(3, { path, file: 'failed' }), frame(4, { path, file: 'saving' }), frame(5)]
		writeFileSync(
			file,
			JSON.stringify({
				version: 1,
				sequence: 5,
				sources: [
					{ connectionId: 'connection', deviceId: 'camera', cameraName: 'Camera', frames },
					{ connectionId: 'connection', deviceId: 'preview', cameraName: 'Preview', frames: [frame(6)] },
				],
			}),
		)

		const { registry, preview } = setup({ file })
		expect(registry.snapshot().sources.map((source) => source.deviceId)).toEqual(['camera'])
		const page = await registry.recent('connection', 'camera')
		expect(page.frames.map((f) => [f.frameId, f.file, f.availability])).toEqual([
			['s:4', 'saved', 'file'],
			['s:2', 'saved', 'file'],
		])

		await preview(1, { sessionId: 'next' })
		expect((await registry.recent('connection', 'camera')).latest!.sequence).toBeGreaterThan(6)
		await registry.flush()
		expect(JSON.parse(readFileSync(file, 'utf-8'))).toMatchObject({ version: 2, sources: [{ saved: [{ frameId: 's:2' }, { frameId: 's:4' }] }] })
	})

	test('a file of a newer version is read and never overwritten', async () => {
		const file = join(root, 'newer.json')
		const text = JSON.stringify({ version: 99, sequence: 5, sources: [{ connectionId: 'connection', deviceId: 'camera', cameraName: 'Camera', saved: [{ frameId: 's:1', sequence: 5, sessionId: 's', generation: 1, time: 0, frameType: 'LIGHT', path: join(root, 'newer.fits'), file: 'saved' }] }] })
		writeFileSync(file, text)
		const { registry, preview } = setup({ file })
		await preview(1, { path: join(root, 'newer-2.fits') })
		await registry.flush()

		expect(readFileSync(file, 'utf-8')).toBe(text)
		expect(registry.snapshot().sources[0].count).toBe(2)
	})

	test('invalid content is read as empty, and invalid frames are skipped', () => {
		expect(parseCaptureFrames('not json')).toEqual({ sources: [], sequence: 0 })
		const { sources } = parseCaptureFrames(JSON.stringify({ version: 2, sources: [{ connectionId: 'c', deviceId: 'd', saved: [{ frameId: 'x' }, { frameId: 's:1', sequence: 1, sessionId: 's', generation: 1, time: 0, path: 'a.fits', file: 'saved' }] }] }))
		expect(sources[0].saved.map((frame) => frame.frameId)).toEqual(['s:1'])
	})
})
