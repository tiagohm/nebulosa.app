import type {
	ObservingCandidate,
	ObservingConstraints,
	ObservingDiscoveryPage,
	ObservingDiscoveryRequest,
	ObservingMode,
	ObservingPlan,
	ObservingPlanDocument,
	ObservingPlanItem,
	ObservingPlannerPresets,
	ObservingPlanPreview,
	ObservingPlansSnapshot,
	ObservingReasonCode,
	ObservingScheduleConflictCode,
	ObservingStatus,
	ObservingTargetRef,
	PlanningSite,
	ServerEvent,
	SkyCatalogClass,
	SkyCatalogEntry,
	SkyCatalogPage,
	TargetAnalysis,
	TargetAnalysisRequest,
} from 'api'
import { proxy } from 'valtio'
import { ApiResponseError, fetchJson, jsonInit, responseError } from '../../http'
import { ACTIVE_TOOL_LOCATION, type SiteLocation, type ToolLocation } from '../../location/site'
import { DEFAULT_ZONE_OVERRIDE, type DisplayZoneOverride, zonedWallTime } from '../../location/zone'
import { navigate, type RouteState, routeState } from '../../shell/route'
import { type SkyClock, skyClock } from '../../sky/clock'
import { showCoordinateInSky, type SkyImageState, skyImageState } from '../../sky/footprint'
import { createRequestGuard } from '../../sky/selection'
import { browserSkyIo, type SkyIo, type SkyState, selectSkyObject, skyState } from '../../sky/sky'
import type { StatusTone } from '../../ui/StatusBadge'

// Observing Planner of the tab: the saved night plans mirrored from the server, and the tab-lived state of the tool
// (location, night, constraints, discovery, analysis, and preview). Every number here comes from the server; nothing is
// computed locally but labels and lengths. Plans are edited as drafts written whole, one request at a time per plan, from
// the revision they were edited from; a conflict is shown, never overwritten without the operator saying so. Times are
// Unix milliseconds (UTC); angles radians.

// Delay between the latest edit of a plan and its write, in milliseconds.
const SAVE_DELAY_MS = 400

// Milliseconds per hour.
const HOUR_MS = 3_600_000

// Requests of the tool, replaced in tests.
export interface ObservingPlannerIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Real current time, Unix milliseconds (UTC).
	readonly time: () => number
	// Schedules a delayed write, returning its cancellation.
	readonly later: (run: () => void, delay: number) => () => void
	// Generates the id of a new plan or item.
	readonly id: () => string
}

// Browser implementation of ObservingPlannerIo.
export const browserObservingPlannerIo: ObservingPlannerIo = {
	fetch: (input, init) => fetch(input, init),
	time: () => Date.now(),
	later: (run, delay) => {
		const timer = setTimeout(run, delay)
		return () => clearTimeout(timer)
	},
	id: () => crypto.randomUUID(),
}

// Section of the tool.
export type ObservingPlannerSection = 'discover' | 'analysis' | 'plan'

// Every section, in display order.
export const OBSERVING_PLANNER_SECTIONS: readonly ObservingPlannerSection[] = ['discover', 'analysis', 'plan']

// Label of each section.
export const SECTION_LABELS: Readonly<Record<ObservingPlannerSection, string>> = { discover: 'Discover', analysis: 'Analysis', plan: 'Night Plan' }

// Every mode, in display order.
export const OBSERVING_MODES: readonly ObservingMode[] = ['deepSky', 'visual', 'planetary']

// Label of each mode.
export const MODE_LABELS: Readonly<Record<ObservingMode, string>> = { deepSky: 'Deep-Sky Imaging', visual: 'Visual', planetary: 'Planetary' }

// Every catalog class, in display order.
export const CATALOG_CLASSES: readonly SkyCatalogClass[] = ['galaxy', 'nebula', 'cluster', 'star', 'other']

// Label of each catalog class.
export const CLASS_LABELS: Readonly<Record<SkyCatalogClass | 'solarSystem', string>> = { galaxy: 'Galaxies', nebula: 'Nebulae', cluster: 'Clusters', star: 'Stars', other: 'Other', solarSystem: 'Solar System' }

// Label and tone of each status.
export const STATUS_LABELS: Readonly<Record<ObservingStatus, { readonly label: string; readonly tone: StatusTone }>> = {
	observable: { label: 'Observable', tone: 'success' },
	limitedDuration: { label: 'Limited', tone: 'warning' },
	notObservable: { label: 'Not observable', tone: 'danger' },
	unresolved: { label: 'Unresolved', tone: 'muted' },
}

// Sentence of each reason.
export const REASON_LABELS: Readonly<Record<ObservingReasonCode, string>> = {
	unresolvedTarget: 'The catalog no longer has this object.',
	noAstronomicalDarkness: 'The site has no astronomical night on this date.',
	sunTooHigh: 'The Sun never goes below the limit.',
	belowMinimumAltitude: 'The target never reaches the minimum altitude.',
	airmassTooHigh: 'The target never reaches the maximum airmass.',
	notDuringDarkness: 'The target is high enough only while the sky is too bright.',
	moonTooClose: 'The Moon is up and too close whenever the target is otherwise observable.',
	windowTooShort: 'Every window is shorter than the minimum continuous time.',
	shorterThanRequested: 'Every window is shorter than the requested time.',
}

// Sentence of each schedule problem.
export const CONFLICT_LABELS: Readonly<Record<ObservingScheduleConflictCode, string>> = {
	unresolvedTarget: 'The catalog no longer has this object.',
	notObservable: 'Not observable this night.',
	insufficientContiguousTime: 'No window is as long as the requested time.',
	outsideNight: 'The block is outside the night.',
	outsideValidWindow: 'The block does not fit inside one window.',
	overlapsItem: 'Overlaps another block.',
}

// Static catalog filter of the tool.
export interface CatalogFilter {
	// Text matched against designations and names.
	text: string
	// Classes listed; empty lists every class.
	classes: SkyCatalogClass[]
	// Faintest magnitude listed.
	maximumMagnitude: number
	// Whether objects without a magnitude are listed.
	includeUnknownMagnitude: boolean
	// Whether the Moon, the planets, and Pluto are candidates of a discovery.
	includeBodies: boolean
}

// Target the tab is looking at, with its name.
export interface NamedTarget {
	// Target.
	readonly target: ObservingTargetRef
	// Name.
	readonly name: string
}

// Listing of the catalog, accumulated page by page.
export interface CatalogListing {
	// Entries so far.
	readonly entries: readonly SkyCatalogEntry[]
	// Objects matching the filter.
	readonly total: number
	// Cursor of the next page.
	readonly nextCursor?: string
}

// Discovery of the night, accumulated batch by batch and ranked over every batch read.
export interface DiscoveryListing {
	// Key of the night, site, constraints, and filter it was computed for.
	readonly key: string
	// Observable candidates so far, best first.
	readonly candidates: readonly ObservingCandidate[]
	// Objects evaluated so far.
	readonly evaluated: number
	// Objects matching the filter.
	readonly total: number
	// Cursor of the next batch.
	readonly nextCursor?: string
}

// Tab-lived state of the tool.
export interface ObservingPlannerState {
	// Section shown.
	section: ObservingPlannerSection
	// Where the tool observes from.
	location: ToolLocation
	// Zone the times are shown in.
	zone: DisplayZoneOverride
	// Civil date of the evening in the location's zone; absent until a location gives tonight's.
	eveningDate?: string
	// Constraints of the tool; absent until the presets are read.
	constraints?: ObservingConstraints
	// Defaults and limits of the server.
	presets?: ObservingPlannerPresets
	// Static catalog filter.
	filter: CatalogFilter
	// Listing of the catalog.
	catalog?: CatalogListing
	// Whether the catalog is being read.
	catalogLoading: boolean
	// Why the catalog could not be read.
	catalogError?: string
	// Discovery of the night.
	discovery?: DiscoveryListing
	// Whether a discovery batch is being computed.
	discoveryLoading: boolean
	// Why the discovery failed.
	discoveryError?: string
	// Target analyzed.
	selected?: NamedTarget
	// Analysis of the selected target.
	analysis?: TargetAnalysis
	// Whether the analysis is being computed.
	analysisLoading: boolean
	// Why the analysis failed.
	analysisError?: string
	// Target the Sky asked to add to a plan.
	pendingTarget?: NamedTarget
	// Preview of the plan shown.
	preview?: { readonly key: string; readonly owner: string; readonly value: ObservingPlanPreview }
	// Whether the preview is being computed.
	previewLoading: boolean
	// Why the preview failed.
	previewError?: string
}

// Default static filter: deep-sky objects with a magnitude down to 10.
export const DEFAULT_FILTER: CatalogFilter = { text: '', classes: ['galaxy', 'nebula', 'cluster'], maximumMagnitude: 10, includeUnknownMagnitude: false, includeBodies: true }

// Creates the tab state of the tool.
export function createObservingPlannerState(): ObservingPlannerState {
	return { section: 'discover', location: { ...ACTIVE_TOOL_LOCATION }, zone: { ...DEFAULT_ZONE_OVERRIDE }, filter: structuredClone(DEFAULT_FILTER), catalogLoading: false, discoveryLoading: false, analysisLoading: false, previewLoading: false }
}

// Tab state of the tool.
export const observingPlannerState = proxy<ObservingPlannerState>(createObservingPlannerState())

// Guards of the requests of the tool, each superseding its previous one.
const catalogGuard = createRequestGuard()
const discoveryGuard = createRequestGuard()
const analysisGuard = createRequestGuard()
const previewGuard = createRequestGuard()

// Returns a plain copy of a JSON value, such as a document read from a valtio proxy or snapshot, which structuredClone
// cannot copy.
export function plain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T
}

// Returns whether a failure is the abort of a superseded request.
function aborted(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
}

// Returns the message of a failure.
function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

// Returns the planning site of a location.
export function planningSite(location: SiteLocation): PlanningSite {
	return { name: location.name ?? 'Coordinates entered', latitude: location.latitude, longitude: location.longitude, elevation: location.elevation, timeZone: location.timeZone }
}

// Returns the civil date of tonight's evening in a zone: the date of twelve hours ago, since a night belongs to the evening
// of the Sun's transit before it (near the civil noon). Only the default of the date picker.
export function tonight(time: number, timeZone: string) {
	const { year, month, day } = zonedWallTime(time - 12 * HOUR_MS, timeZone)
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Reads the presets once, and gives the tool the constraints of its default mode when it has none.
export async function loadPresets(state: ObservingPlannerState, io: ObservingPlannerIo = browserObservingPlannerIo) {
	if (state.presets) return
	try {
		const presets = await fetchJson<ObservingPlannerPresets>(io, '/api/observing-planner/presets')
		state.presets = presets
		state.constraints ??= { ...presets.presets.deepSky }
	} catch {
		// Retried on the next opening of the tool.
	}
}

// Switches the tool to a mode with its default constraints.
export function selectMode(state: ObservingPlannerState, mode: ObservingMode) {
	if (state.presets) state.constraints = { ...state.presets.presets[mode] }
}

// Key of what a night's results depend on: the place, its zone, the evening, and the constraints; never the display zone.
export function nightKey(site: PlanningSite, eveningDate: string, constraints: ObservingConstraints) {
	return JSON.stringify([site.latitude, site.longitude, site.elevation, site.timeZone, eveningDate, constraints])
}

// Reads the first page of the catalog for the filter, or the next one with `more`.
export async function listCatalog(state: ObservingPlannerState, more: boolean = false, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const request = catalogGuard.begin()
	const { text, classes, maximumMagnitude, includeUnknownMagnitude } = state.filter
	const params = new URLSearchParams({ text, maximumMagnitude: String(maximumMagnitude), includeUnknownMagnitude: String(includeUnknownMagnitude), limit: '50' })
	if (classes.length > 0) params.set('classes', classes.join(','))
	const cursor = more ? state.catalog?.nextCursor : undefined
	if (cursor) params.set('cursor', cursor)
	state.catalogLoading = true
	state.catalogError = undefined

	try {
		const page = await fetchJson<SkyCatalogPage>(io, `/api/observing-planner/catalog?${params}`, { signal: request.signal })
		if (!request.current()) return
		state.catalog = { entries: [...(cursor ? (state.catalog?.entries ?? []) : []), ...page.entries], total: page.total, nextCursor: page.nextCursor }
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.catalogError = errorMessage(error)
	}

	state.catalogLoading = false
}

// Ranks candidates by score, then longest window.
function rank(candidates: readonly ObservingCandidate[]) {
	return candidates.toSorted((a, b) => b.score - a.score || b.longestWindowMs - a.longestWindowMs)
}

// Computes the first discovery batch of the night for the filter, or the next one with `more`; batches add up and are
// ranked together, so the ranking covers every object evaluated so far.
export async function discover(state: ObservingPlannerState, location: SiteLocation, more: boolean = false, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const { eveningDate, constraints, filter } = state
	if (!eveningDate || !constraints) return
	const site = planningSite(location)
	const key = JSON.stringify([nightKey(site, eveningDate, constraints), filter])
	const previous = more && state.discovery?.key === key ? state.discovery : undefined
	if (more && !previous?.nextCursor) return

	const request = discoveryGuard.begin()
	const body: ObservingDiscoveryRequest = {
		site,
		eveningDate,
		constraints,
		filter: { text: filter.text, classes: filter.classes, maximumMagnitude: filter.maximumMagnitude, includeUnknownMagnitude: filter.includeUnknownMagnitude },
		includeBodies: filter.includeBodies,
		cursor: previous?.nextCursor,
	}
	state.discoveryLoading = true
	state.discoveryError = undefined
	if (!previous) state.discovery = undefined

	try {
		const page = await fetchJson<ObservingDiscoveryPage>(io, '/api/observing-planner/discover', jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.discovery = { key, candidates: rank([...(previous?.candidates ?? []), ...page.candidates]), evaluated: (previous?.evaluated ?? 0) + page.evaluated, total: page.total, nextCursor: page.nextCursor }
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.discoveryError = errorMessage(error)
	}

	state.discoveryLoading = false
}

// Stops a discovery batch in progress; the server stops computing it.
export function stopDiscovery(state: ObservingPlannerState) {
	discoveryGuard.cancel()
	state.discoveryLoading = false
}

// Analyzes a target over the tool's night and shows the Analysis section.
export async function analyze(state: ObservingPlannerState, location: SiteLocation, target: NamedTarget, io: ObservingPlannerIo = browserObservingPlannerIo) {
	state.selected = target
	state.section = 'analysis'
	await refreshAnalysis(state, location, io)
}

// Computes the analysis of the selected target again for the tool's location, night, and constraints.
export async function refreshAnalysis(state: ObservingPlannerState, location: SiteLocation, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const { selected, eveningDate, constraints } = state
	if (!selected || !eveningDate || !constraints) return
	const request = analysisGuard.begin()
	const body: TargetAnalysisRequest = { target: selected.target, site: planningSite(location), eveningDate, constraints }
	state.analysisLoading = true
	state.analysisError = undefined

	try {
		const analysis = await fetchJson<TargetAnalysis>(io, '/api/observing-planner/analyze', jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.analysis = analysis
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.analysis = undefined
		state.analysisError = errorMessage(error)
	}

	state.analysisLoading = false
}

// Key of what a plan's preview depends on.
export function previewKey(document: Pick<ObservingPlanDocument, 'site' | 'eveningDate' | 'constraints' | 'items'>) {
	return JSON.stringify([document.site, document.eveningDate, document.constraints, document.items])
}

// Computes the preview of a plan document of a plan (`owner`, its id); a document already previewed is not asked again.
export async function previewPlan(state: ObservingPlannerState, owner: string, document: Pick<ObservingPlanDocument, 'site' | 'eveningDate' | 'constraints' | 'items'>, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const key = previewKey(document)
	if (state.preview?.key === key) return
	const request = previewGuard.begin()
	state.previewLoading = true
	state.previewError = undefined

	try {
		const { site, eveningDate, constraints, items } = document
		const value = await fetchJson<ObservingPlanPreview>(io, '/api/observing-planner/preview', jsonInit('POST', { site, eveningDate, constraints, items }, request.signal))
		if (!request.current()) return
		state.preview = { key, owner, value }
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.previewError = errorMessage(error)
	}

	state.previewLoading = false
}

// Saved plans of the server as the tab knows them, with the drafts the tab is writing.
export interface ObservingPlansState {
	// Saved plans, by id.
	plans: Record<string, ObservingPlan>
	// Whether the plans were read once.
	loaded: boolean
	// Plan documents edited and not yet saved, by plan id, with the revision they were edited from.
	drafts: Record<string, { document: ObservingPlanDocument; revision: number }>
	// Plans whose write is in flight.
	saving: Record<string, true>
	// Plans whose last write found another revision: what the server kept (null when it was deleted).
	conflicts: Record<string, ObservingPlan | null>
	// Why the last write of a plan failed.
	errors: Record<string, string>
}

// Mirror of the saved plans of the tab.
export const observingPlansState = proxy<ObservingPlansState>({ plans: {}, loaded: false, drafts: {}, saving: {}, conflicts: {}, errors: {} })

// Generation of the latest read of the plans, so an older answer never replaces a newer one.
let plansGeneration = 0

// Ids of the plans removed since the latest read started, which its answer may still list.
let removedSinceRead = new Set<string>()

// Keeps a plan unless the tab already knows a newer revision of it.
function applyPlan(state: ObservingPlansState, plan: ObservingPlan) {
	const known = state.plans[plan.id]
	if (!known || known.revision <= plan.revision) state.plans[plan.id] = plan
}

// Reads every saved plan, keeping the newer revisions events brought while the read was in flight and leaving out the
// plans removed meanwhile.
export async function refreshObservingPlans(state: ObservingPlansState, io: Pick<ObservingPlannerIo, 'fetch'> = browserObservingPlannerIo) {
	const generation = ++plansGeneration
	removedSinceRead = new Set()

	try {
		const { plans } = await fetchJson<ObservingPlansSnapshot>(io, '/api/observing-planner/plans')
		if (generation !== plansGeneration) return
		const listed = new Set(plans.map((plan) => plan.id))
		for (const id of Object.keys(state.plans)) if (!listed.has(id) && !state.drafts[id]) delete state.plans[id]
		for (const plan of plans) if (!removedSinceRead.has(plan.id)) applyPlan(state, plan)
		state.loaded = true
	} catch {
		// Read again on the next socket open.
	}
}

// Applies an event of the saved plans.
export function handleObservingPlanEvent(state: ObservingPlansState, event: ServerEvent) {
	if (event.type === 'observingPlan:updated') applyPlan(state, event.plan)
	else if (event.type === 'observingPlan:removed') {
		removedSinceRead.add(event.id)
		delete state.plans[event.id]
	}
}

// Returns the document of a plan as the tab shows it: its draft, or what the server saved.
export function planDocument(state: Pick<ObservingPlansState, 'plans' | 'drafts'>, id: string): ObservingPlanDocument | undefined {
	return state.drafts[id]?.document ?? state.plans[id]
}

// Returns the plans, most recently changed first.
export function sortedPlans(state: Pick<ObservingPlansState, 'plans'>): ObservingPlan[] {
	return Object.values(state.plans).toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

// Pending writes of the plans, by id.
const scheduled = new Map<string, () => void>()

// Changes the document of a saved plan and writes it a moment later; edits made meanwhile go in the same write.
export function editPlan(state: ObservingPlansState, id: string, change: (document: ObservingPlanDocument) => ObservingPlanDocument, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const current = state.drafts[id] ?? (state.plans[id] && { document: state.plans[id], revision: state.plans[id].revision })
	if (!current) return
	state.drafts[id] = { document: change(plain(current.document)), revision: current.revision }
	scheduled.get(id)?.()
	scheduled.set(
		id,
		io.later(() => {
			scheduled.delete(id)
			void flushPlan(state, id, io)
		}, SAVE_DELAY_MS),
	)
}

// The fields of a plan document, without what the server adds.
function documentOf({ name, eveningDate, observingSiteId, site, constraints, items }: ObservingPlanDocument): ObservingPlanDocument {
	return { name, eveningDate, observingSiteId, site, constraints, items }
}

// Writes the draft of a plan, one write at a time; a draft changed during the write is written again after it.
export async function flushPlan(state: ObservingPlansState, id: string, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const draft = state.drafts[id]
	if (!draft || state.saving[id] || id in state.conflicts) return
	const sent = draft.document
	state.saving[id] = true
	delete state.errors[id]

	try {
		const response = await io.fetch(`/api/observing-planner/plans/${encodeURIComponent(id)}`, jsonInit('PUT', { ...documentOf(sent), revision: draft.revision }))

		if (response.status === 409) {
			state.conflicts[id] = ((await response.json()) as { plan: ObservingPlan | null }).plan
		} else if (!response.ok) {
			state.errors[id] = await responseError(response)
		} else {
			const plan = (await response.json()) as ObservingPlan
			applyPlan(state, plan)
			const latest = state.drafts[id]
			if (latest && latest.document !== sent) latest.revision = plan.revision
			else delete state.drafts[id]
		}
	} catch (error) {
		state.errors[id] = errorMessage(error)
	}

	delete state.saving[id]
	if (state.drafts[id] && !(id in state.conflicts) && !state.errors[id]) await flushPlan(state, id, io)
}

// Ends a conflict by keeping what the server saved, dropping the tab's draft.
export function discardDraft(state: ObservingPlansState, id: string) {
	delete state.drafts[id]
	delete state.conflicts[id]
	delete state.errors[id]
}

// Ends a conflict by writing the tab's draft over what the server saved, as the operator asked.
export async function overwritePlan(state: ObservingPlansState, id: string, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const draft = state.drafts[id]
	if (!draft || !(id in state.conflicts)) return
	draft.revision = state.conflicts[id]?.revision ?? 0
	delete state.conflicts[id]
	await flushPlan(state, id, io)
}

// Creates a plan and returns its id; undefined when the server refused it.
export async function createPlan(state: ObservingPlansState, document: ObservingPlanDocument, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const id = io.id()

	try {
		const plan = await fetchJson<ObservingPlan>(io, `/api/observing-planner/plans/${encodeURIComponent(id)}`, jsonInit('PUT', { ...documentOf(document), revision: 0 }))
		applyPlan(state, plan)
		return id
	} catch (error) {
		state.errors[id] = errorMessage(error)
		return undefined
	}
}

// Copies a plan under a new name and returns the id of the copy; undefined when the server refused it.
export async function duplicatePlan(state: ObservingPlansState, id: string, name: string, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const copy = io.id()

	try {
		const plan = await fetchJson<ObservingPlan>(io, `/api/observing-planner/plans/${encodeURIComponent(id)}/duplicate`, jsonInit('POST', { id: copy, name }))
		applyPlan(state, plan)
		return copy
	} catch (error) {
		state.errors[id] = errorMessage(error)
		return undefined
	}
}

// Deletes a plan at the revision the tab knows; a newer revision is a conflict.
export async function deletePlan(state: ObservingPlansState, id: string, io: ObservingPlannerIo = browserObservingPlannerIo) {
	const plan = state.plans[id]
	if (!plan) return

	try {
		const response = await io.fetch(`/api/observing-planner/plans/${encodeURIComponent(id)}?revision=${plan.revision}`, { method: 'DELETE' })
		if (response.status === 409) state.conflicts[id] = ((await response.json()) as { plan: ObservingPlan | null }).plan
		else if (!response.ok && response.status !== 404) throw new ApiResponseError(await responseError(response), response.status)
		else {
			delete state.plans[id]
			delete state.drafts[id]
		}
	} catch (error) {
		state.errors[id] = errorMessage(error)
	}
}

// Returns a new item of a target with the plan's minimum continuous time as its request, unscheduled.
export function newItem(target: NamedTarget, constraints: ObservingConstraints, io: Pick<ObservingPlannerIo, 'id'> = browserObservingPlannerIo): ObservingPlanItem {
	return { id: io.id(), target: target.target, targetName: target.name, priority: 3, requestedDurationMs: Math.max(constraints.minimumContinuousMs, HOUR_MS), notes: '' }
}

// Returns a new plan document for the tool's location, night, and constraints, with its first items.
export function newPlanDocument(name: string, location: SiteLocation, observingSiteId: string | undefined, eveningDate: string, constraints: ObservingConstraints, items: readonly ObservingPlanItem[] = []): ObservingPlanDocument {
	return { name, eveningDate, observingSiteId, site: planningSite(location), constraints, items: [...items] }
}

// Opens a plan in the tool.
export function openPlan(state: ObservingPlannerState, id: string | undefined, route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	state.section = 'plan'
	navigate(route, { workspace: 'tools', tool: 'observing-planner', plan: id }, history)
}

// Opens the tool with a target the Sky asked to add to a plan; nothing is added until the operator chooses the plan.
export function addToObservingPlanner(target: NamedTarget, state: ObservingPlannerState = observingPlannerState, route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	state.pendingTarget = { target: plain(target.target), name: target.name }
	navigate(route, { workspace: 'tools', tool: 'observing-planner', plan: route.route.workspace === 'tools' && route.route.tool === 'observing-planner' ? route.route.plan : undefined }, history)
}

// Places the Sky changes when a target is shown, replaced in tests.
export interface SkyHandoff {
	// Sky workspace state.
	readonly sky: SkyState
	// Handoffs of positions to the map.
	readonly images: SkyImageState
	// Simulation clock, which a handoff never changes.
	readonly clock: SkyClock
	// Route of the tab.
	readonly route: RouteState
	// Requests of the selection.
	readonly io: SkyIo
	// History of the tab.
	readonly history: Pick<History, 'pushState'>
}

// Returns the Sky of the tab.
function browserHandoff(): SkyHandoff {
	return { sky: skyState, images: skyImageState, clock: skyClock, route: routeState, io: browserSkyIo, history: window.history }
}

// Shows a target in the Sky at the Sky's own time: a catalog object or a body is selected through the Sky's path from the
// active site, fixed coordinates are marked and panned to. The clock, the mount, the profile, and the site are left alone.
export function showTargetInSky({ target, name }: NamedTarget, site: SiteLocation | undefined, handoff: SkyHandoff = browserHandoff()) {
	if (target.kind === 'coordinates') showCoordinateInSky(handoff.images, [target.rightAscension, target.declination], name)
	else selectSkyObject(handoff.sky, { ref: plain(target), source: 'search', name, category: target.kind === 'body' ? 'solarSystem' : undefined }, site, handoff.io)
	navigate(handoff.route, { workspace: 'sky' }, handoff.history)
}

// Returns whether two targets are the same.
export function sameTarget(a: ObservingTargetRef, b: ObservingTargetRef) {
	if (a.kind === 'catalog' && b.kind === 'catalog') return a.id === b.id
	if (a.kind === 'body' && b.kind === 'body') return a.code === b.code
	return a.kind === 'coordinates' && b.kind === 'coordinates' && a.rightAscension === b.rightAscension && a.declination === b.declination && a.name === b.name
}
