import { expect, test } from 'bun:test'
import { createLunarEclipseRoutes, findLunarEclipse, type LocalLunarEclipse, type LunarEclipseMap, LunarEclipseService, type LunarEclipseSummary, lunarEclipseSummary, resolveLunarEclipse } from './lunareclipses'

const routes = createLunarEclipseRoutes(new LunarEclipseService())

function list(query: string) {
	return routes['/api/eclipses/lunar'].GET(new Request(`http://localhost/api/eclipses/lunar?${query}`))
}

function withId(path: string, id: string) {
	return Object.assign(new Request(`http://localhost${path}`), { params: { id } }) as never
}

function map(id: string) {
	return routes['/api/eclipses/lunar/:id/map'].GET(withId(`/api/eclipses/lunar/${id}/map`, id))
}

function local(id: string, query: string) {
	return routes['/api/eclipses/lunar/:id/local'].GET(withId(`/api/eclipses/lunar/${id}/local?${query}`, id))
}

const TOTAL = lunarEclipseSummary(findLunarEclipse(Date.UTC(1997, 6, 1), 'next'))
const PARTIAL = lunarEclipseSummary(findLunarEclipse(Date.UTC(1994, 4, 1), 'next'))
const PENUMBRAL = lunarEclipseSummary(findLunarEclipse(Date.UTC(1973, 5, 1), 'next'))

test('finds the eclipse after a date with its contacts in UTC', async () => {
	const response = await list(`time=${Date.UTC(1997, 6, 1)}&direction=next`)
	const eclipse = (await response.json()) as LunarEclipseSummary

	expect(response.status).toBe(200)
	expect(eclipse).toEqual(TOTAL)
	expect(eclipse.type).toBe('TOTAL')
	expect(eclipse.contacts.map((contact) => contact.kind)).toEqual(['P1', 'U1', 'U2', 'MAX', 'U3', 'U4', 'P4'])
	// Greatest eclipse at 1997-09-16 18:47 UTC, within a minute.
	expect(Math.abs(eclipse.maximum - Date.UTC(1997, 8, 16, 18, 47))).toBeLessThan(60000)
	expect(eclipse.contacts.find((contact) => contact.kind === 'MAX')?.time).toBe(eclipse.maximum)
	expect(eclipse.id).toBe(`${eclipse.maximum}`)
})

test('lists only the contacts of partial and penumbral eclipses', () => {
	expect(PARTIAL.type).toBe('PARTIAL')
	expect(PARTIAL.contacts.map((contact) => contact.kind)).toEqual(['P1', 'U1', 'MAX', 'U4', 'P4'])
	expect(PENUMBRAL.type).toBe('PENUMBRAL')
	expect(PENUMBRAL.contacts.map((contact) => contact.kind)).toEqual(['P1', 'MAX', 'P4'])

	for (const eclipse of [TOTAL, PARTIAL, PENUMBRAL]) {
		const times = eclipse.contacts.map((contact) => contact.time)
		expect(times).toEqual(times.toSorted((a, b) => a - b))
	}
})

test('steps through eclipses strictly in both directions, and resolves every id', () => {
	const ids: number[] = []
	let time = Date.UTC(2020, 0, 1)

	for (let i = 0; i < 30; i++) {
		const eclipse = lunarEclipseSummary(findLunarEclipse(time, 'next'))
		expect(eclipse.maximum).toBeGreaterThan(time)
		expect(resolveLunarEclipse(eclipse.id) && lunarEclipseSummary(resolveLunarEclipse(eclipse.id)!)).toEqual(eclipse)
		ids.push(eclipse.maximum)
		time = eclipse.maximum
	}

	for (let i = ids.length - 1; i > 0; i--) {
		expect(lunarEclipseSummary(findLunarEclipse(ids[i], 'previous')).maximum).toBe(ids[i - 1])
	}
})

test('answers 404 for an id that names no eclipse', async () => {
	const response = map(`${TOTAL.maximum + 1}`)
	expect(response.status).toBe(404)
	expect(await response.json()).toMatchObject({ code: 'notFound' })
	expect(local(`${TOTAL.maximum - 60000}`, 'longitude=0&latitude=0').status).toBe(404)
})

test('draws the contact lines and fills on the degree plane', async () => {
	const response = map(TOTAL.id)
	const result = (await response.json()) as LunarEclipseMap

	expect(response.status).toBe(200)
	expect(result.eclipse).toEqual(TOTAL)
	expect(result.events.map((event) => event.kind)).toEqual(TOTAL.contacts.map((contact) => contact.kind))
	expect(Object.keys(result.lines).sort()).toEqual(['MAX', 'P1', 'P4', 'U1', 'U2', 'U3', 'U4'])
	expect(Object.keys(result.fills).sort()).toEqual(['MAX', 'P1', 'P4', 'U1', 'U2', 'U3', 'U4'])

	for (const path of [...Object.values(result.lines), ...Object.values(result.fills)]) {
		const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number)
		expect(numbers.length).toBeGreaterThan(10)

		for (let i = 0; i < numbers.length; i += 2) {
			expect(numbers[i]).toBeGreaterThanOrEqual(0)
			expect(numbers[i]).toBeLessThanOrEqual(360)
			expect(numbers[i + 1]).toBeGreaterThanOrEqual(0)
			expect(numbers[i + 1]).toBeLessThanOrEqual(180)
		}
	}

	// At greatest eclipse the Moon was over the Indian Ocean, at the declination of the antisolar point.
	const max = result.events.find((event) => event.kind === 'MAX')!.sublunar
	expect(max.longitude).toBeCloseTo(77, 0)
	expect(max.latitude).toBeCloseTo(-2.8, 0)

	const penumbral = (await map(PENUMBRAL.id).json()) as LunarEclipseMap
	expect(Object.keys(penumbral.lines).sort()).toEqual(['MAX', 'P1', 'P4'])
})

test('computes the circumstances and the Local View of a place', async () => {
	// The Moon is up over the Indian Ocean at greatest eclipse and down on the opposite side of the Earth.
	const up = (await local(TOTAL.id, 'longitude=77&latitude=-3').json()) as LocalLunarEclipse
	const down = (await local(TOTAL.id, 'longitude=-103&latitude=3').json()) as LocalLunarEclipse

	expect(up.eclipseId).toBe(TOTAL.id)
	expect(up.location).toEqual({ longitude: 77, latitude: -3 })
	expect(up.visibility.kind).toBe('completelyVisible')
	expect(up.visibility.hasObservableEclipse).toBe(true)
	expect(up.events.map((event) => event.kind)).toEqual(TOTAL.contacts.map((contact) => contact.kind))
	expect(up.events.every((event) => event.observable)).toBe(true)

	const max = up.events.find((event) => event.kind === 'MAX')!
	expect(max.time).toBe(TOTAL.maximum)
	expect(max.altitude).toBeGreaterThan(80)
	expect(max.azimuth).toBeGreaterThanOrEqual(0)
	expect(max.azimuth).toBeLessThan(360)
	expect(up.details.observableDuration).toBeCloseTo(up.details.penumbralPhaseDuration, -1)
	expect(up.details.totalPhaseDuration).toBeGreaterThan(0)

	expect(down.visibility.kind).toBe('geometricOnlyBelowHorizon')
	expect(down.visibility.hasObservableEclipse).toBe(false)
	expect(down.events.some((event) => event.observable)).toBe(false)
	expect(down.details.observableDuration).toBe(0)

	expect(up.view.selectedEvent).toBe('MAX')
	expect(up.view.shapes.some((shape) => shape.kind === 'circle' && shape.role === 'umbra')).toBe(true)
	expect(up.view.shapes.some((shape) => shape.kind === 'circle' && shape.role === 'ghostMoonDisk')).toBe(true)

	const view = (await local(TOTAL.id, 'longitude=77&latitude=-3&event=U1&orientation=north&handedness=eastLeft&ghosts=false').json()) as LocalLunarEclipse
	expect(view.view.selectedEvent).toBe('U1')
	expect(view.view.shapes.some((shape) => shape.kind === 'circle' && shape.role === 'ghostMoonDisk')).toBe(false)
	expect(view.events).toEqual(up.events)
})

test('omits the durations a penumbral eclipse lacks', async () => {
	const result = (await local(PENUMBRAL.id, 'longitude=-46.6&latitude=-23.5').json()) as LocalLunarEclipse

	expect(result.details.maximalUmbralMagnitude).toBeUndefined()
	expect(result.details.partialPhaseDuration).toBeUndefined()
	expect(result.details.totalPhaseDuration).toBeUndefined()
	expect(result.details.observableDuration).toBeGreaterThanOrEqual(0)
	expect(result.details.observableDuration).toBeLessThanOrEqual(result.details.penumbralPhaseDuration)
})

test('finds the nearest eclipse visible from a place in both directions', async () => {
	const query = `longitude=-103&latitude=3&time=${TOTAL.maximum - 1}`
	const next = (await (await list(`${query}&direction=next`)).json()) as LunarEclipseSummary
	const previous = (await (await list(`time=${TOTAL.maximum + 1}&longitude=-103&latitude=3&direction=previous`)).json()) as LunarEclipseSummary

	// The 1997-09-16 eclipse is not visible there, so both searches skip it.
	expect(next.maximum).toBeGreaterThan(TOTAL.maximum)
	expect(previous.maximum).toBeLessThan(TOTAL.maximum)

	for (const eclipse of [next, previous]) {
		const result = (await local(eclipse.id, 'longitude=-103&latitude=3').json()) as LocalLunarEclipse
		expect(result.visibility.hasObservableEclipse).toBe(true)
	}
})

test('gives up the visible search after a bounded number of eclipses', async () => {
	const service = new LunarEclipseService()
	const controller = new AbortController()
	controller.abort()

	// An aborted request stops after the first candidate instead of trying MAX_VISIBLE_SCAN of them.
	const started = performance.now()
	expect(await service.findVisible(TOTAL.maximum - 1, 'next', { longitude: -103, latitude: 3 }, controller.signal)).toBeUndefined()
	expect(performance.now() - started).toBeLessThan(1000)
})
