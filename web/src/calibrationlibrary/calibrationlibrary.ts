// oxfmt-ignore
import type { CalibrationGroupDetail, CalibrationGroupSummary, CalibrationJobSummary, CalibrationKind, CalibrationLibrarySnapshot, CalibrationMasterDetail, CalibrationMasterSummary, CalibrationSource, CalibrationSourceSummary, ImportCandidate, ImportCommit, MasterRequest, MasterRequestResult, OverridableField, Page, RecipeValidation, ServerEvent, SourceStatus } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../http'

// The Calibration Library as this tab knows it. The server owns every frame, master, and job, so this store only mirrors
// them: a snapshot on every socket (re)open and on every change event, jobs as they change (which no list shows: a group
// follows its own build), and pages and details fetched
// when a view asks. A new epoch means a new server process, whose counters start over; a snapshot older than one applied is
// dropped, and a page that arrives after a newer request is ignored. Nothing here decides whether frames are compatible:
// the tool shows the reasons the server gives. The store lives outside the tool because the wizards of the camera tabs show
// the state of their masters too.

// Filters of the lists of frames and groups.
export interface CalibrationFilter {
	// Role.
	readonly kind?: CalibrationKind
	// Camera hardware id.
	readonly camera?: string
	// State of the file, for frames.
	readonly status?: SourceStatus
	// Text of a file name, for frames.
	readonly search?: string
}

// Calibration Library state of the tab.
export interface CalibrationLibraryRuntime {
	// Latest snapshot of the server.
	summary?: CalibrationLibrarySnapshot
	// Jobs this tab has seen, by job id.
	jobs: Record<string, CalibrationJobSummary>
	// Change counter, which a view watches to fetch its page again.
	changes: number
	// Pages of the view shown.
	groups?: Page<CalibrationGroupSummary>
	sources?: Page<CalibrationSourceSummary>
	masters?: Page<CalibrationMasterSummary>
	// Group shown in detail, and its revision shown.
	group?: CalibrationGroupDetail
	master?: CalibrationMasterDetail
	// Frame shown in detail, with its path.
	source?: CalibrationSource
	// Whether a page is on its way.
	loading: boolean
	// Commands of this tab waiting for the server, by key.
	pending: Record<string, boolean>
	// Why a command of this tab failed, by key; cleared by its next command.
	errors: Record<string, string>
}

// Calibration Library state of the tab.
export const calibrationLibraryRuntime = proxy<CalibrationLibraryRuntime>({ jobs: {}, changes: 0, loading: false, pending: {}, errors: {} })

// Base of the routes of the library.
const BASE_URL = '/api/calibration-library'

// Rows of a page.
export const CALIBRATION_PAGE_SIZE = 50

// Number of the latest request of each list, so a late response is dropped.
const requests: Record<string, number> = {}

// States of a job with nothing left to do.
const ENDED_STATES: ReadonlySet<CalibrationJobSummary['state']> = new Set(['completed', 'failed', 'cancelled', 'interrupted'])

// Returns whether a job ended.
export function jobEnded(job: Pick<CalibrationJobSummary, 'state'>) {
	return ENDED_STATES.has(job.state)
}

// Returns the latest master job of a group this tab knows, undefined when none.
export function latestGroupJob(jobs: Readonly<Record<string, CalibrationJobSummary>>, groupId: string) {
	let latest: CalibrationJobSummary | undefined

	for (const job of Object.values(jobs)) {
		if (job.type === 'master' && job.groupId === groupId && (!latest || latest.createdAt < job.createdAt)) latest = job
	}

	return latest
}

// Replaces what a new server process makes meaningless.
function adoptEpoch(state: CalibrationLibraryRuntime, epoch: string) {
	if (state.summary && state.summary.epoch !== epoch) {
		state.summary = undefined
		state.jobs = {}
	}
}

// Applies a snapshot, unless a newer one of the same process was applied.
function applySummary(state: CalibrationLibraryRuntime, summary: CalibrationLibrarySnapshot) {
	adoptEpoch(state, summary.epoch)
	if (state.summary && state.summary.revision > summary.revision) return
	state.summary = summary
	for (const job of [...summary.recentJobs, ...summary.activeJobs]) state.jobs[job.jobId] = job
	state.changes++
}

// Applies a Calibration Library event; any other event is ignored.
export function handleCalibrationLibraryEvent(state: CalibrationLibraryRuntime, event: ServerEvent) {
	if (event.type === 'calibrationLibrary:changed') {
		applySummary(state, event.summary)
	} else if (event.type === 'calibrationLibrary:jobUpdated') {
		adoptEpoch(state, event.epoch)
		const known = state.jobs[event.job.jobId]
		if (known && known.updatedAt > event.job.updatedAt) return
		state.jobs[event.job.jobId] = event.job
		if (jobEnded(event.job)) state.changes++
	} else if (event.type === 'calibrationLibrary:masterUpdated') {
		adoptEpoch(state, event.epoch)
		state.changes++
	}
}

// Fetches the snapshot; the server being away leaves what is known.
export async function refreshCalibrationLibrary(state: CalibrationLibraryRuntime, request: typeof fetch = fetch) {
	try {
		const response = await request(BASE_URL)
		if (response.ok) applySummary(state, (await response.json()) as CalibrationLibrarySnapshot)
	} catch {
		// The server is unreachable; the next socket open refreshes the snapshot.
	}
}

// Fetches JSON, returning undefined when it failed.
async function fetchJson<T>(url: string, request: typeof fetch) {
	try {
		const response = await request(url)
		return response.ok ? ((await response.json()) as T) : undefined
	} catch {
		return undefined
	}
}

// Builds the query string of a list.
function query(filter: CalibrationFilter, page: number) {
	const parameters = new URLSearchParams({ offset: String(page * CALIBRATION_PAGE_SIZE), limit: String(CALIBRATION_PAGE_SIZE) })
	for (const [key, value] of Object.entries(filter)) if (value) parameters.set(key, value as string)
	return parameters.toString()
}

// Fetches a page of a list, and applies it unless a newer request of that list replaced it.
async function loadPage(state: CalibrationLibraryRuntime, key: string, url: string, request: typeof fetch, apply: (page: unknown) => void) {
	const number = (requests[key] = (requests[key] ?? 0) + 1)
	state.loading = true
	const page = await fetchJson<unknown>(url, request)
	if (requests[key] !== number) return
	state.loading = false
	if (page) apply(page)
}

// Fetches a page of groups.
export function loadCalibrationGroups(state: CalibrationLibraryRuntime, filter: CalibrationFilter, page: number, request: typeof fetch = fetch) {
	return loadPage(state, 'groups', `${BASE_URL}/groups?${query(filter, page)}`, request, (groups) => {
		state.groups = groups as Page<CalibrationGroupSummary>
	})
}

// Fetches a page of frames.
export function loadCalibrationSources(state: CalibrationLibraryRuntime, filter: CalibrationFilter, page: number, request: typeof fetch = fetch) {
	return loadPage(state, 'sources', `${BASE_URL}/sources?${query(filter, page)}`, request, (sources) => {
		state.sources = sources as Page<CalibrationSourceSummary>
	})
}

// Fetches a page of masters.
export function loadCalibrationMasters(state: CalibrationLibraryRuntime, filter: CalibrationFilter, page: number, request: typeof fetch = fetch) {
	return loadPage(state, 'masters', `${BASE_URL}/masters?${query({ kind: filter.kind, camera: filter.camera }, page)}`, request, (masters) => {
		state.masters = masters as Page<CalibrationMasterSummary>
	})
}

// Fetches a group and its frames; one the server does not know is forgotten.
export async function loadCalibrationGroup(state: CalibrationLibraryRuntime, groupId: string | undefined, request: typeof fetch = fetch) {
	state.group = groupId === undefined ? undefined : await fetchJson<CalibrationGroupDetail>(`${BASE_URL}/groups/${encodeURIComponent(groupId)}`, request)
}

// Fetches a revision; absent clears it.
export async function loadCalibrationMaster(state: CalibrationLibraryRuntime, reference: { readonly masterId: string; readonly revision: number } | undefined, request: typeof fetch = fetch) {
	state.master = reference && (await fetchJson<CalibrationMasterDetail>(`${BASE_URL}/masters/${encodeURIComponent(reference.masterId)}/revisions/${reference.revision}`, request))
}

// Fetches a frame; absent clears it.
export async function loadCalibrationSource(state: CalibrationLibraryRuntime, sourceId: string | undefined, request: typeof fetch = fetch) {
	state.source = sourceId === undefined ? undefined : await fetchJson<CalibrationSource>(`${BASE_URL}/sources/${encodeURIComponent(sourceId)}`, request)
}

// Sends a command and records its failure. Resolves its JSON answer, or undefined when it failed.
async function command<T>(state: CalibrationLibraryRuntime, key: string, url: string, init: RequestInit, request: typeof fetch): Promise<T | undefined> {
	if (state.pending[key]) return undefined
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, init)

		if (!response.ok) {
			state.errors[key] = await responseError(response)
			return undefined
		}

		return (await response.json()) as T
	} catch {
		state.errors[key] = 'Unable to reach the server.'
		return undefined
	} finally {
		delete state.pending[key]
	}
}

// Explains a recipe, starting nothing. Resolves undefined when the server cannot be reached.
export async function validateRecipe(body: MasterRequest, request: typeof fetch = fetch) {
	try {
		const response = await request(`${BASE_URL}/recipes/validate`, jsonInit('POST', body))
		return response.ok ? ((await response.json()) as RecipeValidation) : undefined
	} catch {
		return undefined
	}
}

// Requests a master, and its token keeps a retried request from starting another; its progress arrives as events.
export function buildMaster(state: CalibrationLibraryRuntime, key: string, body: MasterRequest, request: typeof fetch = fetch) {
	return command<MasterRequestResult>(state, key, `${BASE_URL}/masters`, jsonInit('POST', { ...body, token: nanoid() } satisfies MasterRequest), request)
}

// Makes a revision the preferred one.
export function preferMaster(state: CalibrationLibraryRuntime, masterId: string, revision: number, request: typeof fetch = fetch) {
	return command(state, `master:${masterId}`, `${BASE_URL}/masters/${encodeURIComponent(masterId)}/preferred`, jsonInit('POST', { revision }), request)
}

// Deletes a revision and its file.
export function deleteCalibrationMaster(state: CalibrationLibraryRuntime, masterId: string, revision: number, request: typeof fetch = fetch) {
	return command(state, `master:${masterId}`, `${BASE_URL}/masters/${encodeURIComponent(masterId)}/revisions/${revision}`, { method: 'DELETE' }, request)
}

// Deletes a frame with its file.
export function deleteCalibrationSource(state: CalibrationLibraryRuntime, sourceId: string, request: typeof fetch = fetch) {
	return command<{ readonly deleted: number }>(state, `source:${sourceId}`, `${BASE_URL}/sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE' }, request)
}

// Deletes a group with the files of its frames.
export function deleteCalibrationGroup(state: CalibrationLibraryRuntime, groupId: string, request: typeof fetch = fetch) {
	return command<{ readonly deleted: number }>(state, `delete:${groupId}`, `${BASE_URL}/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' }, request)
}

// Cancels the scan of an import.
export function cancelCalibrationImport(state: CalibrationLibraryRuntime, jobId: string, request: typeof fetch = fetch) {
	return command(state, `import:${jobId}`, `${BASE_URL}/imports/${encodeURIComponent(jobId)}/cancel`, jsonInit('POST'), request)
}

// Starts scanning a directory of the server; its progress arrives as events.
export function startCalibrationImport(state: CalibrationLibraryRuntime, path: string, recursive: boolean, request: typeof fetch = fetch) {
	return command<CalibrationJobSummary>(state, 'import', `${BASE_URL}/imports`, jsonInit('POST', { path, recursive }), request)
}

// Fetches what an import found.
export function loadImportCandidates(jobId: string, page: number, request: typeof fetch = fetch) {
	return fetchJson<Page<ImportCandidate>>(`${BASE_URL}/imports/${encodeURIComponent(jobId)}/candidates?${query({}, page)}`, request)
}

// Adds reviewed files to the library.
export function commitCalibrationImport(state: CalibrationLibraryRuntime, jobId: string, body: ImportCommit, request: typeof fetch = fetch) {
	return command<{ readonly committed: number }>(state, 'import', `${BASE_URL}/imports/${encodeURIComponent(jobId)}/commit`, jsonInit('POST', body), request)
}

// Declares a value a frame does not state, with the reason.
export function overrideCalibrationSource(state: CalibrationLibraryRuntime, sourceId: string, field: OverridableField, value: string | number, reason: string, request: typeof fetch = fetch) {
	return command(state, `source:${sourceId}`, `${BASE_URL}/sources/${encodeURIComponent(sourceId)}/overrides`, jsonInit('POST', { field, value, reason }), request)
}

// Leaves a frame out of masters, or brings it back without a reason.
export function excludeCalibrationSource(state: CalibrationLibraryRuntime, sourceId: string, reason: string | undefined, request: typeof fetch = fetch) {
	return command(state, `source:${sourceId}`, `${BASE_URL}/sources/${encodeURIComponent(sourceId)}/exclusion`, jsonInit('POST', { reason }), request)
}

// Compares every indexed file with the disk.
export function refreshCalibrationFiles(state: CalibrationLibraryRuntime, request: typeof fetch = fetch) {
	return command(state, 'refresh', `${BASE_URL}/refresh`, jsonInit('POST'), request)
}
