import type { PointingFitOptions } from 'nebulosa/src/observation/mount/pointing'
import { notFound } from './commands'
import { errorResponse } from './http'
import type { PointingFitSample, PointingFitStrategy, PointingModelFitter } from './mountpointing.fit'
import { exportPointingModel, type PointingModelExport, type PointingModelFile, pointingModelImportRefusal, type PointingModelStore, type PointingModelSummary, pointingModelSummary, type PointingRevision, type PointingSampleRecord, type UnavailablePointingModel } from './mountpointing.store'

// Model library of the mount pointing models: listing, editing, importing, exporting, and fitting. It owns no device and
// runs no operation, so it works without a camera or a connection. Every change of a model is a new revision of its
// file: a refit or an exclusion adds a revision and never edits one, and a request made from an outdated file is refused
// with the current model, so two tabs never overwrite each other. A fit runs on the fit worker and answers at once; its
// outcome arrives as an event. Events are ordered by a sequence per process, so a mirror drops a snapshot older than an
// event it applied. A model has no draft on the server: a draft is the form of a tab until it asks for a fit.

// Fit of a model as a mirror follows it.
export interface PointingFitState {
	// Whether a fit of the model is running.
	readonly running: boolean
	// Why its latest fit failed.
	readonly error?: string
}

// Body of POST /api/mount-pointing/models/:modelId/fit.
export interface PointingFitModelRequest {
	// Revision of the file the request was made from.
	readonly expectedRevision: number
	// Strategy asked for.
	readonly strategy: PointingFitStrategy
	// Options on top of the defaults of a run.
	readonly options?: PointingFitOptions
	// Accepted samples left out of this fit, training or withheld.
	readonly excludedSampleIds?: readonly string[]
}

// Body of PATCH /api/mount-pointing/models/:modelId.
export interface PointingModelPatch {
	// Revision of the file the request was made from.
	readonly expectedRevision: number
	// New name.
	readonly label?: string
	// New notes; an empty text removes them.
	readonly notes?: string
}

// Response of GET /api/mount-pointing/models/:modelId, without the live fit, which events carry.
export type PointingModelDetail = PointingModelFile

// Snapshot of the model library.
export interface PointingModelsSnapshot {
	// Usable models, newest first.
	readonly models: readonly PointingModelSummary[]
	// Files that cannot be used.
	readonly unavailable: readonly UnavailablePointingModel[]
	// Fits running or failed, by model id.
	readonly fits: Readonly<Record<string, PointingFitState>>
	// Sequence of the latest event when the snapshot was taken.
	readonly sequence: number
}

// Notification published whenever a model changes or is removed.
export type PointingModelEvent = { readonly type: 'mountPointing:modelUpdated'; readonly model: PointingModelSummary; readonly fit: PointingFitState; readonly sequence: number } | { readonly type: 'mountPointing:modelRemoved'; readonly modelId: string; readonly sequence: number }

// Receiver of model events.
export type PointingModelListener = (event: PointingModelEvent) => void

// Accepted training samples below which a run is not fitted by itself, the fewest the toolkit trusts.
export const MINIMUM_FIT_SAMPLES = 12

// Fit of a model that has none.
const NO_FIT: PointingFitState = { running: false }

// Returns a sample as a fit takes it, or undefined when it holds no solution.
function fitSample({ id, time, command, solved, pierSide }: PointingSampleRecord): PointingFitSample | undefined {
	return solved && { id, time, command, solved, pierSide }
}

// Returns the accepted samples of a role, leaving exclusions out.
function samplesOf(model: Readonly<PointingModelFile>, role: PointingSampleRecord['role'], excluded: ReadonlySet<string>) {
	const samples: PointingFitSample[] = []

	for (const sample of model.samples) {
		if (sample.role !== role || sample.status !== 'accepted' || excluded.has(sample.id)) continue
		const prepared = fitSample(sample)
		if (prepared) samples.push(prepared)
	}

	return samples
}

// Responds 409 with the current model.
function conflict(model: Readonly<PointingModelFile>) {
	return errorResponse('The model was changed since it was read', 409, 'conflict', { model: pointingModelSummary(model) })
}

// Model library, persisted by a store and fitted by a fitter.
export class PointingModels {
	// Latest fit of each model, while it runs or after it failed.
	readonly #fits = new Map<string, PointingFitState>()
	// Sequence of the latest event.
	#sequence = 0
	// Tests of whether a session owns a model, which keeps it from being fitted or removed.
	readonly #inUse: ((modelId: string) => boolean)[] = []
	// Tests of whether a model is in force, which keeps it from being removed; a refit adds a revision and changes nothing.
	readonly #removalGuards: ((modelId: string) => boolean)[] = []

	// Creates the library. store persists the models, fitter fits them, and listener receives every change synchronously.
	constructor(
		readonly store: PointingModelStore,
		readonly fitter: Pick<PointingModelFitter, 'fit'>,
		readonly listener: PointingModelListener,
	) {}

	// Adds a test of whether a model is in use, from a service that holds models.
	protectWith(inUse: (modelId: string) => boolean) {
		this.#inUse.push(inUse)
	}

	// Adds a test of whether a model is in force, from a service that holds revisions.
	protectFromRemoval(inForce: (modelId: string) => boolean) {
		this.#removalGuards.push(inForce)
	}

	// Returns whether something holds a model.
	#isInUse(modelId: string) {
		return this.#inUse.some((inUse) => inUse(modelId))
	}

	// Returns the summaries of the library.
	async snapshot(): Promise<PointingModelsSnapshot> {
		const { models, unavailable } = await this.store.list()
		return { models: models.map(pointingModelSummary), unavailable, fits: Object.fromEntries(this.#fits), sequence: this.#sequence }
	}

	// Responds with a model and its samples and revisions, or 404.
	async model(modelId: string): Promise<Response> {
		const model = await this.store.get(modelId)
		return model ? Response.json(model satisfies PointingModelDetail) : notFound('Model')
	}

	// Responds with the exchange document of a model, as a download, or 404.
	async export(modelId: string): Promise<Response> {
		const model = await this.store.get(modelId)
		if (!model) return notFound('Model')
		return new Response(JSON.stringify(exportPointingModel(model)), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="pointing-model-${modelId}.json"` } })
	}

	// Creates a model from an exchange document and fits it again from its samples when the document says how. Responds
	// 201 with the summary, and 422 for a document of another kind or of a newer format.
	async import(document: PointingModelExport): Promise<Response> {
		const refusal = pointingModelImportRefusal(document)
		if (refusal) return errorResponse(refusal, 422, 'invalidParameter')

		const { label, notes, mount, site, optics, plan, samples, fit } = document
		const modelId = crypto.randomUUID()
		const model = await this.store.create({ modelId, label, ...(notes !== undefined && { notes }), mount, site, optics, origin: 'import', createdAt: Date.now(), plan, acquisition: { sessionId: '', state: 'stopped' }, samples, revisions: [] })
		this.published(model)

		if (fit) {
			const fitted = new Set([...fit.sampleIds, ...fit.heldOutIds])
			const excluded = samples.filter((sample) => !fitted.has(sample.id)).map((sample) => sample.id)
			this.#startFit(model, fit.request, fit.options, excluded)
		}

		return Response.json(pointingModelSummary(model), { status: 201 })
	}

	// Renames a model or changes its notes. Responds with the summary, 404, or 409 with the current model.
	async patch(modelId: string, { expectedRevision, label, notes }: PointingModelPatch): Promise<Response> {
		const saved = await this.store.update(
			modelId,
			(model) => {
				const { notes: _notes, ...rest } = model
				const text = notes ?? model.notes
				return { ...rest, ...(label !== undefined && { label }), ...(text && { notes: text }) }
			},
			expectedRevision,
		)

		if (saved.status === 'notFound') return notFound('Model')
		if (saved.status === 'conflict') return conflict(saved.model)
		this.published(saved.model)
		return Response.json(pointingModelSummary(saved.model))
	}

	// Deletes a model. Responds 204, 404, or 409 while a session or an activation holds it.
	async remove(modelId: string): Promise<Response> {
		if (this.#isInUse(modelId) || this.#removalGuards.some((inForce) => inForce(modelId))) return errorResponse('The model is in use', 409, 'busy')
		if (!(await this.store.delete(modelId))) return notFound('Model')

		this.#fits.delete(modelId)
		this.listener({ type: 'mountPointing:modelRemoved', modelId, sequence: ++this.#sequence })
		return new Response(null, { status: 204 })
	}

	// Starts a fit of a model, which adds a revision when it ends. Responds 202 with the summary; 404; 409 with the current
	// model when it changed, or while a session or another fit holds it; and 422 without a sample to fit.
	async fit(modelId: string, { expectedRevision, strategy, options, excludedSampleIds = [] }: PointingFitModelRequest): Promise<Response> {
		const model = await this.store.get(modelId)
		if (!model) return notFound('Model')
		if (model.revision !== expectedRevision) return conflict(model)
		if (this.#isInUse(modelId) || this.#fits.get(modelId)?.running) return errorResponse('The model is in use', 409, 'busy')
		if (samplesOf(model, 'training', new Set(excludedSampleIds)).length === 0) return errorResponse('The model has no sample to fit', 422, 'invalidParameter')

		this.#startFit(model, strategy, options, excludedSampleIds)
		return Response.json(pointingModelSummary(model), { status: 202 })
	}

	// Fits a model of a run that ended, when it has enough samples. Does nothing otherwise.
	fitAfterRun(model: Readonly<PointingModelFile>) {
		if (samplesOf(model, 'training', new Set()).length >= MINIMUM_FIT_SAMPLES) this.#startFit(model, 'auto', undefined, [])
	}

	// Publishes a change of a model.
	published(model: Readonly<PointingModelFile>) {
		this.listener({ type: 'mountPointing:modelUpdated', model: pointingModelSummary(model), fit: this.#fits.get(model.modelId) ?? NO_FIT, sequence: ++this.#sequence })
	}

	// Runs a fit in the background; its outcome is published.
	#startFit(model: Readonly<PointingModelFile>, strategy: PointingFitStrategy, options: PointingFitOptions | undefined, excludedSampleIds: readonly string[]) {
		const { modelId } = model
		this.#fits.set(modelId, { running: true })
		this.published(model)
		void this.#runFit(model, strategy, options, new Set(excludedSampleIds))
	}

	// Fits a model and adds its revision. A failure stays as the state of the fit.
	async #runFit(model: Readonly<PointingModelFile>, strategy: PointingFitStrategy, options: PointingFitOptions | undefined, excluded: ReadonlySet<string>) {
		const { modelId, site, plan } = model
		const training = samplesOf(model, 'training', excluded)
		const heldOut = samplesOf(model, 'heldOut', excluded)
		let current: Readonly<PointingModelFile> = model

		try {
			const { fitted, residuals, offline, gate } = await this.fitter.fit({ strategy, site, training, heldOut, ...(options && { options }), minimumAltitude: plan.minimumAltitude })
			const parent = model.revisions.at(-1)?.revisionId

			const revision: PointingRevision = {
				revisionId: crypto.randomUUID(),
				...(parent !== undefined && { parent }),
				createdAt: Date.now(),
				request: strategy,
				...(options && { options }),
				sampleIds: training.map((sample) => sample.id),
				heldOutIds: heldOut.map((sample) => sample.id),
				fitted,
				residuals,
				offline,
				gate,
				verifications: [],
			}

			const saved = await this.store.update(modelId, (each) => ({ ...each, revisions: [...each.revisions, revision] }))
			if (saved.status !== 'saved') return

			current = saved.model
			this.#fits.delete(modelId)
		} catch (error) {
			this.#fits.set(modelId, { running: false, error: Error.isError(error) ? error.message : String(error) })
		}

		this.published(current)
	}
}

// Routes of the model library.
export function createPointingModelRoutes(models: PointingModels) {
	return {
		'/api/mount-pointing/models': {
			// The models, with the files that cannot be used and the fits running.
			GET: async () => Response.json(await models.snapshot()),
			// Creates a model from an exchange document, fitted again from its samples.
			POST: async (req) => models.import((await req.json()) as PointingModelExport),
		},
		'/api/mount-pointing/models/:modelId': {
			// A model with its samples and revisions.
			GET: (req) => models.model(req.params.modelId),
			// Renames a model or changes its notes.
			PATCH: async (req) => models.patch(req.params.modelId, (await req.json()) as PointingModelPatch),
			// Deletes a model.
			DELETE: (req) => models.remove(req.params.modelId),
		},
		'/api/mount-pointing/models/:modelId/export': {
			// The exchange document of a model.
			GET: (req) => models.export(req.params.modelId),
		},
		'/api/mount-pointing/models/:modelId/fit': {
			// Starts a fit of a model; its outcome arrives as a mountPointing:modelUpdated event.
			POST: async (req) => models.fit(req.params.modelId, (await req.json()) as PointingFitModelRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
