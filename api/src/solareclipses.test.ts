import { afterAll, expect, test } from 'bun:test'
import { createSolarEclipseRoutes, type LocalSolarEclipse, type SolarEclipseMapWorkerRequest, type SolarEclipseMapWorkerResponse, SolarEclipseService } from './solareclipses'
import { findSolarEclipse, resolveSolarEclipse, type SolarEclipseMap, type SolarEclipseSummary, solarEclipseSummary } from './solareclipses.map'

const service = new SolarEclipseService()
const routes = createSolarEclipseRoutes(service)

afterAll(() => service.dispose())

function list(query: string) {
	return routes['/api/eclipses/solar'].GET(new Request(`http://localhost/api/eclipses/solar?${query}`))
}

function withId(path: string, id: string) {
	return Object.assign(new Request(`http://localhost${path}`), { params: { id } }) as never
}

function map(id: string, routeSet = routes) {
	return routeSet['/api/eclipses/solar/:id/map'].GET(withId(`/api/eclipses/solar/${id}/map`, id))
}

function local(id: string, query: string) {
	return routes['/api/eclipses/solar/:id/local'].GET(withId(`/api/eclipses/solar/${id}/local?${query}`, id))
}

const TOTAL = solarEclipseSummary(findSolarEclipse(Date.UTC(2024, 2, 1), 'next'))
const ANNULAR = solarEclipseSummary(findSolarEclipse(Date.UTC(2023, 8, 1), 'next'))
const HYBRID = solarEclipseSummary(findSolarEclipse(Date.UTC(2023, 2, 1), 'next'))
const PARTIAL = solarEclipseSummary(findSolarEclipse(Date.UTC(2025, 2, 1), 'next'))

// Fake map worker answering each job with what answer returns, counting the jobs it received.
class FakeWorker extends EventTarget {
	jobs = 0
	terminated = false

	constructor(readonly answer: (request: SolarEclipseMapWorkerRequest) => SolarEclipseMapWorkerResponse | undefined) {
		super()
	}

	postMessage(request: SolarEclipseMapWorkerRequest) {
		this.jobs++
		const response = this.answer(request)
		if (response) setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: response })), 5)
	}

	terminate() {
		this.terminated = true
	}

	unref() {}
}

function fakeService(answer: (request: SolarEclipseMapWorkerRequest) => SolarEclipseMapWorkerResponse | undefined, timeout?: number) {
	const worker = new FakeWorker(answer)
	return { worker, service: new SolarEclipseService(timeout, () => worker as never) }
}

test('finds the eclipses after a date with their types and greatest eclipse in UTC', async () => {
	const response = await list(`time=${Date.UTC(2024, 2, 1)}&direction=next`)
	const eclipse = (await response.json()) as SolarEclipseSummary

	expect(response.status).toBe(200)
	expect(eclipse).toEqual(TOTAL)
	expect(eclipse.id).toBe(`${eclipse.maximum}`)

	// NASA: greatest eclipse at 2024-04-08 18:17 UT, 2023-10-14 17:59 UT, 2023-04-20 04:16 UT, 2025-03-29 10:47 UT.
	for (const [eclipse, type, time] of [
		[TOTAL, 'total', Date.UTC(2024, 3, 8, 18, 17)],
		[ANNULAR, 'annular', Date.UTC(2023, 9, 14, 17, 59)],
		[HYBRID, 'hybrid', Date.UTC(2023, 3, 20, 4, 16)],
		[PARTIAL, 'partial', Date.UTC(2025, 2, 29, 10, 47)],
	] as const) {
		expect(eclipse.type).toBe(type)
		expect(Math.abs(eclipse.maximum - time)).toBeLessThan(120000)
	}

	expect(TOTAL.central).toBe(true)
	expect(PARTIAL.central).toBe(false)
})

test('steps through eclipses strictly in both directions, and resolves every id', () => {
	let time = Date.UTC(2020, 0, 1)

	for (let i = 0; i < 30; i++) {
		const eclipse = solarEclipseSummary(findSolarEclipse(time, 'next'))
		expect(eclipse.maximum).toBeGreaterThan(time)
		expect(solarEclipseSummary(resolveSolarEclipse(eclipse.id)!)).toEqual(eclipse)
		expect(solarEclipseSummary(findSolarEclipse(eclipse.maximum, 'previous')).maximum).toBeLessThan(eclipse.maximum)
		time = eclipse.maximum
	}
})

test('answers 404 for an id that names no eclipse', async () => {
	const response = await map(`${TOTAL.maximum + 1}`)
	expect(response.status).toBe(404)
	expect(await response.json()).toMatchObject({ code: 'notFound' })
	expect(local(`${TOTAL.maximum - 60000}`, 'longitude=0&latitude=0').status).toBe(404)
})

test('draws the central line by kind and the limits on the degree plane', async () => {
	const total = (await (await map(TOTAL.id)).json()) as SolarEclipseMap
	const annular = (await (await map(ANNULAR.id)).json()) as SolarEclipseMap
	const hybrid = (await (await map(HYBRID.id)).json()) as SolarEclipseMap
	const partial = (await (await map(PARTIAL.id)).json()) as SolarEclipseMap

	expect(total.eclipse).toEqual(TOTAL)
	expect(Object.keys(total.paths).sort()).toEqual(['penumbraNorth', 'penumbraSouth', 'riseSet', 'total', 'umbraNorth', 'umbraSouth'])
	expect(Object.keys(annular.paths).sort()).toEqual(['annular', 'penumbraNorth', 'penumbraSouth', 'riseSet', 'umbraNorth', 'umbraSouth'])
	expect(hybrid.paths.total).toBeDefined()
	expect(hybrid.paths.annular).toBeDefined()

	// A partial eclipse has neither a central line nor central limits, and at least one partial limit.
	expect(partial.paths.total).toBeUndefined()
	expect(partial.paths.annular).toBeUndefined()
	expect(partial.paths.umbraNorth).toBeUndefined()
	expect(partial.paths.umbraSouth).toBeUndefined()
	expect(partial.paths.penumbraNorth ?? partial.paths.penumbraSouth).toBeDefined()
	expect(partial.points.P1).toBeDefined()
	expect(partial.points.P4).toBeDefined()
	expect(partial.points.C1).toBeUndefined()
	expect(partial.greatestDuration).toBeUndefined()

	for (const result of [total, annular, hybrid, partial]) {
		for (const path of Object.values(result.paths)) {
			const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number)
			expect(numbers.length).toBeGreaterThan(10)

			for (let i = 0; i < numbers.length; i += 2) {
				expect(numbers[i]).toBeGreaterThanOrEqual(0)
				expect(numbers[i]).toBeLessThanOrEqual(360)
				expect(numbers[i + 1]).toBeGreaterThanOrEqual(0)
				expect(numbers[i + 1]).toBeLessThanOrEqual(180)
			}
		}
	}

	// NASA: greatest eclipse at 25.3° N, 104.1° W, greatest duration 4m28s; the central line ends are timed.
	expect(total.greatestEclipse!.latitude).toBeCloseTo(25.3, 0)
	expect(total.greatestEclipse!.longitude).toBeCloseTo(-104.1, 0)
	expect(total.greatestEclipse!.kind).toBe('total')
	expect(Math.abs(total.greatestDuration!.centralDuration! - 268)).toBeLessThan(5)
	expect(total.points.C1!.time!).toBeLessThan(TOTAL.maximum)
	expect(total.points.C2!.time!).toBeGreaterThan(TOTAL.maximum)

	// Every named point of a total eclipse exists; the ends of the eclipse and of the central line are on the
	// sunrise/sunset curve, and the Sun is high at the greatest eclipse.
	expect(Object.keys(total.points).sort()).toEqual(['C1', 'C2', 'MAX', 'N1', 'N2', 'P1', 'P2', 'P3', 'P4', 'S1', 'S2', 'U1', 'U2', 'U3', 'U4'])
	for (const kind of ['P1', 'P4', 'C1', 'C2'] as const) expect(Math.abs(total.points[kind]!.sunAltitude!)).toBeLessThan(0.01)
	expect(total.points.MAX!.sunAltitude!).toBeCloseTo(total.greatestEclipse!.sunAltitude, 1)
	expect(Object.keys(partial.points).sort()).toEqual(['MAX', 'N1', 'P1', 'P4', 'S1'])
	expect(Math.abs(annular.greatestDuration!.centralDuration! - 317)).toBeLessThan(5)
	expect(Math.abs(hybrid.greatestDuration!.centralDuration! - 76)).toBeLessThan(5)
})

test('computes the circumstances and the Local View of a place', async () => {
	// Dallas was inside the path of totality on 2024-04-08; NASA gives it 3m51s of totality.
	const dallas = (await local(TOTAL.id, 'longitude=-96.8&latitude=32.78').json()) as LocalSolarEclipse

	expect(dallas.eclipseId).toBe(TOTAL.id)
	expect(dallas.location).toEqual({ longitude: -96.8, latitude: 32.78 })
	expect(dallas.visibility.hasCentralPhase).toBe(true)
	expect(dallas.visibility.centralPhaseKind).toBe('total')
	expect(dallas.visibility.hasObservableEclipse).toBe(true)
	expect(dallas.events.map((event) => event.kind)).toEqual(['C1', 'C2', 'MAX', 'C3', 'C4'])
	expect(dallas.events.every((event) => event.observable && event.altitude > 0)).toBe(true)
	expect(Math.abs(dallas.details.centralPhaseDuration! - 231)).toBeLessThan(10)
	expect(dallas.details.maximalMagnitude).toBeGreaterThan(1)
	expect(dallas.details.shadowPathWidthKm).toBeGreaterThan(100)

	const times = dallas.events.map((event) => event.time)
	expect(times).toEqual(times.toSorted((a, b) => a - b))
	expect(dallas.view.selectedEvent).toBe('MAX')
	expect(dallas.view.shapes.some((shape) => shape.kind === 'circle' && shape.role === 'sunDisk')).toBe(true)
	expect(dallas.view.shapes.some((shape) => shape.kind === 'circle' && shape.role === 'ghostMoonDisk')).toBe(true)

	// New York saw only a partial eclipse: no central contacts or durations.
	const newYork = (await local(TOTAL.id, 'longitude=-74&latitude=40.71&event=C2').json()) as LocalSolarEclipse
	expect(newYork.visibility.hasCentralPhase).toBe(false)
	expect(newYork.events.map((event) => event.kind)).toEqual(['C1', 'MAX', 'C4'])
	expect(newYork.details.centralPhaseDuration).toBeUndefined()
	expect(newYork.details.shadowPathWidthKm).toBeUndefined()
	expect(newYork.details.maximalMagnitude).toBeLessThan(1)
	// C2 does not exist there, so the Local View falls back to MAX.
	expect(newYork.view.selectedEvent).toBe('MAX')

	// The shadow never reached São Paulo.
	const saoPaulo = (await local(TOTAL.id, 'longitude=-46.63&latitude=-23.55').json()) as LocalSolarEclipse
	expect(saoPaulo.visibility.kind).toBe('notVisible')
	expect(saoPaulo.events).toEqual([])
	expect(saoPaulo.view.selectedEvent).toBeUndefined()

	// The 2023-04-20 shadow reached southeastern Brazil at night.
	const night = (await local(HYBRID.id, 'longitude=-45&latitude=-22').json()) as LocalSolarEclipse
	expect(night.visibility.kind).toBe('geometricOnlyBelowHorizon')
	expect(night.visibility.hasGeometricEclipse).toBe(true)
	expect(night.events.some((event) => event.observable)).toBe(false)

	const view = (await local(TOTAL.id, 'longitude=-96.8&latitude=32.78&event=C3&orientation=north&handedness=eastLeft&ghosts=false').json()) as LocalSolarEclipse
	expect(view.view.selectedEvent).toBe('C3')
	expect(view.view.shapes.some((shape) => shape.kind === 'circle' && shape.role === 'ghostMoonDisk')).toBe(false)
	expect(view.events).toEqual(dallas.events)
})

test('finds the nearest eclipse visible from a place in both directions', async () => {
	const place = 'longitude=-46.63&latitude=-23.55'
	const next = (await (await list(`${place}&time=${TOTAL.maximum - 1}&direction=next`)).json()) as SolarEclipseSummary
	const previous = (await (await list(`${place}&time=${TOTAL.maximum + 1}&direction=previous`)).json()) as SolarEclipseSummary

	// The 2024-04-08 eclipse is not seen from São Paulo, so both searches skip it.
	expect(next.maximum).toBeGreaterThan(TOTAL.maximum)
	expect(previous.maximum).toBeLessThan(TOTAL.maximum)

	for (const eclipse of [next, previous]) {
		const result = (await local(eclipse.id, place).json()) as LocalSolarEclipse
		expect(result.visibility.hasObservableEclipse).toBe(true)
	}
})

test('gives up the visible search after a bounded number of eclipses', async () => {
	const controller = new AbortController()
	controller.abort()

	// An aborted request stops after the first candidate instead of trying MAX_VISIBLE_SCAN of them.
	const started = performance.now()
	expect(await service.findVisible(TOTAL.maximum - 1, 'next', { longitude: -46.63, latitude: -23.55 }, controller.signal)).toBeUndefined()
	expect(performance.now() - started).toBeLessThan(1000)
})

test('computes a map once for concurrent requests and keeps it', async () => {
	const answer = { eclipse: TOTAL, deltaT: 69, points: {}, paths: {} } satisfies SolarEclipseMap
	const { worker, service } = fakeService((request) => ({ jobId: request.jobId, status: 'computed', map: answer }))

	const [a, b] = await Promise.all([service.map(TOTAL.id), service.map(TOTAL.id)])
	expect(a).toEqual(answer)
	expect(b).toEqual(answer)
	expect(worker.jobs).toBe(1)

	expect(await service.map(TOTAL.id)).toEqual(answer)
	expect(worker.jobs).toBe(1)
	expect(worker.terminated).toBe(false)
})

test('answers 500 when the map fails or times out, terminating a stuck worker', async () => {
	const failing = fakeService((request) => ({ jobId: request.jobId, status: 'failed', error: 'no convergence' }))
	const failed = await map(TOTAL.id, createSolarEclipseRoutes(failing.service))
	expect(failed.status).toBe(500)
	expect(await failed.json()).toMatchObject({ code: 'computationFailed', error: 'The solar eclipse map failed: no convergence' })
	// A map that failed leaves the worker usable.
	expect(failing.worker.terminated).toBe(false)

	const stuck = fakeService(() => undefined, 20)
	const timedOut = await map(TOTAL.id, createSolarEclipseRoutes(stuck.service))
	expect(timedOut.status).toBe(500)
	expect(stuck.worker.terminated).toBe(true)
})
