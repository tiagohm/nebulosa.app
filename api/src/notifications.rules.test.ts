import { expect, test } from 'bun:test'
import type { AutoFocusSessionSummary } from './autofocus'
import type { CaptureSession } from './captures'
import type { DarvMeasurement, DarvSessionSummary } from './darv'
import type { FlatWizardSessionSummary } from './flatwizard'
import type { GuidingSessionSummary } from './guiding'
import { NotificationClassifier } from './notifications.rules'
import type { OperationRecord } from './operations'
import type { TargetCenteringSessionSummary } from './targetcentering'
import type { TppaSessionSummary } from './tppa'
import type { ServerEvent } from './websocket'

const camera = { connectionId: 'c', deviceId: 'cam' }
const mount = { connectionId: 'c', deviceId: 'mnt' }

function capture(session: Partial<CaptureSession>): ServerEvent {
	return { type: 'capture:updated', session: { sessionId: 's1', operationId: 'o1', connectionId: 'c', deviceId: 'cam', cameraName: 'CCD', phase: 'exposing', captured: 3, ...session } as CaptureSession }
}

function autoFocus(session: Partial<AutoFocusSessionSummary>): ServerEvent {
	return { type: 'autofocus:updated', session: { sessionId: 'a1', operationId: 'o2', camera, cameraName: 'CCD', focuser: { connectionId: 'c', deviceId: 'foc' }, focuserName: 'Focuser', state: 'measuring', ...session } as AutoFocusSessionSummary }
}

function tppa(session: Partial<TppaSessionSummary>): ServerEvent {
	return { type: 'tppa:updated', session: { sessionId: 't1', operationId: 'o3', camera, cameraName: 'CCD', mount, mountName: 'Mount', state: 'capturing', ...session } as TppaSessionSummary }
}

function targetCentering(session: Partial<TargetCenteringSessionSummary>): ServerEvent {
	return { type: 'targetCentering:updated', session: { sessionId: 'c1', operationId: 'o6', camera, cameraName: 'CCD', mount, mountName: 'Mount', state: 'running', positionVerified: false, ...session } as TargetCenteringSessionSummary }
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
	expect(classifier.classify(autoFocus({ state: 'completed', finalPosition: 1200 }))[0]).toMatchObject({ code: 'autofocus.completed', message: 'Focuser was focused at position 1200.', target: { tool: 'auto-focus', deviceId: 'cam' } })
	expect(classifier.classify(autoFocus({ state: 'failed', reason: 'commandFailed' }))[0]).toMatchObject({ code: 'autofocus.failed', level: 'error' })
	expect(classifier.classify(tppa({ state: 'readyToRefine' }))[0]).toMatchObject({ key: 'tppa.ready:t1', level: 'info', code: 'tppa.readyToRefine' })
	expect(classifier.classify(tppa({ state: 'refinementPaused' }))).toEqual([])
	expect(classifier.classify(tppa({ state: 'completed' }))).toEqual([])
	expect(classifier.classify(tppa({ state: 'failed', reason: 'timeout' }))[0]).toMatchObject({ key: 'tppa:t1', code: 'tppa.failed' })
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

	for (const kind of ['camera.capture', 'focuser.autofocus', 'mount.tppa', 'mount.darv', 'camera.flatWizard', 'camera.guiding', 'guideOutput.guiding', 'mount.nudge', 'guideOutput.pulse', 'indi.propertyWrite'] as const) {
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
	expect(lost).toMatchObject({ key: 'connection.lost:c:1', level: 'warning', code: 'connection.lost', message: 'The connection to pi:7624 was lost.', source: { connectionId: 'c', endpoint: { type: 'INDI', host: 'pi', port: 7624 } } })
	expect(classifier.classify(capture({ phase: 'failed', reason: 'removed' }))).toHaveLength(1)

	classifier.classify(open)
	expect(classifier.classify({ type: 'connection:close', id: 'c', cause: 'lost' })[0].key).toBe('connection.lost:c:2')
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
