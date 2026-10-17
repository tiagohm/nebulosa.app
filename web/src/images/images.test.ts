import { describe, expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { activeDocument, closeImage, type ImagesIo, type ImagesState, openImage, renderImage, selectImage } from './images'

interface Call {
	readonly url: string
	readonly method: string
	readonly body?: unknown
	readonly signal?: AbortSignal
}

const INFO = { id: 'srv-1', name: 'm31.fits', path: '/data/m31.fits', format: 'fits', width: 4, height: 2, channels: 1, header: {} }
const STRETCH = { stretch: { midtone: 0.2, shadow: 0.1, highlight: 1 } }

// Fake API: opens any path as INFO (or fails for paths containing "bad"), and renders after release()
// is called for that rendering when gated.
function fakeIo(gated = false) {
	const calls: Call[] = []
	const created: string[] = []
	const revoked: string[] = []
	const gates: (() => void)[] = []
	let count = 0

	const io: ImagesIo = {
		fetch: async (input: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
			calls.push({ url: input, method, body, signal: init?.signal ?? undefined })

			if (input === '/api/images') return (body as { path: string }).path.includes('bad') ? Response.json({ error: 'Not a FITS or XISF image' }, { status: 415 }) : Response.json(INFO, { status: 201 })
			if (method === 'DELETE') return new Response(null, { status: 204 })

			if (gated) {
				await new Promise<void>((resolve, reject) => {
					gates.push(resolve)
					init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
				})
			}

			return new Response(new Blob(['jpeg']), { headers: { 'X-Image-Render': JSON.stringify(STRETCH) } })
		},
		createObjectURL: () => {
			const url = `blob:${++count}`
			created.push(url)
			return url
		},
		revokeObjectURL: (url) => void revoked.push(url),
	}

	return { io, calls, created, revoked, gates }
}

function newState() {
	return proxy<ImagesState>({ documents: [] })
}

describe('open', () => {
	test('opens, activates, and renders with an automatic stretch', async () => {
		const state = newState()
		const { io, calls } = fakeIo()

		await openImage(state, '/data/m31.fits', io)
		const document = activeDocument(state)!

		expect(document).toMatchObject({ name: 'm31.fits', source: { kind: 'file', path: '/data/m31.fits' }, status: 'ready', renderPending: false, rendering: { url: 'blob:1', result: STRETCH } })
		expect(document.info?.id).toBe('srv-1')
		expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
			['POST', '/api/images', { path: '/data/m31.fits' }],
			['POST', '/api/images/srv-1/render', { stretch: 'auto' }],
		])
	})

	test('a rejected file becomes an error document', async () => {
		const state = newState()
		await openImage(state, 'C:\\data\\bad.txt', fakeIo().io)
		expect(activeDocument(state)).toMatchObject({ name: 'bad.txt', status: 'error', error: 'Not a FITS or XISF image' })
	})

	test('a document closed while opening is released on the server', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		const opening = openImage(state, '/data/m31.fits', io)
		closeImage(state, state.documents[0].key, io)
		await opening

		expect(state.documents).toEqual([])
		expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/images/srv-1' })
	})
})

describe('render', () => {
	test('a newer rendering aborts the previous one and replaces its URL', async () => {
		const state = newState()
		const { io, calls, gates, revoked } = fakeIo(true)
		const opening = openImage(state, '/data/m31.fits', io)
		await Bun.sleep(0)
		const key = state.documents[0].key

		const second = renderImage(state, key, { stretch: { midtone: 0.5, shadow: 0, highlight: 1 } }, io)
		expect(calls[1]?.signal?.aborted).toBe(true)
		gates[1]?.()
		await Promise.all([opening, second])

		expect(state.documents[0].rendering?.url).toBe('blob:1')
		expect(state.documents[0].renderPending).toBe(false)
		expect(revoked).toEqual([])

		const third = renderImage(state, key, { stretch: 'auto' }, io)
		gates[2]?.()
		await third

		expect(state.documents[0].rendering?.url).toBe('blob:2')
		expect(revoked).toEqual(['blob:1'])
	})
})

describe('tabs', () => {
	test('closing revokes, releases, and activates a neighbor', async () => {
		const state = newState()
		const { io, calls, revoked } = fakeIo()
		await openImage(state, '/a.fits', io)
		await openImage(state, '/b.fits', io)
		await openImage(state, '/c.fits', io)
		const [a, b, c] = state.documents.map((d) => d.key)

		selectImage(state, b)
		closeImage(state, b, io)
		expect(state.activeKey).toBe(c)

		closeImage(state, c, io)
		expect(state.activeKey).toBe(a)
		expect(revoked).toEqual(['blob:2', 'blob:3'])
		expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2)

		closeImage(state, a, io)
		expect(state.activeKey).toBeUndefined()
	})
})
