import { afterEach, expect, test } from 'bun:test'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { PI, PIOVERTWO, SIDEREAL_DRIFT_RATE } from 'nebulosa/src/core/constants'
import { type Angle, deg, normalizeAngle } from 'nebulosa/src/math/units/angle'
import { ConnectionManager } from './connection'
import {
	assessMeridianExposure,
	createMeridianFlipRoutes,
	DEFAULT_MERIDIAN_FLIP_SETTINGS,
	evaluateMeridianFlipMonitor,
	INITIAL_MERIDIAN_FLIP_MEMORY,
	type MeridianFlipEvent,
	type MeridianFlipMemory,
	type MeridianFlipMonitor,
	MeridianFlipService,
	type MeridianFlipSettings,
	type MeridianMountSample,
	type MeridianTransitionKind,
} from './meridianflip'
import { type OperationEvent, OperationRegistry } from './operations'

// Instant of the first sample of every scenario, Unix milliseconds.
const T0 = Date.UTC(2026, 10, 5, 2, 0, 0)
const LONGITUDE = deg(-45)
const SETTINGS: MeridianFlipSettings = { ...DEFAULT_MERIDIAN_FLIP_SETTINGS, settleSeconds: 2 }

// Right ascension whose hour angle is seconds of wall-clock time after the transit at instant time.
function raAt(seconds: number, time = T0, longitude = LONGITUDE): Angle {
	return normalizeAngle(localSiderealTime(timeUnix(time / 1000, true), longitude) - seconds * SIDEREAL_DRIFT_RATE)
}

// Tracking GEM sample pointing at a right ascension and declination.
function sample(rightAscension: Angle, overrides: Partial<MeridianMountSample> = {}): MeridianMountSample {
	return {
		connected: true,
		mountType: 'EQ_GEM',
		tracking: true,
		trackMode: 'SIDEREAL',
		parked: false,
		moving: false,
		hasPierSide: true,
		pierSide: 'WEST',
		hasEquatorialCoordinate: true,
		rightAscension,
		declination: deg(20),
		hasGeographicCoordinate: true,
		longitude: LONGITUDE,
		...overrides,
	}
}

// Deterministic id factory.
function ids() {
	let n = 0
	return () => `id${++n}`
}

// Runs evaluations in order, returning the final memory and the kinds observed by each one.
function run(steps: readonly (readonly [number, MeridianMountSample])[], settings = SETTINGS, memory: MeridianFlipMemory = INITIAL_MERIDIAN_FLIP_MEMORY, newId = ids()) {
	const kinds: MeridianTransitionKind[][] = []
	for (const [time, s] of steps) {
		const result = evaluateMeridianFlipMonitor(memory, s, settings, time, newId)
		memory = result.memory
		kinds.push(result.transitions.map((transition) => transition.kind))
	}
	return { memory, kinds, view: memory.view }
}

test('a tracked position settles into a context before it is monitored', () => {
	const ra = raAt(-3600)
	const { memory, view, kinds } = run([
		[T0, sample(ra)],
		[T0 + 1000, sample(ra)],
		[T0 + 2000, sample(ra)],
	])

	expect(kinds[0]).toEqual([])
	expect(view.availability).toBe('monitoring')
	expect(memory.context?.id).toBe('id1')
	expect(memory.episodeId).toBe('id2')
	expect(view.timing.phase).toBe('before')
	expect(view.mechanical).toBe('notDue')
})

test('the first evaluation of a settling position reports settling', () => {
	const { view } = run([[T0, sample(raAt(-3600))]])
	expect(view.availability).toBe('settling')
	expect(view.reason).toBe('settling')
	expect(view.mechanical).toBe('verificationPending')
})

test('one sidereal hour before the transit is a little less than one hour of wall clock', () => {
	const ra = raAt(-3590.1704)
	const { view } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
	])

	expect(view.timing.hourAngle).toBeCloseTo(-PI / 12, 3)
	expect(view.timing.secondsToTransit).toBeCloseTo(3588.17, 0)
	expect(view.timing.transitAt).toBeCloseTo(T0 + 3590170, -3)
	expect(view.timing.windowOpensAt! - view.timing.transitAt!).toBeCloseTo(300000, 6)
	expect(view.timing.windowClosesAt! - view.timing.transitAt!).toBeCloseTo(900000, 6)
	expect(view.timing.warningAt! - view.timing.transitAt!).toBeCloseTo(-900000, 6)
})

test('right ascension wrapping through 0 h keeps the signed hour angle', () => {
	// A longitude where the sidereal time is just past 0 h, and a target just past the meridian, near 24 h.
	const lst = localSiderealTime(timeUnix(T0 / 1000, true), 0)
	const longitude = normalizeAngle(-lst) + deg(0.2)
	const ra = raAt(118, T0, longitude)
	expect(ra).toBeGreaterThan(deg(359))

	const { view } = run([
		[T0, sample(ra, { longitude })],
		[T0 + 2000, sample(ra, { longitude })],
	])

	expect(view.timing.secondsToTransit).toBeCloseTo(-120, 0)
	expect(view.timing.phase).toBe('approaching')
})

test('the phases follow the configured window', () => {
	const phase = (seconds: number, settings = SETTINGS) => {
		const ra = raAt(seconds - 2)
		return run(
			[
				[T0, sample(ra)],
				[T0 + 2000, sample(ra)],
			],
			settings,
		).view.timing.phase
	}

	expect(phase(-1000)).toBe('before')
	expect(phase(-600)).toBe('approaching')
	expect(phase(100)).toBe('approaching')
	expect(phase(400)).toBe('windowOpen')
	expect(phase(1000)).toBe('pastDeadline')
	expect(phase(-3600 * 11.9)).toBe('before')
	expect(phase(3600 * 11.9)).toBe('pastDeadline')

	const zero = { ...SETTINGS, earlyWarningSeconds: 0, minimumSeconds: 0, maximumSeconds: 0, deadlineWarningSeconds: 0 }
	expect(phase(-10, zero)).toBe('before')
	expect(phase(10, zero)).toBe('pastDeadline')

	const instant = { ...SETTINGS, minimumSeconds: 600, maximumSeconds: 600 }
	expect(phase(500, instant)).toBe('approaching')
	expect(phase(700, instant)).toBe('pastDeadline')
})

test('a naturally tracked crossing is published once, and windows open in order', () => {
	const ra = raAt(-62)
	const { kinds, view } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 30000, sample(ra)],
		[T0 + 70000, sample(ra)],
		[T0 + 80000, sample(ra)],
		[T0 + 370000, sample(ra)],
		[T0 + 380000, sample(ra)],
	])

	expect(kinds[1]).toEqual(['approaching'])
	expect(kinds[2]).toEqual([])
	expect(kinds[3]).toEqual(['upperMeridianCrossed'])
	expect(kinds[4]).toEqual([])
	expect(kinds[5]).toEqual(['windowOpened', 'flipCandidate'])
	expect(kinds[6]).toEqual([])
	expect(view.mechanical).toBe('flipCandidate')
})

test('a GoTo across the meridian is a new target, never a crossing', () => {
	const before = raAt(-60)
	const after = raAt(400 + 7)
	const { kinds, view, memory } = run([
		[T0, sample(before)],
		[T0 + 2000, sample(before)],
		[T0 + 3000, sample(before, { moving: true })],
		[T0 + 5000, sample(after)],
		[T0 + 7000, sample(after)],
	])

	expect(kinds.flat()).not.toContain('upperMeridianCrossed')
	expect(kinds[2]).toEqual([])
	expect(kinds[4]).toEqual(['targetChanged', 'windowOpened', 'flipCandidate'])
	expect(memory.context?.id).toBe('id3')
	expect(view.timing.phase).toBe('windowOpen')
})

test('repositioning invalidates the candidate until the mount settles again', () => {
	const ra = raAt(398)
	const { view } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 3000, sample(ra, { moving: true })],
	])

	expect(view.availability).toBe('repositioning')
	expect(view.mechanical).toBe('verificationPending')
	expect(view.timing.phase).toBe('unavailable')
	expect(view.timing.hourAngle).toBeDefined()
})

test('a GoTo back to the same target keeps the context and the episode', () => {
	const ra = raAt(-3600)
	const { memory, kinds } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 3000, sample(ra, { moving: true })],
		[T0 + 4000, sample(ra)],
		[T0 + 6000, sample(ra)],
	])

	expect(memory.context?.id).toBe('id1')
	expect(memory.episodeId).toBe('id2')
	expect(kinds.flat()).toEqual([])
})

test('a jump without motion, such as a sync, starts a new context once it settles', () => {
	const a = raAt(-3600)
	const b = a + deg(1)
	const { memory, kinds } = run([
		[T0, sample(a)],
		[T0 + 2000, sample(a)],
		[T0 + 3000, sample(b)],
		[T0 + 5000, sample(b)],
	])

	expect(kinds[2]).toEqual([])
	expect(kinds[3]).toEqual(['targetChanged'])
	expect(memory.context?.id).toBe('id3')
})

test('guiding drift under the tolerance keeps monitoring the same target', () => {
	const a = raAt(-3600)
	const { memory, view } = run([
		[T0, sample(a)],
		[T0 + 2000, sample(a)],
		[T0 + 3000, sample(a, { declination: deg(20.1) })],
		[T0 + 4000, sample(a, { declination: deg(20.24) })],
	])

	expect(view.availability).toBe('monitoring')
	expect(memory.context?.id).toBe('id1')
})

test('a position just over the tolerance settles again', () => {
	const a = raAt(-3600)
	const { view } = run([
		[T0, sample(a)],
		[T0 + 2000, sample(a)],
		[T0 + 3000, sample(a, { declination: deg(20.26) })],
	])

	expect(view.availability).toBe('settling')
})

test('a mount already on the expected side is no candidate', () => {
	const ra = raAt(398)
	const { view, kinds } = run([
		[T0, sample(ra, { pierSide: 'EAST' })],
		[T0 + 2000, sample(ra, { pierSide: 'EAST' })],
	])

	expect(view.mechanical).toBe('alreadyOnExpectedSide')
	expect(view.expectedPierSide).toBe('EAST')
	expect(kinds.flat()).not.toContain('flipCandidate')
})

test('a pier side change across a motion back to the same target is only suspected as a flip', () => {
	const ra = raAt(398)
	const { kinds, view } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 3000, sample(ra, { moving: true, pierSide: 'EAST' })],
		[T0 + 4000, sample(ra, { pierSide: 'EAST' })],
		[T0 + 6000, sample(ra, { pierSide: 'EAST' })],
	])

	expect(kinds[1]).toEqual(['windowOpened', 'flipCandidate'])
	expect(kinds[4]).toEqual(['pierSideChanged', 'externalFlipSuspected'])
	expect(view.mechanical).toBe('alreadyOnExpectedSide')
})

test('a pier side change on the same target without motion is an observation only', () => {
	const ra = raAt(-3600)
	const { kinds } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 3000, sample(ra, { pierSide: 'EAST' })],
	])

	expect(kinds[2]).toEqual(['pierSideChanged'])
})

test('the deadline warnings need a pending candidate', () => {
	const ra = raAt(798)
	const { kinds } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 120000, sample(ra)],
	])

	expect(kinds[1]).toEqual(['windowOpened', 'flipCandidate', 'deadlineApproaching'])
	expect(kinds[2]).toEqual(['deadlinePassed'])

	const flipped = run([
		[T0, sample(ra, { pierSide: 'EAST' })],
		[T0 + 2000, sample(ra, { pierSide: 'EAST' })],
		[T0 + 120000, sample(ra, { pierSide: 'EAST' })],
	])

	expect(flipped.kinds.flat()).toEqual(['windowOpened'])
})

test('missing evidence is reported as unknown or unsupported', () => {
	const ra = raAt(398)
	const view = (overrides: Partial<MeridianMountSample>) =>
		run([
			[T0, sample(ra, overrides)],
			[T0 + 2000, sample(ra, overrides)],
		]).view

	expect(view({ pierSide: 'NEITHER' })).toMatchObject({ mechanical: 'unknown', reason: 'noPierSide' })
	expect(view({ hasPierSide: false })).toMatchObject({ mechanical: 'unknown', reason: 'noPierSide' })
	expect(view({ mountType: 'UNKNOWN' })).toMatchObject({ mechanical: 'unknown', reason: 'unknownMountType' })
	expect(view({ mountType: 'ALTAZ' })).toMatchObject({ mechanical: 'unsupportedMountType', reason: 'altazimuthMount', availability: 'monitoring' })
	expect(view({ mountType: 'EQ_FORK' })).toMatchObject({ mechanical: 'unsupportedMountType', reason: 'forkMount' })
	expect(view({ declination: PIOVERTWO })).toMatchObject({ mechanical: 'unknown', reason: 'nearPole' })
	expect(view({ trackMode: 'LUNAR' })).toMatchObject({ reason: 'nonSiderealTracking', timing: { quality: 'approximate' } })
})

test('a mount that observes no fixed target has no forecast', () => {
	const ra = raAt(398)
	const view = (overrides: Partial<MeridianMountSample>) => run([[T0, sample(ra, overrides)]]).view

	expect(view({ tracking: false })).toMatchObject({ availability: 'idle', reason: 'notTracking', mechanical: 'unknown', timing: { phase: 'unavailable', quality: 'unavailable' } })
	expect(view({ tracking: false }).timing.hourAngle).toBeCloseTo(398 * SIDEREAL_DRIFT_RATE, 6)
	expect(view({ parked: true })).toMatchObject({ availability: 'idle', reason: 'parked' })
	expect(view({ hasEquatorialCoordinate: false })).toMatchObject({ availability: 'waitingForCoordinates', reason: 'noCoordinates', timing: { phase: 'unavailable' } })
	expect(view({ hasGeographicCoordinate: false })).toMatchObject({ availability: 'waitingForCoordinates', reason: 'noSite' })
	expect(view({ hasGeographicCoordinate: true, longitude: 0 }).availability).toBe('settling')
})

test('a disconnection forgets the context and a reconnection starts a new one', () => {
	const ra = raAt(-3600)
	const { kinds, memory, view } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 3000, sample(ra, { connected: false })],
		[T0 + 4000, sample(ra, { connected: false })],
		[T0 + 5000, sample(ra)],
		[T0 + 7000, sample(ra)],
	])

	expect(kinds[2]).toEqual(['monitorUnavailable'])
	expect(kinds[3]).toEqual([])
	expect(kinds[5]).toEqual(['monitorRecovered'])
	expect(memory.context?.id).toBe('id3')
	expect(view.availability).toBe('monitoring')
})

test('stopping tracking interrupts the context and a resume is not a crossing', () => {
	const ra = raAt(-62)
	const { kinds, memory } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 30000, sample(ra, { tracking: false })],
		[T0 + 70000, sample(ra)],
		[T0 + 72000, sample(ra)],
	])

	expect(memory.context?.id).toBe('id1')
	expect(kinds.flat()).not.toContain('upperMeridianCrossed')
})

test('passing the lower meridian starts another episode', () => {
	const ra = raAt(43082 - 32)
	const { memory } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 62000, sample(ra)],
	])

	expect(memory.context?.id).toBe('id1')
	expect(memory.episodeId).toBe('id3')
})

test('repeated evaluations without change publish nothing new', () => {
	const ra = raAt(398)
	const { kinds } = run([
		[T0, sample(ra)],
		[T0 + 2000, sample(ra)],
		[T0 + 3000, sample(ra)],
		[T0 + 4000, sample(ra)],
	])

	expect(kinds[2]).toEqual([])
	expect(kinds[3]).toEqual([])
})

// Monitor of a scenario, for the exposure assessment.
function monitorOf(seconds: number, overrides: Partial<MeridianMountSample> = {}): MeridianFlipMonitor {
	const ra = raAt(seconds - 2)
	const { memory } = run([
		[T0, sample(ra, overrides)],
		[T0 + 2000, sample(ra, overrides)],
	])
	const { availability, timing, mechanical, reason, expectedPierSide } = memory.view
	return {
		monitorId: 'm',
		connectionId: 'c',
		deviceId: 'd',
		revision: 1,
		settings: SETTINGS,
		settingsRevision: 1,
		sampledAt: T0 + 2000,
		contextId: memory.context?.id,
		episodeId: memory.episodeId,
		mount: { mountType: 'EQ_GEM', pierSide: 'WEST', expectedPierSide, tracking: true, trackMode: 'SIDEREAL' },
		availability,
		timing,
		mechanical,
		reason,
	}
}

test('an exposure is assessed against the preferred window', () => {
	const now = T0 + 2000
	const early = monitorOf(-3600)
	const allowed = assessMeridianExposure(early, { exposureSeconds: 300, overheadSeconds: 10 }, now)
	expect(allowed).toMatchObject({ decision: 'allowed', validForContextId: 'id1' })
	expect(allowed.decision === 'allowed' && allowed.latestSafeStartAt).toBeCloseTo(early.timing.windowClosesAt! - 310000, 6)

	expect(assessMeridianExposure(monitorOf(-300), { exposureSeconds: 1200, overheadSeconds: 10 }, now)).toMatchObject({ decision: 'defer', reevaluateAt: expect.any(Number) })
	expect(assessMeridianExposure(monitorOf(800), { exposureSeconds: 300, overheadSeconds: 0 }, now)).toMatchObject({ decision: 'blocked' })
	expect(assessMeridianExposure(monitorOf(800), { exposureSeconds: 60, overheadSeconds: 0 }, now)).toMatchObject({ decision: 'allowed' })
	expect(assessMeridianExposure(monitorOf(800, { pierSide: 'EAST' }), { exposureSeconds: 3600, overheadSeconds: 0 }, now)).toMatchObject({ decision: 'allowed' })
	expect(assessMeridianExposure(monitorOf(800, { pierSide: 'NEITHER' }), { exposureSeconds: 60, overheadSeconds: 0 }, now)).toMatchObject({ decision: 'unknown' })
	expect(assessMeridianExposure(monitorOf(800, { mountType: 'ALTAZ' }), { exposureSeconds: 3600, overheadSeconds: 0 }, now)).toMatchObject({ decision: 'allowed' })
	expect(assessMeridianExposure(early, { exposureSeconds: 60, overheadSeconds: 0, expectedContextId: 'other' }, now)).toMatchObject({ decision: 'unknown' })
	expect(assessMeridianExposure({ ...early, availability: 'repositioning' }, { exposureSeconds: 60, overheadSeconds: 0 }, now)).toMatchObject({ decision: 'unknown' })
})

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

// Polls until condition holds or timeout milliseconds elapse.
async function waitUntil(condition: () => boolean, timeout = 10000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(10)
	}
}

// Monitor service over a simulator connection whose mount is connected; operations is never asked for a device.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operationEvents: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => operationEvents.push(event))
	disposables.push(operations)
	const events: MeridianFlipEvent[] = []
	const service = new MeridianFlipService(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		(event) => events.push(event),
		{ now: () => Date.now(), tickInterval: 50, refreshInterval: 30000 },
	)
	disposables.push(service)
	manager.listen((event) => service.consume(event))
	const mountId = manager.devices.list(client).find((d) => d.type === 'mount')!.id
	manager.devices.switch(client, mountId, true)
	const mount = manager.devices.mount(client, mountId)!
	await waitUntil(() => mount.connected && mount.hasEquatorialCoordinate && mount.hasGeographicCoordinate)
	return { manager, id, client, mountId, mount, operations, operationEvents, service, events }
}

const FAST: MeridianFlipSettings = { ...DEFAULT_MERIDIAN_FLIP_SETTINGS, settleSeconds: 0.1 }

test('enabling is idempotent and the monitor follows a tracking mount', async () => {
	const { id, mountId, mount, manager, service, events, operationEvents } = await setup()

	const first = service.enable(id, mountId, FAST)
	expect(first.status).toBe(200)
	const monitor = (await first.json()) as MeridianFlipMonitor
	expect(monitor.settingsRevision).toBe(1)

	const again = (await service.enable(id, mountId, { ...FAST, minimumSeconds: 0 }).json()) as MeridianFlipMonitor
	expect(again.monitorId).toBe(monitor.monitorId)
	expect(again.settings).toEqual(FAST)
	expect(service.snapshot().monitors).toHaveLength(1)

	manager.devices.mounts.tracking(mount, true)
	await waitUntil(() => service.monitor(id, mountId)?.availability === 'monitoring')

	const current = service.monitor(id, mountId)!
	expect(current.contextId).toBeDefined()
	expect(current.mount.mountType).toBe('EQ_GEM')
	expect(current.timing.phase).not.toBe('unavailable')
	expect(events.some((event) => event.type === 'meridianFlip:updated' && event.monitor?.availability === 'monitoring')).toBe(true)
	// Monitoring never starts an operation.
	expect(operationEvents).toEqual([])
})

test('an unknown mount is answered 404 and a disconnected one 409', async () => {
	const { id, mountId, client, manager, service } = await setup()
	expect(service.enable(id, 'nope', FAST).status).toBe(404)
	expect(service.updateSettings(id, mountId, { settings: FAST, expectedRevision: 1 }).status).toBe(404)
	expect(service.transitions(id, mountId).status).toBe(404)

	manager.devices.switch(client, mountId, false)
	await waitUntil(() => !manager.devices.mount(client, mountId)!.connected)
	const response = service.enable(id, mountId, FAST)
	expect(response.status).toBe(409)
	expect(await response.json()).toMatchObject({ code: 'disconnected' })
})

test('outdated settings are refused with the current monitor', async () => {
	const { id, mountId, service } = await setup()
	service.enable(id, mountId, FAST)

	const updated = service.updateSettings(id, mountId, { settings: { ...FAST, maximumSeconds: 1200 }, expectedRevision: 1 })
	expect(updated.status).toBe(200)
	expect(((await updated.json()) as MeridianFlipMonitor).settingsRevision).toBe(2)

	const stale = service.updateSettings(id, mountId, { settings: FAST, expectedRevision: 1 })
	expect(stale.status).toBe(409)
	const body = (await stale.json()) as { code: string; monitor: MeridianFlipMonitor }
	expect(body.code).toBe('conflict')
	expect(body.monitor.settings.maximumSeconds).toBe(1200)
})

test('disabling removes the monitor and publishes its removal', async () => {
	const { id, mountId, service, events } = await setup()
	service.enable(id, mountId, FAST)
	expect(service.disable(id, mountId).status).toBe(204)
	expect(service.disable(id, mountId).status).toBe(204)
	expect(service.snapshot().monitors).toEqual([])
	const last = events.at(-1)
	expect(last?.type === 'meridianFlip:updated' && last.monitor).toBeUndefined()

	const count = events.length
	await Bun.sleep(150)
	expect(events.length).toBe(count)
})

test('a disconnected mount waits, and a closed connection removes its monitor', async () => {
	const { id, mountId, client, manager, service } = await setup()
	service.enable(id, mountId, FAST)

	manager.devices.switch(client, mountId, false)
	await waitUntil(() => service.monitor(id, mountId)?.availability === 'waitingForMount')
	expect(service.monitor(id, mountId)?.contextId).toBeUndefined()

	manager.devices.switch(client, mountId, true)
	await waitUntil(() => service.monitor(id, mountId)?.availability !== 'waitingForMount')

	manager.disconnect(id)
	expect(service.snapshot().monitors).toEqual([])
})

test('the routes answer the snapshot and an exposure assessment', async () => {
	const { id, mountId, service } = await setup()
	const routes = createMeridianFlipRoutes(service)
	type Handler = (req: Request) => Response | Promise<Response>
	const call = (path: keyof typeof routes, method: string, body?: unknown) => {
		const handler = (routes[path] as unknown as Record<string, Handler>)[method]
		const req = new Request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
		return handler(Object.assign(req, { params: { id, deviceId: mountId } }))
	}

	expect((await call('/api/connections/:id/mounts/:deviceId/meridian-flip/enable', 'POST', FAST)).status).toBe(200)
	const snapshot = (await (await call('/api/meridian-flip', 'GET')).json()) as { monitors: unknown[] }
	expect(snapshot.monitors).toHaveLength(1)

	const assessment = await (await call('/api/connections/:id/mounts/:deviceId/meridian-flip/assess-exposure', 'POST', { exposureSeconds: 60, overheadSeconds: 5 })).json()
	expect(assessment).toMatchObject({ decision: 'unknown' })

	expect((await call('/api/connections/:id/mounts/:deviceId/meridian-flip/transitions', 'GET')).status).toBe(200)
	expect((await call('/api/connections/:id/mounts/:deviceId/meridian-flip/disable', 'POST')).status).toBe(204)
})
