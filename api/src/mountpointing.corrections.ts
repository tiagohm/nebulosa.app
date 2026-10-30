import { equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { geodeticLocation, localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { expectedPierSide, type Mount, type MountTargetCoordinate, type PierSide } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, DeviceManager } from 'nebulosa/src/devices/indi/manager/device'
import { mountTargetEquatorial } from 'nebulosa/src/devices/indi/manager/mount'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { normalizePI } from 'nebulosa/src/math/units/angle'
import { correctPointingCoordinate, type FittedPointingModel, predictPointingModelError } from 'nebulosa/src/observation/mount/pointing'
import { busy, type ClientResolver, connectedDevice, notFound, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import type { PointingModels } from './mountpointing'
import { apparentFromIcrs, type EquatorialPosition, POINTING_MODEL_FRAME, type PointingSite } from './mountpointing.frames'
import type { PointingModelFile, PointingRevision } from './mountpointing.store'
import type { OperationRegistry } from './operations'

// Correction of a GoTo by a pointing model: the command that lands the mount on a target, or why there is none. It is
// synchronous, because a GoTo of Mount Remote Control is admitted or refused at once, so a model is held in memory and
// never fetched from a disk or a worker here. Nothing is trusted from the toolkit's result alone: an unusable model
// predicts zero with converged true, so the model, the support of the target, the pier side, and the inverse are all
// checked. Angles are radians, instants Unix milliseconds.

// Why a target cannot be corrected:
// - unusable: the toolkit could not determine the model.
// - extrapolating: the target is too far from any sample.
// - pierSide: the model has no sample on the pier side the mount would take.
// - clamped: the correction is larger than the toolkit allows, or the inverse left its domain.
// - notConverged: the inverse did not converge.
// - notFinite: the inverse gave no coordinate.
export type CorrectionRefusal = 'unusable' | 'extrapolating' | 'pierSide' | 'clamped' | 'notConverged' | 'notFinite'

// Message of each refusal, meant for people.
export const CORRECTION_REFUSALS: Readonly<Record<CorrectionRefusal, string>> = {
	unusable: 'The pointing model is not usable',
	extrapolating: 'The target is too far from the samples of the pointing model',
	pierSide: 'The pointing model has no samples on the pier side of the target',
	clamped: 'The correction of the pointing model is out of its limits',
	notConverged: 'The correction of the pointing model did not converge',
	notFinite: 'The correction of the pointing model gave no coordinate',
}

// Where a target is corrected for.
export interface CorrectionContext {
	// Instant of the command, in Unix milliseconds.
	readonly time: number
	// Site of the model.
	readonly site: PointingSite
	// Pier side the mount is expected to take.
	readonly pierSide: PierSide
}

// Outcome of a correction.
export type CorrectedCommand = { readonly ok: true; readonly command: EquatorialPosition } | { readonly ok: false; readonly reason: CorrectionRefusal }

// Returns the command, opaque coordinates of the driver, that lands a mount on an apparent target by a model.
export function correctedCommand(fitted: FittedPointingModel, target: EquatorialPosition, { time, site: { latitude, longitude }, pierSide }: CorrectionContext): CorrectedCommand {
	if (!fitted.usable) return { ok: false, reason: 'unusable' }

	const input = { ...target, time: timeUnix(time / 1000, true), latitude, longitude, pierSide, frame: POINTING_MODEL_FRAME } as const
	const { quality } = predictPointingModelError(fitted, input)
	if (quality.extrapolating) return { ok: false, reason: 'extrapolating' }
	if (!quality.pierSideCovered) return { ok: false, reason: 'pierSide' }

	const { rightAscension, declination, clamped, converged } = correctPointingCoordinate(fitted, input)
	if (clamped) return { ok: false, reason: 'clamped' }
	if (!converged) return { ok: false, reason: 'notConverged' }
	if (!Number.isFinite(rightAscension) || !Number.isFinite(declination)) return { ok: false, reason: 'notFinite' }
	return { ok: true, command: { rightAscension, declination } }
}

// A model in force on a mount, as clients see it. Nothing of this is persisted: a restart leaves every mount inactive.
export interface PointingActivation {
	// Id of the physical mount.
	readonly hardwareId: string
	// Name of the mount.
	readonly mountName: string
	// Model in force.
	readonly modelId: string
	// Name of the model.
	readonly label: string
	// Immutable revision in force.
	readonly revisionId: string
	// Whether it corrects GoTos, or was suspended by something that may have invalidated it.
	readonly state: 'active' | 'suspended'
	// Why it was suspended.
	readonly reason?: string
	// When it was activated, Unix milliseconds.
	readonly activatedAt: number
	// Latest GoTo it saw.
	readonly last?: PointingCorrectionAudit
}

// What happened to the latest GoTo of a mount, which tells the target asked for from what the mount was sent to.
export interface PointingCorrectionAudit {
	// When it was admitted, Unix milliseconds.
	readonly time: number
	// Apparent target asked for.
	readonly requested: EquatorialPosition
	// Command sent to the mount; absent when it was refused.
	readonly command?: EquatorialPosition
	// Why it was refused.
	readonly refused?: CorrectionRefusal | 'meridian'
	// Whether the mount took another pier side than the one the correction was made for.
	readonly pierSideMismatch?: boolean
}

// Snapshot of GET /api/mount-pointing/activations.
export interface PointingActivationsSnapshot {
	// Model in force on each mount.
	readonly activations: readonly PointingActivation[]
	// Sequence of the latest event when the snapshot was taken.
	readonly sequence: number
}

// Notification published whenever a model takes force, is suspended, sees a GoTo, or leaves.
export type PointingActivationEvent = { readonly type: 'mountPointing:activation'; readonly hardwareId: string; readonly activation?: PointingActivation; readonly sequence: number }

// Receiver of activation events.
export type PointingActivationListener = (event: PointingActivationEvent) => void

// What a GoTo must do with its target:
// - uncorrected: go as asked, since no model is in force, or the one on the mount is suspended.
// - corrected: go to the command of the model, exactly, whatever the commander's distance from it.
// - refused: do not go, since a model in force cannot speak for this target.
export type MountCorrectionPlan =
	| { readonly status: 'uncorrected'; readonly target: MountTargetCoordinate<string | number> }
	| { readonly status: 'corrected'; readonly target: MountTargetCoordinate<number>; readonly options: { readonly tolerance: 0 }; readonly pierSide: PierSide; readonly modelId: string; readonly revisionId: string }
	| { readonly status: 'refused'; readonly error: string }

// Hour angle half width around the meridian where the side a mount takes cannot be told, in radians (1°); provisional.
const MERIDIAN_MARGIN = 1 * DEG2RAD

// Largest change of the site a model accepts, in radians.
const SITE_TOLERANCE = 0.001 * DEG2RAD

// A model in force.
interface ActiveModel {
	// What clients see of it.
	record: PointingActivation
	// Model of the toolkit, held in memory so a GoTo never waits for it.
	readonly fitted: FittedPointingModel
	// Site of the model.
	readonly site: PointingSite
}

// Returns the apparent target of a GoTo. J2000 and galactic targets are reduced as the samples were, so aberration stays out
// of the model; the other frames are of date already, ALTAZ with its default refraction.
function apparentTarget(mount: Mount, target: MountTargetCoordinate<string | number>, time: number, site: PointingSite): EquatorialPosition {
	const instant = timeUnix(time / 1000, true)
	const [rightAscension, declination] = mountTargetEquatorial(mount, target, instant)

	if (target.type === 'J2000' || target.type === 'GALACTIC') {
		const [icrsRightAscension, icrsDeclination] = equatorialToJ2000(rightAscension, declination, instant)
		return apparentFromIcrs({ rightAscension: icrsRightAscension, declination: icrsDeclination }, time, site)
	}

	return { rightAscension, declination }
}

// Models in force on the mounts of the process. Each physical mount has at most one, and a model loses force, without moving
// anything, when something that may invalidate it is seen: a disconnection, another site, a Sync, a clock, or a write of its
// vectors. A suspended model stays visible, with its reason, until it is deactivated or activated again; nothing activates
// by itself, and nothing here survives a restart. A correction is applied at most once, here, by MountCommands alone.
export class MountCorrections implements DeviceHandler<Mount>, Disposable {
	// Model in force on each mount, by hardware id.
	readonly #active = new Map<string, ActiveModel>()
	// Sequence of the latest event.
	#sequence = 0

	// Creates the corrections over the mounts of the registry. listener receives every change synchronously.
	constructor(
		readonly mounts: Pick<DeviceManager<Mount>, 'addHandler' | 'removeHandler'>,
		readonly listener: PointingActivationListener,
	) {
		mounts.addHandler(this)
	}

	[Symbol.dispose]() {
		this.mounts.removeHandler(this)
	}

	// A new mount has no model.
	added() {}

	// A mount that is gone takes its model's force with it.
	removed(mount: Mount) {
		this.suspend(mount, 'The mount was removed')
	}

	// Suspends the model of a mount that disconnected or changed site, whichever path changed it.
	updated(mount: Mount, property: keyof Mount & string) {
		if (property === 'connected' && !mount.connected) this.suspend(mount, 'The mount disconnected')
		else if (property === 'geographicCoordinate') {
			const active = this.#active.get(resourceKey(mount))
			if (active && !sameSite(mount, active.site)) this.suspend(mount, 'The mount reports another site')
		}
	}

	// Returns whether a model is in force on a mount.
	isActive(modelId: string) {
		for (const { record } of this.#active.values()) if (record.modelId === modelId) return true
		return false
	}

	// Returns the models in force.
	snapshot(): PointingActivationsSnapshot {
		return { activations: Array.from(this.#active.values(), ({ record }) => record), sequence: this.#sequence }
	}

	// Puts a revision in force on a mount, replacing what it had at once. The caller checked that it may.
	activate(mount: Mount, model: Pick<PointingModelFile, 'modelId' | 'label' | 'site'>, revision: Pick<PointingRevision, 'revisionId' | 'fitted'>) {
		const hardwareId = resourceKey(mount)
		const record: PointingActivation = { hardwareId, mountName: mount.name, modelId: model.modelId, label: model.label, revisionId: revision.revisionId, state: 'active', activatedAt: Date.now() }
		this.#active.set(hardwareId, { record, fitted: revision.fitted, site: model.site })
		this.#publish(hardwareId, record)
		return record
	}

	// Takes a model out of force at once. Moves nothing. Resolves whether the mount had one.
	deactivate(hardwareId: string) {
		if (!this.#active.delete(hardwareId)) return false
		this.#publish(hardwareId, undefined)
		return true
	}

	// Suspends the model of a mount.
	suspend(mount: Mount, reason: string) {
		this.suspendHardware(resourceKey(mount), reason)
	}

	// Suspends the model of the physical device with this id, if it has one; the first reason stands.
	suspendHardware(hardwareId: string, reason: string) {
		const active = this.#active.get(hardwareId)
		if (!active || active.record.state === 'suspended') return
		active.record = { ...active.record, state: 'suspended', reason }
		this.#publish(hardwareId, active.record)
	}

	// Decides what a GoTo of a mount does with its target. Synchronous, so it can be answered at once.
	plan(mount: Mount, target: MountTargetCoordinate<string | number>, time = Date.now()): MountCorrectionPlan {
		const active = this.#active.get(resourceKey(mount))
		if (!active || active.record.state === 'suspended') return { status: 'uncorrected', target }

		if (!sameSite(mount, active.site)) {
			this.suspend(mount, 'The mount reports another site')
			return { status: 'uncorrected', target }
		}

		const { fitted, site } = active
		const requested = apparentTarget(mount, target, time, site)
		const lst = localSiderealTime(timeUnix(time / 1000, true), geodeticLocation(site.longitude, site.latitude, 0))
		const pierSide = expectedPierSide(requested.rightAscension, requested.declination, lst)

		if (fitted.featureConfiguration.includePierSideTerms && Math.abs(normalizePI(lst - requested.rightAscension)) < MERIDIAN_MARGIN) {
			this.#audit(active, { time, requested, refused: 'meridian' })
			return { status: 'refused', error: 'The target is too close to the meridian to tell the pier side' }
		}

		const corrected = correctedCommand(fitted, requested, { time, site, pierSide })

		if (!corrected.ok) {
			this.#audit(active, { time, requested, refused: corrected.reason })
			return { status: 'refused', error: CORRECTION_REFUSALS[corrected.reason] }
		}

		const { command } = corrected
		this.#audit(active, { time, requested, command })
		const { modelId, revisionId } = active.record
		return { status: 'corrected', target: { type: 'JNOW', JNOW: { x: command.rightAscension, y: command.declination } }, options: { tolerance: 0 }, pierSide, modelId, revisionId }
	}

	// Records the pier side a corrected GoTo ended on, when it is not the one it was corrected for.
	observed(mount: Mount, expected: PierSide, reported: PierSide) {
		const active = this.#active.get(resourceKey(mount))
		const last = active?.record.last
		if (!active || !last || expected === reported || reported === 'NEITHER') return
		this.#audit(active, { ...last, pierSideMismatch: true })
	}

	// Keeps the latest GoTo of a model.
	#audit(active: ActiveModel, last: PointingCorrectionAudit) {
		active.record = { ...active.record, last }
		this.#publish(active.record.hardwareId, active.record)
	}

	// Publishes a change of a mount.
	#publish(hardwareId: string, activation: PointingActivation | undefined) {
		this.listener({ type: 'mountPointing:activation', hardwareId, ...(activation && { activation }), sequence: ++this.#sequence })
	}
}

// Returns whether a mount reports the site of a model.
function sameSite({ geographicCoordinate: { latitude, longitude } }: Mount, site: PointingSite) {
	return Math.abs(latitude - site.latitude) < SITE_TOLERANCE && Math.abs(longitude - site.longitude) < SITE_TOLERANCE
}

// Body of POST /api/mount-pointing/models/:modelId/activate.
export interface PointingActivateRequest {
	// Revision to put in force.
	readonly revisionId: string
	// Mount to correct, by its exact connection and device ids.
	readonly mount: { readonly connectionId: string; readonly deviceId: string }
	// Whether the operator confirmed that no native pointing model of the mount or its driver will correct the same error,
	// which nothing here can detect, and that a mount that reports no type is equatorial.
	readonly nativeModelAcknowledged: boolean
}

// Puts revisions in force, after checking everything with the values of this moment.
export class PointingActivations {
	// Creates the activations. client resolves an open connection id to its client, corrections holds the models in force,
	// models holds the revisions, and operations tells whether a mount is free.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly corrections: MountCorrections,
		readonly models: PointingModels,
		readonly operations: OperationRegistry,
	) {
		models.protectFromRemoval((modelId) => corrections.isActive(modelId))
	}

	// Puts a revision in force on a mount. Responds with the activation; 404 for an unknown model, revision, or mount; 409 when
	// the mount is disconnected, held, another mount, or at another site; and 422 when the revision did not pass offline, was
	// not verified on the sky, or the operator did not acknowledge what cannot be detected.
	async activate(modelId: string, { revisionId, mount: device, nativeModelAcknowledged }: PointingActivateRequest): Promise<Response> {
		const model = await this.models.store.get(modelId)
		if (!model) return notFound('Model')
		const revision = model.revisions.find((each) => each.revisionId === revisionId)
		if (!revision) return notFound('Revision')
		if (revision.gate !== 'passed') return unsupported('The revision did not pass its offline quality')
		if (!revision.verifications.at(-1)?.passed) return unsupported('The revision has not passed a verification on the sky')
		if (!nativeModelAcknowledged) return unsupported('Confirm that no native pointing model corrects the same error')

		const mount = connectedDevice(this, device.connectionId, 'mount', device.deviceId, 'Mount')
		if (mount instanceof Response) return mount
		if (mount.mountType === 'ALTAZ') return unsupported(`${mount.name} is not an equatorial mount`)
		if (model.mount.hardwareId !== resourceKey(mount)) return errorResponse('The model belongs to another mount', 409, 'incompatible')
		if (!sameSite(mount, model.site)) return errorResponse('The model was measured at another site', 409, 'incompatible')
		if (!this.operations.available(mount)) return busy()

		const saved = await this.models.store.update(modelId, (each) => ({ ...each, lastActiveAt: Date.now() }))
		if (saved.status === 'saved') this.models.published(saved.model)
		return Response.json(this.corrections.activate(mount, model, revision))
	}

	// Takes the model of a mount out of force at once, whatever the mount is doing. Responds 204, also when it had none, and 404
	// for an unknown mount.
	deactivate(connectionId: string, deviceId: string): Response {
		const client = this.client(connectionId)
		const mount = client && this.devices.mount(client, deviceId)
		if (!mount) return notFound('Mount')
		this.corrections.deactivate(resourceKey(mount))
		return new Response(null, { status: 204 })
	}
}

// Routes of the activations.
export function createPointingActivationRoutes(activations: PointingActivations) {
	return {
		'/api/mount-pointing/activations': {
			// The models in force, each with the latest GoTo it saw.
			GET: () => Response.json(activations.corrections.snapshot()),
		},
		'/api/mount-pointing/models/:modelId/activate': {
			// Puts a revision in force on a mount.
			POST: async (req) => activations.activate(req.params.modelId, (await req.json()) as PointingActivateRequest),
		},
		'/api/mount-pointing/mounts/:connectionId/:deviceId/deactivate': {
			// Takes the model of a mount out of force, whatever the mount is doing.
			POST: (req) => activations.deactivate(req.params.connectionId, req.params.deviceId),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
