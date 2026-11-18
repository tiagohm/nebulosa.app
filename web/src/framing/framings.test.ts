import { describe, expect, test } from 'bun:test'
import type { Framing as SavedFraming } from 'api'
import { proxy } from 'valtio'
import { copyName, createFraming, deleteFraming, discardFramingDraft, editFraming, framingDocument, framingSaveStatus, type FramingsIo, type FramingsState, handleFramingEvent, overwriteFraming, refreshFramings, sortedFramings } from './framings'

function framing(id: string, revision: number, name: string = id): SavedFraming {
	return {
		id,
		name,
		optics: { telescope: { source: 'manual', focalLength: 600, aperture: 120, focalMultiplier: 1 }, camera: { source: 'manual', sensor: { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 } } },
		rotation: 0,
		color: 0,
		revision,
		createdAt: 0,
		updatedAt: revision,
	}
}

function framingsState(): FramingsState {
	return proxy<FramingsState>({ framings: {}, loaded: false, drafts: {}, saving: {}, conflicts: {}, errors: {} })
}

function respond(body: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

// IO whose writes run when the test says, answering requests with `answer`.
function io(answer: (url: string, init?: RequestInit) => Promise<Response>) {
	const requests: { url: string; method?: string; body?: unknown }[] = []
	const pending: (() => void)[] = []
	let ids = 0
	const value: FramingsIo = {
		fetch: (url, init) => {
			requests.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined })
			return answer(url, init)
		},
		later: (run) => {
			pending.push(run)
			return () => pending.splice(pending.indexOf(run), 1)
		},
		id: () => `id${++ids}`,
	}
	const flush = () => {
		for (const run of pending.splice(0)) run()
	}
	return { io: value, requests, flush }
}

describe('mirror', () => {
	test('an event never rolls back a newer revision, and a read keeps what events brought meanwhile', async () => {
		const state = framingsState()
		handleFramingEvent(state, { type: 'framing:updated', framing: framing('a', 3) })
		handleFramingEvent(state, { type: 'framing:updated', framing: framing('a', 2, 'Old') })
		expect(state.framings.a.revision).toBe(3)

		let release!: () => void
		const read = refreshFramings(state, {
			fetch: () =>
				new Promise((resolve) => {
					release = () => resolve(new Response(JSON.stringify({ framings: [framing('a', 2), framing('b', 1)] })))
				}),
		})
		handleFramingEvent(state, { type: 'framing:removed', id: 'b' })
		handleFramingEvent(state, { type: 'framing:updated', framing: framing('a', 4) })
		release()
		await read
		expect(Object.keys(state.framings)).toEqual(['a'])
		expect(state.framings.a.revision).toBe(4)
		expect(state.loaded).toBe(true)
	})

	test('lists by name with the drafts applied, and names a copy that no framing has', () => {
		const state = framingsState()
		state.framings = { b: framing('b', 1, 'wide'), a: framing('a', 1, 'Narrow'), c: framing('c', 1, 'Narrow copy') }
		state.drafts.b = { document: framing('b', 1, 'Alpha'), revision: 1 }
		expect(sortedFramings(state).map((e) => e.name)).toEqual(['Alpha', 'Narrow', 'Narrow copy'])
		expect(copyName(state, 'Narrow')).toBe('Narrow copy 2')
	})
})

describe('edits', () => {
	test('edits close together are written once from the revision they were made on', async () => {
		const state = framingsState()
		state.framings.a = framing('a', 1)
		const { io: fake, requests, flush } = io((_, init) => respond({ ...framing('a', 2), name: (JSON.parse(init!.body as string) as SavedFraming).name }))
		editFraming(state, 'a', (document) => ({ ...document, name: 'One' }), fake)
		editFraming(state, 'a', (document) => ({ ...document, rotation: 45, name: 'Two' }), fake)
		expect(framingDocument(state, 'a')?.name).toBe('Two')
		expect(framingSaveStatus(state, 'a')).toBe('saving')
		flush()
		await Bun.sleep(0)
		expect(requests).toHaveLength(1)
		expect(requests[0]).toMatchObject({ url: '/api/framings/a', method: 'PUT', body: { name: 'Two', rotation: 45, revision: 1 } })
		expect(state.drafts.a).toBeUndefined()
		expect(state.framings.a).toMatchObject({ name: 'Two', revision: 2 })
		expect(framingSaveStatus(state, 'a')).toBe('saved')
	})

	test('a conflict keeps the draft until the operator keeps theirs or saves over it', async () => {
		const state = framingsState()
		state.framings.a = framing('a', 1)
		let conflict = true
		const { io: fake, requests, flush } = io(() => (conflict ? respond({ error: 'changed', code: 'conflict', framing: framing('a', 5, 'Theirs') }, 409) : respond(framing('a', 6, 'Mine'))))
		editFraming(state, 'a', (document) => ({ ...document, name: 'Mine' }), fake)
		flush()
		await Bun.sleep(0)
		expect(state.conflicts.a).toMatchObject({ name: 'Theirs', revision: 5 })
		expect(framingSaveStatus(state, 'a')).toBe('conflict')

		conflict = false
		await overwriteFraming(state, 'a', fake)
		expect(requests.at(-1)?.body).toMatchObject({ name: 'Mine', revision: 5 })
		expect(state.conflicts.a).toBeUndefined()
		expect(state.framings.a.revision).toBe(6)

		state.drafts.a = { document: framing('a', 6, 'Draft'), revision: 6 }
		state.conflicts.a = null
		discardFramingDraft(state, 'a')
		expect(framingDocument(state, 'a')?.name).toBe('Mine')
	})

	test('a name another framing has fails the write and keeps the draft, without a conflict', async () => {
		const state = framingsState()
		state.framings.a = framing('a', 1)
		const { io: fake, flush } = io(() => respond({ error: 'Another framing has this name', code: 'nameTaken' }, 409))
		editFraming(state, 'a', (document) => ({ ...document, name: 'Taken' }), fake)
		flush()
		await Bun.sleep(0)
		expect(state.conflicts.a).toBeUndefined()
		expect(state.errors.a).toBe('Another framing has this name')
		expect(framingDocument(state, 'a')?.name).toBe('Taken')
		expect(framingSaveStatus(state, 'a')).toBe('failed')
	})

	test('creates under an id of the tab and deletes from the revision the tab knows', async () => {
		const state = framingsState()
		const { io: fake, requests } = io((_, init) => (init?.method === 'DELETE' ? Promise.resolve(new Response(null, { status: 204 })) : respond(framing('id1', 1, 'New'))))
		expect(await createFraming(state, framing('x', 0, 'New'), fake)).toBe('id1')
		expect(requests[0]).toMatchObject({ url: '/api/framings/id1', body: { name: 'New', revision: 0 } })
		expect(state.framings.id1.revision).toBe(1)

		await deleteFraming(state, 'id1', fake)
		expect(requests[1]).toMatchObject({ url: '/api/framings/id1?revision=1', method: 'DELETE' })
		expect(state.framings.id1).toBeUndefined()
	})
})
