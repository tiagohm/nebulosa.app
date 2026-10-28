import { expect, test } from 'bun:test'
import type { SolarEclipseSummary, SunAlmanacResponse } from 'api'
import { proxy } from 'valtio'
import { initialInspectorSections, inspectorSections, setInspectorSectionOpen } from '../inspector'
import { ALMANAC_BUCKET_MS, initialSunState, loadActiveRegions, loadSunImage, refreshSunAlmanac, refreshSunEclipse, type SunIo, type SunState } from './sun'

// Fake API whose responses are released by the test, in any order.
function fakeApi() {
	const pending: { url: string; body?: string; resolve: (response: Response) => void }[] = []
	const requested: string[] = []
	const created: string[] = []
	const revoked: string[] = []

	const io: SunIo = {
		fetch: (input, init) =>
			new Promise<Response>((resolve, reject) => {
				requested.push(input)
				init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
				pending.push({ url: input, body: init?.body as string | undefined, resolve })
			}),
		createObjectURL: () => {
			const url = `blob:${created.length + 1}`
			created.push(url)
			return url
		},
		revokeObjectURL: (url) => void revoked.push(url),
	}

	const release = async (match: (url: string) => boolean, response: Response) => {
		const index = pending.findIndex((e) => match(e.url))
		expect(index).toBeGreaterThanOrEqual(0)
		pending.splice(index, 1)[0].resolve(response)
		await Bun.sleep(0)
	}

	return { io, pending, requested, created, revoked, release }
}

function newState(): SunState {
	return proxy<SunState>(initialSunState())
}

const observer = { latitude: -23.5, longitude: -46.6, elevation: 760 }
const T = Date.UTC(2026, 9, 28, 15)

function almanac(time: number, nextSeason = Date.UTC(2026, 11, 21, 20, 50)): SunAlmanacResponse {
	return { time, seasons: [{ kind: 'decemberSolstice', time: nextSeason }], physical: { equationOfTimeSeconds: 980, carringtonRotation: 2317, source: 'local' } }
}

test('the almanac is asked again only for another bucket, day, observer, or zone', async () => {
	const state = newState()
	const { io, requested, pending, release } = fakeApi()

	void refreshSunAlmanac(state, T, observer, 'America/Sao_Paulo', io)
	expect(requested).toEqual(['/api/sky/sun/almanac'])
	expect(JSON.parse(pending[0].body!)).toEqual({ time: T, observer, timeZone: 'America/Sao_Paulo' })
	await release(() => true, Response.json(almanac(T)))
	expect(state.almanac.value?.time).toBe(T)

	// Same bucket: nothing is asked.
	void refreshSunAlmanac(state, T + 1000, observer, 'America/Sao_Paulo', io)
	expect(requested).toHaveLength(1)

	// Next bucket of the same day: asked again, keeping the value meanwhile.
	void refreshSunAlmanac(state, T + ALMANAC_BUCKET_MS, observer, 'America/Sao_Paulo', io)
	expect(requested).toHaveLength(2)
	expect(state.almanac.value?.time).toBe(T)
	await release(() => true, Response.json(almanac(T + ALMANAC_BUCKET_MS)))

	// Another observer: the value of the other place is cleared at once.
	void refreshSunAlmanac(state, T + ALMANAC_BUCKET_MS, { ...observer, latitude: 10 }, 'America/Sao_Paulo', io)
	expect(requested).toHaveLength(3)
	expect(state.almanac.value).toBeUndefined()
	expect(state.almanac.loading).toBe(true)
})

test('passing the next season asks the almanac again within the bucket', async () => {
	const state = newState()
	const { io, requested, release } = fakeApi()
	const solstice = T + 1000

	void refreshSunAlmanac(state, T, undefined, 'UTC', io)
	await release(() => true, Response.json(almanac(T, solstice)))

	void refreshSunAlmanac(state, solstice - 1, undefined, 'UTC', io)
	expect(requested).toHaveLength(1)
	void refreshSunAlmanac(state, solstice, undefined, 'UTC', io)
	expect(requested).toHaveLength(2)
})

test('a late almanac of a former observer is discarded', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	void refreshSunAlmanac(state, T, observer, 'UTC', io)
	void refreshSunAlmanac(state, T, undefined, 'UTC', io)
	await release((url) => url.endsWith('almanac'), Response.json(almanac(T)))
	await release((url) => url.endsWith('almanac'), Response.json(almanac(T + 5)))
	expect(state.almanac.value?.time).toBe(T + 5)
})

test('the next eclipse holds until its maximum, with its local circumstances for an observer', async () => {
	const state = newState()
	const { io, requested, release } = fakeApi()
	const eclipse: SolarEclipseSummary = { id: '1801929595109', type: 'annular', maximum: 1801929595109, magnitude: 0.928, gamma: -0.296, central: true, lunation: 335 }

	void refreshSunEclipse(state, T, observer, io)
	expect(requested).toEqual([`/api/eclipses/solar?time=${T}&direction=next`])
	await release(() => true, Response.json(eclipse))
	expect(requested[1]).toStartWith(`/api/eclipses/solar/${eclipse.id}/local?longitude=-46.6&latitude=-23.5&event=MAX`)
	await release(() => true, Response.json({ eclipseId: eclipse.id, visibility: { text: 'Entire eclipse visible' } }))
	expect(state.eclipse.value?.eclipse).toEqual(eclipse)
	expect(state.eclipse.value?.local?.visibility.text).toBe('Entire eclipse visible')

	void refreshSunEclipse(state, eclipse.maximum - 1, observer, io)
	expect(requested).toHaveLength(2)

	// After the maximum, before the search instant, or for another observer, the next eclipse is searched again.
	void refreshSunEclipse(state, eclipse.maximum, observer, io)
	expect(requested).toHaveLength(3)
	expect(state.eclipse.value).toBeUndefined()
	void refreshSunEclipse(state, eclipse.maximum - 10, observer, io)
	expect(requested).toHaveLength(4)
	void refreshSunEclipse(state, eclipse.maximum - 10, undefined, io)
	expect(requested.at(-1)).toBe(`/api/eclipses/solar?time=${eclipse.maximum - 10}&direction=next`)
})

test('an image keeps its source times and releases the one it replaces', async () => {
	const state = newState()
	const { io, requested, revoked, release } = fakeApi()
	const headers = { 'Content-Type': 'image/jpeg', 'Last-Modified': 'Wed, 28 Oct 2026 11:40:06 GMT', 'X-Sun-Fetched-At': '1234', 'X-Sun-Stale': '1' }

	void loadSunImage(state, 'image', 'aia193', io)
	expect(requested).toEqual(['/api/sky/sun/image?channel=aia193&size=512'])
	await release(() => true, new Response(new Uint8Array([1]), { headers }))
	await Bun.sleep(0)
	expect(state.image.value).toEqual({ url: 'blob:1', channel: 'aia193', size: 512, updatedAt: Date.UTC(2026, 9, 28, 11, 40, 6), fetchedAt: 1234, stale: true })

	void loadSunImage(state, 'image', 'hmiMagnetogram', io)
	await release(() => true, new Response(new Uint8Array([2]), { headers: { 'Content-Type': 'image/jpeg', 'X-Sun-Fetched-At': '5', 'X-Sun-Stale': '0' } }))
	await Bun.sleep(0)
	expect(state.image.value?.channel).toBe('hmiMagnetogram')
	expect(state.image.value?.updatedAt).toBeUndefined()
	expect(revoked).toEqual(['blob:1'])

	void loadSunImage(state, 'enlarged', 'aia171', io)
	expect(requested.at(-1)).toBe('/api/sky/sun/image?channel=aia171&size=1024')
})

test('a failed source is reported apart from the others', async () => {
	const state = newState()
	const { io, release } = fakeApi()

	void loadActiveRegions(state, io)
	void loadSunImage(state, 'image', 'aia193', io)
	await release((url) => url.includes('active-regions'), Response.json({ error: 'The NOAA active region report is unavailable', code: 'upstreamUnavailable' }, { status: 502 }))
	expect(state.regions.error).toBe('The NOAA active region report is unavailable')
	expect(state.regions.loading).toBe(false)
	expect(state.image.loading).toBe(true)
	expect(state.image.error).toBeUndefined()
})

test('only Position and Visibility start expanded, and a section keeps its state', () => {
	const sections = initialInspectorSections()
	expect(Object.entries(sections).filter(([, open]) => open)).toEqual([
		['position', true],
		['visibility', true],
	])

	setInspectorSectionOpen(inspectorSections, 'catalog', true)
	expect(inspectorSections.catalog).toBe(true)
	setInspectorSectionOpen(inspectorSections, 'catalog', false)
})
