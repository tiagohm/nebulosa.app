import { expect, test } from 'bun:test'
import type { LunarEclipseSummary, MoonAlmanacResponse } from 'api'
import { proxy } from 'valtio'
import { almanacCurrent, initialMoonState, type MoonIo, type MoonState, refreshMoonAlmanac, refreshMoonEclipse } from './moon'

// Fake API whose responses are released by the test, in any order.
function fakeApi() {
	const pending: { url: string; body?: string; resolve: (value: unknown, status?: number) => void }[] = []
	const requested: string[] = []

	const io: MoonIo = {
		fetch: (input, init) =>
			new Promise<Response>((resolve, reject) => {
				requested.push(input)
				init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
				pending.push({ url: input, body: init?.body as string | undefined, resolve: (value, status = 200) => resolve(Response.json(value, { status })) })
			}),
	}

	const release = async (match: (url: string, body?: string) => boolean, value: unknown, status?: number) => {
		const index = pending.findIndex((e) => match(e.url, e.body))
		expect(index).toBeGreaterThanOrEqual(0)
		pending.splice(index, 1)[0].resolve(value, status)
		await Bun.sleep(0)
	}

	return { io, pending, requested, release }
}

const HOME = { latitude: -23.5, longitude: -46.6, elevation: 760 }
const AWAY = { latitude: 51.5, longitude: 0, elevation: 10 }

function almanac(time: number): MoonAlmanacResponse {
	return { time, appearance: { phase: 'fullMoon' } as MoonAlmanacResponse['appearance'], phases: [], apsides: [], source: 'local' }
}

function eclipse(maximum: number): LunarEclipseSummary {
	return { id: `${maximum}`, type: 'TOTAL', maximum, magnitude: 1.1, lunation: 1, contacts: [] }
}

function newState(): MoonState {
	return proxy<MoonState>(initialMoonState())
}

test('the almanac is asked for each instant, keeps the last one of the observer while loading, and drops late answers', async () => {
	const state = newState()
	const { io, requested, release } = fakeApi()

	void refreshMoonAlmanac(state, 1000, HOME, io)
	void refreshMoonAlmanac(state, 1000, HOME, io)
	expect(requested).toEqual(['/api/sky/moon/almanac'])
	await release((_, body) => body!.includes('"time":1000'), almanac(1000))
	expect(state.almanac.value?.time).toBe(1000)
	expect(almanacCurrent(state, 1000, HOME)).toBe(true)

	void refreshMoonAlmanac(state, 2000, HOME, io)
	void refreshMoonAlmanac(state, 3000, HOME, io)
	expect(state.almanac.value?.time).toBe(1000)
	expect(state.almanac.loading).toBe(true)
	expect(almanacCurrent(state, 3000, HOME)).toBe(false)

	await release((_, body) => body!.includes('"time":3000'), almanac(3000))
	await release((_, body) => body!.includes('"time":2000'), almanac(2000)).catch(() => undefined)
	expect(state.almanac.value?.time).toBe(3000)
	expect(almanacCurrent(state, 3000, HOME)).toBe(true)
})

test('another observer clears the almanac at once', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	void refreshMoonAlmanac(state, 1000, HOME, io)
	await release(() => true, almanac(1000))
	void refreshMoonAlmanac(state, 1000, AWAY, io)
	expect(state.almanac.value).toBeUndefined()
	void refreshMoonAlmanac(state, 1000, undefined, io)
	expect(state.almanac.value).toBeUndefined()
	expect(almanacCurrent(state, 1000, undefined)).toBe(false)
})

test('the next eclipse holds until its maximum, with local circumstances, and its failure leaves the almanac alone', async () => {
	const state = newState()
	const { io, requested, release } = fakeApi()

	void refreshMoonEclipse(state, 1000, HOME, io)
	await release((url) => url === '/api/eclipses/lunar?time=1000&direction=next', eclipse(5000))
	await release((url) => url.startsWith('/api/eclipses/lunar/5000/local?longitude=-46.6&latitude=-23.5&event=MAX'), { visibility: { text: 'Entire eclipse visible' } })
	expect(state.eclipse.value?.eclipse.id).toBe('5000')
	expect(state.eclipse.value?.local?.visibility.text).toBe('Entire eclipse visible')

	void refreshMoonEclipse(state, 4999, HOME, io)
	expect(requested).toHaveLength(2)

	void refreshMoonEclipse(state, 5000, HOME, io)
	void refreshMoonAlmanac(state, 5000, HOME, io)
	await release((url) => url.startsWith('/api/eclipses/lunar?time=5000'), { error: 'Upstream failed' }, 500)
	await release((url) => url === '/api/sky/moon/almanac', almanac(5000))
	expect(state.eclipse.error).toBe('Upstream failed')
	expect(state.almanac.value?.time).toBe(5000)
	expect(state.almanac.error).toBeUndefined()
})

test('without an observer the eclipse has no local circumstances', async () => {
	const state = newState()
	const { io, requested, release } = fakeApi()

	void refreshMoonEclipse(state, 1000, undefined, io)
	await release(() => true, eclipse(5000))
	expect(state.eclipse.value?.local).toBeUndefined()
	expect(requested).toEqual(['/api/eclipses/lunar?time=1000&direction=next'])
})
