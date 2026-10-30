import type { PointingFitModelRequest, PointingFitStrategy, PointingModelSummary } from 'api'
import type { PointingFitOptions } from 'nebulosa/src/observation/mount/pointing'
import { cameraTabKey } from '../../images/cameratabs'

// Pure logic of the Mount Pointing Model tool: which models a mount lists, where Build New Model goes, and what a form of
// fit options sends. Nothing here decides whether a model is valid: that is the server's.

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
