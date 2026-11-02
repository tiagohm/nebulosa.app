import type { PierSide } from 'nebulosa/src/devices/indi/device'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { FittedPointingModel, PointingFitOptions } from 'nebulosa/src/observation/mount/pointing'
import type { PointingPlanPattern, PointingWaypoint } from 'nebulosa/src/observation/mount/pointing.plan'
import type { AppDatabase } from './database'
import type { PointingFitStrategy, PointingGate, PointingOfflineMetrics, PointingSampleResidual } from './mountpointing.fit'
import type { EquatorialPosition, PointingSite } from './mountpointing.frames'

// Durable records of the mount pointing models, in the operational database: the header of each model in pointing_models,
// and its samples, revisions, and verifications in rows of their own, in order. Samples, revisions, and verifications are
// immutable: a refit or an exclusion adds a revision, so nothing edits a revision that is active, and a save that would
// change or remove a row already written is a programming error and throws. A save from an outdated revision is refused,
// so two tabs never overwrite each other. Every save is one synchronous transaction, so saves never interleave. Nothing
// holds pixels, nor says a model is active: activation lives in server memory and does not survive a restart, and an
// acquisition a stopped server left running or paused is recorded as interrupted when it starts again. Angles are
// radians, times Unix milliseconds, and elevations meters.

// Version of the exchange format of an export.
const POINTING_MODEL_EXPORT_VERSION = 1

// Identity of the physical mount of a model.
export interface PointingMountIdentity {
	// Id of the hardware, stable per endpoint and device name.
	readonly hardwareId: string
	// Id of the connection it was reached through.
	readonly connectionId: string
	// Exact id of the mount.
	readonly deviceId: string
	// Name of the mount.
	readonly name: string
	// Executable and version of its driver; the Alpaca unique id for an Alpaca mount.
	readonly driver: { readonly executable: string; readonly version: string }
}

// Physical evidence of the optical train a model was measured through. The server does not know the telescope, so what
// the plate solutions measured stands for it.
export interface PointingOpticsFingerprint {
	// Exact id of the camera.
	readonly cameraId: string
	// Name of the camera.
	readonly cameraName: string
	// Median image scale per unbinned pixel, in radians per pixel; absent before a solution.
	readonly scale?: Angle
	// Median field orientation modulo 180°, in radians, since a meridian flip rotates the field; absent before a solution.
	readonly orientation?: Angle
	// Parity of the solutions; absent before a solution.
	readonly parity?: 'NORMAL' | 'FLIPPED'
	// Binning of the frames.
	readonly binning: number
	// Subframe of the frames in unbinned pixels, when not the whole sensor.
	readonly subframe?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

// How a plan was asked for, and its waypoints.
export interface PointingPlanRecord {
	// Pattern of the waypoints.
	readonly pattern: PointingPlanPattern
	// Lowest altitude of a waypoint, in radians.
	readonly minimumAltitude: Angle
	// Hour angle half width left free around the meridian, in radians.
	readonly meridianAvoidance: Angle
	// Waypoints in slew order.
	readonly waypoints: readonly PointingWaypoint[]
}

// State of the acquisition of a model:
// - running, paused: a session of this process works on it.
// - interrupted: such a session did not end, because the process did. Nothing resumes it by itself.
// - completed, stopped: the acquisition ended.
export type PointingAcquisitionState = 'running' | 'paused' | 'interrupted' | 'completed' | 'stopped'

// One attempt at a waypoint.
export interface PointingSampleRecord {
	// Id of the attempt, unique in the model.
	readonly id: string
	// Index of the waypoint in the plan.
	readonly waypoint: number
	// Attempt at the waypoint, from 1.
	readonly attempt: number
	// Session that took it.
	readonly sessionId: string
	// Whether it trains the model or is withheld from the fit.
	readonly role: 'training' | 'heldOut'
	// Whether it can be fitted; a rejected attempt keeps its reason and what it measured.
	readonly status: 'accepted' | 'rejected'
	// Why it was rejected.
	readonly reason?: string
	// Middle of the exposure.
	readonly time: number
	// Dispatch of the command.
	readonly commandedAt: number
	// Exact command the driver received, opaque coordinates of the driver.
	readonly command: EquatorialPosition
	// Position the driver reported after the slew, in the driver's coordinates. Telemetry, never truth.
	readonly reported?: EquatorialPosition
	// Center of the plate solution, ICRS; absent when nothing was solved.
	readonly solvedIcrs?: EquatorialPosition
	// Center reduced to the frame of the model; absent when nothing was solved.
	readonly solved?: EquatorialPosition
	// Pier side the mount reported at the sample.
	readonly pierSide: PierSide
	// Image scale of the solution, in radians per pixel of the frame.
	readonly scale?: Angle
	// Field orientation of the solution, in radians.
	readonly orientation?: Angle
	// Parity of the solution.
	readonly parity?: 'NORMAL' | 'FLIPPED'
}

// One immutable fit of a model.
export interface PointingRevision {
	// Id of the revision.
	readonly revisionId: string
	// Revision it was refitted from.
	readonly parent?: string
	// When it was fitted.
	readonly createdAt: number
	// Strategy asked for.
	readonly request: PointingFitStrategy
	// Options of the fit, beyond the defaults of a run.
	readonly options?: PointingFitOptions
	// Samples fitted, which leaves the manual exclusions out.
	readonly sampleIds: readonly string[]
	// Samples withheld from the fit.
	readonly heldOutIds: readonly string[]
	// Model of the toolkit.
	readonly fitted: FittedPointingModel
	// Error of each sample before and after the model.
	readonly residuals: readonly PointingSampleResidual[]
	// Measures of the fit.
	readonly offline: PointingOfflineMetrics
	// Offline quality gate.
	readonly gate: PointingGate
	// Physical verifications of the revision, oldest first.
	readonly verifications: readonly PointingVerification[]
}

// One physical test of a candidate revision: GoTos to independent positions, uncorrected and corrected.
export interface PointingVerification {
	// Id of the verification.
	readonly verificationId: string
	// When it ended.
	readonly createdAt: number
	// Positions measured.
	readonly count: number
	// RMS distance of the uncorrected GoTos from their targets, in radians.
	readonly uncorrectedRms: Angle
	// RMS distance of the corrected GoTos from their targets, in radians.
	readonly correctedRms: Angle
	// Whether the corrected GoTos landed closer.
	readonly passed: boolean
}

// A model and everything measured for it.
export interface PointingModelFile {
	// Id of the model.
	readonly modelId: string
	// Revision of the model, raised by every save.
	readonly revision: number
	// Name the operator reads.
	readonly label: string
	// Notes of the operator.
	readonly notes?: string
	// Physical mount.
	readonly mount: PointingMountIdentity
	// Site of the samples.
	readonly site: PointingSite
	// Optical evidence of the samples.
	readonly optics: PointingOpticsFingerprint
	// Where the samples came from. An imported model cannot prove its mount or optics.
	readonly origin: 'session' | 'import'
	// When the model was created.
	readonly createdAt: number
	// When the model was last saved.
	readonly updatedAt: number
	// When a revision of it was last active. Shown only: nothing activates from it.
	readonly lastActiveAt?: number
	// Plan of the acquisition.
	readonly plan: PointingPlanRecord
	// Latest acquisition of the samples.
	readonly acquisition: { readonly sessionId: string; readonly state: PointingAcquisitionState }
	// Every attempt, in order.
	readonly samples: readonly PointingSampleRecord[]
	// Every fit, in order.
	readonly revisions: readonly PointingRevision[]
}

// What a listing shows of a model, without its arrays.
export interface PointingModelSummary {
	// Id of the model.
	readonly modelId: string
	// Revision of the model.
	readonly revision: number
	// Name the operator reads.
	readonly label: string
	// Notes of the operator.
	readonly notes?: string
	// Physical mount.
	readonly mount: PointingMountIdentity
	// Site of the samples.
	readonly site: PointingSite
	// Optical evidence of the samples.
	readonly optics: PointingOpticsFingerprint
	// Where the samples came from.
	readonly origin: PointingModelFile['origin']
	// When the model was created.
	readonly createdAt: number
	// When the model was last saved.
	readonly updatedAt: number
	// When a revision of it was last active.
	readonly lastActiveAt?: number
	// Latest acquisition.
	readonly acquisition: PointingModelFile['acquisition']
	// Accepted samples.
	readonly acceptedCount: number
	// Attempts rejected.
	readonly rejectedCount: number
	// Waypoints planned.
	readonly plannedCount: number
	// Revisions fitted.
	readonly revisionCount: number
	// Latest revision, without its model and residuals.
	readonly latest?: Pick<PointingRevision, 'revisionId' | 'createdAt' | 'request' | 'offline' | 'gate'> & { readonly strategy: FittedPointingModel['strategy']; readonly verified: boolean }
}

// Exchange format of a model: what was measured and how it was fitted. It holds no coefficients and no verdict, so an
// import is fitted and judged again here, and nothing it claims is trusted.
export interface PointingModelExport {
	// Version of the exchange format.
	readonly version: number
	// Kind of the document.
	readonly kind: 'nebulosaPointingModel'
	// Name of the model.
	readonly label: string
	// Notes of the model.
	readonly notes?: string
	// Physical mount it was measured on.
	readonly mount: PointingMountIdentity
	// Site of the samples.
	readonly site: PointingSite
	// Optical evidence of the samples.
	readonly optics: PointingOpticsFingerprint
	// Plan of the acquisition.
	readonly plan: PointingPlanRecord
	// Every attempt.
	readonly samples: readonly PointingSampleRecord[]
	// How the latest revision was fitted.
	readonly fit?: Pick<PointingRevision, 'request' | 'options' | 'sampleIds' | 'heldOutIds'>
}

// Outcome of a save: saved, refused because another revision was saved since, or refused because the model is gone.
export type PointingModelSaveOutcome = { readonly status: 'saved'; readonly model: PointingModelFile } | { readonly status: 'conflict'; readonly model: PointingModelFile } | { readonly status: 'notFound' }

// Returns what a listing shows of a model.
export function pointingModelSummary(model: Readonly<PointingModelFile>): PointingModelSummary {
	const { modelId, revision, label, notes, mount, site, optics, origin, createdAt, updatedAt, lastActiveAt, acquisition, samples, plan, revisions } = model
	const acceptedCount = samples.reduce((count, sample) => count + (sample.status === 'accepted' ? 1 : 0), 0)
	const latest = revisions.at(-1)

	return {
		modelId,
		revision,
		label,
		...(notes !== undefined && { notes }),
		mount,
		site,
		optics,
		origin,
		createdAt,
		updatedAt,
		...(lastActiveAt !== undefined && { lastActiveAt }),
		acquisition,
		acceptedCount,
		rejectedCount: samples.length - acceptedCount,
		plannedCount: plan.waypoints.length,
		revisionCount: revisions.length,
		...(latest && {
			latest: { revisionId: latest.revisionId, createdAt: latest.createdAt, request: latest.request, offline: latest.offline, gate: latest.gate, strategy: latest.fitted.strategy, verified: latest.verifications.some((verification) => verification.passed) },
		}),
	}
}

// Returns the exchange document of a model.
export function exportPointingModel({ label, notes, mount, site, optics, plan, samples, revisions }: Readonly<PointingModelFile>): PointingModelExport {
	const latest = revisions.at(-1)

	return {
		version: POINTING_MODEL_EXPORT_VERSION,
		kind: 'nebulosaPointingModel',
		label,
		...(notes !== undefined && { notes }),
		mount,
		site,
		optics,
		plan,
		samples,
		...(latest && { fit: { request: latest.request, ...(latest.options && { options: latest.options }), sampleIds: latest.sampleIds, heldOutIds: latest.heldOutIds } }),
	}
}

// Returns why an exchange document cannot be imported, or undefined when it can. Only its version is judged: an import
// is fitted again from its samples, and its content is what the caller sends.
export function pointingModelImportRefusal(document: PointingModelExport) {
	if (document.kind !== 'nebulosaPointingModel') return 'The file is not a Nebulosa pointing model'
	if (!Number.isInteger(document.version) || document.version > POINTING_MODEL_EXPORT_VERSION) return 'The file was written by a newer version of Nebulosa'
	return undefined
}

// Row of pointing_models.
interface PointingModelRow {
	readonly model_id: string
	readonly revision: number
	readonly label: string
	readonly notes: string | null
	readonly origin: PointingModelFile['origin']
	readonly mount: string
	readonly site: string
	readonly optics: string
	readonly plan: string
	readonly acquisition_session_id: string
	readonly acquisition_state: PointingAcquisitionState
	readonly created_at: number
	readonly updated_at: number
	readonly last_active_at: number | null
}

// Row of pointing_samples, pointing_revisions, or pointing_verifications, as a model reads them.
interface PointingRecordRow {
	readonly record: string
}

// Row of pointing_verifications, with the revision it verifies.
interface PointingVerificationRow extends PointingRecordRow {
	readonly revision_id: string
}

// Columns of pointing_models, in the order of headerValues.
const HEADER_COLUMNS = 'model_id, revision, label, notes, origin, mount, site, optics, plan, acquisition_session_id, acquisition_state, created_at, updated_at, last_active_at'

// Returns the values of the header of a model, in the order of HEADER_COLUMNS.
function headerValues({ modelId, revision, label, notes, origin, mount, site, optics, plan, acquisition, createdAt, updatedAt, lastActiveAt }: Readonly<PointingModelFile>) {
	return [modelId, revision, label, notes ?? null, origin, JSON.stringify(mount), JSON.stringify(site), JSON.stringify(optics), JSON.stringify(plan), acquisition.sessionId, acquisition.state, createdAt, updatedAt, lastActiveAt ?? null] as const
}

// Returns the record of a revision as its row keeps it, without its verifications.
function revisionRecord({ verifications, ...revision }: PointingRevision) {
	return revision
}

// Returns the items of next that previous did not have, throwing when next changed or removed one of them, compared by
// identity first and then by the JSON copy of what record keeps of them. name names the items for the error.
function appended<T>(previous: readonly T[], next: readonly T[], name: string, record: (item: T) => unknown = (item) => item) {
	if (next.length < previous.length || previous.some((item, index) => item !== next[index] && JSON.stringify(record(item)) !== JSON.stringify(record(next[index])))) throw new Error(`The ${name} of a pointing model cannot be changed`)
	return next.slice(previous.length)
}

// Mount pointing models in the operational database. Methods answer promises, so a caller never depends on a save being
// synchronous, but each one runs in a single transaction and rejects when it cannot be written, leaving the model as it was.
export class PointingModelStore {
	// Creates the store of the models in database.
	constructor(readonly database: AppDatabase) {}

	// Records the acquisitions a previous run of the server left running or paused as interrupted, without raising the
	// revision of their models. Returns how many were. Called once, before anything is served.
	interruptRunning() {
		return this.database.write(() => this.database.db.query("UPDATE pointing_models SET acquisition_state = 'interrupted' WHERE acquisition_state IN ('running', 'paused')").run().changes)
	}

	// Reads a model with its samples, revisions, and verifications.
	#read(row: PointingModelRow): PointingModelFile {
		const { db } = this.database
		const verifications = new Map<string, PointingVerification[]>()

		for (const { revision_id, record } of db.query<PointingVerificationRow, [string]>('SELECT revision_id, record FROM pointing_verifications WHERE model_id = ? ORDER BY revision_id, position').all(row.model_id)) {
			const list = verifications.get(revision_id)
			if (list) list.push(JSON.parse(record) as PointingVerification)
			else verifications.set(revision_id, [JSON.parse(record) as PointingVerification])
		}

		const samples = db.query<PointingRecordRow, [string]>('SELECT record FROM pointing_samples WHERE model_id = ? ORDER BY position').all(row.model_id)
		const revisions = db.query<PointingRecordRow, [string]>('SELECT record FROM pointing_revisions WHERE model_id = ? ORDER BY position').all(row.model_id)

		return {
			modelId: row.model_id,
			revision: row.revision,
			label: row.label,
			...(row.notes !== null && { notes: row.notes }),
			mount: JSON.parse(row.mount) as PointingMountIdentity,
			site: JSON.parse(row.site) as PointingSite,
			optics: JSON.parse(row.optics) as PointingOpticsFingerprint,
			origin: row.origin,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			...(row.last_active_at !== null && { lastActiveAt: row.last_active_at }),
			plan: JSON.parse(row.plan) as PointingPlanRecord,
			acquisition: { sessionId: row.acquisition_session_id, state: row.acquisition_state },
			samples: samples.map(({ record }) => JSON.parse(record) as PointingSampleRecord),
			revisions: revisions.map(({ record }) => {
				const revision = JSON.parse(record) as PointingRevision
				return Object.assign(revision, { verifications: verifications.get(revision.revisionId) ?? [] })
			}),
		}
	}

	// Returns a model, or undefined when there is none.
	#get(modelId: string) {
		const row = this.database.db.query<PointingModelRow, [string]>(`SELECT ${HEADER_COLUMNS} FROM pointing_models WHERE model_id = ?`).get(modelId)
		return row ? this.#read(row) : undefined
	}

	// Writes the rows of model that previous did not have; previous is undefined for a new model.
	#writeRecords(model: Readonly<PointingModelFile>, previous?: Readonly<PointingModelFile>) {
		const { db } = this.database
		const sample = db.query('INSERT INTO pointing_samples (model_id, sample_id, position, record) VALUES (?, ?, ?, ?)')
		const revision = db.query('INSERT INTO pointing_revisions (model_id, revision_id, position, record) VALUES (?, ?, ?, ?)')
		const verification = db.query('INSERT INTO pointing_verifications (model_id, revision_id, verification_id, position, record) VALUES (?, ?, ?, ?, ?)')
		const samplesBefore = previous?.samples ?? []
		const revisionsBefore = previous?.revisions ?? []

		for (const [index, each] of appended(samplesBefore, model.samples, 'samples').entries()) sample.run(model.modelId, each.id, samplesBefore.length + index, JSON.stringify(each))
		appended(revisionsBefore, model.revisions, 'revisions', revisionRecord)

		for (const [index, each] of model.revisions.entries()) {
			if (index >= revisionsBefore.length) revision.run(model.modelId, each.revisionId, index, JSON.stringify(revisionRecord(each)))
			const verificationsBefore = revisionsBefore[index]?.verifications ?? []
			for (const [position, added] of appended(verificationsBefore, each.verifications, 'verifications').entries()) verification.run(model.modelId, each.revisionId, added.verificationId, verificationsBefore.length + position, JSON.stringify(added))
		}
	}

	// Returns every model, newest first.
	list(): Promise<{ readonly models: readonly PointingModelFile[] }> {
		return Promise.try(() => {
			const rows = this.database.db.query<PointingModelRow, []>(`SELECT ${HEADER_COLUMNS} FROM pointing_models ORDER BY created_at DESC, model_id`).all()
			return { models: rows.map((row) => this.#read(row)) }
		})
	}

	// Returns a model, or undefined when there is none.
	get(modelId: string): Promise<PointingModelFile | undefined> {
		return Promise.try(() => this.#get(modelId))
	}

	// Creates a model. Rejects when it cannot be written; the store is then unchanged.
	create(model: Omit<PointingModelFile, 'revision' | 'updatedAt'>): Promise<PointingModelFile> {
		return Promise.try(() =>
			this.database.write(() => {
				const created: PointingModelFile = { ...model, revision: 1, updatedAt: Date.now() }
				this.database.db.query(`INSERT INTO pointing_models (${HEADER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...headerValues(created))
				this.#writeRecords(created)
				return created
			}),
		)
	}

	// Saves a change of a model, returned by change from the current one. A save with an expected revision is refused
	// when another one was saved since; the sessions, which own the model while they run, need none. Rejects when it
	// cannot be written, or when change edited or removed a sample, revision, or verification; the model is then
	// unchanged.
	update(modelId: string, change: (model: PointingModelFile) => PointingModelFile, expectedRevision?: number): Promise<PointingModelSaveOutcome> {
		return Promise.try(() =>
			this.database.write((): PointingModelSaveOutcome => {
				const current = this.#get(modelId)
				if (!current) return { status: 'notFound' }
				if (expectedRevision !== undefined && expectedRevision !== current.revision) return { status: 'conflict', model: current }

				const model: PointingModelFile = { ...change(current), modelId, revision: current.revision + 1, updatedAt: Date.now() }
				const [, ...values] = headerValues(model)
				this.database.db.query('UPDATE pointing_models SET revision = ?, label = ?, notes = ?, origin = ?, mount = ?, site = ?, optics = ?, plan = ?, acquisition_session_id = ?, acquisition_state = ?, created_at = ?, updated_at = ?, last_active_at = ? WHERE model_id = ?').run(...values, modelId)
				this.#writeRecords(model, current)
				return { status: 'saved', model }
			}),
		)
	}

	// Deletes a model with its samples, revisions, and verifications. Resolves whether it existed.
	delete(modelId: string): Promise<boolean> {
		return Promise.try(() => this.database.write(() => this.database.db.query('DELETE FROM pointing_models WHERE model_id = ?').run(modelId).changes > 0))
	}
}
