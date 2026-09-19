import { basename, dirname } from 'path'
import { isCamera } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { CameraCaptureStart } from '#/camera'
import { failedOperationResult } from '#/orchestration'
import { sequencerCaptureExposureInSeconds } from '#/sequencer'
import type { SequencerDeviceRole } from '#/sequencer'
import type { SequencerPlanFrameGroup } from '#/sequencer.plan'
import type { CameraHandler } from './camera'
import { sequencerActionFailure, sequencerDeviceOf, sequencerMissingRole } from './sequencer.action'
import { sequencerCommittedArtifact, sequencerPendingArtifact, sequencerRejectedArtifact } from './sequencer.artifact'
import { SEQUENCER_BLOCK_TYPE } from './sequencer.compiler'
import type { SequencerCapture } from './sequencer.compiler'
import type { ResourceBinding, SequencerActionContext, SequencerActionHandler, SequencerActionResult, SequencerValidationResult } from './sequencer.registry'
import { classifySequencerFrame, commitSequencerFrame, sequencerStagedFramePath } from './sequencer.write'

// Capture block: the one action of the plan that fills a slot, and the only place a frame of the session is
// exposed and published.
//
// Everything around the exposure belongs elsewhere. The scheduler decides which group is exposed and under
// which slot, the safe point in front of it reconciles the optical path, the cadence decides when the exposure
// may start, and the retry policy decides what a failure costs. What is left here is the pair that cannot be
// split: driving the camera and completing the write protocol of the frame it produced.
//
// The camera is commanded straight into the temporary path of the protocol instead of writing somewhere and
// being moved afterwards. That is what makes the final path meaningful: nothing ever observes a frame under
// its final name before it parsed, so the existence check the next run performs answers what it is meant to
// answer. The bytes are the camera's, the validation and the atomic rename stay in `sequencer.write.ts`, and
// the identity of the slot stays in the runtime.
//
// Exposure times in the capture recipe keep the unit the editor declared; the camera request forwards both
// fields, and outcomes report the duration in seconds. Instants are milliseconds since the Unix epoch.

// Handler version of the capture block. It changes whenever the meaning of its configuration or of its
// execution changes, which refuses a session compiled against the older meaning instead of running it here.
const SEQUENCER_CAPTURE_VERSION = 1

// What one accepted exposure produced.
export interface SequencerCaptureOutcome {
	// Final path the frame was committed under, which is the path of the slot.
	readonly path: string
	// Exposure duration of the frame, in seconds.
	readonly exposureTime: number
	// Instant the exposure was commanded at, in milliseconds since the Unix epoch.
	readonly startedAt: number
	// Instant the frame became durable at, in milliseconds since the Unix epoch.
	readonly endedAt: number
	// True when the slot was already filled by a previous run and this attempt exposed nothing, which is what a
	// resume finding a readable final does.
	readonly resumed: boolean
}

// Collaborators the capture block commands, injected so the handler stays free of device managers.
export interface SequencerCaptureServices {
	// Owner of the exposure and of the transfer that follows it.
	readonly cameraHandler: CameraHandler
}

// Roles the capture node commands.
//
// The camera is the only required one. Every other role is bound optional and is there because the safe point
// of this node — the trigger bracket and the frame preparation — runs under the same node and commands the
// optical path through the same reservation: a wheel, a focuser, a rotator, a cover or a panel left out of the
// reservation set would be commanded by the preparation without the session holding it. A role the definition
// does not declare is simply not part of the session, which is what optional means here.
function captureResources(configuration: SequencerCapture): readonly ResourceBinding[] {
	const roles: ResourceBinding[] = [{ role: 'camera' }, { role: 'mount', optional: true }, { role: 'focuser', optional: true }, { role: 'rotator', optional: true }, { role: 'cover', optional: true }, { role: 'flatPanel', optional: true }]
	if (configuration.group.capture.filter !== undefined) roles.push({ role: 'wheel', optional: true })
	return roles
}

// Builds the camera request of one frame of the plan.
//
// `outputPath` and `outputName` are the two halves of the temporary the protocol writes into, so the driver
// creates the file the protocol expects and nothing else. `publishPath` is the final name the image is
// announced under, so a `.partial` is never what the viewer opens. `autoSave` is what actually writes it:
// without it the payload is only buffered in the image processor, and the rename that publishes the frame
// would find nothing.
// One name is one frame, which is why the request always asks for a single exposure with no delay of its own —
// the spacing between frames is the cadence of the loop and is waited for outside the exposure.
function frameCapture(group: SequencerPlanFrameGroup, staged: string, published: string, devices: SequencerCaptureDevices): CameraCaptureStart {
	const { capture } = group

	return {
		...structuredClone(DEFAULT_CAMERA_CAPTURE_START),
		exposureTime: capture.exposureTime,
		exposureTimeUnit: capture.exposureTimeUnit,
		frameType: capture.frameType,
		exposureMode: 'single',
		count: 1,
		delay: 0,
		binX: capture.binX,
		binY: capture.binY,
		gain: capture.gain,
		offset: capture.offset,
		frameFormat: capture.frameFormat,
		subframe: capture.subframe,
		x: capture.x,
		y: capture.y,
		width: capture.width,
		height: capture.height,
		transferFormat: capture.transferFormat,
		compressed: capture.compressed,
		autoSave: true,
		outputPath: dirname(staged),
		outputName: basename(staged),
		publishPath: published,
		mount: devices.mount,
		wheel: devices.wheel,
		focuser: devices.focuser,
		rotator: devices.rotator,
	}
}

// Names of the devices whose state the driver writes into the metadata of the frame, absent when the session
// does not command the role.
interface SequencerCaptureDevices {
	// Mount the frame is pointed with.
	readonly mount?: string
	// Wheel the frame is exposed through.
	readonly wheel?: string
	// Focuser serving the frame.
	readonly focuser?: string
	// Rotator holding the field angle of the frame.
	readonly rotator?: string
}

// Names the devices of the roles the frame is annotated with, as the session resolved them.
function captureDevices(context: SequencerActionContext): SequencerCaptureDevices {
	const device = (role: SequencerDeviceRole) => context.request(role)?.device?.name

	return { mount: device('mount'), wheel: device('wheel'), focuser: device('focuser'), rotator: device('rotator') }
}

// Capture block: exposes one frame into the slot the runtime reserved and publishes it through the write
// protocol.
//
// A slot whose final path already holds a readable frame is not exposed again. That is the resume semantics of
// the whole design: the deterministic final path is the external registry of this version, so a frame that is
// on disk and parses is a frame the plan already has, whatever the artifact registry lost to a crash.
export function sequencerCaptureHandler(services: SequencerCaptureServices): SequencerActionHandler<SequencerCapture, SequencerCaptureOutcome> {
	return {
		type: SEQUENCER_BLOCK_TYPE.captureFrame,
		version: SEQUENCER_CAPTURE_VERSION,
		validate: (configuration): SequencerValidationResult<SequencerCapture> => ({ ok: true, configuration: configuration as SequencerCapture }),
		resources: captureResources,
		execute: (context, configuration) => runCapture(services, context, configuration),
	}
}

// Exposes and publishes one frame, with the slot the runtime reserved for it.
async function runCapture(services: SequencerCaptureServices, context: SequencerActionContext, configuration: SequencerCapture): Promise<SequencerActionResult<SequencerCaptureOutcome>> {
	const slot = context.frame

	// A frame block reaching execution without a slot is a wiring defect of the runtime, not an operational
	// outcome: composing a destination here would write outside the namespace the session proved.
	if (slot === undefined) return { type: 'fatalFailure', reason: 'unexpectedState', detail: 'the frame has no slot the session reserved' }

	const camera = sequencerDeviceOf(context, 'camera', isCamera)

	if (camera === undefined) return sequencerMissingRole('camera')

	// What a previous run left for this slot decides whether anything is exposed at all. The classification also
	// leaves the directory in the state it reports: an unreadable final is removed or quarantined and an orphan
	// temporary is discarded, so the exposure below starts against a free name either way.
	const classification = await classifySequencerFrame(slot.path, slot.write)

	if (classification === 'validFinal') {
		context.artifact(sequencerCommittedArtifact(slot.logicalSlotId, context.attempt, slot.path))

		const at = context.now()

		return { type: 'completed', value: { path: slot.path, exposureTime: sequencerCaptureExposureInSeconds(configuration.group.capture), startedAt: at, endedAt: at, resumed: true } }
	}

	// The directories are created before the artifact is registered, because a destination that cannot be
	// created is not an attempt that failed: nothing has been exposed and no record should claim otherwise.
	let staged: string

	try {
		staged = await sequencerStagedFramePath(slot.path, slot.write)
	} catch (e) {
		return { type: 'retryableFailure', reason: 'commandFailed', detail: `the frame directory could not be created: ${e instanceof Error ? e.message : String(e)}` }
	}

	// The classification and the staging above are filesystem work, and an immediate pause or stop landing inside
	// them finds no camera operation to drain: the reservation is reopened and the command below would start an
	// exposure after the pause was acknowledged, or alongside the finalization of the stop. The cancellation is
	// therefore read here, in front of the command, the same way `sequencerCommand` fronts every other block —
	// and in front of the pending record too, so a frame that was never exposed leaves no artifact claiming it
	// was. The orphan temporary the staging left is discarded by the classification of the next attempt.
	if (context.signal.aborted) return sequencerActionFailure(failedOperationResult('aborted', 'the frame was cancelled before the camera was commanded'))

	// The pending record is durable when this returns, which is the whole point of registering it before the
	// exposure: a crash between here and the rename leaves a record for the attempt that was in flight instead
	// of a file no session ever claimed. A refusal to persist it stops the frame rather than exposing it
	// unrecorded, which is why it is registered inside the same guard.
	try {
		context.artifact(sequencerPendingArtifact(slot.logicalSlotId, context.attempt))
	} catch (e) {
		return { type: 'retryableFailure', reason: 'commandFailed', detail: `the frame could not be recorded before the exposure: ${e instanceof Error ? e.message : String(e)}` }
	}

	const startedAt = context.now()

	const exposureInSeconds = sequencerCaptureExposureInSeconds(configuration.group.capture)
	context.progress({ fraction: 0, detail: `exposing ${slot.cycle}/${slot.ordinal} for ${exposureInSeconds}s`, exposure: exposureInSeconds })

	const handle = services.cameraHandler.capture(context.scope, camera, frameCapture(configuration.group, staged, slot.path, captureDevices(context)))
	const started = await handle.started

	if (!started.ok) {
		context.artifact(sequencerRejectedArtifact(slot.logicalSlotId, context.attempt))
		return sequencerActionFailure(started, 'the exposure did not start')
	}

	const captured = await handle.result

	if (!captured.ok) {
		context.artifact(sequencerRejectedArtifact(slot.logicalSlotId, context.attempt))
		return sequencerActionFailure(captured, 'the exposure failed')
	}

	context.progress({ fraction: 1, detail: 'publishing the frame' })

	const written = await commitSequencerFrame(slot.path, slot.write)

	if (!written.ok) {
		// The attempt produced no frame the plan can use, and the temporary is already gone: the slot is left to
		// the retry policy, which spends another attempt of the same slot on a new exposure.
		context.artifact(sequencerRejectedArtifact(slot.logicalSlotId, context.attempt))
		return { type: 'retryableFailure', reason: written.reason === 'invalidFrame' ? 'unexpectedState' : 'commandFailed', detail: written.error }
	}

	context.artifact(sequencerCommittedArtifact(slot.logicalSlotId, context.attempt, written.path))

	return { type: 'completed', value: { path: written.path, exposureTime: exposureInSeconds, startedAt, endedAt: context.now(), resumed: false } }
}
