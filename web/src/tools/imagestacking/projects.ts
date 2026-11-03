// oxfmt-ignore
import type { ImageStackingSnapshot, Page, ServerEvent, SourceStatus, StackingFilterGroup, StackingImportCandidate, StackingImportCommit, StackingJobSummary, StackingProjectDetail, StackingRole, StackingSourceDetail, StackingSourcePatch, StackingSourceSummary } from 'api'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../../http'

// Image Stacking as this tab knows it. The server owns every project, frame, and job, so this store only mirrors them: a
// snapshot on every socket (re)open and on every change event, jobs as they change, and the project, its groups, and a
// page of its frames fetched when the view asks. A new epoch means a new server process, whose counters start over; a
// snapshot older than one applied is dropped, and a response that arrives after a newer request of its kind is ignored.
// Nothing here decides a role, a filter, or a group: the tool shows what the server answers.

// Filters of the list of frames of a project.
export interface StackingFrameFilter {
	// Key of one filter group; the empty key is the lights without a filter.
	readonly group?: string
	// Role.
	readonly role?: StackingRole
	// State of the file.
	readonly status?: SourceStatus
	// Only included, or only left out, frames.
	readonly included?: boolean
	// Text of a file name.
	readonly search?: string
}

// Image Stacking state of the tab.
export interface ImageStackingRuntime {
	// Latest snapshot of the server.
	snapshot?: ImageStackingSnapshot
	// Jobs this tab has seen, by job id.
	jobs: Record<string, StackingJobSummary>
	// Change counter, which a view watches to fetch what it shows again.
	changes: number
	// Project shown, its filter groups, and the page of its frames shown.
	project?: StackingProjectDetail
	groups?: StackingFilterGroup[]
	frames?: Page<StackingSourceSummary>
	// Frame shown in detail, with its path.
	frame?: StackingSourceDetail
	// Whether a page of frames is on its way.
	loading: boolean
	// Commands of this tab waiting for the server, by key.
	pending: Record<string, boolean>
	// Why a command of this tab failed, by key; cleared by its next command.
	errors: Record<string, string>
}

// Image Stacking state of the tab.
export const imageStackingRuntime = proxy<ImageStackingRuntime>({ jobs: {}, changes: 0, loading: false, pending: {}, errors: {} })

// Base of the routes of Image Stacking.
const BASE_URL = '/api/image-stacking'

// Rows of a page of frames.
export const STACKING_PAGE_SIZE = 50

// Number of the latest request of each kind, so a late response is dropped.
const requests: Record<string, number> = {}

// Returns whether a job ended.
export function jobEnded(job: Pick<StackingJobSummary, 'state'>) {
	return job.state !== 'scanning'
}

// Replaces what a new server process makes meaningless.
function adoptEpoch(state: ImageStackingRuntime, epoch: string) {
	if (state.snapshot && state.snapshot.epoch !== epoch) {
		state.snapshot = undefined
		state.jobs = {}
	}
}

// Applies a snapshot, unless a newer one of the same process was applied.
function applySnapshot(state: ImageStackingRuntime, snapshot: ImageStackingSnapshot) {
	adoptEpoch(state, snapshot.epoch)
	if (state.snapshot && state.snapshot.revision > snapshot.revision) return
	state.snapshot = snapshot
	for (const job of snapshot.jobs) state.jobs[job.jobId] = job
	state.changes++
}

// Applies an Image Stacking event; any other event is ignored.
export function handleImageStackingEvent(state: ImageStackingRuntime, event: ServerEvent) {
	if (event.type === 'imageStacking:changed') {
		applySnapshot(state, event.snapshot)
	} else if (event.type === 'imageStacking:jobUpdated') {
		adoptEpoch(state, event.epoch)
		const known = state.jobs[event.job.jobId]
		if (known && known.updatedAt > event.job.updatedAt) return
		state.jobs[event.job.jobId] = event.job
	}
}

// Fetches the snapshot; the server being away leaves what is known.
export async function refreshImageStacking(state: ImageStackingRuntime, request: typeof fetch = fetch) {
	try {
		const response = await request(BASE_URL)
		if (response.ok) applySnapshot(state, (await response.json()) as ImageStackingSnapshot)
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

// Awaits the answer of a request of a kind, wrapped, or undefined when a newer request of that kind was made meanwhile.
async function latest<T>(key: string, answer: Promise<T>): Promise<{ readonly value: T } | undefined> {
	const number = (requests[key] = (requests[key] ?? 0) + 1)
	const value = await answer
	return requests[key] === number ? { value } : undefined
}

// Builds the query string of a page of frames.
export function framesQuery(filter: StackingFrameFilter, page: number) {
	const parameters = new URLSearchParams({ offset: String(page * STACKING_PAGE_SIZE), limit: String(STACKING_PAGE_SIZE) })
	if (filter.group !== undefined) parameters.set('group', filter.group)
	if (filter.role) parameters.set('role', filter.role)
	if (filter.status) parameters.set('status', filter.status)
	if (filter.included !== undefined) parameters.set('included', String(filter.included))
	if (filter.search) parameters.set('search', filter.search)
	return parameters.toString()
}

// Path of a project.
function projectUrl(projectId: string) {
	return `${BASE_URL}/projects/${encodeURIComponent(projectId)}`
}

// Fetches a project with its filter groups; absent, or one the server does not know, clears them.
export async function loadStackingProject(state: ImageStackingRuntime, projectId: string | undefined, request: typeof fetch = fetch) {
	if (projectId === undefined) {
		requests.project = (requests.project ?? 0) + 1
		requests.groups = (requests.groups ?? 0) + 1
		state.project = undefined
		state.groups = undefined
		return
	}

	const [project, groups] = await Promise.all([latest('project', fetchJson<StackingProjectDetail>(projectUrl(projectId), request)), latest('groups', fetchJson<StackingFilterGroup[]>(`${projectUrl(projectId)}/groups`, request))])
	if (project) state.project = project.value
	if (groups) state.groups = groups.value
}

// Fetches a page of frames of a project.
export async function loadStackingFrames(state: ImageStackingRuntime, projectId: string, filter: StackingFrameFilter, page: number, request: typeof fetch = fetch) {
	state.loading = true
	const frames = await latest('frames', fetchJson<Page<StackingSourceSummary>>(`${projectUrl(projectId)}/frames?${framesQuery(filter, page)}`, request))
	if (!frames) return
	state.loading = false
	if (frames.value) state.frames = frames.value
}

// Fetches a frame with its path; absent clears it.
export async function loadStackingFrame(state: ImageStackingRuntime, sourceId: string | undefined, request: typeof fetch = fetch) {
	if (sourceId === undefined) {
		requests.frame = (requests.frame ?? 0) + 1
		state.frame = undefined
		return
	}

	const frame = await latest('frame', fetchJson<StackingSourceDetail>(`${BASE_URL}/frames/${encodeURIComponent(sourceId)}`, request))
	if (frame) state.frame = frame.value
}

// Sends a command and records its failure. Resolves its JSON answer, or undefined when it failed.
async function command<T>(state: ImageStackingRuntime, key: string, url: string, init: RequestInit, request: typeof fetch): Promise<T | undefined> {
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

// Creates a project.
export function createStackingProject(state: ImageStackingRuntime, name: string, request: typeof fetch = fetch) {
	return command<StackingProjectDetail>(state, 'project', `${BASE_URL}/projects`, jsonInit('POST', { name }), request)
}

// Renames a project from the revision it was edited from.
export function renameStackingProject(state: ImageStackingRuntime, projectId: string, name: string, revision: number, request: typeof fetch = fetch) {
	return command<StackingProjectDetail>(state, 'project', projectUrl(projectId), jsonInit('PATCH', { name, revision }), request)
}

// Deletes a project; its frames stay on the disk.
export function deleteStackingProject(state: ImageStackingRuntime, projectId: string, request: typeof fetch = fetch) {
	return command(state, 'project', projectUrl(projectId), { method: 'DELETE' }, request)
}

// Compares the frames of a project with the disk.
export function refreshStackingProject(state: ImageStackingRuntime, projectId: string, request: typeof fetch = fetch) {
	return command(state, 'refresh', `${projectUrl(projectId)}/refresh`, jsonInit('POST'), request)
}

// Starts looking at directories and files of the server for a project; its progress arrives as events.
export function startStackingImport(state: ImageStackingRuntime, projectId: string, paths: readonly string[], recursive: boolean, request: typeof fetch = fetch) {
	return command<StackingJobSummary>(state, 'import', `${projectUrl(projectId)}/imports`, jsonInit('POST', { paths, recursive }), request)
}

// Fetches what an import found.
export function loadStackingCandidates(jobId: string, page: number, request: typeof fetch = fetch) {
	return fetchJson<Page<StackingImportCandidate>>(`${BASE_URL}/imports/${encodeURIComponent(jobId)}/candidates?offset=${page * STACKING_PAGE_SIZE}&limit=${STACKING_PAGE_SIZE}`, request)
}

// Cancels the scan of an import.
export function cancelStackingImport(state: ImageStackingRuntime, jobId: string, request: typeof fetch = fetch) {
	return command(state, `import:${jobId}`, `${BASE_URL}/imports/${encodeURIComponent(jobId)}/cancel`, jsonInit('POST'), request)
}

// Adds reviewed files to the project of an import.
export function commitStackingImport(state: ImageStackingRuntime, jobId: string, body: StackingImportCommit, request: typeof fetch = fetch) {
	return command<{ readonly committed: number }>(state, 'import', `${BASE_URL}/imports/${encodeURIComponent(jobId)}/commit`, jsonInit('POST', body), request)
}

// Changes what an operator decides about a frame.
export function updateStackingFrame(state: ImageStackingRuntime, sourceId: string, patch: StackingSourcePatch, request: typeof fetch = fetch) {
	return command<StackingSourceDetail>(state, `frame:${sourceId}`, `${BASE_URL}/frames/${encodeURIComponent(sourceId)}`, jsonInit('PATCH', patch), request)
}

// Takes a frame out of its project; its file stays where it is.
export function removeStackingFrame(state: ImageStackingRuntime, sourceId: string, request: typeof fetch = fetch) {
	return command(state, `frame:${sourceId}`, `${BASE_URL}/frames/${encodeURIComponent(sourceId)}`, { method: 'DELETE' }, request)
}

// Merges the lights of a filter key into the group of another.
export function mergeStackingFilter(state: ImageStackingRuntime, projectId: string, filterKey: string, targetKey: string, request: typeof fetch = fetch) {
	return command<StackingFilterGroup[]>(state, `alias:${filterKey}`, `${projectUrl(projectId)}/aliases`, jsonInit('POST', { filterKey, targetKey }), request)
}

// Separates a merged filter key again.
export function separateStackingFilter(state: ImageStackingRuntime, projectId: string, filterKey: string, request: typeof fetch = fetch) {
	return command<StackingFilterGroup[]>(state, `alias:${filterKey}`, `${projectUrl(projectId)}/aliases/${encodeURIComponent(filterKey)}`, { method: 'DELETE' }, request)
}
