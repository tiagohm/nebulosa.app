import { describe, expect, test } from 'bun:test'
import type { AutoFocusSessionSummary } from './autofocus'
import type { CalibrationJobSummary } from './calibrationlibrary.jobs'
import type { CaptureSession } from './captures'
import type { DarkLibraryWizardSessionSummary } from './darklibrarywizard'
import type { DarvMeasurement, DarvSessionSummary } from './darv'
import type { FlatWizardSessionSummary } from './flatwizard'
import type { GuidingSessionSummary } from './guiding'
import type { IPolarSessionSummary } from './ipolar'
import type { LiveStackingCounters, LiveStackingSession } from './livestacking'
import type { MeridianFlipTransition } from './meridianflip'
import type { MeridianFlipArm, MeridianFlipExecution } from './meridianflipexecutor'
import { failureText, NotificationClassifier } from './notifications.rules'
import type { OperationRecord } from './operations'
import type { SpiceKernelJob } from './spicekernels.jobs'
import type { TargetCenteringSessionSummary } from './targetcentering'
import type { TppaSessionSummary } from './tppa'
import type { ServerEvent } from './websocket'

const camera = { connectionId: 'c', deviceId: 'cam' }
const mount = { connectionId: 'c', deviceId: 'mnt' }

function capture(session: Partial<CaptureSession>): ServerEvent {
	return { type: 'capture:updated', session: { sessionId: 's1', operationId: 'o1', connectionId: 'c', deviceId: 'cam', cameraName: 'CCD', phase: 'exposing', captured: 3, ...session } as CaptureSession }
}

function liveStacking(state: LiveStackingSession['state'], counters: Partial<LiveStackingCounters>, ended = true): ServerEvent {
	const session = {
		sessionId: 'l1',
		connectionId: 'c',
		deviceId: 'cam',
		cameraName: 'CCD',
		state,
		capture: { sessionId: 'cap1', outputMode: 'preview-only', ended },
		counters: { received: 0, queued: 0, processing: 0, held: 0, accepted: 0, rejected: 0, skipped: 0, deliveryFailed: 0, ...counters },
	} as LiveStackingSession
	return { type: 'liveStacking:updated', epoch: 'e', revision: 1, session }
}

function autoFocus(session: Partial<AutoFocusSessionSummary>): ServerEvent {
	return { type: 'autofocus:updated', session: { sessionId: 'a1', operationId: 'o2', camera, cameraName: 'CCD', focuser: { connectionId: 'c', deviceId: 'foc' }, focuserName: 'Focuser', state: 'measuring', ...session } as AutoFocusSessionSummary }
}

function tppa(session: Partial<TppaSessionSummary>): ServerEvent {
	return { type: 'tppa:updated', session: { sessionId: 't1', operationId: 'o3', camera, cameraName: 'CCD', mount, mountName: 'Mount', state: 'capturing', ...session } as TppaSessionSummary }
}

function ipolar(session: Partial<IPolarSessionSummary>): ServerEvent {
	return { type: 'ipolar:updated', session: { sessionId: 'i1', operationId: 'o9', camera, cameraName: 'CCD', state: 'capturing', convergence: { streak: 0, converged: false }, ...session } as IPolarSessionSummary }
}

function targetCentering(session: Partial<TargetCenteringSessionSummary>): ServerEvent {
	return { type: 'targetCentering:updated', session: { sessionId: 'c1', operationId: 'o6', camera, cameraName: 'CCD', mount, mountName: 'Mount', state: 'running', positionVerified: false, ...session } as TargetCenteringSessionSummary }
}

function darkLibraryWizard(session: Partial<DarkLibraryWizardSessionSummary>): ServerEvent {
	return { type: 'darkLibraryWizard:updated', session: { sessionId: 'd1', operationId: 'o5', camera, cameraName: 'CCD', state: 'exposing', cleanupWarnings: [], ...session } as DarkLibraryWizardSessionSummary }
}

function flatWizard(session: Partial<FlatWizardSessionSummary>): ServerEvent {
	return { type: 'flatWizard:updated', session: { sessionId: 'f1', operationId: 'o4', camera, cameraName: 'CCD', state: 'exposing', ...session } as FlatWizardSessionSummary }
}

function guiding(session: Partial<GuidingSessionSummary>): ServerEvent {
	return { type: 'guiding:updated', session: { sessionId: 'g1', operationId: 'o5', camera, cameraName: 'Guider', active: true, lost: false, ...session } as GuidingSessionSummary }
}

function darv(...measurements: Partial<DarvMeasurement>[]): ServerEvent {
	return { type: 'darv:updated', session: { sessionId: 'd1', camera, cameraName: 'CCD', mount, mountName: 'Mount', state: 'idle', measurements: measurements.map((m, i) => Object.assign({ generation: i + 1, operationId: `od${i}`, state: 'ready' }, m) as DarvMeasurement) } as unknown as DarvSessionSummary }
}

function operation(record: Partial<OperationRecord>): ServerEvent {
	return { type: 'operation:updated', operation: { operationId: 'op', kind: 'mount.goto', devices: [mount], state: 'failed', reason: 'timeout', startedAt: 0, ...record } }
}

const open: ServerEvent = { type: 'connection:open', connection: { type: 'INDI', host: 'pi', port: 7624, id: 'c' } }

test('a Dark Library Wizard reports what needs the operator, what it left changed, and its outcome, never its telemetry', () => {
	const classifier = new NotificationClassifier(() => undefined)
	expect(classifier.classify(darkLibraryWizard({ state: 'stabilizing', temperature: -10 }))).toEqual([])
	expect(classifier.classify(darkLibraryWizard({ state: 'cancelled', reason: 'aborted' }))).toEqual([])
	expect(classifier.classify(darkLibraryWizard({ state: 'waitingForProtection', pending: { stepId: 'x', kind: 'protectionLost', message: 'Wheel left the dark slot' } }))).toEqual([
		expect.objectContaining({ key: 'dark.step:x', level: 'warning', code: 'darkLibraryWizard.actionRequired', target: expect.objectContaining({ tool: 'dark-library-wizard' }) }),
	])
	expect(classifier.classify(darkLibraryWizard({ state: 'waitingForDecision', pending: { stepId: 'y', kind: 'suspectedLight', group: 0, suspicions: ['saturation'] } }))[0].message).toContain('external light')
	expect(classifier.classify(darkLibraryWizard({ state: 'completed', cleanupWarnings: ['cover'] })).map((draft) => draft.code)).toEqual(['darkLibraryWizard.cleanupWarning', 'darkLibraryWizard.completed'])
	expect(classifier.classify(darkLibraryWizard({ state: 'failed', reason: 'alert' }))[0]).toMatchObject({ key: 'dark:d1', code: 'darkLibraryWizard.failed' })
})

test('reports completed and failed captures once per session key', () => {
	const classifier = new NotificationClassifier()
	expect(classifier.classify(capture({ phase: 'exposing' }))).toEqual([])

	const [completed] = classifier.classify(capture({ phase: 'completed' }))
	expect(completed).toMatchObject({ key: 'capture:s1', level: 'success', code: 'capture.completed', target: { kind: 'cameraTool', connectionId: 'c', deviceId: 'cam', tool: 'camera-acquisition' } })

	const [failed] = classifier.classify(capture({ phase: 'failed', reason: 'timeout', error: '/home/user/secret.fits: EACCES' }))
	expect(failed).toMatchObject({ key: 'capture:s1', level: 'error', code: 'capture.failed' })
	expect(failed.message).not.toContain('secret')
	expect(failed.message).toContain('timed out')
})

test('reports a failed Live Stacking session and a capture that ended with nothing stacked, once each', () => {
	const classifier = new NotificationClassifier()
	expect(classifier.classify(liveStacking('waiting', { received: 3, skipped: 3 }, false))).toEqual([])
	expect(classifier.classify(liveStacking('waiting', { received: 3, queued: 1, skipped: 2 }))).toEqual([])
	expect(classifier.classify(liveStacking('waiting', { received: 3, accepted: 1, skipped: 2 }))).toEqual([])
	expect(classifier.classify(liveStacking('stopped', { received: 3, skipped: 3 }))).toEqual([])
	expect(classifier.classify(liveStacking('waiting', { received: 3, skipped: 3 }))).toMatchObject([
		{ key: 'liveStacking:l1:cap1:noneStacked', level: 'warning', code: 'liveStacking.noneStacked', message: 'None of the 3 frames CCD took was stacked; Live Stacking says why.', target: { kind: 'cameraTool', connectionId: 'c', deviceId: 'cam', tool: 'live-stacking' } },
	])
	expect(classifier.classify(liveStacking('failed', { received: 3, deliveryFailed: 3 }))).toMatchObject([{ key: 'liveStacking:l1:failed', level: 'error', code: 'liveStacking.failed' }])
})

test('stopped, aborted, and cancelled sessions are quiet', () => {
	const classifier = new NotificationClassifier()
	expect(classifier.classify(capture({ phase: 'stopped' }))).toEqual([])
	expect(classifier.classify(capture({ phase: 'aborted', reason: 'aborted' }))).toEqual([])
	expect(classifier.classify(autoFocus({ state: 'cancelled', reason: 'aborted' }))).toEqual([])
	expect(classifier.classify(tppa({ state: 'cancelled', reason: 'aborted' }))).toEqual([])
	expect(classifier.classify(flatWizard({ state: 'cancelled', reason: 'aborted' }))).toEqual([])
	expect(classifier.classify(guiding({ active: false }))).toEqual([])
	expect(classifier.classify(darv({ state: 'aborted', reason: 'aborted' }))).toEqual([])
})

test('reports Auto Focus and TPPA transitions', () => {
	const classifier = new NotificationClassifier()
	expect(classifier.classify(autoFocus({ state: 'completed', finalPosition: 1200 }))[0]).toMatchObject({ code: 'autofocus.completed', message: 'Focuser was focused at 1200 steps.', target: { tool: 'auto-focus', deviceId: 'cam' } })
	expect(classifier.classify(autoFocus({ sessionId: 'a2', state: 'completed', finalPosition: 1200, verifiedHfd: 2.774 }))[0]).toMatchObject({ message: 'Focuser was focused at 1200 steps, verified at 2.77 px HFD.' })
	expect(classifier.classify(autoFocus({ state: 'failed', reason: 'commandFailed' }))[0]).toMatchObject({ code: 'autofocus.failed', level: 'error', message: 'Auto Focus of Focuser failed: a command failed.' })
	expect(classifier.classify(autoFocus({ sessionId: 'a3', state: 'failed', reason: 'commandFailed', error: 'the focus curve of 9 frames was rejected' }))[0]).toMatchObject({ message: 'Auto Focus of Focuser failed: the focus curve of 9 frames was rejected.' })
	expect(classifier.classify(tppa({ state: 'readyToRefine' }))[0]).toMatchObject({ key: 'tppa.ready:t1', level: 'info', code: 'tppa.readyToRefine' })
	expect(classifier.classify(tppa({ state: 'refinementPaused' }))).toEqual([])
	expect(classifier.classify(tppa({ state: 'completed' }))).toEqual([])
	expect(classifier.classify(tppa({ state: 'failed', reason: 'timeout' }))[0]).toMatchObject({ key: 'tppa:t1', code: 'tppa.failed' })
	expect(classifier.classify(tppa({ sessionId: 't2', state: 'failed', reason: 'unexpectedState', error: 'point 2 moved against the RA direction' }))[0]).toMatchObject({ message: 'TPPA of CCD with Mount failed: point 2 moved against the RA direction.' })
})

test('reports iPolar ready to refine, within its target, and failed, never a cancellation', () => {
	const classifier = new NotificationClassifier()
	expect(classifier.classify(ipolar({ state: 'readyToRefine' }))[0]).toMatchObject({ key: 'ipolar.ready:i1', level: 'info', code: 'ipolar.readyToRefine', target: { tool: 'ipolar', deviceId: 'cam' } })
	expect(classifier.classify(ipolar({ state: 'refining' }))).toEqual([])
	expect(classifier.classify(ipolar({ state: 'refining', convergence: { streak: 3, converged: true } }))[0]).toMatchObject({ key: 'ipolar.converged:i1', code: 'ipolar.converged' })
	expect(classifier.classify(ipolar({ state: 'completed' }))).toEqual([])
	expect(classifier.classify(ipolar({ state: 'cancelled', reason: 'aborted' }))).toEqual([])
	expect(classifier.classify(ipolar({ state: 'failed', reason: 'unexpectedState', error: 'the second pose was rejected: wrongAxis' }))[0]).toMatchObject({ key: 'ipolar:i1', code: 'ipolar.failed', level: 'error' })
})

test('reports a blocked mount and the outcome of a centering, never a measurement out of tolerance or a stop', () => {
	const classifier = new NotificationClassifier()
	expect(classifier.classify(targetCentering({ state: 'completed', positionVerified: true, readyForImaging: true }))[0]).toMatchObject({ key: 'targetCentering:c1', level: 'success', code: 'targetCentering.completed', target: { kind: 'cameraTool', tool: 'target-centering' } })
	expect(classifier.classify(targetCentering({ state: 'completed', positionVerified: true, readyForImaging: false }))[0]).toMatchObject({ level: 'warning', code: 'targetCentering.guidingNotRestored' })
	expect(classifier.classify(targetCentering({ state: 'failed', reason: 'commandFailed', error: 'no plate solution' }))[0]).toMatchObject({ level: 'error', code: 'targetCentering.failed', message: 'Centering Mount failed: no plate solution.' })
	expect(classifier.classify(targetCentering({ state: 'blocked' }))[0]).toMatchObject({ level: 'error', code: 'targetCentering.blocked' })
	expect(classifier.classify(targetCentering({ state: 'completed', positionVerified: false }))).toEqual([])
	expect(classifier.classify(targetCentering({ state: 'cancelled', reason: 'aborted' }))).toEqual([])
	expect(classifier.classify(targetCentering({ state: 'failed', reason: 'aborted' }))).toEqual([])
})

test('reports each manual step of the Flat Wizard by its id, cleanup warnings, and outcomes', () => {
	const classifier = new NotificationClassifier()
	const step = classifier.classify(flatWizard({ state: 'waitingForFilter', pending: { stepId: 'x', kind: 'filter', filter: 0 } }))
	expect(step).toEqual([expect.objectContaining({ key: 'flat.step:x', level: 'warning', code: 'flatWizard.actionRequired' })])
	expect(classifier.classify(flatWizard({ state: 'waitingForIllumination', pending: { stepId: 'y', kind: 'illumination', filter: 1 } }))[0].key).toBe('flat.step:y')

	const ended = classifier.classify(flatWizard({ state: 'completed', cleanupWarning: 'panel left on' }))
	expect(ended.map((d) => d.code)).toEqual(['flatWizard.cleanupWarning', 'flatWizard.completed'])
	expect(ended[0].message).not.toContain('panel left on')
	expect(classifier.classify(flatWizard({ state: 'failed', reason: 'alert' }))[0]).toMatchObject({ key: 'flat:f1', code: 'flatWizard.failed' })
})

test('reports guiding calibrations and failures, never telemetry or frames', () => {
	const classifier = new NotificationClassifier()
	expect(classifier.classify(guiding({ active: true }))).toEqual([])
	expect(classifier.classify({ type: 'guiding:event', sessionId: 'g1', record: { sequence: 4, event: { type: 'calibrationCompleted' } } } as ServerEvent)[0]).toMatchObject({ key: 'guiding.calibrated:g1:4', code: 'guiding.calibrated', target: { tool: 'guiding' } })
	expect(classifier.classify({ type: 'guiding:event', sessionId: 'g1', record: { sequence: 5, event: { type: 'lockLost' } } } as ServerEvent)).toEqual([])
	expect(classifier.classify({ type: 'guiding:telemetry', sessionId: 'g1' } as ServerEvent)).toEqual([])
	expect(classifier.classify({ type: 'guiding:frame', sessionId: 'g1' } as ServerEvent)).toEqual([])
	expect(classifier.classify({ type: 'capture:frame' } as ServerEvent)).toEqual([])
	expect(classifier.classify(guiding({ active: false, lost: true, failure: { reason: 'disconnected', error: 'socket closed' } }))[0]).toMatchObject({ key: 'guiding:g1', code: 'guiding.failed' })
	// The session ended, so a late calibration event of it has no camera to point to.
	expect(classifier.classify({ type: 'guiding:event', sessionId: 'g1', record: { sequence: 6, event: { type: 'calibrationCompleted' } } } as ServerEvent)).toEqual([])
})

test('reports failed DARV measurements by generation', () => {
	const classifier = new NotificationClassifier()
	const drafts = classifier.classify(darv({ state: 'ready' }, { state: 'failed', reason: 'timeout' }))
	expect(drafts).toEqual([expect.objectContaining({ key: 'darv:d1:2', code: 'darv.measurementFailed' })])
	expect(drafts[0].message).not.toContain('align')
})

test('reports failures of the listed device operations only', () => {
	const classifier = new NotificationClassifier((_, deviceId) => (deviceId === 'mnt' ? 'EQ6' : undefined))
	expect(classifier.classify(operation({}))[0]).toMatchObject({ key: 'operation:op', code: 'mount.goto.failed', title: 'Go to failed', message: 'EQ6 go to failed: it timed out.', target: { kind: 'equipment', deviceId: 'mnt' } })
	expect(classifier.classify(operation({ kind: 'focuser.move', devices: [{ connectionId: 'c', deviceId: 'foc' }] }))[0].message).toBe('The focuser move failed: it timed out.')
	expect(classifier.classify(operation({ state: 'running', reason: undefined }))).toEqual([])
	expect(classifier.classify(operation({ state: 'succeeded', reason: undefined }))).toEqual([])
	expect(classifier.classify(operation({ reason: 'aborted' }))).toEqual([])

	for (const kind of ['camera.capture', 'focuser.autofocus', 'mount.tppa', 'camera.ipolar', 'mount.darv', 'camera.flatWizard', 'camera.darkLibraryWizard', 'camera.guiding', 'guideOutput.guiding', 'mount.nudge', 'guideOutput.pulse', 'indi.propertyWrite'] as const) {
		expect(classifier.classify(operation({ kind }))).toEqual([])
	}
})

test('a requested close is quiet and so are the failures it causes', () => {
	const classifier = new NotificationClassifier()
	classifier.classify(open)
	expect(classifier.classify({ type: 'connection:close', id: 'c', cause: 'requested' })).toEqual([])
	expect(classifier.classify(capture({ phase: 'failed', reason: 'removed' }))).toEqual([])
	expect(classifier.classify(guiding({ active: false, lost: true, failure: { reason: 'disconnected' } }))).toEqual([])
	expect(classifier.classify(operation({ reason: 'removed' }))).toEqual([])
	// Failures unrelated to the close are still reported.
	expect(classifier.classify(capture({ sessionId: 's2', phase: 'failed', reason: 'timeout' }))).toHaveLength(1)

	// Opening the connection again makes its failures loud.
	classifier.classify(open)
	expect(classifier.classify(capture({ sessionId: 's3', phase: 'failed', reason: 'removed' }))).toHaveLength(1)
})

test('a lost connection warns once per close and its failures are reported', () => {
	const classifier = new NotificationClassifier()
	classifier.classify(open)
	const [lost] = classifier.classify({ type: 'connection:close', id: 'c', cause: 'lost' })
	expect(lost.key).toEndWith(':1')
	expect(lost).toMatchObject({ level: 'warning', code: 'connection.lost', message: 'The connection to pi:7624 was lost.', source: { connectionId: 'c', endpoint: { type: 'INDI', host: 'pi', port: 7624 } } })
	expect(classifier.classify(capture({ phase: 'failed', reason: 'removed' }))).toHaveLength(1)

	classifier.classify(open)
	expect(classifier.classify({ type: 'connection:close', id: 'c', cause: 'lost' })[0].key).toBe(lost.key.replace(/1$/, '2'))
})

test('a lost connection of a new classifier, as after a restart, is keyed apart from the losses recorded before', () => {
	const before = new NotificationClassifier()
	before.classify(open)
	const after = new NotificationClassifier()
	after.classify(open)
	expect(after.classify({ type: 'connection:close', id: 'c', cause: 'lost' })[0].key).not.toBe(before.classify({ type: 'connection:close', id: 'c', cause: 'lost' })[0].key)
})

test('session notifications carry the endpoint of their connection', () => {
	const classifier = new NotificationClassifier()
	classifier.classify(open)
	expect(classifier.classify(capture({ phase: 'completed' }))[0].source).toEqual({ kind: 'capture', connectionId: 'c', endpoint: { type: 'INDI', host: 'pi', port: 7624 }, deviceId: 'cam', operationId: 'o1', sessionId: 's1' })
})

test('high-frequency device events give nothing', () => {
	const classifier = new NotificationClassifier()
	expect(classifier.classify({ type: 'device:updated', connectionId: 'c', id: 'cam', connected: true })).toEqual([])
	expect(classifier.classify({ type: 'device:removed', connectionId: 'c', id: 'cam' })).toEqual([])
})

test('an output file that already exists is named without its directory, and other causes stay fixed text', () => {
	expect(failureText('commandFailed', 'the output file "C:\\captures\\M31\\A-0001.fit" already exists')).toBe('the output file "A-0001.fit" already exists; change the file name template')
	expect(failureText('commandFailed', 'the output file "/home/me/A-0001.fit" already exists')).toBe('the output file "A-0001.fit" already exists; change the file name template')
	expect(failureText('commandFailed', 'Unable to save C:\\captures\\flat.fit: EACCES')).toBe('a command failed')
	expect(failureText('commandFailed', undefined)).toBe('a command failed')
	expect(failureText('disconnected', 'socket closed')).toBe('a device disconnected')
})

describe('calibration library', () => {
	const job = { jobId: 'j', type: 'master', createdAt: 1, updatedAt: 2, groupId: 'g', progress: { framesValidated: 0, rowsCombined: 0, rowsTotal: 0, bytesWritten: 0 } } as const
	const classify = (patch: Partial<CalibrationJobSummary> & Pick<CalibrationJobSummary, 'state' | 'automatic'>) => new NotificationClassifier(() => undefined).classify({ type: 'calibrationLibrary:jobUpdated', epoch: 'e', revision: 1, job: { ...job, ...patch } })

	test('a failed master is an error that opens its group', () => {
		expect(classify({ state: 'failed', automatic: false, error: 'Boom' })).toMatchObject([{ level: 'error', code: 'calibrationLibrary.failed', target: { kind: 'tool', tool: 'calibration-library', group: 'g' } }])
	})

	test('a master of a wizard is announced, and one a person asked for is not', () => {
		expect(classify({ state: 'completed', automatic: true })).toMatchObject([{ level: 'success', code: 'calibrationLibrary.completed' }])
		expect(classify({ state: 'completed', automatic: false })).toEqual([])
		expect(classify({ state: 'integrating', automatic: true })).toEqual([])
	})

	test('an import is quiet', () => {
		expect(classify({ type: 'import', state: 'failed', automatic: false })).toEqual([])
	})
})

describe('spice kernel library', () => {
	const job: SpiceKernelJob = { jobId: 'k', kind: 'download', key: 'download:de440s', label: 'de440s.bsp', state: 'running', createdAt: 1, updatedAt: 2, unit: 'bytes' }
	const classify = (patch: Partial<SpiceKernelJob>) => new NotificationClassifier(() => undefined).classify({ type: 'spiceKernels:jobUpdated', epoch: 'e', revision: 1, job: { ...job, ...patch } })

	test('a new kernel and a failed acquisition open the library', () => {
		expect(classify({ state: 'completed', kernelId: 'x', alreadyInstalled: false })).toMatchObject([{ key: 'spiceKernels:k:completed', level: 'success', code: 'spiceKernels.completed', title: 'Kernel added', target: { kind: 'tool', tool: 'spice-kernel-library' } }])
		expect(classify({ kind: 'generate', label: '1 Ceres (20000001)', state: 'failed', error: 'Horizons failed writing /var/nebulosa/staging/x.part' })).toMatchObject([
			{ level: 'error', code: 'spiceKernels.failed', message: 'The generation of 1 Ceres (20000001) failed. The SPICE Kernel Library explains why under Add Kernel.' },
		])
	})

	test('a file already installed, a cancellation, and progress are quiet', () => {
		expect(classify({ state: 'completed', alreadyInstalled: true })).toEqual([])
		expect(classify({ state: 'cancelled' })).toEqual([])
		expect(classify({ state: 'running', bytes: 10 })).toEqual([])
	})
})

describe('meridian flip monitor', () => {
	function transition(kind: MeridianFlipTransition['kind'], overrides: Partial<MeridianFlipTransition> = {}): ServerEvent {
		return { type: 'meridianFlip:transition', epoch: 'e', transition: { transitionId: `t-${kind}`, kind, monitorId: 'm', connectionId: 'c', deviceId: 'mnt', contextId: 'x', episodeId: 'p', revision: 1, at: 0, phase: 'windowOpen', mechanical: 'flipCandidate', pierSide: 'WEST', ...overrides } }
	}

	const classifier = new NotificationClassifier((_, deviceId) => (deviceId === 'mnt' ? 'EQ6' : undefined))

	test('warns once per episode when a flip may be needed and when its window ends', () => {
		expect(classifier.classify(transition('flipCandidate'))).toMatchObject([{ key: 'meridianFlip:m:p:flipCandidate', level: 'warning', code: 'meridianFlip.candidate', target: { kind: 'tool', tool: 'meridian-flip' }, source: { kind: 'meridianFlip', connectionId: 'c', deviceId: 'mnt' } }])
		expect(classifier.classify(transition('deadlineApproaching'))).toMatchObject([{ key: 'meridianFlip:m:p:deadlineApproaching', code: 'meridianFlip.deadlineApproaching' }])
		expect(classifier.classify(transition('deadlinePassed', { phase: 'pastDeadline' }))).toMatchObject([{ key: 'meridianFlip:m:p:deadlinePassed', code: 'meridianFlip.deadlinePassed' }])
		expect(classifier.classify(transition('flipCandidate'))[0].message).toContain('EQ6')
	})

	test('a lost mount warns only near the meridian, and observations stay quiet', () => {
		expect(classifier.classify(transition('monitorUnavailable', { phase: 'approaching', contextId: undefined, episodeId: undefined }))).toMatchObject([{ key: 'meridianFlip:m:t-monitorUnavailable', code: 'meridianFlip.unavailable' }])
		expect(classifier.classify(transition('monitorUnavailable', { phase: 'before' }))).toEqual([])

		for (const kind of ['approaching', 'upperMeridianCrossed', 'windowOpened', 'pierSideChanged', 'externalFlipSuspected', 'targetChanged', 'monitorRecovered'] as const) {
			expect(classifier.classify(transition(kind))).toEqual([])
		}
	})

	test('a flip armed or running for the mount silences the candidate and the closing window, not the end of the window', () => {
		const quiet = new NotificationClassifier()
		const armed = (arm: boolean): ServerEvent => ({ type: 'meridianFlipExecutor:armed', epoch: 'e', revision: 1, key: { connectionId: 'c', deviceId: 'mnt' }, arm: arm ? ({ armId: 'a' } as MeridianFlipArm) : undefined })
		const execution = (state: MeridianFlipExecution['state']): ServerEvent => ({ type: 'meridianFlipExecutor:updated', epoch: 'e', revision: 2, execution: { sessionId: 's', connectionId: 'c', deviceId: 'mnt', mountName: 'EQ6', state } as MeridianFlipExecution })

		expect(quiet.classify(armed(true))).toEqual([])
		expect(quiet.classify(transition('flipCandidate'))).toEqual([])
		expect(quiet.classify(armed(false))).toEqual([])
		expect(quiet.classify(execution('running'))).toEqual([])
		expect(quiet.classify(transition('deadlineApproaching'))).toEqual([])
		expect(quiet.classify(transition('deadlinePassed', { phase: 'pastDeadline' }))).toHaveLength(1)
		expect(quiet.classify(transition('flipCandidate', { deviceId: 'other' }))).toHaveLength(1)
		quiet.classify(execution('cancelled'))
		expect(quiet.classify(transition('flipCandidate'))).toHaveLength(1)
	})

	test('every text fits its limits', () => {
		for (const kind of ['flipCandidate', 'deadlineApproaching', 'deadlinePassed', 'monitorUnavailable'] as const) {
			for (const draft of classifier.classify(transition(kind))) {
				expect(draft.title.length).toBeLessThanOrEqual(80)
				expect(draft.message.length).toBeLessThanOrEqual(240)
			}
		}
	})
})

describe('INDI server messages', () => {
	const global = (id: string, text: string): ServerEvent => ({ type: 'indi:globalMessage', connectionId: 'c', epoch: 'e', id, receivedAt: 0, text })

	test('a global message is an info notification per occurrence, scoped to its connection and opening nothing', () => {
		const classifier = new NotificationClassifier()
		classifier.classify(open)

		expect(classifier.classify(global('m1', 'Driver indi_eqmod_telescope: started'))).toEqual([
			{ key: 'indi:global:c:e:m1', level: 'info', code: 'indi.globalMessage', title: 'INDI Server', message: 'Driver indi_eqmod_telescope: started', source: { kind: 'indi', connectionId: 'c', endpoint: { type: 'INDI', host: 'pi', port: 7624 } } },
		])
		expect(classifier.classify(global('m2', 'Driver indi_eqmod_telescope: started'))[0].key).toBe('indi:global:c:e:m2')
	})

	test('a suppression is its own notification, named by its window, and not a driver text', () => {
		const classifier = new NotificationClassifier()
		const [draft] = classifier.classify({ type: 'indi:globalMessagesSuppressed', connectionId: 'c', epoch: 'e', windowStart: 5000, limit: 8, window: 60000 })

		expect(draft).toMatchObject({ key: 'indi:suppressed:c:e:5000', level: 'info', code: 'indi.globalMessagesSuppressed', title: 'INDI Server', source: { kind: 'indi', connectionId: 'c' } })
		expect(draft).not.toHaveProperty('target')
		expect(draft.message).toContain('8 messages within 60 s')
	})

	test('the message streams of a device give none', () => {
		const classifier = new NotificationClassifier()
		const header = { connectionId: 'c', hardwareId: 'h', epoch: 'e', revision: 1 }

		expect(classifier.classify({ type: 'indi:messageReceived', ...header, message: { id: 'm', sequence: 1, receivedAt: 0, text: 'x' } })).toEqual([])
		expect(classifier.classify({ type: 'indi:messagesSnapshot', ...header, messages: [] })).toEqual([])
	})
})

describe('meridian flip executor', () => {
	const classifier = new NotificationClassifier()

	test('a failed execution says why from its code, never from its error text', () => {
		const execution = { sessionId: 's', connectionId: 'c', deviceId: 'mnt', mountName: 'EQ6', state: 'failed', code: 'unknownResult', error: 'ENOENT: /home/secret/frame.fits' } as unknown as MeridianFlipExecution
		const [draft] = classifier.classify({ type: 'meridianFlipExecutor:updated', epoch: 'e', revision: 1, execution })

		expect(draft).toMatchObject({ code: 'meridianFlip.failed', message: 'The flip of EQ6 did not leave imaging ready: the result of a command could not be established.' })
		expect(draft.message).not.toContain('secret')
	})

	test('a mount seen crossing the meridian without evidence of its new side is a warning, not a failure', () => {
		const outcome = { verification: 'unverified', flipCommandCompleted: true, movementObserved: true, captureRestoration: 'notNeeded' }
		const execution = { sessionId: 'u', connectionId: 'c', deviceId: 'mnt', mountName: 'EQ6', state: 'failed', code: 'noFlipEvidence', outcome } as unknown as MeridianFlipExecution
		const [draft] = classifier.classify({ type: 'meridianFlipExecutor:updated', epoch: 'e', revision: 1, execution })

		expect(draft).toMatchObject({ level: 'warning', code: 'meridianFlip.unverified', title: 'Meridian flip not verified' })
		expect(draft.message).toStartWith('EQ6 moved across the meridian')
		expect(draft.message).not.toContain('paused')

		const still = { ...execution, sessionId: 'v', outcome: { ...outcome, movementObserved: false } } as MeridianFlipExecution
		expect(classifier.classify({ type: 'meridianFlipExecutor:updated', epoch: 'e', revision: 2, execution: still })[0]).toMatchObject({ level: 'error', code: 'meridianFlip.unverified', title: 'Meridian flip not completed' })
	})
})
