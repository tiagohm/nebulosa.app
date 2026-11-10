import { expect, test } from 'bun:test'
import type { SpiceKernelJob, SpiceKernelLibrarySnapshot } from 'api'
import { activeJobs, applySpiceKernelSnapshot, handleSpiceKernelEvent, importSpiceKernel, refreshSpiceKernels, setSpicePolicy, type SpiceKernelsState, updateSpiceKernel } from './spicekernels'

function snapshot(epoch: string, revision: number, jobs: SpiceKernelJob[] = []): SpiceKernelLibrarySnapshot {
	return { epoch, revision, loading: false, generation: revision, policy: 'automatic', bytes: 0, kernels: [], jobs }
}

function job(jobId: string, state: SpiceKernelJob['state'], createdAt = 0): SpiceKernelJob {
	return { jobId, kind: 'download', key: `download:${jobId}`, label: jobId, state, createdAt, updatedAt: createdAt }
}

function state(): SpiceKernelsState {
	return { revision: 0, pending: {}, errors: {} }
}

function respond(body: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

test('a snapshot older than the applied revision of the same process is dropped', () => {
	const s = state()
	applySpiceKernelSnapshot(s, snapshot('a', 5))
	applySpiceKernelSnapshot(s, snapshot('a', 3))
	expect(s.revision).toBe(5)

	applySpiceKernelSnapshot(s, snapshot('b', 1))
	expect(s.epoch).toBe('b')
	expect(s.revision).toBe(1)
})

test('a change event reads the snapshot again, and a stale one is ignored', async () => {
	const s = state()
	applySpiceKernelSnapshot(s, snapshot('a', 2))
	const requests: string[] = []
	const request = ((url: string) => {
		requests.push(url)
		return respond(snapshot('a', 3))
	}) as typeof fetch

	handleSpiceKernelEvent(s, { type: 'spiceKernels:changed', epoch: 'a', revision: 2 }, request)
	expect(requests).toEqual([])

	handleSpiceKernelEvent(s, { type: 'spiceKernels:changed', epoch: 'a', revision: 3 }, request)
	await Bun.sleep(0)
	expect(requests).toEqual(['/api/spice-kernels'])
	expect(s.revision).toBe(3)
})

test('a job update replaces its job without reading the snapshot', () => {
	const s = state()
	applySpiceKernelSnapshot(s, snapshot('a', 1, [job('j1', 'queued')]))
	const request = (() => {
		throw new Error('no request expected')
	}) as unknown as typeof fetch

	handleSpiceKernelEvent(s, { type: 'spiceKernels:jobUpdated', epoch: 'a', revision: 2, job: { ...job('j1', 'running'), bytes: 10, totalBytes: 100 } }, request)

	expect(s.revision).toBe(2)
	expect(s.snapshot?.jobs).toEqual([{ ...job('j1', 'running'), bytes: 10, totalBytes: 100 }])
	expect(activeJobs(s.snapshot).map((e) => e.jobId)).toEqual(['j1'])
})

test('a snapshot request answered after a newer one is dropped', async () => {
	const s = state()
	let release: (() => void) | undefined
	const slow = (() =>
		new Promise<Response>((resolve) => {
			release = () => resolve(new Response(JSON.stringify(snapshot('a', 1))))
		})) as unknown as typeof fetch

	const first = refreshSpiceKernels(s, slow)
	await refreshSpiceKernels(s, () => respond(snapshot('a', 4)))
	release?.()
	await first

	expect(s.revision).toBe(4)
})

test('commands keep their failures and stream an upload as the body', async () => {
	const s = state()
	const calls: { url: string; init?: RequestInit }[] = []
	const request = ((url: string, init?: RequestInit) => {
		calls.push({ url, init })
		return url.includes('/settings') ? respond({ error: 'Nope', code: 'processingFailed' }, 500) : respond({})
	}) as typeof fetch

	const file = new File([new Uint8Array([1, 2, 3])], 'de 440.bsp')
	expect(await importSpiceKernel(s, file, request)).toBeTrue()
	expect(calls[0].url).toBe('/api/spice-kernels/import?name=de%20440.bsp')
	expect(calls[0].init?.body).toBe(file)

	expect(await updateSpiceKernel(s, 'k1', { enabled: false }, request)).toBeTrue()
	expect(calls[1]).toMatchObject({ url: '/api/spice-kernels/k1', init: { method: 'PATCH', body: JSON.stringify({ enabled: false }) } })

	expect(await setSpicePolicy(s, 'offline', request)).toBeFalse()
	expect(s.errors.settings).toBe('Nope')
	expect(s.pending).toEqual({})
})
