import type { OperationFailureReason } from 'nebulosa/src/devices/orchestration/operation'
import type { AutoFocusSessionSummary } from './autofocus'
import type { CaptureSession } from './captures'
import type { ConnectRequest, ConnectionStatus } from './connection'
import type { DarvSessionSummary } from './darv'
import type { FlatWizardSessionSummary } from './flatwizard'
import type { GuidingEventRecord, GuidingSessionSummary } from './guiding'
import type { MountPointingSessionSummary } from './mountpointing.sessions'
import type { OperationDevice, OperationKind, OperationRecord } from './operations'
import type { TargetCenteringSessionSummary } from './targetcentering'
import type { TppaSessionSummary } from './tppa'
import type { ServerEvent } from './websocket'

// Deterministic classification of the server events into notification drafts. Only a few transitions of the
// session services, the failures of a short list of device operations, and lost connections are worth a
// notification; every other event, including telemetry, frames, and progress, gives none. Each draft carries a
// key naming the occurrence it reports (a session outcome, a manual step, an operation, a close), so the
// notification service creates one record per occurrence however often the same state is published. The text
// is built from fixed templates, device names, and fixed descriptions of the failure reasons; the error text of
// a session or driver is never copied into a notification.

// Severity of a notification.
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

// Camera tool a notification can open, named as the Images workspace names it.
export type NotificationCameraTool = 'camera-acquisition' | 'auto-focus' | 'guiding' | 'tppa' | 'pointing-model-builder' | 'target-centering' | 'darv' | 'flat-wizard'

// Context a notification can open in the UI; opening it never commands a device.
export type NotificationTarget =
	| {
			readonly kind: 'cameraTool'
			// Id of the open connection that provides the camera.
			readonly connectionId: string
			// Exact id of the camera.
			readonly deviceId: string
			// Tool of the camera tab to select.
			readonly tool: NotificationCameraTool
	  }
	| {
			readonly kind: 'equipment'
			// Id of the open connection that provides the device.
			readonly connectionId: string
			// Exact id of the device.
			readonly deviceId: string
	  }

// What a notification is about.
export interface NotificationSource {
	// Service that reported the occurrence: connection, capture, autofocus, tppa, flatWizard, guiding, darv, or operation.
	readonly kind: string
	// Id of the connection involved; absent for an application-wide notification.
	readonly connectionId?: string
	// Endpoint of that connection, so a client can match it to a saved connection after it closed.
	readonly endpoint?: ConnectRequest
	// Exact id of the main device involved.
	readonly deviceId?: string
	// Id of the operation involved.
	readonly operationId?: string
	// Id of the session involved.
	readonly sessionId?: string
}

// Notification the classifier asks for, before the service gives it an identity.
export interface NotificationDraft {
	// Identity of the occurrence it reports; the service never creates two records with the same key.
	readonly key: string
	readonly level: NotificationLevel
	// Stable code of the occurrence, such as capture.completed.
	readonly code: string
	// Short title meant for people.
	readonly title: string
	// Explanation meant for people.
	readonly message: string
	readonly source: NotificationSource
	readonly target?: NotificationTarget
}

// Returns the name of a device of an open connection, if it is still known.
export type DeviceNameResolver = (connectionId: string, deviceId: string) => string | undefined

// Device operations whose failure is reported: commands that keep running after their request was answered, so
// their failure is not shown inline by the form that started them. Session operations are reported by their
// sessions, and manual moves, pulses, and property writes are never reported.
const REPORTED_OPERATIONS: ReadonlySet<OperationKind> = new Set<OperationKind>([
	'mount.goto',
	'mount.slew',
	'mount.flip',
	'mount.park',
	'mount.unpark',
	'mount.home',
	'mount.findHome',
	'focuser.move',
	'wheel.move',
	'rotator.move',
	'rotator.home',
	'cover.open',
	'cover.close',
	'dome.slew',
	'dome.home',
	'dome.park',
	'dome.unpark',
	'dome.shutter',
])

// Description of each failure reason, completing a sentence such as "Capture failed: <description>.".
const REASON_TEXT: Readonly<Record<OperationFailureReason, string>> = {
	busy: 'the device was busy',
	aborted: 'it was aborted',
	disconnected: 'a device disconnected',
	removed: 'a device was removed',
	timeout: 'it timed out',
	alert: 'the driver reported an alert',
	commandFailed: 'a command failed',
	unexpectedState: 'a device reached an unexpected state',
}

// Names of the device types an operation kind starts with, for an operation whose device name is unknown.
const DEVICE_TEXT: Readonly<Record<string, string>> = {
	mount: 'The mount',
	focuser: 'The focuser',
	wheel: 'The filter wheel',
	rotator: 'The rotator',
	cover: 'The cover',
	dome: 'The dome',
}

// Readable names of the reported operation commands, by the part of the kind after the device type.
const COMMAND_TEXT: Readonly<Record<string, string>> = {
	goto: 'go to',
	slew: 'slew',
	flip: 'meridian flip',
	park: 'park',
	unpark: 'unpark',
	home: 'home',
	findHome: 'home search',
	move: 'move',
	open: 'open',
	close: 'close',
	shutter: 'shutter command',
}

// Classifier of the server events. It remembers only what a transition needs: the endpoints of the open
// connections, the connections closed on request (whose sessions then fail quietly), the number of losses of
// each connection, and the guide camera of each active guiding session.
export class NotificationClassifier {
	// Endpoint of each open connection, by connection id.
	readonly #endpoints = new Map<string, ConnectRequest>()
	// Connections closed on request and not opened again.
	readonly #requested = new Set<string>()
	// Losses of each connection so far, numbering their occurrences.
	readonly #losses = new Map<string, number>()
	// Guide camera of each active guiding session, by session id.
	readonly #guidingCameras = new Map<string, OperationDevice>()

	// Creates the classifier; deviceName names the devices of operations, which carry only ids.
	constructor(readonly deviceName: DeviceNameResolver = () => undefined) {}

	// Returns the notifications an event asks for; none for most events.
	classify(event: ServerEvent): NotificationDraft[] {
		switch (event.type) {
			case 'connection:open':
				return this.#opened(event.connection)
			case 'connection:close':
				return this.#closed(event.id, event.cause === 'lost')
			case 'capture:updated':
				return this.#capture(event.session)
			case 'autofocus:updated':
				return this.#autoFocus(event.session)
			case 'tppa:updated':
				return this.#tppa(event.session)
			case 'mountPointing:updated':
				return this.#mountPointing(event.session)
			case 'targetCentering:updated':
				return this.#targetCentering(event.session)
			case 'flatWizard:updated':
				return this.#flatWizard(event.session)
			case 'guiding:updated':
				return this.#guiding(event.session)
			case 'guiding:event':
				return this.#guidingEvent(event.sessionId, event.record)
			case 'darv:updated':
				return this.#darv(event.session)
			case 'operation:updated':
				return this.#operation(event.operation)
			default:
				return []
		}
	}

	// Remembers the endpoint of a connection that opened; its sessions fail loudly again.
	#opened(connection: ConnectionStatus): NotificationDraft[] {
		const { id, ...endpoint } = connection
		this.#endpoints.set(id, endpoint)
		this.#requested.delete(id)
		return []
	}

	// Warns about a lost connection; a requested close is quiet, and so are the failures it causes.
	#closed(id: string, lost: boolean): NotificationDraft[] {
		const endpoint = this.#endpoints.get(id)

		if (!lost) {
			this.#requested.add(id)
			return []
		}

		this.#requested.delete(id)
		const occurrence = (this.#losses.get(id) ?? 0) + 1
		this.#losses.set(id, occurrence)
		const where = endpoint?.type === 'SIMULATOR' ? 'the simulator' : endpoint ? `${endpoint.host}:${endpoint.port}` : 'a server'
		return [{ key: `connection.lost:${id}:${occurrence}`, level: 'warning', code: 'connection.lost', title: 'Connection lost', message: `The connection to ${where} was lost.`, source: { kind: 'connection', connectionId: id, endpoint } }]
	}

	// Reports a capture that completed or failed; stopped and aborted captures are quiet.
	#capture(session: CaptureSession): NotificationDraft[] {
		const { sessionId, connectionId, deviceId, cameraName, phase, reason } = session
		const base = { key: `capture:${sessionId}`, source: this.#source('capture', connectionId, deviceId, session.operationId, sessionId), target: cameraTool(connectionId, deviceId, 'camera-acquisition') }

		if (phase === 'completed') return [{ ...base, level: 'success', code: 'capture.completed', title: 'Capture completed', message: `${cameraName} captured ${session.captured} ${session.captured === 1 ? 'frame' : 'frames'}.` }]
		if (phase === 'failed' && !this.#quiet(connectionId, reason)) return [{ ...base, level: 'error', code: 'capture.failed', title: 'Capture failed', message: `Capture with ${cameraName} failed: ${reasonText(reason)}.` }]
		return []
	}

	// Reports an Auto Focus that completed or failed; a cancelled one is quiet.
	#autoFocus(session: AutoFocusSessionSummary): NotificationDraft[] {
		const { sessionId, camera, focuserName, state, reason } = session
		const base = { key: `autofocus:${sessionId}`, source: this.#source('autofocus', camera.connectionId, session.focuser.deviceId, session.operationId, sessionId), target: cameraTool(camera.connectionId, camera.deviceId, 'auto-focus') }

		if (state === 'completed') {
			const position = session.finalPosition === undefined ? '' : ` at position ${session.finalPosition}`
			return [{ ...base, level: 'success', code: 'autofocus.completed', title: 'Auto Focus completed', message: `${focuserName} was focused${position}.` }]
		}

		if (state === 'failed' && !this.#quiet(camera.connectionId, reason)) return [{ ...base, level: 'error', code: 'autofocus.failed', title: 'Auto Focus failed', message: `Auto Focus of ${focuserName} failed: ${reasonText(reason)}.` }]
		return []
	}

	// Reports a TPPA ready for refinement or failed; it never claims the alignment is good.
	#tppa(session: TppaSessionSummary): NotificationDraft[] {
		const { sessionId, camera, mountName, state, reason } = session
		const source = this.#source('tppa', camera.connectionId, session.mount.deviceId, session.operationId, sessionId)
		const target = cameraTool(camera.connectionId, camera.deviceId, 'tppa')

		if (state === 'readyToRefine') return [{ key: `tppa.ready:${sessionId}`, level: 'info', code: 'tppa.readyToRefine', title: 'TPPA ready to refine', message: `The polar error of ${mountName} was estimated; adjust the mount while TPPA refines it.`, source, target }]
		if (state === 'failed' && !this.#quiet(camera.connectionId, reason)) return [{ key: `tppa:${sessionId}`, level: 'error', code: 'tppa.failed', title: 'TPPA failed', message: `TPPA with ${mountName} failed: ${reasonText(reason)}.`, source, target }]
		return []
	}

	// Reports a pointing session that needs the operator: one the mount could not be confirmed stopped for, one that paused
	// by itself, and the end of a run.
	#mountPointing(session: MountPointingSessionSummary): NotificationDraft[] {
		const { sessionId, operationId, camera, mount, mountName, state, reason, acceptedCount, plannedCount } = session
		const source = this.#source('mountPointing', camera.connectionId, mount.deviceId, operationId, sessionId)
		const target = cameraTool(camera.connectionId, camera.deviceId, 'pointing-model-builder')

		if (state === 'blocked') return [{ key: `mountPointing.blocked:${sessionId}`, level: 'error', code: 'mountPointing.blocked', title: 'Mount not confirmed stopped', message: `${mountName} could not be confirmed stopped after its pointing session; check it before using it.`, source, target }]
		if (state === 'paused' && reason !== undefined && reason !== 'aborted' && !this.#quiet(camera.connectionId, reason))
			return [{ key: `mountPointing.paused:${sessionId}:${operationId}`, level: 'warning', code: 'mountPointing.paused', title: 'Pointing session paused', message: `The pointing session of ${mountName} paused: ${reasonText(reason)}.`, source, target }]
		if (session.kind === 'verification') return []
		if (state === 'completed') return [{ key: `mountPointing.completed:${sessionId}`, level: 'info', code: 'mountPointing.completed', title: 'Pointing session completed', message: `${acceptedCount} of ${plannedCount} waypoints of ${mountName} were sampled.`, source, target }]
		return []
	}

	// Reports a centering that needs the operator and its outcome; a cancelled one is quiet, and a measurement out of tolerance is
	// a result, not a failure.
	#targetCentering(session: TargetCenteringSessionSummary): NotificationDraft[] {
		const { sessionId, operationId, camera, mount, mountName, state, reason, positionVerified } = session
		const source = this.#source('targetCentering', camera.connectionId, mount.deviceId, operationId, sessionId)
		const target = cameraTool(camera.connectionId, camera.deviceId, 'target-centering')

		if (state === 'blocked') return [{ key: `targetCentering.blocked:${sessionId}`, level: 'error', code: 'targetCentering.blocked', title: 'Mount not confirmed stopped', message: `${mountName} could not be confirmed stopped after its centering; check it before using it.`, source, target }]
		if (state === 'failed' && !this.#quiet(camera.connectionId, reason)) return [{ key: `targetCentering:${sessionId}`, level: 'error', code: 'targetCentering.failed', title: 'Target Centering failed', message: `Centering ${mountName} failed: ${session.error ?? reasonText(reason)}.`, source, target }]
		if (state === 'completed' && positionVerified && !session.readyForImaging)
			return [{ key: `targetCentering:${sessionId}`, level: 'warning', code: 'targetCentering.guidingNotRestored', title: 'Guiding not restored', message: `The position of ${mountName} was verified, but guiding was not restored.`, source, target }]
		if (state === 'completed' && positionVerified) return [{ key: `targetCentering:${sessionId}`, level: 'success', code: 'targetCentering.completed', title: 'Target Centering completed', message: `The position of ${mountName} was verified.`, source, target }]
		return []
	}

	// Reports a Flat Wizard waiting for a manual step, leaving a device in an unintended state, and its outcome.
	#flatWizard(session: FlatWizardSessionSummary): NotificationDraft[] {
		const { sessionId, camera, cameraName, state, pending, reason } = session
		const source = this.#source('flatWizard', camera.connectionId, camera.deviceId, session.operationId, sessionId)
		const target = cameraTool(camera.connectionId, camera.deviceId, 'flat-wizard')
		const drafts: NotificationDraft[] = []

		if (pending) {
			const message = pending.kind === 'filter' ? `Put the next filter in place for ${cameraName} and continue in the Flat Wizard.` : `Ready the light for ${cameraName} and continue in the Flat Wizard.`
			drafts.push({ key: `flat.step:${pending.stepId}`, level: 'warning', code: 'flatWizard.actionRequired', title: 'Flat Wizard needs you', message, source, target })
		}

		if (session.cleanupWarning) drafts.push({ key: `flat.cleanup:${sessionId}`, level: 'warning', code: 'flatWizard.cleanupWarning', title: 'Flat Wizard left a device on', message: `Check the panel and cover of ${cameraName}: the Flat Wizard could not restore them.`, source, target })

		if (state === 'completed') drafts.push({ key: `flat:${sessionId}`, level: 'success', code: 'flatWizard.completed', title: 'Flat Wizard completed', message: `Flats of ${cameraName} were captured.`, source, target })
		else if (state === 'failed' && !this.#quiet(camera.connectionId, reason)) drafts.push({ key: `flat:${sessionId}`, level: 'error', code: 'flatWizard.failed', title: 'Flat Wizard failed', message: `Flat Wizard of ${cameraName} failed: ${reasonText(reason)}.`, source, target })

		return drafts
	}

	// Remembers the guide camera of an active session and reports a session that ended by a failure; a stopped
	// session is quiet.
	#guiding(session: GuidingSessionSummary): NotificationDraft[] {
		const { sessionId, camera, cameraName, failure } = session

		if (session.active) {
			this.#guidingCameras.set(sessionId, camera)
			return []
		}

		this.#guidingCameras.delete(sessionId)
		if (!failure || this.#quiet(camera.connectionId, failure.reason)) return []

		const source = this.#source('guiding', camera.connectionId, camera.deviceId, session.operationId, sessionId)
		return [{ key: `guiding:${sessionId}`, level: 'error', code: 'guiding.failed', title: 'Guiding stopped', message: `Guiding with ${cameraName} stopped: ${reasonText(failure.reason)}.`, source, target: cameraTool(camera.connectionId, camera.deviceId, 'guiding') }]
	}

	// Reports a completed calibration of an active guiding session.
	#guidingEvent(sessionId: string, record: GuidingEventRecord): NotificationDraft[] {
		const camera = this.#guidingCameras.get(sessionId)
		if (record.event.type !== 'calibrationCompleted' || !camera) return []

		const source = this.#source('guiding', camera.connectionId, camera.deviceId, undefined, sessionId)
		return [{ key: `guiding.calibrated:${sessionId}:${record.sequence}`, level: 'success', code: 'guiding.calibrated', title: 'Guiding calibrated', message: 'The guider calibration completed.', source, target: cameraTool(camera.connectionId, camera.deviceId, 'guiding') }]
	}

	// Reports the failed measurements of a DARV session; aborted ones are quiet, and a finished session is never
	// reported as an aligned mount.
	#darv(session: DarvSessionSummary): NotificationDraft[] {
		const { sessionId, camera, mountName } = session
		const drafts: NotificationDraft[] = []

		for (const measurement of session.measurements) {
			if (measurement.state !== 'failed' || this.#quiet(camera.connectionId, measurement.reason)) continue
			const source = this.#source('darv', camera.connectionId, session.mount.deviceId, measurement.operationId, sessionId)
			drafts.push({
				key: `darv:${sessionId}:${measurement.generation}`,
				level: 'error',
				code: 'darv.measurementFailed',
				title: 'DARV measurement failed',
				message: `DARV measurement ${measurement.generation} with ${mountName} failed: ${reasonText(measurement.reason)}.`,
				source,
				target: cameraTool(camera.connectionId, camera.deviceId, 'darv'),
			})
		}

		return drafts
	}

	// Reports the failure of a reported device operation.
	#operation(operation: OperationRecord): NotificationDraft[] {
		const device = operation.devices[0]
		if (operation.state !== 'failed' || !device || !REPORTED_OPERATIONS.has(operation.kind) || this.#quiet(device.connectionId, operation.reason)) return []

		const [type = '', command = ''] = operation.kind.split('.')
		const name = this.deviceName(device.connectionId, device.deviceId) ?? DEVICE_TEXT[type] ?? 'The device'
		const commandText = COMMAND_TEXT[command] ?? command
		const source = this.#source('operation', device.connectionId, device.deviceId, operation.operationId)
		return [
			{
				key: `operation:${operation.operationId}`,
				level: 'error',
				code: `${operation.kind}.failed`,
				title: `${capitalize(commandText)} failed`,
				message: `${name} ${commandText} failed: ${reasonText(operation.reason)}.`,
				source,
				target: { kind: 'equipment', connectionId: device.connectionId, deviceId: device.deviceId },
			},
		]
	}

	// Whether a failure is quiet: an abort asked by someone, or the end of a session whose connection was closed
	// on request.
	#quiet(connectionId: string, reason: OperationFailureReason | undefined) {
		return reason === 'aborted' || (this.#requested.has(connectionId) && (reason === 'removed' || reason === 'disconnected'))
	}

	// Source of a notification about a connection, with the endpoint of that connection when known.
	#source(kind: string, connectionId: string, deviceId: string, operationId?: string, sessionId?: string): NotificationSource {
		return { kind, connectionId, endpoint: this.#endpoints.get(connectionId), deviceId, operationId, sessionId }
	}
}

// Target opening a tool of a camera tab.
function cameraTool(connectionId: string, deviceId: string, tool: NotificationCameraTool): NotificationTarget {
	return { kind: 'cameraTool', connectionId, deviceId, tool }
}

// Description of a failure reason, a generic one when absent.
function reasonText(reason: OperationFailureReason | undefined) {
	return reason ? REASON_TEXT[reason] : 'an error occurred'
}

// Text with its first letter in upper case.
function capitalize(text: string) {
	return text.charAt(0).toUpperCase() + text.slice(1)
}
