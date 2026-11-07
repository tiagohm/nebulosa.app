import type { Database } from 'bun:sqlite'
import { altitudeAtTransit } from 'nebulosa/src/astronomy/formulas'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import { errorResponse } from './http'
import { LruCache } from './lrucache'
import {
	analyzeTarget,
	MINIMUM_CONTINUOUS_MS,
	OBSERVING_PRESETS,
	OBSERVING_SCORE_MODEL_VERSION,
	type ObservingConstraints,
	type ObservingMode,
	type ObservingReasonCode,
	type ObservingStatus,
	type ObservingTargetRef,
	type ObservingWindow,
	PLANNING_BODY_CODES,
	PlanningNight,
	type PlanningSite,
	resolveNight,
	resolveTarget,
	type TargetAnalysis,
	type TargetAnalysisRequest,
	unresolvedAnalysis,
} from './observingplanner.astronomy'
import { diagnoseSchedule, type ScheduleItemDiagnostics, type ScheduleTotals } from './observingplanner.schedule'
import type { ObservingPlan, ObservingPlanDocument, ObservingPlanOutcome, ObservingPlanSaveRequest, ObservingPlanStore } from './observingplanner.store'
import { queryCatalog } from './sky/catalog'
import type { TimeSpan } from './sky/sun'
import type { SkyCatalogClass, SkyCatalogQuery } from './sky/types'

// Observing Planner: local discovery and analysis of observing targets over a night of a site, and the night plans the
// operator saves. The catalog listing, the analysis of one target, the bounded discovery, and the preview of a plan are
// read-only, computed from the embedded sky catalog and the toolkit, never JPL, a forecast, or a device; their results
// are kept only in memory. Plans are documents of the operational database, written whole with an optimistic revision
// and published once committed; they never command a device or start an operation. Angles are radians and times Unix
// milliseconds (UTC).

export type { ObservingScheduleConflict, ObservingScheduleConflictCode, ScheduleItemDiagnostics, ScheduleTotals } from './observingplanner.schedule'
export type { ObservingConstraintsOverride, ObservingPlan, ObservingPlanDocument, ObservingPlanItem, ObservingPlanSaveRequest } from './observingplanner.store'

export type { ObservingConstraints, ObservingMode, ObservingReasonCode, ObservingSample, ObservingScore, ObservingStatus, ObservingSummary, ObservingTargetRef, ObservingWindow, PlanningBodyCode, PlanningSite, TargetAnalysis, TargetAnalysisRequest } from './observingplanner.astronomy'
export { MINIMUM_CONTINUOUS_MS, OBSERVING_PRESETS, PLANNING_BODY_CODES } from './observingplanner.astronomy'

// Catalog objects one discovery request evaluates.
const DISCOVERY_BATCH = 100

// Candidates evaluated between two yields to the event loop, so a discovery never stalls other requests.
const DISCOVERY_YIELD_EVERY = 10

// Margin under the minimum altitude below which a fixed target's meridian altitude rejects it without a search, in
// radians (1°): it covers precession and proper motion since J2000, under a degree for decades.
const TRANSIT_PRECHECK_MARGIN = DEG2RAD

// Nights kept in memory.
const NIGHT_CACHE_LIMIT = 8

// Target analyses kept in memory.
const ANALYSIS_CACHE_LIMIT = 256

// Codes of the Observing Planner errors.
export type ObservingPlannerErrorCode = 'notFound' | 'conflict'

// Body of POST /api/observing-planner/discover.
export interface ObservingDiscoveryRequest {
	// Site of the night.
	readonly site: PlanningSite
	// Civil date of the evening in the site's zone, YYYY-MM-DD.
	readonly eveningDate: string
	// Constraints the candidates must satisfy.
	readonly constraints: ObservingConstraints
	// Continuous time the observation needs, in milliseconds; absent asks only for the constraints' minimum.
	readonly requestedDurationMs?: number
	// Static catalog filter of the candidates, without paging.
	readonly filter: Omit<SkyCatalogQuery, 'cursor' | 'limit'>
	// Whether the Moon, the planets, and Pluto are candidates too; they are evaluated with the first batch.
	readonly includeBodies: boolean
	// Cursor of the batch, the nextCursor of the previous one; absent for the first.
	readonly cursor?: string
}

// Observable candidate of a discovery, without its display samples.
export interface ObservingCandidate {
	// Target.
	readonly target: ObservingTargetRef
	// Name.
	readonly name: string
	// Object type.
	readonly typeName?: string
	// Broad class, or 'solarSystem' for a body.
	readonly class: SkyCatalogClass | 'solarSystem'
	// IAU abbreviation of the constellation; absent for bodies.
	readonly constellation?: string
	// Visual magnitude; absent when unknown.
	readonly magnitude?: number
	// Apparent major axis in radians; absent when unknown.
	readonly majorAxis?: number
	// Observable or only in shorter windows.
	readonly status: Extract<ObservingStatus, 'observable' | 'limitedDuration'>
	// Why it is only partly observable.
	readonly reasons: readonly ObservingReasonCode[]
	// Best score, 0..100.
	readonly score: number
	// Instant of the best score.
	readonly bestAt: number
	// Windows, chronological.
	readonly windows: readonly ObservingWindow[]
	// Length of the longest window, in milliseconds.
	readonly longestWindowMs: number
	// Total length of the windows, in milliseconds.
	readonly totalUsableMs: number
}

// One batch of a discovery: the observable candidates of the batch, best first, and the coverage so far.
export interface ObservingDiscoveryPage {
	// Observable candidates of this batch, best score first.
	readonly candidates: readonly ObservingCandidate[]
	// Objects evaluated by this batch, observable or not.
	readonly evaluated: number
	// Objects matching the filter over every batch.
	readonly total: number
	// Cursor of the next batch; absent on the last one.
	readonly nextCursor?: string
	// Version of the score model.
	readonly modelVersion: number
}

// Canonical sort key of a target, for deterministic ties: bodies, then catalog objects, then coordinates.
function targetKey(ref: ObservingTargetRef) {
	if (ref.kind === 'body') return `0:${ref.code.padStart(4, '0')}`
	if (ref.kind === 'catalog') return `1:${`${ref.id}`.padStart(12, '0')}`
	return `2:${ref.name}:${ref.rightAscension}:${ref.declination}`
}

// Orders candidates by score, then longest window, then identity.
function compareCandidates(a: ObservingCandidate, b: ObservingCandidate) {
	return b.score - a.score || b.longestWindowMs - a.longestWindowMs || targetKey(a.target).localeCompare(targetKey(b.target))
}

// Candidate of an analysis; undefined when it has no window.
function candidateOf(analysis: TargetAnalysis, details: Pick<ObservingCandidate, 'class' | 'constellation' | 'magnitude' | 'majorAxis'>): ObservingCandidate | undefined {
	if ((analysis.status !== 'observable' && analysis.status !== 'limitedDuration') || !analysis.score) return undefined
	const { target, name, typeName, status, reasons, windows, summary, score } = analysis
	return { target, name, typeName, ...details, status, reasons, score: score.value, bestAt: score.at, windows, longestWindowMs: summary.longestWindowMs, totalUsableMs: summary.totalUsableMs }
}

// Yields to the event loop.
function yieldToEventLoop() {
	return new Promise<void>((resolve) => {
		setImmediate(resolve)
	})
}

// Change of a saved plan, published once its transaction committed.
export type ObservingPlanEvent =
	// A plan was created, edited, or duplicated; carries the whole saved plan.
	| { readonly type: 'observingPlan:updated'; readonly plan: ObservingPlan }
	// A plan was deleted.
	| { readonly type: 'observingPlan:removed'; readonly id: string }

// Body of POST /api/observing-planner/plans/:id/duplicate.
export interface ObservingPlanDuplicateRequest {
	// Id of the copy, generated by the tab.
	readonly id: string
	// Name of the copy.
	readonly name: string
}

// Body of POST /api/observing-planner/preview: a plan document, saved or not.
export type ObservingPlanPreviewRequest = Pick<ObservingPlanDocument, 'site' | 'eveningDate' | 'constraints' | 'items'>

// Preview of one item: its analysis with its effective constraints and the problems of its schedule.
export interface ObservingPlanItemPreview extends ScheduleItemDiagnostics {
	// Id of the item.
	readonly itemId: string
	// Analysis of the target with the plan's constraints and the item's replacements.
	readonly analysis: TargetAnalysis
}

// Preview of a plan: the night, each item, and the totals. Computed on request, never stored.
export interface ObservingPlanPreview {
	// The night of the plan.
	readonly night: AstroWeatherNight
	// Stretches where the Sun is below the plan's limit, the scope of the totals.
	readonly scope: readonly TimeSpan[]
	// Items, in the plan's order.
	readonly items: readonly ObservingPlanItemPreview[]
	// Totals of the schedule.
	readonly totals: ScheduleTotals
}

// Body of GET /api/observing-planner/plans.
export interface ObservingPlansSnapshot {
	// Every plan, most recently changed first.
	readonly plans: readonly ObservingPlan[]
}

// Dependencies of the Observing Planner.
export interface ObservingPlannerOptions {
	// The sky catalog.
	readonly catalog: Database
	// Night of a site containing an instant (Astro Weather's local night).
	readonly night: (request: AstroWeatherNightRequest) => AstroWeatherNight
	// Saved plans.
	readonly store: ObservingPlanStore
	// Receives every committed change of a plan.
	readonly listener?: (event: ObservingPlanEvent) => void
}

// Listing, analysis, discovery, and saved plans of the Observing Planner, with the in-memory caches of the derived results.
export class ObservingPlannerService {
	readonly #nights = new LruCache<PlanningNight>(NIGHT_CACHE_LIMIT)
	readonly #analyses = new LruCache<TargetAnalysis>(ANALYSIS_CACHE_LIMIT)

	constructor(readonly options: ObservingPlannerOptions) {}

	// Every saved plan.
	plans(): ObservingPlansSnapshot {
		return { plans: this.options.store.list() }
	}

	// A saved plan; undefined when it does not exist.
	plan(id: string) {
		return this.options.store.get(id)
	}

	// Saves a whole plan when the revision matches, publishing it once committed.
	savePlan(id: string, request: ObservingPlanSaveRequest) {
		return this.#published(this.options.store.save(id, request))
	}

	// Copies a plan under a new id and name, publishing the copy once committed.
	duplicatePlan(id: string, { id: newId, name }: ObservingPlanDuplicateRequest) {
		return this.#published(this.options.store.duplicate(id, newId, name))
	}

	// Deletes a plan when the revision matches, publishing the removal once committed.
	removePlan(id: string, revision: number) {
		const outcome = this.options.store.remove(id, revision)
		if (outcome.status === 'removed') this.options.listener?.({ type: 'observingPlan:removed', id })
		return outcome
	}

	// Analyzes every item of a plan with its effective constraints and diagnoses the schedule; nothing is stored.
	preview({ site, eveningDate, constraints, items }: ObservingPlanPreviewRequest): ObservingPlanPreview {
		const night = this.planningNight(site, eveningDate)
		const analyses = items.map((item) => this.analyze({ target: item.target, site, eveningDate, constraints: { ...constraints, ...item.constraints }, requestedDurationMs: item.requestedDurationMs }))
		const scope = night.sunWindows(constraints.maximumSunAltitude)
		const entries = items.map((item, i) => ({ id: item.id, requestedDurationMs: item.requestedDurationMs, scheduledStartAt: item.scheduledStartAt, status: analyses[i].status, windows: analyses[i].windows }))
		const { items: diagnostics, totals } = diagnoseSchedule(entries, night.night.sun, scope)
		return { night: night.night, scope, items: items.map((item, i) => ({ itemId: item.id, analysis: analyses[i], ...diagnostics.get(item.id)! })), totals }
	}

	// Publishes a saved plan.
	#published(outcome: ObservingPlanOutcome) {
		if (outcome.status === 'saved') this.options.listener?.({ type: 'observingPlan:updated', plan: outcome.plan })
		return outcome
	}

	// Lists the catalog.
	catalog(query: SkyCatalogQuery) {
		return queryCatalog(this.options.catalog, query)
	}

	// Night of a site whose evening falls on a civil date, shared by every analysis of it.
	planningNight(site: PlanningSite, eveningDate: string) {
		const key = `${site.latitude}|${site.longitude}|${site.elevation}|${site.timeZone}|${eveningDate}`
		let night = this.#nights.get(key)

		if (!night) {
			night = new PlanningNight(site, resolveNight(this.options.night, site, eveningDate))
			this.#nights.set(key, night)
		}

		return night
	}

	// Analyzes one target over a night; an unknown catalog id is unresolved, never an error.
	analyze({ target, site, eveningDate, constraints, requestedDurationMs }: TargetAnalysisRequest): TargetAnalysis {
		const key = JSON.stringify([OBSERVING_SCORE_MODEL_VERSION, target, site.latitude, site.longitude, site.elevation, site.timeZone, eveningDate, constraints, requestedDurationMs])
		const cached = this.#analyses.get(key)
		if (cached) return cached

		const night = this.planningNight(site, eveningDate)
		const resolved = resolveTarget(this.options.catalog, night, target)
		const analysis = resolved ? analyzeTarget(night, resolved, constraints, requestedDurationMs) : unresolvedAnalysis(night, target, constraints, requestedDurationMs)
		this.#analyses.set(key, analysis)
		return analysis
	}

	// Evaluates the next batch of candidates matching a filter over a night and returns the observable ones, best first.
	// A fixed target whose meridian altitude stays under the minimum is rejected without a search. Stops with the
	// signal's reason as soon as it is aborted, yielding to the event loop between candidates.
	async discover(request: ObservingDiscoveryRequest, signal?: AbortSignal): Promise<ObservingDiscoveryPage> {
		const { site, eveningDate, constraints, requestedDurationMs, filter, includeBodies, cursor } = request
		const night = this.planningNight(site, eveningDate)
		const page = queryCatalog(this.options.catalog, { ...filter, cursor, limit: DISCOVERY_BATCH })
		const bodies = includeBodies ? PLANNING_BODY_CODES : []
		const candidates: ObservingCandidate[] = []
		const latitude = night.location.latitude
		let evaluated = 0

		const evaluate = async (target: ObservingTargetRef, details: Pick<ObservingCandidate, 'class' | 'constellation' | 'magnitude' | 'majorAxis'>) => {
			if (++evaluated % DISCOVERY_YIELD_EVERY === 0) await yieldToEventLoop()
			signal?.throwIfAborted()
			const candidate = candidateOf(this.analyze({ target, site, eveningDate, constraints, requestedDurationMs }), details)
			if (candidate) candidates.push(candidate)
		}

		if (!cursor) for (const code of bodies) await evaluate({ kind: 'body', code }, { class: 'solarSystem' })

		for (const entry of page.entries) {
			if (altitudeAtTransit(latitude, entry.declination) < constraints.minimumAltitude - TRANSIT_PRECHECK_MARGIN) {
				evaluated++
				continue
			}

			await evaluate(entry.ref, { class: entry.class, constellation: entry.constellation, magnitude: entry.magnitude, majorAxis: entry.majorAxis })
		}

		return { candidates: candidates.sort(compareCandidates), evaluated, total: page.total + bodies.length, nextCursor: page.nextCursor, modelVersion: OBSERVING_SCORE_MODEL_VERSION }
	}
}

// Reads an optional number of a query parameter.
function numberParam(params: URLSearchParams, name: string) {
	const value = params.get(name)
	return value ? +value : undefined
}

// Reads the catalog query of GET /api/observing-planner/catalog: text, classes (comma-separated), constellation,
// minimumMagnitude, maximumMagnitude, includeUnknownMagnitude ('false' leaves them out), minimumSize and maximumSize
// (radians), cursor, and limit.
function catalogQuery(params: URLSearchParams): SkyCatalogQuery {
	const classes = params.get('classes')
	return {
		text: params.get('text') ?? undefined,
		classes: classes ? (classes.split(',') as SkyCatalogClass[]) : undefined,
		constellation: params.get('constellation') ?? undefined,
		minimumMagnitude: numberParam(params, 'minimumMagnitude'),
		maximumMagnitude: numberParam(params, 'maximumMagnitude'),
		includeUnknownMagnitude: params.get('includeUnknownMagnitude') !== 'false',
		minimumSize: numberParam(params, 'minimumSize'),
		maximumSize: numberParam(params, 'maximumSize'),
		cursor: params.get('cursor') ?? undefined,
		limit: numberParam(params, 'limit'),
	}
}

// Defaults and limits the client builds its constraints from.
export interface ObservingPlannerPresets {
	// Default constraints of each mode.
	readonly presets: Readonly<Record<ObservingMode, ObservingConstraints>>
	// Shortest continuous duration a window may require, in milliseconds.
	readonly minimumContinuousMs: number
	// Version of the score model.
	readonly modelVersion: number
}

// Answers a write of a plan: the saved plan, 409 conflict with the current plan, or 404.
function planResponse(outcome: ObservingPlanOutcome): Response {
	if (outcome.status === 'saved') return Response.json(outcome.plan)
	if (outcome.status === 'conflict') return errorResponse('The plan was changed by another tab', 409, 'conflict' satisfies ObservingPlannerErrorCode, { plan: outcome.current })
	return errorResponse('Observing plan not found', 404, 'notFound' satisfies ObservingPlannerErrorCode)
}

// Routes of the Observing Planner.
export function createObservingPlannerRoutes(service: ObservingPlannerService) {
	return {
		'/api/observing-planner/plans': {
			// Every saved plan (ObservingPlansSnapshot).
			GET: () => Response.json(service.plans()),
		},
		'/api/observing-planner/plans/:id': {
			// A saved plan (ObservingPlan); 404 notFound.
			GET: (req) => {
				const plan = service.plan(req.params.id)
				return plan ? Response.json(plan) : errorResponse('Observing plan not found', 404, 'notFound' satisfies ObservingPlannerErrorCode)
			},
			// Saves the whole plan of the body (ObservingPlanSaveRequest, revision 0 creating it); 409 conflict with the
			// current plan (null when it was deleted) when another revision was saved since.
			PUT: async (req) => planResponse(service.savePlan(req.params.id, (await req.json()) as ObservingPlanSaveRequest)),
			// Deletes the plan of ?revision; 409 conflict with the current plan when another revision was saved since; 404.
			DELETE: (req) => {
				const outcome = service.removePlan(req.params.id, +new URL(req.url).searchParams.get('revision')!)
				if (outcome.status === 'removed') return new Response(undefined, { status: 204 })
				return planResponse(outcome)
			},
		},
		'/api/observing-planner/plans/:id/duplicate': {
			// Copies the plan under the id and name of the body (ObservingPlanDuplicateRequest); 404 when it does not exist.
			POST: async (req) => planResponse(service.duplicatePlan(req.params.id, (await req.json()) as ObservingPlanDuplicateRequest)),
		},
		'/api/observing-planner/preview': {
			// Analysis and schedule diagnostics of the plan document of the body (ObservingPlanPreviewRequest).
			POST: async (req) => Response.json(service.preview((await req.json()) as ObservingPlanPreviewRequest) satisfies ObservingPlanPreview),
		},
		'/api/observing-planner/presets': {
			// Defaults and limits of the constraints (ObservingPlannerPresets).
			GET: () => Response.json({ presets: OBSERVING_PRESETS, minimumContinuousMs: MINIMUM_CONTINUOUS_MS, modelVersion: OBSERVING_SCORE_MODEL_VERSION } satisfies ObservingPlannerPresets),
		},
		'/api/observing-planner/catalog': {
			// One page of the catalog listing (SkyCatalogPage).
			GET: (req) => Response.json(service.catalog(catalogQuery(new URL(req.url).searchParams))),
		},
		'/api/observing-planner/analyze': {
			// Analysis of one target over a night (TargetAnalysis) for the body (TargetAnalysisRequest).
			POST: async (req) => Response.json(service.analyze((await req.json()) as TargetAnalysisRequest) satisfies TargetAnalysis),
		},
		'/api/observing-planner/discover': {
			// Next batch of a discovery (ObservingDiscoveryPage) for the body (ObservingDiscoveryRequest); a request that left
			// stops the batch and is not answered.
			POST: async (req) => Response.json((await service.discover((await req.json()) as ObservingDiscoveryRequest, req.signal)) satisfies ObservingDiscoveryPage),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
