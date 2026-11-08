import { afterEach, expect, spyOn, test } from 'bun:test'
import type { MountFlipExecution } from 'nebulosa/src/devices/commanders/mount'
import { type Client, DEFAULT_GUIDE_OUTPUT, DEFAULT_MOUNT, type GuideOutput, type Mount } from 'nebulosa/src/devices/indi/device'
import { failedOperationResult, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { deg, hour } from 'nebulosa/src/math/units/angle'
import type { AutoFocusSessionSummary } from './autofocus'
import type { CaptureSession, CaptureSuspensionAdmission } from './captures'
import { ConnectionManager } from './connection'
import type { GuidingRestoration, GuidingSessionSummary } from './guiding'
import type { MeridianFlipMonitor } from './meridianflip'
import { type MeridianFlipExecution, type MeridianFlipExecutionRequest, MeridianFlipExecutor, type MeridianFlipExecutorEvent, type MeridianFlipExecutorServices } from './meridianflipexecutor'
import { DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, type MeridianFlipExecutorPolicy } from './meridianflipexecutor.policy'
import type { MountMeridianFlipAdmission } from './mounts'
import { type OperationDevice, OperationRegistry, type ToolInvocation } from './operations'
import type { TargetCenteringRequest, TargetCenteringSessionSummary } from './targetcentering'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

async function waitUntil(condition: () => boolean, timeout = 5000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(5)
	}
}

const POSITION = { rightAscension: hour(5), declination: deg(20) }

// Flip evidence of a mount that moved from WEST to EAST, as the driver reported it.
function moved(patch: Partial<MountFlipExecution> = {}): MountFlipExecution {
	return {
		strategy: 'forcedGoto',
		outcome: 'moved',
		target: POSITION,
		initial: { ...POSITION, pierSide: 'WEST' },
		final: { ...POSITION, pierSide: 'EAST' },
		pierSideProvenance: 'driverReported',
		pierSideChanged: true,
		movementObserved: true,
		arrivalSeparation: 0,
		trackingAfter: true,
		dispatchedAt: Date.now(),
		...patch,
	}
}

// A monitor with the flip window open on the context of the mount.
function openWindow(connectionId: string, deviceId: string, patch: Partial<MeridianFlipMonitor> = {}, timing: Partial<MeridianFlipMonitor['timing']> = {}): MeridianFlipMonitor {
	const now = Date.now()
	return {
		monitorId: 'monitor',
		connectionId,
		deviceId,
		revision: 1,
		settings: { earlyWarningSeconds: 900, minimumSeconds: 300, maximumSeconds: 900, deadlineWarningSeconds: 180, settleSeconds: 2 },
		settingsRevision: 1,
		sampledAt: now,
		contextId: 'context',
		episodeId: 'episode',
		mount: { mountType: 'EQ_GEM', pierSide: 'WEST', tracking: true, trackMode: 'SIDEREAL' },
		availability: 'monitoring',
		timing: { phase: 'windowOpen', quality: 'valid', transitAt: now - 400000, windowOpensAt: now - 100000, windowClosesAt: now + 500000, ...timing },
		mechanical: 'flipCandidate',
		...patch,
	}
}

async function setup(mountPatch: Partial<Mount> = {}) {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operations = new OperationRegistry(manager.devices, () => {})
	disposables.push(operations)
	const list = manager.devices.list(client)
	const mountId = list.find((device) => device.type === 'mount')!.id
	const cameraId = list.find((device) => device.type === 'camera')!.id
	const focuserId = list.find((device) => device.type === 'focuser')!.id
	const hardwareId = manager.devices.mount(client, mountId)!.hardwareId

	// The driver of this mount reports its pier side, unlike the simulator client, whose side is simulated.
	const mount: Mount = { ...structuredClone(DEFAULT_MOUNT), id: mountId, name: 'GEM', hardwareId, connected: true, mountType: 'EQ_GEM', canGoTo: true, hasPierSide: true, pierSide: 'WEST', tracking: true, client: { type: 'INDI', id: 'indi' }, equatorialCoordinate: { ...POSITION }, ...mountPatch }
	const guideOutput: GuideOutput = { ...structuredClone(DEFAULT_GUIDE_OUTPUT), id: 'st4', name: 'ST4', hardwareId: 'st4-hardware', connected: true, client: { type: 'INDI', id: 'indi' } }
	const device = manager.devices.device.bind(manager.devices)
	spyOn(manager.devices, 'device').mockImplementation(((owner: Client, type: string, deviceId: string) => (type === 'mount' && deviceId === mountId ? mount : type === 'guideOutput' && deviceId === 'st4' ? guideOutput : device(owner, type as 'camera', deviceId))) as typeof device)

	const calls: string[] = []
	let monitor: MeridianFlipMonitor | undefined = openWindow(id, mountId)
	let flip: MountFlipExecution | OperationResult<never> = moved()
	const camera: OperationDevice = { connectionId: id, deviceId: cameraId }
	const guide: OperationDevice = { connectionId: id, deviceId: 'st4' }

	// A running loop capture of the main camera, paused by the Executor.
	let captureRunning = true
	let suspendGate: Promise<void> = Promise.resolve()
	const captureSession = { sessionId: 'capture', connectionId: id, deviceId: cameraId, request: { exposureTime: 60, delay: 0 } } as unknown as CaptureSession

	// Guiding through the setup's guide output.
	let guiding: GuidingSessionSummary['state'] | undefined = 'guiding'
	let restoration: GuidingRestoration = 'restored'

	// Plate solutions Target Centering finds: the field turns by half a turn with the flip.
	let flipped = false
	let solutionsFound = true
	const centered: { mode: string; invocation?: ToolInvocation }[] = []

	const services: MeridianFlipExecutorServices = {
		monitor: { monitor: () => monitor },
		mounts: {
			admitMeridianFlip: (_, __, request, invocation): MountMeridianFlipAdmission => {
				calls.push(`flip:${request.strategy}:${invocation && operations.reserves(mount, invocation) ? 'reserved' : 'unreserved'}`)
				const record = { operationId: 'flip', kind: 'mount.flip', devices: [], state: 'running', startedAt: Date.now() } as const
				flipped = true
				const result = 'ok' in flip ? Promise.resolve(flip) : Promise.resolve(successfulOperationResult(flip))
				return { ok: true, admission: { record, finished: Promise.resolve({ ...record, state: 'succeeded' }), repeated: false }, result }
			},
		},
		captures: {
			snapshot: () => ({ sessions: captureRunning ? [captureSession] : [], frames: [] }),
			suspendForMotion: async (_, requester, signal): Promise<CaptureSuspensionAdmission> => {
				calls.push('capture:suspend')
				const aborted = Promise.withResolvers<void>()
				signal.addEventListener('abort', () => aborted.resolve(), { once: true })
				await Promise.race([suspendGate, aborted.promise])
				if (signal.aborted) return { status: 'withdrawn' }
				expect(requester.reservation.ownerId).toBeDefined()
				return {
					status: 'suspended',
					handle: {
						sessionId: 'capture',
						generation: 3,
						ended: new Promise(() => {}),
						reclaim: () => (calls.push('capture:reclaim'), 'reclaimed'),
						resume: () => (calls.push('capture:resume'), 'resumed'),
						release: () => (calls.push('capture:release'), 'released'),
					},
				}
			},
		},
		guiding: {
			runsOn: () => (guiding ? [{ sessionId: 'guiding', cameraName: 'Guide Camera', state: guiding } as GuidingSessionSummary] : []),
			hold: () => {
				calls.push('guiding:hold')
				return { [Symbol.dispose]: () => calls.push('guiding:unhold') }
			},
			suspendForMotion: (sessionId, options) => {
				calls.push(`guiding:suspend:${options?.reservation ? 'reservation' : 'none'}`)
				return Promise.resolve(successfulOperationResult({ sessionId, commandId: 'stop', settle: { pixels: 1.5, time: 10, timeout: 60 } }))
			},
			restoreAfterMotion: () => {
				calls.push('guiding:restore')
				return Promise.resolve(restoration)
			},
		},
		targetCentering: {
			admit: (_, __, request: TargetCenteringRequest, invocation) => {
				calls.push(`center:${request.mode}`)
				centered.push({ mode: request.mode, invocation })
				const orientation = flipped ? deg(190) : deg(10)
				const summary = { sessionId: `center-${centered.length}`, attempts: solutionsFound ? [{ attempt: 1, outcome: 'solved' }] : [], positionVerified: solutionsFound, readyForImaging: solutionsFound } as unknown as TargetCenteringSessionSummary
				solutions.set(summary.sessionId, { orientation, parity: 'NORMAL' })
				return Promise.resolve({ ok: true, sessionId: summary.sessionId, operationId: 'center', repeated: false, ended: Promise.resolve(summary) })
			},
			interrupt: () => true,
			solutionsOf: (sessionId) => {
				const solution = solutions.get(sessionId)
				return solution && solutionsFound ? (new Map([[1, solution]]) as never) : undefined
			},
		},
		autoFocus: {
			admit: (_, __, request, invocation) => {
				calls.push(`autofocus:${invocation ? 'reserved' : 'manual'}`)
				return Promise.resolve({ ok: true, sessionId: 'focus', operationId: 'focus', repeated: false, ended: Promise.resolve({ state: 'completed' } as AutoFocusSessionSummary) })
			},
			interrupt: () => Promise.resolve(true),
		},
	}

	const solutions = new Map<string, { readonly orientation: number; readonly parity: 'NORMAL' }>()
	const events: MeridianFlipExecutorEvent[] = []
	const executor = new MeridianFlipExecutor(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		services,
		(event) => events.push(event),
	)
	disposables.push(executor)

	const policy = (patch: Partial<MeridianFlipExecutorPolicy> = {}): MeridianFlipExecutorPolicy => ({ ...DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY, mountSettleSeconds: 0, ...patch })
	const request = (patch: Partial<MeridianFlipExecutionRequest> = {}, policyPatch: Partial<MeridianFlipExecutorPolicy> = {}): MeridianFlipExecutionRequest => ({
		token: Bun.randomUUIDv7(),
		setup: { camera, guideOutput: guide, focuser: { connectionId: id, deviceId: focuserId } },
		policy: policy(policyPatch),
		centering: {} as never,
		autoFocus: {} as never,
		...patch,
	})
	const execute = (mode: 'now' | 'whenEligible', body: MeridianFlipExecutionRequest = request()) => executor.execute(id, mountId, { ...body, mode })
	const ended = async (response: Response) => {
		const { sessionId } = (await response.json()) as MeridianFlipExecution
		return await executor.ended(sessionId)!
	}

	return {
		id,
		mountId,
		mount,
		operations,
		executor,
		events,
		calls,
		centered,
		request,
		execute,
		ended,
		setMonitor: (value: MeridianFlipMonitor | undefined) => (monitor = value),
		setFlip: (value: MountFlipExecution | OperationResult<never>) => (flip = value),
		setGuiding: (value: GuidingSessionSummary['state'] | undefined) => (guiding = value),
		setRestoration: (value: GuidingRestoration) => (restoration = value),
		setCaptureRunning: (value: boolean) => (captureRunning = value),
		setSuspendGate: (value: Promise<void>) => {
			suspendGate = value
		},
		setSolutionsFound: (value: boolean) => (solutionsFound = value),
	}
}

test('a verified flip pauses the capture, suspends guiding into the reservation, recenters, restores guiding, and resumes the capture', async () => {
	const context = await setup()
	const response = context.execute('now')
	expect(response.status).toBe(202)
	const execution = await context.ended(response)

	expect(execution).toMatchObject({ state: 'completed', strategy: 'forcedGoto', verificationMode: 'driverPierSide', captureSessionId: 'capture', target: { source: 'derivedFromMount' } })
	expect(execution.outcome).toMatchObject({ verification: 'verified', pierSideBefore: 'WEST', pierSideAfter: 'EAST', recentering: 'completed', autofocus: 'skipped', guidingRestoration: 'restored', captureRestoration: 'resumed', readyForImaging: 'ready' })
	expect(context.calls).toEqual(['guiding:hold', 'capture:suspend', 'guiding:suspend:reservation', 'flip:forcedGoto:reserved', 'center:recenter', 'capture:reclaim', 'guiding:restore', 'guiding:unhold', 'capture:resume'])
	// The recentering ran under the reservation, which is released at the end.
	expect(context.centered[0].invocation?.reservation.ownerId).toBe(execution.sessionId)
	expect(context.operations.arbiter.reservationOwnerOf(resourceKey(context.mount))).toBeUndefined()
	expect(context.events.at(-1)).toMatchObject({ type: 'meridianFlipExecutor:updated', execution: { state: 'completed' } })
})

test('Auto Focus runs after the recentering under the same reservation when asked for', async () => {
	const context = await setup()
	const execution = await context.ended(context.execute('now', context.request({}, { autofocusAfterFlip: true })))

	expect(execution.outcome).toMatchObject({ autofocus: 'completed', readyForImaging: 'ready' })
	expect(context.calls).toContain('autofocus:reserved')
	expect(context.calls.indexOf('autofocus:reserved')).toBeGreaterThan(context.calls.indexOf('center:recenter'))
})

test('a flip without movement or side change is never retried and leaves the capture paused', async () => {
	const context = await setup()
	context.setFlip(moved({ outcome: 'noFlipEvidence', movementObserved: false, pierSideChanged: false, final: { ...POSITION, pierSide: 'WEST' } }))
	const execution = await context.ended(context.execute('now'))

	expect(execution).toMatchObject({ state: 'failed', code: 'noFlipEvidence' })
	expect(execution.outcome).toMatchObject({ verification: 'unverified', captureRestoration: 'leftSuspended', recentering: 'skipped', readyForImaging: 'notReady' })
	expect(context.calls.filter((call) => call.startsWith('flip:'))).toHaveLength(1)
	expect(context.calls).not.toContain('center:recenter')
	expect(context.calls).not.toContain('guiding:restore')
	expect(context.calls).toContain('capture:release')
})

test('a flip with an unknown outcome blocks or fails, without retrying or resuming', async () => {
	const context = await setup()
	context.setFlip(failedOperationResult('timeout', 'the mount did not stop'))
	const execution = await context.ended(context.execute('now'))

	expect(execution).toMatchObject({ code: 'unknownResult' })
	expect(['failed', 'blocked']).toContain(execution.state)
	expect(execution.outcome).toMatchObject({ verification: 'unverified', flipCommandCompleted: false, captureRestoration: 'leftSuspended' })
})

test('a mount without a usable pier side is inferred from plate solutions around the flip', async () => {
	const context = await setup({ hasPierSide: false, pierSide: 'NEITHER' })
	context.setFlip(moved({ pierSideProvenance: 'unavailable', pierSideChanged: false, initial: { ...POSITION, pierSide: 'NEITHER' }, final: { ...POSITION, pierSide: 'NEITHER' } }))

	const strict = await context.ended(context.execute('now'))
	expect(strict).toMatchObject({ state: 'failed', code: 'notReady', verificationMode: 'inference' })
	expect(strict.outcome).toMatchObject({ verification: 'inferred', wcs: { status: 'consistent', parityKept: true }, captureRestoration: 'leftSuspended', recentering: 'skipped' })
	expect(context.calls.filter((call) => call.startsWith('center:'))).toEqual(['center:verifyOnly', 'center:verifyOnly'])
})

test('an inferred flip lets imaging go on only when the policy accepts it', async () => {
	const context = await setup({ hasPierSide: false, pierSide: 'NEITHER' })
	context.setFlip(moved({ pierSideProvenance: 'unavailable', pierSideChanged: false }))

	const accepted = await context.ended(context.execute('now', context.request({}, { allowInferredVerification: true, allowInferredAutoResume: true })))
	expect(accepted).toMatchObject({ state: 'completed' })
	expect(accepted.outcome).toMatchObject({ verification: 'inferred', recentering: 'completed', captureRestoration: 'resumed' })
})

test('missing plate solutions leave an inferred flip unverified', async () => {
	const context = await setup({ hasPierSide: false, pierSide: 'NEITHER' })
	context.setFlip(moved({ pierSideProvenance: 'unavailable', pierSideChanged: false }))
	context.setSolutionsFound(false)

	const execution = await context.ended(context.execute('now', context.request({}, { allowInferredAutoResume: true })))
	expect(execution).toMatchObject({ state: 'failed', code: 'noFlipEvidence' })
	expect(execution.outcome).toMatchObject({ verification: 'unverified', wcs: { status: 'missing' } })
})

test('a flip is refused before the window when asked now, scheduled when eligible, and never repeated for its passage', async () => {
	const context = await setup()
	context.setMonitor(openWindow(context.id, context.mountId, { mechanical: 'notDue' }, { phase: 'approaching', windowOpensAt: Date.now() + 60000 }))

	const now = context.execute('now')
	expect(now.status).toBe(409)
	expect(await now.json()).toMatchObject({ code: 'notDue' })

	const scheduled = context.execute('whenEligible')
	expect(scheduled.status).toBe(202)
	expect(context.executor.snapshot().arms).toHaveLength(1)
	expect(context.execute('whenEligible').status).toBe(409)

	context.setMonitor(openWindow(context.id, context.mountId))
	context.executor.consume({ type: 'meridianFlip:updated', epoch: 'epoch', revision: 2, key: { connectionId: context.id, deviceId: context.mountId } })
	expect(context.executor.snapshot().arms).toHaveLength(0)
	const running = context.executor.snapshot().executions[0]
	expect(running).toMatchObject({ trigger: 'scheduled' })
	expect(await context.executor.ended(running.sessionId)).toMatchObject({ state: 'completed' })

	const again = context.execute('now')
	expect(again.status).toBe(409)
	expect(await again.json()).toMatchObject({ code: 'alreadyServiced' })
})

test('the automatic arm refuses a mount without a usable pier side unless inference is allowed, and disarming commands nothing', async () => {
	const context = await setup({ client: { type: 'SIMULATOR', id: 'simulator' } })

	const refused = context.executor.arm(context.id, context.mountId, context.request())
	expect(refused.status).toBe(409)
	expect(await refused.json()).toMatchObject({ code: 'noPierSide' })

	context.setMonitor(openWindow(context.id, context.mountId, { mechanical: 'notDue' }, { phase: 'before', windowOpensAt: Date.now() + 3600000 }))
	expect(context.executor.arm(context.id, context.mountId, context.request({}, { allowInferredVerification: true })).status).toBe(202)
	expect(context.executor.snapshot().arms[0]).toMatchObject({ trigger: 'automatic', decision: { decision: 'wait', code: 'notDue' } })
	expect(context.executor.disarm(context.id, context.mountId).status).toBe(204)
	expect(context.executor.snapshot().arms).toEqual([])
	expect(context.calls).toEqual([])
})

test('a mount already on its post-meridian side, or a setup without what the policy needs, is refused', async () => {
	const context = await setup()
	context.setMonitor(openWindow(context.id, context.mountId, { mechanical: 'alreadyOnExpectedSide' }))
	expect(await context.execute('now').json()).toMatchObject({ code: 'alreadyFlipped' })

	context.setMonitor(openWindow(context.id, context.mountId))
	const noCamera = context.execute('now', context.request({ setup: {} }))
	expect(noCamera.status).toBe(422)
	expect(await noCamera.json()).toMatchObject({ code: 'missingCamera' })
	expect(await context.execute('now', context.request({ setup: { camera: { connectionId: context.id, deviceId: 'unknown' } } })).json()).toMatchObject({ code: 'notFound' })
})

test('cancelling while the capture finishes its frame commands nothing and resumes nothing', async () => {
	const context = await setup()
	context.setSuspendGate(Promise.withResolvers<void>().promise)
	const response = context.execute('now')
	const { sessionId } = (await response.clone().json()) as MeridianFlipExecution
	await waitUntil(() => context.calls.includes('capture:suspend'))

	expect(context.executor.cancel(sessionId).status).toBe(202)
	const execution = await context.executor.ended(sessionId)!
	expect(execution).toMatchObject({ state: 'cancelled', code: 'cancelled' })
	expect(context.calls.some((call) => call.startsWith('flip:'))).toBeFalse()
	expect(context.calls).not.toContain('guiding:suspend:reservation')
})

test('guiding that is calibrating refuses the flip before the mount moves, and the capture goes on', async () => {
	const context = await setup()
	context.setGuiding('calibrating')
	const execution = await context.ended(context.execute('now'))

	expect(execution).toMatchObject({ state: 'failed', code: 'guidingActive' })
	expect(context.calls.some((call) => call.startsWith('flip:'))).toBeFalse()
	expect(context.calls).toContain('capture:resume')
})

test('guiding that cannot be restored leaves the capture paused', async () => {
	const context = await setup()
	context.setRestoration('failed')
	const execution = await context.ended(context.execute('now'))

	expect(execution).toMatchObject({ state: 'failed', code: 'notReady' })
	expect(execution.outcome).toMatchObject({ verification: 'verified', guidingRestoration: 'failed', captureRestoration: 'leftSuspended' })
})

test('a repeated token answers the first response without flipping again', async () => {
	const context = await setup()
	const body = context.request()
	const first = context.execute('now', body)
	await context.ended(first.clone())
	const second = context.execute('now', body)

	expect(second.status).toBe(first.status)
	expect(context.calls.filter((call) => call.startsWith('flip:'))).toHaveLength(1)
})
