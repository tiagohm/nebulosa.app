import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { geodeticLocation, localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { arcsec, deg, normalizeAngle, toArcsec, toDeg, toHour } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { planPointingWaypoints } from 'nebulosa/src/observation/mount/pointing.plan'
import { ConnectionManager } from './connection'
import { correctedCommand, MountCorrections, type PointingActivationEvent, PointingActivations } from './mountpointing.corrections'
import { computePointingFit, type PointingFitSample } from './mountpointing.fit'
import { apparentFromIcrs, type PointingSite } from './mountpointing.frames'
import { MountCommands } from './mounts'
import { OperationRegistry } from './operations'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

async function waitUntil(condition: () => boolean, timeout = 30000) {
	const start = Date.now()

	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(5)
	}
}

const SITE: PointingSite = { latitude: deg(-22), longitude: deg(-45), elevation: 800 }
const OBSERVER = { latitude: -22, longitude: -45, elevation: 800 }
const LOCATION = geodeticLocation(SITE.longitude, SITE.latitude, 0)

// A model of a mount that lands 90″ north of every command, on both pier sides.
function fittedModel() {
	const { waypoints } = planPointingWaypoints({ pattern: 'goldenSpiral', count: 50, latitude: SITE.latitude, limits: { declination: [deg(-75), deg(75)] } })
	const now = Date.now()

	const samples = waypoints.map(({ hourAngle, declination, expectedPierSide }, index): PointingFitSample => {
		const time = now + index * 1000
		const rightAscension = normalizeAngle(localSiderealTime(timeUnix(time / 1000, true), LOCATION) - hourAngle)
		return { id: `s${index}`, time, pierSide: expectedPierSide, command: { rightAscension, declination }, solved: { rightAscension, declination: declination + arcsec(90 + 0.5 * Math.sin(index * 3.1)) } }
	})

	const { fitted, gate } = computePointingFit({ strategy: 'hybrid', site: SITE, training: samples.filter((_, index) => index % 5 !== 0), heldOut: samples.filter((_, index) => index % 5 === 0) })
	expect(gate).toBe('passed')
	return fitted
}

const FITTED = fittedModel()
const REVISION = { revisionId: 'r1', fitted: FITTED }
const MODEL = { modelId: 'm1', label: 'Model', site: SITE }

async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operations = new OperationRegistry(manager.devices, () => {})
	disposables.push(operations)
	const events: PointingActivationEvent[] = []
	const corrections = new MountCorrections(manager.devices.mounts, (event) => events.push(event))
	disposables.push(corrections)
	const commands = new MountCommands(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		() => Promise.resolve(undefined),
		operations,
		() => {},
		undefined,
		corrections,
	)
	disposables.push(commands)

	const deviceId = manager.devices.list(client).find((device) => device.type === 'mount')!.id
	manager.devices.switch(client, deviceId, true)
	const mount = manager.devices.mount(client, deviceId)!
	await waitUntil(() => mount.connected && mount.canGoTo && operations.available(mount))

	const { commander } = commands
	expect(await commander.setGeographicCoordinate(operations.coordinator, mount, { latitude: SITE.latitude, longitude: SITE.longitude, elevation: meter(SITE.elevation) })).toMatchObject({ ok: true })
	expect(await commander.setTracking(operations.coordinator, mount, true)).toMatchObject({ ok: true })
	await waitUntil(() => mount.geographicCoordinate.latitude !== 0 && operations.available(mount))

	// A target well above the horizon, west of the meridian: the JNOW coordinates of an hour angle now.
	const target = (hourAngle = deg(30), declination = deg(-40)) => ({ type: 'JNOW' as const, JNOW: { x: normalizeAngle(localSiderealTime(timeUnix(Date.now() / 1000, true), LOCATION) - hourAngle), y: declination } })
	const goTo = spyOn(commander, 'goTo')

	return { id, deviceId, client, manager, operations, corrections, commands, mount, target, goTo, events }
}

describe('corrected GoTos', () => {
	test('without a model a GoTo goes as asked', async () => {
		const { id, commands, mount, target, goTo } = await setup()
		const asked = target()

		expect(commands.goToNow(id, mount, asked, OBSERVER)).toMatchObject({ ok: true })
		expect(goTo.mock.calls[0][2]).toEqual(asked)
		expect(goTo.mock.calls[0][3]).toBeUndefined()
	}, 60000)

	test('a GoTo of Mount Remote Control is corrected once, the way the error requires, and exactly', async () => {
		const { id, commands, corrections, mount, target, goTo, events } = await setup()
		corrections.activate(mount, MODEL, REVISION)
		const asked = target()

		expect(commands.goToNow(id, mount, asked, OBSERVER)).toMatchObject({ ok: true })
		expect(goTo).toHaveBeenCalledTimes(1)

		const [, , sent, options] = goTo.mock.calls[0]
		expect(options).toEqual({ tolerance: 0 })
		expect(sent.type).toBe('JNOW')

		// The mount lands 90″ north of a command, so the command is 90″ south of the target.
		const { x, y } = sent.JNOW as { x: number; y: number }
		expect(toArcsec(asked.JNOW.y - y)).toBeCloseTo(90, 0)
		expect(toArcsec(Math.abs(asked.JNOW.x - x) * Math.cos(y))).toBeLessThan(5)

		const { last } = events.at(-1)!.activation!
		expect(last?.requested.declination).toBe(asked.JNOW.y)
		expect(last?.command?.declination).toBe(y)
	}, 60000)

	test('the goto route is corrected, and answers the operation it started', async () => {
		const { id, deviceId, commands, corrections, mount, target, goTo } = await setup()
		corrections.activate(mount, MODEL, REVISION)
		const { JNOW } = target()

		const response = commands.goTo(id, deviceId, { token: 'one', target: { frame: 'JNOW', x: String(toHour(JNOW.x)), y: String(toDeg(JNOW.y)) }, observer: OBSERVER })
		expect(response.status).toBe(202)
		expect(goTo.mock.calls[0][3]).toEqual({ tolerance: 0 })
	}, 60000)

	test('a J2000 target goes through the reduction of the samples, not of the commander', async () => {
		const { id, commands, corrections, mount, goTo } = await setup()
		corrections.activate(mount, MODEL, REVISION)

		const time = Date.now()
		const rightAscension = normalizeAngle(localSiderealTime(timeUnix(time / 1000, true), LOCATION) - deg(30))
		expect(commands.goToNow(id, mount, { type: 'J2000', J2000: { x: rightAscension, y: deg(-40) } }, OBSERVER)).toMatchObject({ ok: true })

		const apparent = apparentFromIcrs({ rightAscension, declination: deg(-40) }, time, SITE)
		const { y } = goTo.mock.calls[0][2].JNOW as { y: number }
		expect(toArcsec(apparent.declination - y)).toBeCloseTo(90, -1)
	}, 60000)

	test('a flip is never corrected', async () => {
		const { id, deviceId, commands, corrections, mount, target } = await setup()
		corrections.activate(mount, MODEL, REVISION)
		const plan = spyOn(corrections, 'plan')
		const { JNOW } = target()

		commands.flip(id, deviceId, { token: 'one', target: { frame: 'JNOW', x: String(toHour(JNOW.x)), y: String(toDeg(JNOW.y)) }, observer: OBSERVER })
		expect(plan).not.toHaveBeenCalled()
	}, 60000)

	test('the sessions go around the correction, since they use the commander', async () => {
		const { corrections, mount, commands, operations, target } = await setup()
		corrections.activate(mount, MODEL, REVISION)
		const plan = spyOn(corrections, 'plan')

		expect(await commands.commander.goTo(operations.coordinator, mount, target())).toMatchObject({ ok: true })
		expect(plan).not.toHaveBeenCalled()
	}, 60000)

	test('a target far from the samples is refused, nothing moves, and the reason is kept', async () => {
		const { id, commands, corrections, mount, target, goTo, events } = await setup()
		corrections.activate(mount, MODEL, REVISION)
		expect(commands.goToNow(id, mount, target(deg(170), deg(85)), { ...OBSERVER, latitude: 89 })).toMatchObject({ ok: false })
		expect(goTo).not.toHaveBeenCalled()
		expect(events.length).toBeGreaterThan(0)
	}, 60000)
})

describe('suspension', () => {
	test('a sync suspends the model, and a GoTo then goes as asked, saying so', async () => {
		const { id, commands, corrections, mount, target, goTo, operations, events } = await setup()
		corrections.activate(mount, MODEL, REVISION)

		expect(commands.syncNow(mount, target(0, deg(-22)))).toMatchObject({ ok: true })
		expect(events.at(-1)?.activation).toMatchObject({ state: 'suspended', reason: 'The mount was synced' })
		await waitUntil(() => operations.available(mount))

		const asked = target()
		expect(commands.goToNow(id, mount, asked, OBSERVER)).toMatchObject({ ok: true })
		expect(goTo.mock.calls[0][2]).toEqual(asked)
	}, 60000)

	test('the sync route, a clock, and a site suspend the model', async () => {
		const { id, deviceId, commands, corrections, mount, target, events, operations } = await setup()

		corrections.activate(mount, MODEL, REVISION)
		const { JNOW } = target(0, deg(-22))
		expect((await commands.sync(id, deviceId, { target: { frame: 'JNOW', x: String(toHour(JNOW.x)), y: String(toDeg(JNOW.y)) } })).status).toBe(204)
		expect(events.at(-1)?.activation?.state).toBe('suspended')
		await waitUntil(() => operations.available(mount))

		corrections.activate(mount, MODEL, REVISION)
		expect((await commands.setTime(id, deviceId, { utc: Date.now(), offset: 0 })).status).toBe(204)
		expect(events.at(-1)?.activation?.reason).toContain('clock')
		await waitUntil(() => operations.available(mount))

		corrections.activate(mount, MODEL, REVISION)
		expect((await commands.setSite(id, deviceId, { site: { latitude: 10, longitude: 10, elevation: 0 } })).status).toBe(204)
		await waitUntil(() => events.at(-1)?.activation?.state === 'suspended')
		expect(events.at(-1)?.activation?.reason).toContain('site')
	}, 60000)

	test('a mount that disconnects suspends its model, which never comes back by itself', async () => {
		const { manager, client, deviceId, corrections, mount, events } = await setup()
		corrections.activate(mount, MODEL, REVISION)

		manager.devices.switch(client, deviceId, false)
		await waitUntil(() => !mount.connected)
		expect(events.at(-1)?.activation).toMatchObject({ state: 'suspended', reason: 'The mount disconnected' })

		manager.devices.switch(client, deviceId, true)
		await waitUntil(() => mount.connected)
		expect(corrections.snapshot().activations[0].state).toBe('suspended')
	}, 60000)

	test('a new process has nothing in force', async () => {
		const { manager, corrections, mount } = await setup()
		corrections.activate(mount, MODEL, REVISION)
		expect(new MountCorrections(manager.devices.mounts, () => {}).snapshot().activations).toEqual([])
	}, 60000)
})

describe('activation', () => {
	function revision(patch: object = {}) {
		return { ...REVISION, gate: 'passed', verifications: [{ passed: true }], ...patch }
	}

	async function activations(file: object) {
		const context = await setup()
		const stored = { modelId: 'm1', label: 'Model', site: SITE, mount: { hardwareId: context.mount.hardwareId }, revisions: [revision()], ...file }
		const saves: unknown[] = []
		const store = { get: (modelId: string) => Promise.resolve(modelId === 'm1' ? stored : undefined), update: (_: string, change: (model: never) => unknown) => Promise.resolve({ status: 'saved', model: saves.push(change(stored as never)) && stored }) }
		const models = { store, published: () => {}, protectFromRemoval: () => {} }
		const service = new PointingActivations(context.manager.devices, (connectionId) => context.manager.client(connectionId), context.corrections, models as never, context.operations)
		const body = { revisionId: 'r1', mount: { connectionId: context.id, deviceId: context.deviceId }, nativeModelAcknowledged: true }
		return { ...context, service, body, saves }
	}

	test('a verified revision of this mount takes force, and deactivating is immediate', async () => {
		const { service, body, corrections, id, deviceId, saves } = await activations({})

		const response = await service.activate('m1', body)
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({ modelId: 'm1', revisionId: 'r1', state: 'active' })
		expect(saves).toHaveLength(1)
		expect(corrections.isActive('m1')).toBeTrue()

		expect(service.deactivate(id, deviceId).status).toBe(204)
		expect(corrections.snapshot().activations).toEqual([])
		expect(service.deactivate(id, deviceId).status).toBe(204)
	}, 60000)

	test('a revision is refused unless it passed offline and on the sky, and without the acknowledgment', async () => {
		const offline = await activations({ revisions: [revision({ gate: 'failed' })] })
		expect((await offline.service.activate('m1', offline.body)).status).toBe(422)

		const unverified = await activations({ revisions: [revision({ verifications: [] })] })
		expect((await unverified.service.activate('m1', unverified.body)).status).toBe(422)

		const failed = await activations({ revisions: [revision({ verifications: [{ passed: true }, { passed: false }] })] })
		expect((await failed.service.activate('m1', failed.body)).status).toBe(422)

		const { service, body, corrections } = await activations({})
		expect((await service.activate('m1', { ...body, nativeModelAcknowledged: false })).status).toBe(422)
		expect((await service.activate('gone', body)).status).toBe(404)
		expect((await service.activate('m1', { ...body, revisionId: 'gone' })).status).toBe(404)
		expect(corrections.snapshot().activations).toEqual([])
	}, 120000)

	test('a model of another mount or site is refused, and so is a busy mount', async () => {
		const other = await activations({ mount: { hardwareId: 'other' } })
		expect((await other.service.activate('m1', other.body)).status).toBe(409)

		const site = await activations({ site: { ...SITE, latitude: deg(10) } })
		expect((await site.service.activate('m1', site.body)).status).toBe(409)

		const { service, body, operations, mount, commands, target } = await activations({})
		void commands.commander.goTo(operations.coordinator, mount, target(deg(60)))
		expect((await service.activate('m1', body)).status).toBe(409)
	}, 120000)

	test('activating a revision replaces the one in force at once', async () => {
		const { corrections, mount } = await setup()
		corrections.activate(mount, MODEL, REVISION)
		corrections.activate(mount, MODEL, { ...REVISION, revisionId: 'r2' })
		expect(corrections.snapshot().activations.map((each) => each.revisionId)).toEqual(['r2'])
	}, 60000)
})

test('a correction refuses an unusable model, whose inverse claims to converge', () => {
	const context = { time: Date.now(), site: SITE, pierSide: 'EAST' } as const
	const result = correctedCommand({ ...FITTED, usable: false }, { rightAscension: 1, declination: -0.5 }, context)
	expect(result).toEqual({ ok: false, reason: 'unusable' })
})

test('a correction is cheap enough to answer a GoTo at once', () => {
	const context = { time: Date.now(), site: SITE, pierSide: 'EAST' } as const
	const start = performance.now()
	for (let i = 0; i < 100; i++) correctedCommand(FITTED, { rightAscension: 1 + i * 0.01, declination: -0.5 }, context)
	expect((performance.now() - start) / 100).toBeLessThan(5)
})
