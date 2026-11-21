import type { PointingAcquisitionState, PointingActivation, PointingFitModelRequest, PointingFitStrategy, PointingModelDetail, PointingModelSummary, PointingRevision, PointingSampleRecord } from 'api'
import type { PointingFitOptions } from 'nebulosa/src/observation/mount/pointing'
import { cameraTabKey } from '../../images/cameratabs'

// Pure logic of the Mount Pointing Model tool: which models a mount lists, which revision opens, the draft of a refit
// started from the revision shown, the samples as rows to curate, where Build New Model goes, and what a form of fit
// options sends. Nothing here decides whether a model is valid: that is the server's.

// Choices of the strategy of a fit, in selector order.
export const FIT_STRATEGIES: readonly PointingFitStrategy[] = ['auto', 'semiPhysical', 'hybrid', 'empirical']

// Label of each strategy.
export const FIT_STRATEGY_LABELS: Readonly<Record<PointingFitStrategy, string>> = { auto: 'Auto', semiPhysical: 'Semi-Physical', hybrid: 'Hybrid', empirical: 'Empirical' }

// Robust regressions of a fit, in selector order.
export const ROBUST_METHODS = ['huber', 'tukey', 'none'] as const

// Label of each robust regression.
export const ROBUST_METHOD_LABELS: Readonly<Record<(typeof ROBUST_METHODS)[number], string>> = { huber: 'Huber', tukey: 'Tukey', none: 'None' }

// Fit options of the form, on top of the defaults of a run.
export interface FitForm {
	// Strategy asked for.
	readonly strategy: PointingFitStrategy
	// Robust regression.
	readonly robust: (typeof ROBUST_METHODS)[number]
	// Whether empirical altitude terms are used.
	readonly altitudeTerms: boolean
	// Whether empirical hour angle terms are used.
	readonly hourAngleTerms: boolean
	// Whether empirical declination terms are used.
	readonly declinationTerms: boolean
}

// Form of a fit not edited yet: the defaults of a run.
export const DEFAULT_FIT_FORM: FitForm = { strategy: 'auto', robust: 'huber', altitudeTerms: true, hourAngleTerms: true, declinationTerms: true }

// Word of each state of the latest acquisition of a model.
export const ACQUISITION_STATE_LABELS: Readonly<Record<PointingAcquisitionState, string>> = { running: 'Running', paused: 'Paused', interrupted: 'Interrupted', completed: 'Completed', stopped: 'Stopped' }

// Draft of the next fit of a model in this tab: the form and the accepted samples left out, started from a revision.
export interface FitDraft {
	// Revision the draft started from; absent for a model never fitted.
	readonly revisionId?: string
	// Fit options.
	readonly form: FitForm
	// Ids of the accepted samples left out of the next fit.
	readonly excluded: ReadonlySet<string>
}

// Returns the draft a refit starts from: the strategy, the options the form holds, and the samples the revision left out,
// so a refit changes only what the operator changes. Options the form does not hold are the defaults of a run. Without a
// revision it is the defaults with every sample in.
export function draftFrom(revision: Pick<PointingRevision, 'revisionId' | 'request' | 'options' | 'sampleIds' | 'heldOutIds'> | undefined, samples: readonly Pick<PointingSampleRecord, 'id' | 'status'>[]): FitDraft {
	if (!revision) return { form: DEFAULT_FIT_FORM, excluded: new Set() }
	const { robust, featureConfiguration } = revision.options ?? {}
	const fitted = new Set([...revision.sampleIds, ...revision.heldOutIds])
	const form: FitForm = {
		strategy: revision.request,
		robust: robust?.method ?? DEFAULT_FIT_FORM.robust,
		altitudeTerms: featureConfiguration?.includeAltitudeTerms !== false,
		hourAngleTerms: featureConfiguration?.includeHourAngleTerms !== false,
		declinationTerms: featureConfiguration?.includeDeclinationTerms !== false,
	}
	return { revisionId: revision.revisionId, form, excluded: new Set(samples.filter((sample) => sample.status === 'accepted' && !fitted.has(sample.id)).map((sample) => sample.id)) }
}

// Returns the revision a model opens on: the one in force on its mount when this model is in force, else the latest.
// Undefined for a model never fitted.
export function openingRevision(model: Pick<PointingModelDetail, 'modelId' | 'revisions'>, activation: Pick<PointingActivation, 'modelId' | 'revisionId'> | undefined): string | undefined {
	const inForce = activation?.modelId === model.modelId ? model.revisions.find((revision) => revision.revisionId === activation.revisionId) : undefined
	return (inForce ?? model.revisions.at(-1))?.revisionId
}

// Returns the number of a revision, from 1 in the order it was fitted, or undefined when the model has no such revision.
export function revisionNumber(model: Pick<PointingModelDetail, 'revisions'>, revisionId: string | undefined): number | undefined {
	const index = model.revisions.findIndex((revision) => revision.revisionId === revisionId)
	return index < 0 ? undefined : index + 1
}

// Order of the rows of the samples: by point of the plan, or by the error the revision shown leaves, largest first.
export type SampleOrder = 'point' | 'error'

// An accepted sample as a row to curate.
export interface SampleRow {
	// Sample.
	readonly sample: PointingSampleRecord
	// Error the revision shown leaves on it, in radians; absent when the revision has no residual of it.
	readonly error?: number
}

// Returns the accepted samples of a model as rows, with the error the revision leaves on each, in the order asked for.
// Samples without an error sort last by error.
export function sampleRows(samples: readonly PointingSampleRecord[], revision: Pick<PointingRevision, 'residuals'> | undefined, order: SampleOrder): SampleRow[] {
	const errors = new Map(revision?.residuals.map((residual) => [residual.id, Math.hypot(residual.dx, residual.dy)]))
	const rows = samples
		.filter((sample) => sample.status === 'accepted')
		.map((sample): SampleRow => {
			const error = errors.get(sample.id)
			return error === undefined ? { sample } : { sample, error }
		})
	const byPoint = (a: SampleRow, b: SampleRow) => a.sample.waypoint - b.sample.waypoint || a.sample.attempt - b.sample.attempt
	return order === 'point' ? rows.sort(byPoint) : rows.sort((a, b) => (b.error ?? -1) - (a.error ?? -1) || byPoint(a, b))
}

// Returns the models a mount lists, newest first: only its own unless told otherwise, since a model of another mount can
// be read but never used. Without a mount every model is listed.
export function listedModels(models: Readonly<Record<string, PointingModelSummary>>, hardwareId: string | undefined, all: boolean): PointingModelSummary[] {
	return Object.values(models)
		.filter((model) => all || hardwareId === undefined || model.mount.hardwareId === hardwareId)
		.sort((a, b) => b.createdAt - a.createdAt || a.modelId.localeCompare(b.modelId))
}

// Returns the options a form sends. A form left at the defaults sends none, so a revision says it took the defaults of a run.
export function fitOptions({ robust, altitudeTerms, hourAngleTerms, declinationTerms }: FitForm): PointingFitOptions | undefined {
	const features = { ...(!altitudeTerms && { includeAltitudeTerms: false }), ...(!hourAngleTerms && { includeHourAngleTerms: false }), ...(!declinationTerms && { includeDeclinationTerms: false }) }
	const options: PointingFitOptions = { ...(robust !== 'huber' && { robust: { method: robust } }), ...(Object.keys(features).length > 0 && { featureConfiguration: features }) }
	return Object.keys(options).length > 0 ? options : undefined
}

// Returns the request of a fit of a model from a form and the samples left out.
export function fitRequest(expectedRevision: number, form: FitForm, excluded: ReadonlySet<string>): PointingFitModelRequest {
	const options = fitOptions(form)
	return { expectedRevision, strategy: form.strategy, ...(options && { options }), ...(excluded.size > 0 && { excludedSampleIds: [...excluded] }) }
}

// Where Build New Model goes.
export type BuildTarget = { readonly key: string } | { readonly reason: string }

// Returns the camera tab of the Main Camera, exactly, or why there is none. It never falls back to another camera, which
// would measure another optical train.
export function buildTarget(documents: readonly { readonly key: string }[], camera: { readonly id: string; readonly connectionId: string } | undefined): BuildTarget {
	if (!camera) return { reason: 'No Main Camera is assigned in Equipment Setup.' }
	const key = cameraTabKey(camera.connectionId, camera.id)
	return documents.some((document) => document.key === key) ? { key } : { reason: 'The Main Camera has no tab in Images; connect it first.' }
}
