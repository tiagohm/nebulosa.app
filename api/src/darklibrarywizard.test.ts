import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CameraCommands } from './cameras'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures } from './captures'
import { ConnectionManager } from './connection'
import { CoverCommands } from './covers'
import { type DarkLibraryWizardEvent, type DarkLibraryWizardRequest, type DarkLibraryWizardSession, DarkLibraryWizardSessions, darkGroupKey, expectedFrameSize, orderDarkGroups } from './darklibrarywizard'
import { type DarkFrameMeasurement, measureDarkFile } from './darklibrarywizard.analysis'
import { DarkPlanStore, STAGING_DIRECTORY } from './darklibrarywizard.store'
import { AppDatabase } from './database'
import { FlatPanelCommands } from './flatpanels'
import { ImageStore } from './images'
import { OperationRegistry } from './operations'
import { WheelCommands } from './wheels'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-darkwizard-test-'))
const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

async function waitUntil(condition: () => boolean, timeout = 30000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(10)
	}
}

let tokens = 0

function request(directory: string, patch: Partial<DarkLibraryWizardRequest> = {}): DarkLibraryWizardRequest {
	return {
		token: `token-${tokens++}`,
		capture: { gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 64, height: 64, frameFormat: '' },
		groups: [{ exposure: 0.01, count: 2 }],
		protection: { closeCover: false, panelOff: false, manualCap: true, verifyFirstFrame: true },
		thermal: { tolerance: 0.5, hold: 0, timeout: 30 },
		maximumRejections: 2,
		directory,
		...patch,
	}
}

// Measures with the real statistics of the file; edit changes what a frame seems to show, by its number from 1.
function analyzer(edit: (measurement: DarkFrameMeasurement, frame: number) => DarkFrameMeasurement | Promise<DarkFrameMeasurement>) {
	let frames = 0
	return { measure: async (path: string) => await edit(await measureDarkFile(path), ++frames) }
}

// A measurement that seems flooded by light.
function flooded(measurement: DarkFrameMeasurement): DarkFrameMeasurement {
	return { ...measurement, planes: measurement.planes.map((plane) => ({ ...plane, clipped: 0.5 })) }
}

async function setup(edit: Parameters<typeof analyzer>[0] = (measurement) => measurement) {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operations = new OperationRegistry(manager.devices, () => {})
	disposables.push(operations)
	const images = new ImageStore()
	const frames = new CaptureFrameRegistry(images, () => {}, { database: AppDatabase.memory() })
	disposables.push(frames)
	const resolve = (connectionId: string) => manager.client(connectionId)
	const captures = new CameraCaptures(manager.devices, resolve, operations, images, frames, () => {}, mkdtempSync(join(root, 'captures-')))
	disposables.push(captures)
	const cameras = new CameraCommands(manager.devices, resolve, operations)
	const wheels = new WheelCommands(manager.devices, resolve, operations)
	disposables.push(wheels)
	const panels = new FlatPanelCommands(manager.devices, resolve, operations)
	disposables.push(panels)
	const covers = new CoverCommands(manager.devices, resolve, operations)
	disposables.push(covers)
	const events: DarkLibraryWizardEvent[] = []
	const store = new DarkPlanStore(AppDatabase.memory())
	const endedPlans: string[] = []
	const wizard = new DarkLibraryWizardSessions(
		manager.devices,
		resolve,
		operations,
		captures.capturer,
		cameras.commander,
		wheels.commander,
		panels.commander,
		covers.commander,
		images,
		frames,
		analyzer(edit),
		store,
		(event) => events.push(event),
		undefined,
		(planId) => endedPlans.push(planId),
	)
	disposables.push(wizard)

	const devices = manager.devices.list(client)
	const cameraId = devices.find((device) => device.type === 'camera')!.id
	const wheelId = devices.find((device) => device.type === 'wheel')!.id
	const panelId = devices.find((device) => device.type === 'flatPanel')!.id
	const coverId = devices.find((device) => device.type === 'cover')!.id
	for (const deviceId of [cameraId, wheelId, panelId, coverId]) manager.devices.switch(client, deviceId, true)
	const camera = manager.devices.camera(client, cameraId)!
	const wheel = manager.devices.device(client, 'wheel', wheelId)!
	const panel = manager.devices.device(client, 'flatPanel', panelId)!
	const cover = manager.devices.device(client, 'cover', coverId)!
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && wheel.connected && wheel.count > 1 && panel.connected && cover.connected && cover.canPark && operations.available(camera) && operations.available(wheel) && operations.available(panel) && operations.available(cover))
	if (panel.enabled) expect(await panels.commander.disable(operations.coordinator, panel)).toMatchObject({ ok: true })
	if (cover.parked) expect(await covers.commander.unpark(operations.coordinator, cover)).toMatchObject({ ok: true })
	if (wheel.position !== 0) expect(await wheels.commander.moveTo(operations.coordinator, wheel, 0)).toMatchObject({ ok: true })

	const summary = () => events.at(-1)?.session
	const ended = () => summary()?.endedAt !== undefined
	const released = () => operations.available(camera) && operations.available(wheel) && operations.available(panel) && operations.available(cover)
	const pending = async () => {
		await waitUntil(() => summary()?.pending !== undefined)
		return summary()!.pending!
	}
	const confirm = async (sessionId: string) => expect(wizard.continue(sessionId, { stepId: (await pending()).stepId }).status).toBe(204)

	return {
		endedPlans,
		id,
		manager,
		client,
		operations,
		cameras,
		wheels,
		panels,
		covers,
		store,
		frames,
		wizard,
		events,
		camera,
		cameraId,
		wheel,
		wheelDevice: { connectionId: id, deviceId: wheelId },
		panel,
		panelDevice: { connectionId: id, deviceId: panelId },
		cover,
		coverDevice: { connectionId: id, deviceId: coverId },
		directory: mkdtempSync(join(root, 'darks-')),
		summary,
		ended,
		released,
		pending,
		confirm,
	}
}

// Starts a session and returns its ids.
async function start(wizard: DarkLibraryWizardSessions, connectionId: string, cameraId: string, body: DarkLibraryWizardRequest) {
	const response = await wizard.start(connectionId, cameraId, body)
	expect(response.status).toBe(202)
	return (await response.json()) as { sessionId: string; operationId: string; planId: string }
}

// Returns the published and rejected files of a group directory.
function filesOf(directory: string) {
	const files = readdirSync(directory).filter((file) => file.endsWith('.fit'))
	const rejected = join(directory, 'rejected')
	return { files, rejected: existsSync(rejected) ? readdirSync(rejected) : [] }
}

describe('plan helpers', () => {
	const capture = { gain: 100, offset: 10, binX: 2, binY: 2, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: 'RAW16' }

	test('a group key tells apart exact values and an uncontrolled temperature', () => {
		const key = (exposure: number, temperature?: number, gain = capture.gain) => darkGroupKey({ exposure, temperature }, { ...capture, gain }, 'camera')
		expect(key(60, -10)).toBe(key(60, -10))
		expect(new Set([key(60, -10), key(60.0001, -10), key(60, -10, 101), key(60, -10.1), key(60)]).size).toBe(5)
	})

	test('groups of one temperature run together, in the order they were asked for', () => {
		const groups = [{ temperature: -10, exposure: 1 }, { temperature: 0, exposure: 2 }, { temperature: -10, exposure: 3 }, { exposure: 4 }, { temperature: 0, exposure: 5 }]
		expect(orderDarkGroups(groups).map((group) => group.exposure)).toEqual([1, 3, 2, 5, 4])
	})

	test('the expected size follows the binning of the sensor or the subframe', () => {
		expect(expectedFrameSize(capture, { width: 4656, height: 3520 })).toEqual({ width: 2328, height: 1760 })
		expect(expectedFrameSize({ ...capture, subframe: true, width: 101, height: 64 }, undefined)).toEqual({ width: 50, height: 32 })
		expect(expectedFrameSize(capture, undefined)).toBeUndefined()
	})
})

describe('Dark Library Wizard sessions', () => {
	test('a manual run asks for no confirmation, and saves its frames byte for byte', async () => {
		const { id, cameraId, wizard, frames, directory, summary, ended, released, camera, store } = await setup()
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory))
		expect(wizard.continue(sessionId, { stepId: 'stale' }).status).toBe(409)

		await waitUntil(ended, 60000)
		expect(summary()?.state).not.toBe('waitingForProtection')
		expect(wizard.session(sessionId).status).toBe(200)
		expect(((await wizard.session(sessionId).json()) as DarkLibraryWizardSession).attempts).toHaveLength(2)
		expect(wizard.session('unknown').status).toBe(404)
		expect(summary()).toMatchObject({ state: 'completed', planId, groups: [{ state: 'completed', accepted: 2, missing: 0, attempted: 2 }] })
		await waitUntil(released)

		const plan = await store.detail(planId, 10)
		expect(plan).toMatchObject({ status: 'completed', missing: 0 })
		const group = plan!.plan.groups[0]
		expect(group.directory.startsWith(join(directory, 'darks'))).toBeTrue()
		expect(existsSync(join(group.directory, STAGING_DIRECTORY))).toBeTrue()
		expect(readdirSync(join(group.directory, STAGING_DIRECTORY))).toEqual([])
		expect(filesOf(group.directory).files).toHaveLength(2)

		const [record] = plan!.frames
		expect(record).toMatchObject({ verdict: 'accepted', header: { frameType: 'Dark Frame', width: 64, height: 64 } })
		expect(record.temperature?.start).toBeNumber()
		expect(readFileSync(record.path).byteLength).toBe(record.size)

		const page = await frames.recent(id, cameraId)
		expect(page.frames).toHaveLength(2)
		expect(page.frames[0]).toMatchObject({ origin: 'darkLibraryWizard', frameType: 'DARK' })
		expect(camera.frameType).toBe('DARK')
		expect(summary()?.lastAttempt).toMatchObject({ verdict: 'accepted', frameId: `${sessionId}:2` })
	})

	test('a plan records what its frames are for and asks for masters, and hears of its end after its journal', async () => {
		const { id, cameraId, wizard, directory, confirm, ended, store, endedPlans } = await setup()
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory, { purpose: 'darkFlat', generateMasters: true }))
		await waitUntil(ended, 60000)
		await waitUntil(() => endedPlans.length > 0)

		expect(endedPlans).toEqual([planId])
		expect(await store.plan(planId)).toMatchObject({ purpose: 'darkFlat', generateMasters: true })
		expect(await store.detail(planId, 10)).toMatchObject({ status: 'completed', missing: 0 })
	})

	test('an ordinary plan stays as it was', async () => {
		const { id, cameraId, wizard, directory, confirm, ended, store } = await setup()
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory))
		await waitUntil(ended, 60000)

		const plan = await store.plan(planId)
		expect(plan?.purpose).toBeUndefined()
		expect(plan?.generateMasters).toBeUndefined()
	})

	test('a repeated token answers the same session, even while the first request is prepared', async () => {
		const { id, cameraId, wizard, directory, confirm, ended } = await setup()
		const body = request(directory)
		const [first, second] = await Promise.all([wizard.start(id, cameraId, body), wizard.start(id, cameraId, body)])
		const started = (await first.json()) as { sessionId: string }
		expect(first.status).toBe(202)
		expect(await second.json()).toEqual(started as never)
		expect(((await (await wizard.start(id, cameraId, body)).json()) as { sessionId: string }).sessionId).toBe(started.sessionId)
		await waitUntil(ended, 60000)
	})

	test('every protection is applied in order, verified, restored, and left off', async () => {
		const { id, cameraId, wizard, directory, wheel, panel, cover, panels, operations, wheelDevice, panelDevice, coverDevice, events, summary, ended } = await setup()
		expect(await panels.commander.enable(operations.coordinator, panel)).toMatchObject({ ok: true })
		const body = request(directory, { groups: [{ exposure: 1, count: 1 }], protection: { darkFilter: { slot: 2 }, closeCover: true, panelOff: true, manualCap: false, verifyFirstFrame: true }, wheel: wheelDevice, panel: panelDevice, cover: coverDevice })
		await start(wizard, id, cameraId, body)

		await waitUntil(() => summary()?.state === 'exposing')
		expect(panel.enabled).toBeFalse()
		expect(wheel.position).toBe(2)
		expect(cover.parked).toBeTrue()

		const order = events.map((event) => event.session.state).filter((state, index, all) => state !== all[index - 1])
		expect(order.slice(0, 3)).toEqual(['disablingPanel', 'movingDarkFilter', 'closingCover'])

		await waitUntil(ended, 60000)
		expect(summary()).toMatchObject({ state: 'completed', cleanupWarnings: [] })
		expect(panel.enabled).toBeFalse()
		expect(wheel.position).toBe(0)
		expect(cover.parked).toBeFalse()
	})

	test('a cover found closed stays closed', async () => {
		const { id, cameraId, wizard, directory, cover, covers, operations, coverDevice, summary, ended } = await setup()
		expect(await covers.commander.park(operations.coordinator, cover)).toMatchObject({ ok: true })
		await start(wizard, id, cameraId, request(directory, { protection: { closeCover: true, panelOff: false, manualCap: false, verifyFirstFrame: true }, cover: coverDevice }))
		await waitUntil(ended, 60000)
		expect(summary()).toMatchObject({ state: 'completed' })
		expect(cover.parked).toBeTrue()
	})

	test('what the protection did not select stays free', async () => {
		const { id, cameraId, wizard, directory, wheel, operations, wheelDevice, summary, wizard: service } = await setup()
		const { sessionId } = await start(wizard, id, cameraId, request(directory, { groups: [{ exposure: 30, count: 1 }], wheel: wheelDevice }))
		await waitUntil(() => summary()?.state === 'exposing')
		expect(operations.available(wheel)).toBeTrue()
		expect(summary()?.wheel).toBeUndefined()
		expect((await service.stop(sessionId)).status).toBe(204)
	})

	test('a selected device that is missing, a slot the wheel lacks, or an uncoolable target is refused without moving anything', async () => {
		const { id, cameraId, wizard, directory, wheel, wheelDevice, events, store } = await setup()
		const protection = { closeCover: false, panelOff: false, manualCap: false, verifyFirstFrame: true }

		const missing = await wizard.start(id, cameraId, request(directory, { protection: { ...protection, closeCover: true } }))
		expect(missing.status).toBe(409)
		expect(await missing.json()).toMatchObject({ code: 'protectionUnavailable' })

		const slot = await wizard.start(id, cameraId, request(directory, { protection: { ...protection, darkFilter: { slot: wheel.count } }, wheel: wheelDevice }))
		expect(slot.status).toBe(422)
		expect(await slot.json()).toMatchObject({ code: 'invalidFilterSlot' })
		expect(wheel.position).toBe(0)

		expect(events).toHaveLength(0)
		expect(await store.list()).toHaveLength(0)
	})

	test('a busy camera and a running session are refused', async () => {
		const { id, cameraId, wizard, directory } = await setup()
		const { sessionId } = await start(wizard, id, cameraId, request(directory, { groups: [{ exposure: 30, count: 1 }] }))
		const again = await wizard.start(id, cameraId, request(directory))
		expect(again.status).toBe(409)
		expect(await again.json()).toMatchObject({ code: 'alreadyRunning' })
		await wizard.stop(sessionId)
	})

	test('a stop during an exposure cleans up, and the plan records what is missing', async () => {
		const { id, cameraId, wizard, directory, summary, store, released } = await setup()
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory, { groups: [{ exposure: 30, count: 1 }] }))
		await waitUntil(() => summary()?.state === 'exposing')
		expect((await wizard.stop(sessionId)).status).toBe(204)
		expect(summary()).toMatchObject({ state: 'cancelled', groups: [{ state: 'cancelled', accepted: 0, missing: 1 }] })
		expect((await store.list())[0]).toMatchObject({ planId, status: 'stopped', missing: 1 })
		expect((await wizard.stop(sessionId)).status).toBe(409)
		await waitUntil(released)
	})

	test('a pause takes effect between frames, keeps the devices, and a resume continues at once', async () => {
		const { id, cameraId, wizard, directory, camera, operations, summary, ended, store } = await setup()
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory, { groups: [{ exposure: 0.01, count: 3 }] }))
		expect(wizard.pause(sessionId).status).toBe(204)
		expect(wizard.pause(sessionId).status).toBe(204)

		await waitUntil(() => summary()?.state === 'paused')
		expect(summary()).toMatchObject({ pauseRequested: true })
		expect(operations.available(camera)).toBeFalse()
		expect((await store.list())[0].status).toBe('paused')

		expect(wizard.resume(sessionId).status).toBe(204)
		expect(wizard.resume(sessionId).status).toBe(409)
		await waitUntil(ended, 60000)
		expect(summary()).toMatchObject({ state: 'completed', pauseRequested: false, groups: [{ accepted: 3 }] })
		expect((await store.list())[0]).toMatchObject({ planId, status: 'completed' })
	})

	test('a device that leaves its verified state stops the frames until it returns', async () => {
		const { id, cameraId, wizard, directory, summary, ended, confirm, operations, wheel, wheelDevice, pending, client } = await setup()
		const { sessionId } = await start(wizard, id, cameraId, request(directory, { groups: [{ exposure: 0.01, count: 2 }], protection: { darkFilter: { slot: 2 }, closeCover: false, panelOff: false, manualCap: false, verifyFirstFrame: true }, wheel: wheelDevice }))
		expect(wizard.pause(sessionId).status).toBe(204)
		await waitUntil(() => summary()?.state === 'paused')

		// Something outside this application moved the wheel.
		client.sendNumber({ device: wheel.name, name: 'FILTER_SLOT', elements: { FILTER_SLOT_VALUE: 1 } })
		await waitUntil(() => wheel.position === 0 && !wheel.moving)

		expect(wizard.resume(sessionId).status).toBe(204)
		expect(await pending()).toMatchObject({ kind: 'protectionLost', message: expect.stringContaining('dark slot') })
		await confirm(sessionId)
		expect(await pending()).toMatchObject({ kind: 'protectionLost' })
		expect(operations.available(wheel)).toBeFalse()
		await wizard.stop(sessionId)
		expect(ended()).toBeTrue()
		expect(summary()).toMatchObject({ state: 'cancelled', groups: [{ accepted: 0 }] })
	})

	test('a suspicion on the first frame waits for a decision, and continuing keeps the warning', async () => {
		const { id, cameraId, wizard, directory, summary, ended, confirm, pending, store } = await setup((measurement, frame) => (frame === 1 ? flooded(measurement) : measurement))
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory))
		expect(await pending()).toMatchObject({ kind: 'suspectedLight', group: 0, suspicions: ['saturation'] })
		expect(summary()?.state).toBe('waitingForDecision')
		await confirm(sessionId)
		await waitUntil(ended, 60000)

		expect(summary()).toMatchObject({ state: 'completed', groups: [{ accepted: 1, acceptedWithWarnings: 1 }] })
		const { frames } = (await store.detail(planId, 10))!
		expect(frames[0]).toMatchObject({ verdict: 'acceptedWithWarnings', acknowledged: true, suspicions: ['saturation'] })
		expect(frames[1]).toMatchObject({ verdict: 'accepted' })
	})

	test('stopping at a suspicion quarantines the frame, which never counts', async () => {
		const { id, cameraId, wizard, directory, summary, confirm, pending, store } = await setup(flooded)
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory))
		await pending()
		expect(summary()?.groups[0].attempted).toBe(1)
		await wizard.stop(sessionId)

		const detail = (await store.detail(planId, 10))!
		expect(detail.groups[0]).toMatchObject({ accepted: 0, incomplete: 1, missing: 2 })
		const { files, rejected } = filesOf(detail.plan.groups[0].directory)
		expect(files).toEqual([])
		expect(rejected).toHaveLength(1)
	})

	test('without first-frame verification one suspicion is only recorded, and two in a row stop', async () => {
		const { id, cameraId, wizard, directory, summary, confirm, pending } = await setup(flooded)
		const protection = { closeCover: false, panelOff: false, manualCap: true, verifyFirstFrame: false }
		const { sessionId } = await start(wizard, id, cameraId, request(directory, { protection, groups: [{ exposure: 0.01, count: 3 }] }))
		expect(await pending()).toMatchObject({ kind: 'suspectedLight' })
		expect(summary()?.groups[0]).toMatchObject({ acceptedWithWarnings: 1, attempted: 2 })
		await wizard.stop(sessionId)
	})

	test('a rejected frame is kept and retried within its budget', async () => {
		const { id, cameraId, wizard, directory, summary, ended, confirm, store } = await setup((measurement, frame) => (frame === 2 ? { ...measurement, header: { ...measurement.header, frameType: 'Light Frame' } } : measurement))
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory))
		await waitUntil(ended, 60000)

		expect(summary()).toMatchObject({ state: 'completed', groups: [{ accepted: 2, rejected: 1, attempted: 3 }] })
		const detail = (await store.detail(planId, 10))!
		expect(filesOf(detail.plan.groups[0].directory)).toMatchObject({ files: [expect.any(String), expect.any(String)], rejected: [expect.any(String)] })
		expect(detail.frames[1]).toMatchObject({ verdict: 'rejected', rejections: ['frameTypeMismatch'] })
	})

	test('an unreadable frame is quarantined like any other rejection, and the budget ends the session', async () => {
		const { id, cameraId, wizard, directory, summary, ended, confirm, store } = await setup(() => Promise.reject(new Error('broken')))
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory, { maximumRejections: 1 }))
		await waitUntil(ended, 60000)

		expect(summary()).toMatchObject({ state: 'failed', code: 'verificationFailed', groups: [{ state: 'failed', rejected: 2, accepted: 0 }] })
		expect((await store.detail(planId, 10))!.frames.map((frame) => frame.rejections)).toEqual([['unreadable'], ['unreadable']])
		expect((await store.list())[0].status).toBe('failed')
	})

	test('a target is commanded once and waits for the reported temperature', async () => {
		const { id, cameraId, wizard, directory, camera, summary, ended, confirm, events, store } = await setup()
		const target = Math.round(camera.temperature) - 2
		const { sessionId, planId } = await start(wizard, id, cameraId, request(directory, { groups: [{ exposure: 0.01, count: 1, temperature: target }], thermal: { tolerance: 0.5, hold: 0.2, timeout: 60 } }))
		await waitUntil(ended, 60000)

		expect(summary()).toMatchObject({ state: 'completed' })
		expect(camera.cooler).toBeTrue()
		expect(Math.abs(camera.temperature - target)).toBeLessThanOrEqual(0.5)
		expect(events.some((event) => event.session.state === 'stabilizing')).toBeTrue()
		const { frames } = (await store.detail(planId, 10))!
		expect(Math.abs(frames[0].temperature!.start - target)).toBeLessThanOrEqual(0.5)
		expect(frames[0].rejections).toEqual([])
	})

	test('a target the sensor does not reach in time fails, and the plan stays', async () => {
		const { id, cameraId, wizard, directory, camera, summary, ended, confirm, store } = await setup()
		const { sessionId } = await start(wizard, id, cameraId, request(directory, { groups: [{ exposure: 0.01, count: 1, temperature: camera.temperature - 40 }], thermal: { tolerance: 0.5, hold: 1, timeout: 0.5 } }))
		await waitUntil(ended, 60000)
		expect(summary()).toMatchObject({ state: 'failed', code: 'temperatureTimeout', reason: 'timeout' })
		expect((await store.list())[0]).toMatchObject({ status: 'failed', missing: 1 })
	})

	test('a disconnection ends the session, and what it held is reported rather than restored', async () => {
		const { id, cameraId, wizard, directory, summary, ended, manager, client, cover, coverDevice } = await setup()
		await start(wizard, id, cameraId, request(directory, { groups: [{ exposure: 30, count: 1 }], protection: { closeCover: true, panelOff: false, manualCap: true, verifyFirstFrame: true }, cover: coverDevice }))
		await waitUntil(() => summary()?.state === 'exposing')
		manager.devices.switch(client, cover.id, false)
		await waitUntil(ended, 30000)
		expect(summary()?.endedAt).toBeDefined()
		expect(summary()?.cleanupWarnings).toEqual([expect.stringContaining(cover.name)])
	})

	test('a failure to record the plan ends the session and counts nothing', async () => {
		const { id, cameraId, wizard, directory, summary, ended, store } = await setup()
		await start(wizard, id, cameraId, request(directory, { groups: [{ exposure: 1, count: 2 }] }))
		store.database.db.run('PRAGMA query_only = ON')
		await waitUntil(ended, 60000)
		expect(summary()).toMatchObject({ state: 'failed', code: 'manifestUnavailable', groups: [{ accepted: 0 }] })
	})
})
