import { readdir, readFile, rm } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { PierSide } from 'nebulosa/src/devices/indi/device'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { FittedPointingModel, PointingFitOptions } from 'nebulosa/src/observation/mount/pointing'
import type { PointingPlanPattern, PointingWaypoint } from 'nebulosa/src/observation/mount/pointing.plan'
import type { PointingFitStrategy, PointingGate, PointingOfflineMetrics, PointingSampleResidual } from './mountpointing.fit'
import type { EquatorialPosition, PointingSite } from './mountpointing.frames'
import { errorCode, isRecord, writeAtomically } from './util'

// Durable records of the mount pointing models: one versioned JSON file per model under ~/Nebulosa/pointing-models, with
// its samples and revisions inline, since a file is the unit writeAtomically replaces. There is no index: the directory
// is read once, on first use, and a file that cannot be used costs only itself, listed as unavailable and never
// overwritten, so a corrupt record never takes the library down. Samples and revisions are immutable: a refit or an
// exclusion adds a revision, so nothing edits a revision that is active. Saves of a model run one at a time and a save
// from an outdated revision is refused, so two tabs never overwrite each other. A file never holds pixels, and never
// says a model is active: activation lives in server memory and does not survive a restart. Angles are radians, times
// Unix milliseconds, and elevations meters.

// Directory the models are persisted in when none is given.
export const DEFAULT_POINTING_MODELS_DIRECTORY = join(homedir(), 'Nebulosa', 'pointing-models')

// Version of the model file format written by this version.
const POINTING_MODEL_VERSION = 1

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
	// Version of the file format.
	readonly version: number
	// Id of the model.
	readonly modelId: string
	// Revision of the file, raised by every save.
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
	// When the file was last saved.
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
	// Revision of the file.
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
	// When the file was last saved.
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

// A model file that cannot be used; it stays on the disk as it is.
export interface UnavailablePointingModel {
	// Name of the file, without its extension.
	readonly modelId: string
	// Why it cannot be used: not a model document, or written by a newer version.
	readonly reason: 'corrupt' | 'newerVersion'
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

// Outcome of a save: saved, refused because another revision was saved since, or refused because the model is gone or
// its file cannot be used.
export type PointingModelSaveOutcome = { readonly status: 'saved'; readonly model: PointingModelFile } | { readonly status: 'conflict'; readonly model: PointingModelFile } | { readonly status: 'notFound' }

// Models read from the directory.
interface LoadedPointingModels {
	// Usable models, by id.
	readonly models: Map<string, PointingModelFile>
	// Files that cannot be used, by id.
	readonly unavailable: Map<string, UnavailablePointingModel>
}

// Returns the file of a model.
function modelFile(directory: string, modelId: string) {
	return join(directory, `${modelId}.json`)
}

// Reads a model file, whose content is only checked for its version and its shape at the top: the server wrote it, and
// writes are atomic. A session that did not end is left interrupted. Returns the reason when it cannot be used.
export function parsePointingModel(text: string): PointingModelFile | UnavailablePointingModel['reason'] {
	let data: unknown

	try {
		data = JSON.parse(text)
	} catch {
		return 'corrupt'
	}

	if (!isRecord(data) || !Number.isInteger(data.version) || typeof data.modelId !== 'string' || !Array.isArray(data.samples) || !Array.isArray(data.revisions) || !isRecord(data.acquisition)) return 'corrupt'
	if ((data.version as number) > POINTING_MODEL_VERSION) return 'newerVersion'

	const model = data as unknown as PointingModelFile
	const { state } = model.acquisition
	return state === 'running' || state === 'paused' ? { ...model, acquisition: { ...model.acquisition, state: 'interrupted' } } : model
}

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

// Mount pointing models, each persisted in a file of its own. The directory is read on first use, so creating the store
// has no side effect.
export class PointingModelStore {
	// Models read from the directory, once the first read started.
	#loaded?: Promise<LoadedPointingModels>
	// Tail of the saves in progress of each model, which run one at a time.
	readonly #queues = new Map<string, Promise<unknown>>()

	// Creates the store of the files in directory.
	constructor(readonly directory: string = DEFAULT_POINTING_MODELS_DIRECTORY) {}

	// Reads every file of the directory. A missing directory gives no models.
	async #read(): Promise<LoadedPointingModels> {
		const models = new Map<string, PointingModelFile>()
		const unavailable = new Map<string, UnavailablePointingModel>()
		let files: string[]

		try {
			files = await readdir(this.directory)
		} catch (error) {
			const code = errorCode(error)
			if (code === 'ENOENT' || code === 'ENOTDIR') return { models, unavailable }
			throw error
		}

		for (const file of files) {
			if (!file.endsWith('.json')) continue

			const modelId = file.slice(0, -5)
			let parsed: PointingModelFile | UnavailablePointingModel['reason']

			try {
				parsed = parsePointingModel(await readFile(join(this.directory, file), 'utf-8'))
			} catch {
				parsed = 'corrupt'
			}

			if (typeof parsed === 'string') unavailable.set(modelId, { modelId, reason: parsed })
			else models.set(modelId, parsed)
		}

		return { models, unavailable }
	}

	// Returns the models, reading the directory on the first call.
	#load(): Promise<LoadedPointingModels> {
		return (this.#loaded ??= this.#read())
	}

	// Runs a save of a model after the ones in progress.
	#enqueue<T>(modelId: string, save: () => Promise<T>): Promise<T> {
		const run = (this.#queues.get(modelId) ?? Promise.resolve()).then(save)
		this.#queues.set(
			modelId,
			run.catch(() => undefined),
		)
		return run
	}

	// Returns every usable model, newest first, and the files that cannot be used.
	async list(): Promise<{ readonly models: readonly PointingModelFile[]; readonly unavailable: readonly UnavailablePointingModel[] }> {
		const { models, unavailable } = await this.#load()
		return { models: [...models.values()].sort((a, b) => b.createdAt - a.createdAt || a.modelId.localeCompare(b.modelId)), unavailable: [...unavailable.values()] }
	}

	// Returns a model, or undefined when there is none or its file cannot be used.
	async get(modelId: string): Promise<PointingModelFile | undefined> {
		return (await this.#load()).models.get(modelId)
	}

	// Creates a model. Throws when the file cannot be written; the store is then unchanged.
	async create(model: Omit<PointingModelFile, 'version' | 'revision' | 'updatedAt'>): Promise<PointingModelFile> {
		const created: PointingModelFile = { ...model, version: POINTING_MODEL_VERSION, revision: 1, updatedAt: Date.now() }

		return await this.#enqueue(model.modelId, async () => {
			await writeAtomically(modelFile(this.directory, model.modelId), serializePointingModel(created))
			;(await this.#load()).models.set(model.modelId, created)
			return created
		})
	}

	// Saves a change of a model, returned by change from the current one. A save with an expected revision is refused
	// when another one was saved since; the sessions, which own the model while they run, need none. Throws when the
	// file cannot be written; the model is then unchanged.
	update(modelId: string, change: (model: PointingModelFile) => PointingModelFile, expectedRevision?: number): Promise<PointingModelSaveOutcome> {
		return this.#enqueue(modelId, async (): Promise<PointingModelSaveOutcome> => {
			const { models } = await this.#load()
			const current = models.get(modelId)
			if (!current) return { status: 'notFound' }
			if (expectedRevision !== undefined && expectedRevision !== current.revision) return { status: 'conflict', model: current }

			const model: PointingModelFile = { ...change(current), version: POINTING_MODEL_VERSION, revision: current.revision + 1, updatedAt: Date.now() }
			await writeAtomically(modelFile(this.directory, modelId), serializePointingModel(model))
			models.set(modelId, model)
			return { status: 'saved', model }
		})
	}

	// Deletes a model and its file. Resolves whether it existed.
	delete(modelId: string): Promise<boolean> {
		return this.#enqueue(modelId, async () => {
			const { models } = await this.#load()
			if (!models.has(modelId)) return false
			await rm(modelFile(this.directory, modelId), { force: true })
			models.delete(modelId)
			return true
		})
	}
}

// Returns the content of a model file. A JSON copy holds a condition number that is not finite as null.
function serializePointingModel(model: Readonly<PointingModelFile>) {
	return `${JSON.stringify(model)}\n`
}
