import { stat } from 'fs/promises'
import { basename, relative } from 'path'
import type { CalibrationMetadata } from './calibrationlibrary.compatibility'
import { fileIdentity, type FileInspection, inspectFile, scanDirectory } from './calibrationlibrary.sources'
import { MAX_PAGE_SIZE, type Page, type SourceFormat, type SourceStatus } from './calibrationlibrary.store'
import { errorResponse } from './http'
import { cohortKeyOf, filterKeyOf, filterSynonyms, isWithin, lightRoleOf, type StackingRole, stackingSourceId } from './imagestacking.sources'
// oxfmt-ignore
import { type ImageStackingStore, type StackingFilterAlias, type StackingProject, type StackingSource, type StackingSourceFacts, type StackingSourceFilter, type StackingSourceSummary, stackingSourceSummary } from './imagestacking.store'
import { errorCode } from './util'

// Image Stacking: projects of light frames saved on the server, grouped by the physical filter they were taken through,
// for integration and color composition. It needs no connection, claims no device, and takes no part in
// OperationRegistry. Frames enter a project only through an import an operator reviewed: a cancellable scan of headers
// that never reads pixels, never writes a file, and never infers anything from a name. A header without a role leaves
// a frame unclassified until an operator declares it a light; a frame without a filter waits in the Unassigned group
// until an operator declares its filter; filter names that are spelled differently stay apart until an operator merges
// them. Projects and frames are rows of the operational database; import jobs live in memory and end with the process.

// Default page size of the lists.
const DEFAULT_PAGE_SIZE = 50

// Files checked at once when comparing the frames with the disk.
const REFRESH_CONCURRENCY = 32

// Ended jobs kept in memory, the latest first.
const KEPT_JOBS = 50

// Files found between two progress events of a scan.
const PROGRESS_STEP = 100

// Stable code of a failed request.
export type ImageStackingErrorCode = 'notFound' | 'conflict' | 'jobConflict' | 'managedPath' | 'verifiedMetadata' | 'invalidAlias' | 'processingFailed'

// Failure of a request, with its status and stable code.
class StackingError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: ImageStackingErrorCode,
	) {
		super(message)
	}
}

// What a project holds, by counts.
export interface StackingProjectSummary extends StackingProject {
	// Frames, lights among them, and frames waiting for a role.
	readonly frames: number
	readonly lights: number
	readonly unclassified: number
	// Frames left out by an operator, and frames whose file is missing, changed, or unreadable.
	readonly excluded: number
	readonly unavailable: number
	// Filter groups with a filter, and lights without one.
	readonly filters: number
	readonly unassigned: number
	// Exposure of the included lights whose file is available, in seconds.
	readonly exposure: number
	// Targets their headers name, by name; more than one asks the operator to check the project.
	readonly objects: readonly string[]
}

// Lights of one physical filter in a project, after the aliases of the project.
export interface StackingFilterGroup {
	// Canonical key of the group; empty for the lights without a filter.
	readonly key: string
	// Name shown: the most frequent name written for the key, or Unassigned.
	readonly name: string
	// Every canonical key and every name written that the group holds.
	readonly filterKeys: readonly string[]
	readonly names: readonly string[]
	// Lights, those included with an available file, and those whose file is not available.
	readonly frames: number
	readonly usable: number
	readonly unavailable: number
	// Exposure of the usable lights, in seconds.
	readonly exposure: number
	// Distinct acquisition settings among the usable lights.
	readonly cohorts: number
	// Targets their headers name.
	readonly objects: readonly string[]
	// Key of another group whose name is a known synonym of this one, offered as a merge.
	readonly suggestion?: string
}

// A project with its aliases.
export interface StackingProjectDetail extends StackingProjectSummary {
	readonly aliases: readonly StackingFilterAlias[]
}

// State of a job:
// - scanning: reading headers.
// - completed: found what it could; an import waits for its review.
// - failed, cancelled: ended without candidates.
export type StackingJobState = 'scanning' | 'completed' | 'failed' | 'cancelled'

// What lists and events show of a job: no paths.
export interface StackingJobSummary {
	readonly jobId: string
	// Project it works for.
	readonly projectId: string
	// What it does.
	readonly type: 'import'
	readonly state: StackingJobState
	// When it was requested, and last changed, Unix milliseconds (UTC).
	readonly createdAt: number
	readonly updatedAt: number
	// Files found and their total size, in bytes.
	readonly found: number
	readonly bytes: number
	// Whether the limit on files stopped a scan.
	readonly truncated: boolean
	// Frames that entered the project once committed.
	readonly committed?: number
	// Why it failed, with a stable code.
	readonly error?: string
	readonly code?: ImageStackingErrorCode
}

// File an import found, for review. Paths are shown because the operator chose where to look.
export interface StackingImportCandidate {
	// Absolute path, and its name under the chosen directory.
	readonly path: string
	readonly name: string
	// Size, in bytes, and modification time, Unix milliseconds.
	readonly bytes: number
	readonly mtimeMillis: number
	// Format, when its header was read.
	readonly format?: SourceFormat
	// Role its header gives it in a project.
	readonly role?: StackingRole
	// Why it cannot join a project.
	readonly rejected?: string
	// Filter, target, and start of its exposure, as its header says.
	readonly filter?: string
	readonly object?: string
	readonly observedAt?: number
	// What is known about it.
	readonly metadata?: CalibrationMetadata
	// What should be said about it.
	readonly warnings: readonly string[]
	// Why its header could not be read.
	readonly error?: string
	// Whether the project already holds this file.
	readonly known: boolean
}

// Everything a tab needs to mirror Image Stacking, with no paths.
export interface ImageStackingSnapshot {
	// Id of this process; a new one invalidates everything a tab holds.
	readonly epoch: string
	// Monotonic change counter of this process.
	readonly revision: number
	// Every project, the latest changed first.
	readonly projects: readonly StackingProjectSummary[]
	// Jobs still working, and the latest ended ones.
	readonly jobs: readonly StackingJobSummary[]
}

// Event of Image Stacking.
export type ImageStackingEvent =
	// A project, its frames, or its aliases changed.
	| { readonly type: 'imageStacking:changed'; readonly revision: number; readonly snapshot: ImageStackingSnapshot }
	// A job changed.
	| { readonly type: 'imageStacking:jobUpdated'; readonly epoch: string; readonly revision: number; readonly job: StackingJobSummary }

// Request of an import.
export interface StackingImportRequest {
	// Directories and files of the server to look at.
	readonly paths: readonly string[]
	// Whether directories are entered recursively; true by default.
	readonly recursive?: boolean
}

// Review of an import.
export interface StackingImportCommit {
	// Candidates to add; every usable one when absent.
	readonly paths?: readonly string[]
	// Unclassified candidates an operator declares lights, with the reason.
	readonly lights?: Readonly<Record<string, { readonly reason: string }>>
}

// Change of a frame by an operator.
export interface StackingSourcePatch {
	// Reason to leave it out of stacks, or null to include it again.
	readonly excluded?: string | null
	// Declares an unclassified frame a light.
	readonly light?: { readonly reason: string }
	// Declares the filter of a frame whose header names none.
	readonly filter?: { readonly value: string; readonly reason: string }
}

// A frame with what is only for one who asks: its path, for opening it in Images.
export interface StackingSourceDetail extends StackingSourceSummary {
	readonly path: string
}

// Import job of this process, with what only its review reads.
interface ImportJob extends StackingJobSummary {
	// Directories and files it looks at.
	readonly paths: readonly string[]
	readonly recursive: boolean
	// Files found, with their identities, until committed.
	readonly candidates?: readonly (StackingImportCandidate & { readonly identity: string })[]
}

// Returns what lists and events show of a job.
function jobSummary({ paths: _, recursive: __, candidates: ___, ...summary }: ImportJob): StackingJobSummary {
	return summary
}

// Returns the most frequent value, ties broken by order of first appearance; undefined for none.
function mostFrequent(values: readonly string[]) {
	const counts = new Map<string, number>()
	let best: string | undefined
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
	for (const [value, count] of counts) if (best === undefined || count > counts.get(best)!) best = value
	return best
}

// Groups the lights of a project by filter after its aliases: a frame's group is the target of its key's alias, or its
// key. Usable lights are included and available. Groups are sorted by name, the Unassigned group last.
export function filterGroups(facts: readonly StackingSourceFacts[], aliases: readonly StackingFilterAlias[]): StackingFilterGroup[] {
	const targets = new Map(aliases.map((alias) => [alias.filterKey, alias.targetKey]))
	const groups = new Map<string, StackingSourceFacts[]>()

	for (const fact of facts) {
		if (fact.role !== 'light') continue
		const key = targets.get(fact.filterKey) ?? fact.filterKey
		const members = groups.get(key)
		if (members) members.push(fact)
		else groups.set(key, [fact])
	}

	const result: StackingFilterGroup[] = []

	for (const [key, members] of groups) {
		const usable = members.filter((fact) => !fact.excluded && fact.status === 'available')
		const own = members.filter((fact) => fact.filterKey === key && fact.filterName !== undefined).map((fact) => fact.filterName!)
		const names = [...new Set(members.flatMap((fact) => fact.filterName ?? []))].sort()
		const exposure = usable.reduce((sum, fact) => sum + (fact.exposure ?? 0), 0) / 1000000
		result.push({
			key,
			name: key === '' ? 'Unassigned' : (mostFrequent(own) ?? names[0] ?? key),
			filterKeys: [...new Set(members.map((fact) => fact.filterKey))].sort(),
			names,
			frames: members.length,
			usable: usable.length,
			unavailable: members.filter((fact) => fact.status !== 'available').length,
			exposure,
			cohorts: new Set(usable.map((fact) => fact.cohortKey)).size,
			objects: [...new Set(members.flatMap((fact) => fact.object || []))].sort(),
		})
	}

	for (const group of result) {
		const suggestion = result.find((other) => other.key !== group.key && filterSynonyms(group.key, other.key))
		if (suggestion) Object.assign(group, { suggestion: suggestion.key })
	}

	return result.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.name.localeCompare(b.name)))
}

// Summarizes a project from the facts of its frames.
function projectSummary(project: StackingProject, facts: readonly StackingSourceFacts[], aliases: readonly StackingFilterAlias[]): StackingProjectSummary {
	const groups = filterGroups(facts, aliases)
	const lights = facts.filter((fact) => fact.role === 'light')

	return {
		...project,
		frames: facts.length,
		lights: lights.length,
		unclassified: facts.length - lights.length,
		excluded: facts.filter((fact) => fact.excluded).length,
		unavailable: facts.filter((fact) => fact.status !== 'available').length,
		filters: groups.filter((group) => group.key !== '').length,
		unassigned: groups.find((group) => group.key === '')?.frames ?? 0,
		exposure: groups.reduce((sum, group) => sum + group.exposure, 0),
		objects: [...new Set(lights.flatMap((fact) => fact.object || []))].sort(),
	}
}

// The service. Work waits for the first open, so importing this module touches no file.
export class ImageStacking {
	// Id of this process.
	readonly #epoch = crypto.randomUUID()
	// Change counter.
	#revision = 0
	// First comparison of the frames with the disk.
	#opened?: Promise<void>
	// Jobs of this process, by id.
	readonly #jobs = new Map<string, ImportJob>()
	// Scans running, by job.
	readonly #scans = new Map<string, AbortController>()

	// Creates the service. listener receives every change synchronously; managed lists the directories whose files belong
	// to the application, which an import never reads.
	constructor(
		readonly store: ImageStackingStore,
		readonly listener: (event: ImageStackingEvent) => void,
		readonly managed: readonly string[] = [store.directory],
	) {}

	// Compares the frames with the disk once. A failure leaves the next request to try again.
	ready() {
		this.#opened ??= this.#refreshFiles().then(
			() => this.#changed(),
			(error: unknown) => {
				this.#opened = undefined
				throw error
			},
		)
		return this.#opened
	}

	// Builds the snapshot.
	snapshot(): ImageStackingSnapshot {
		const projects = this.store.projects().map((project) => projectSummary(project, this.store.facts(project.projectId), this.store.aliases(project.projectId)))
		const jobs = [...this.#jobs.values()].toSorted((a, b) => b.createdAt - a.createdAt).map(jobSummary)
		return { epoch: this.#epoch, revision: this.#revision, projects, jobs }
	}

	// Publishes a change of the projects.
	#changed() {
		const revision = ++this.#revision
		this.listener({ type: 'imageStacking:changed', revision, snapshot: this.snapshot() })
	}

	// Saves a job, keeps only the latest ended ones, and publishes it.
	#saveJob(job: ImportJob, patch: Partial<ImportJob> = {}) {
		const next: ImportJob = { ...job, ...patch, updatedAt: Date.now() }
		this.#jobs.set(next.jobId, next)

		const ended = [...this.#jobs.values()].filter((other) => other.state !== 'scanning').toSorted((a, b) => b.updatedAt - a.updatedAt)
		for (const old of ended.slice(KEPT_JOBS)) this.#jobs.delete(old.jobId)

		this.listener({ type: 'imageStacking:jobUpdated', epoch: this.#epoch, revision: ++this.#revision, job: jobSummary(next) })
		return next
	}

	// Returns a project. Throws when unknown.
	#project(projectId: string) {
		const project = this.store.project(projectId)
		if (!project) throw new StackingError('Unknown project', 404, 'notFound')
		return project
	}

	// Returns a frame. Throws when unknown.
	#source(sourceId: string) {
		const source = this.store.source(sourceId)
		if (!source) throw new StackingError('Unknown frame', 404, 'notFound')
		return source
	}

	// Returns a job. Throws when unknown.
	#job(jobId: string) {
		const job = this.#jobs.get(jobId)
		if (!job) throw new StackingError('Unknown job', 404, 'notFound')
		return job
	}

	// Lists every project.
	async projects() {
		await this.ready()
		return this.snapshot().projects
	}

	// Returns a project with its aliases. Throws when unknown.
	async project(projectId: string): Promise<StackingProjectDetail> {
		await this.ready()
		const project = this.#project(projectId)
		const aliases = this.store.aliases(projectId)
		return { ...projectSummary(project, this.store.facts(projectId), aliases), aliases }
	}

	// Creates an empty project.
	async createProject({ name }: { readonly name: string }) {
		await this.ready()
		const now = Date.now()
		const project: StackingProject = { projectId: crypto.randomUUID(), name: name.trim(), revision: 1, createdAt: now, updatedAt: now }
		this.store.putProject(project)
		this.#changed()
		return this.project(project.projectId)
	}

	// Renames a project from the revision it was edited from. Throws 409 with the current project when another edit came first.
	async updateProject(projectId: string, { name, revision }: { readonly name: string; readonly revision: number }) {
		await this.ready()
		const project = this.#project(projectId)
		if (project.revision !== revision) throw new StackingError('The project changed meanwhile', 409, 'conflict')
		this.store.putProject({ ...project, name: name.trim(), revision: revision + 1, updatedAt: Date.now() })
		this.#changed()
		return this.project(projectId)
	}

	// Deletes a project and stops its scans; its frames stay on the disk.
	async deleteProject(projectId: string) {
		await this.ready()
		this.#project(projectId)

		for (const job of this.#jobs.values()) {
			if (job.projectId === projectId) this.#scans.get(job.jobId)?.abort(new DOMException('Project deleted', 'AbortError'))
		}

		this.store.deleteProject(projectId)
		this.#changed()
		return { deleted: projectId }
	}

	// Lists frames of a project; `group`, when given, is the key of one filter group.
	async frames(projectId: string, filter: Omit<StackingSourceFilter, 'filterKeys'> & { readonly group?: string }, offset: number, limit: number): Promise<Page<StackingSourceSummary>> {
		await this.ready()
		this.#project(projectId)
		const { group, ...rest } = filter
		const filterKeys = group === undefined ? undefined : this.#groupKeys(projectId, group)
		const { items, total } = this.store.sources(projectId, { ...rest, filterKeys }, offset, limit)
		return { items: items.map(stackingSourceSummary), total }
	}

	// Returns the canonical keys of a filter group: its key, unless merged elsewhere, and the keys merged into it.
	#groupKeys(projectId: string, group: string) {
		const aliases = this.store.aliases(projectId)
		const keys = aliases.filter((alias) => alias.targetKey === group).map((alias) => alias.filterKey)
		if (!aliases.some((alias) => alias.filterKey === group)) keys.push(group)
		return keys
	}

	// Returns a frame with its path. Throws when unknown.
	async frame(sourceId: string): Promise<StackingSourceDetail> {
		await this.ready()
		const source = this.#source(sourceId)
		return { ...stackingSourceSummary(source), path: source.path }
	}

	// Changes what an operator decides about a frame: its exclusion, its role, or its filter when its header names none.
	// Declarations are recorded among its warnings, and never written to its file.
	async updateFrame(sourceId: string, patch: StackingSourcePatch) {
		await this.ready()
		const source = this.#source(sourceId)
		let next: StackingSource = source

		if (patch.excluded !== undefined) {
			const { excluded: _, ...rest } = next
			next = patch.excluded === null ? rest : { ...rest, excluded: patch.excluded }
		}

		if (patch.light) {
			if (next.role === 'light') throw new StackingError('This frame is already a light', 409, 'conflict')
			next = { ...next, role: 'light', warnings: [...next.warnings, `Declared a light by an operator: ${patch.light.reason}`] }
		}

		if (patch.filter) {
			if (next.metadata.filter.evidence !== 'unknown') throw new StackingError('Only a filter the header does not name can be declared', 409, 'verifiedMetadata')
			const metadata = { ...next.metadata, filter: { value: patch.filter.value.trim(), evidence: 'operatorDeclared' as const } }
			next = { ...next, metadata, filterKey: filterKeyOf(metadata.filter.value), warnings: [...next.warnings, `Filter declared by an operator: ${patch.filter.reason}`] }
		}

		this.store.putSources(source.projectId, [next], Date.now())
		this.#changed()
		return this.frame(sourceId)
	}

	// Takes a frame out of its project; its file stays where it is.
	async removeFrame(sourceId: string) {
		await this.ready()
		const source = this.#source(sourceId)
		this.store.removeSource(source.projectId, sourceId, Date.now())
		this.#changed()
		return { removed: sourceId }
	}

	// Lists the filter groups of a project.
	async groups(projectId: string) {
		await this.ready()
		this.#project(projectId)
		return filterGroups(this.store.facts(projectId), this.store.aliases(projectId))
	}

	// Merges the lights of a filter key into the group of another. Both keys must name lights of the project; a target
	// already merged elsewhere is followed to its group, and keys merged into the merged key follow it, so no alias
	// ever points to a merged key.
	async setAlias(projectId: string, { filterKey, targetKey }: StackingFilterAlias) {
		await this.ready()
		this.#project(projectId)
		const keys = new Set(this.store.facts(projectId).flatMap((fact) => (fact.role === 'light' ? fact.filterKey : [])))
		if (filterKey === '' || targetKey === '' || !keys.has(filterKey) || !keys.has(targetKey)) throw new StackingError('Both filters must name lights of this project', 409, 'invalidAlias')

		const aliases = this.store.aliases(projectId)
		const root = aliases.find((alias) => alias.filterKey === targetKey)?.targetKey ?? targetKey
		if (root === filterKey) throw new StackingError('A filter cannot be merged into itself', 409, 'invalidAlias')

		const next: StackingFilterAlias[] = [{ filterKey, targetKey: root }]
		for (const alias of aliases) if (alias.filterKey !== filterKey) next.push({ filterKey: alias.filterKey, targetKey: alias.targetKey === filterKey ? root : alias.targetKey })
		this.store.setAliases(projectId, next, Date.now())
		this.#changed()
		return this.groups(projectId)
	}

	// Separates a merged filter key again.
	async removeAlias(projectId: string, filterKey: string) {
		await this.ready()
		this.#project(projectId)
		const aliases = this.store.aliases(projectId)
		this.store.setAliases(
			projectId,
			aliases.filter((alias) => alias.filterKey !== filterKey),
			Date.now(),
		)
		this.#changed()
		return this.groups(projectId)
	}

	// Compares the frames of a project, or of every project, with the disk.
	async refresh(projectId?: string) {
		await this.ready()
		if (projectId !== undefined) this.#project(projectId)
		await this.#refreshFiles(projectId)
		this.#changed()
		return this.snapshot()
	}

	// Marks each frame available, missing, or changed by the size and modification time of its file; an unreadable
	// header stays corrupt.
	async #refreshFiles(projectId?: string) {
		const sources = this.store.sourcesOf(projectId)
		const changed = new Map<string, StackingSource[]>()
		let next = 0

		const check = async () => {
			for (let index = next++; index < sources.length; index = next++) {
				const source = sources[index]
				if (source.status === 'corrupt') continue
				const info = await stat(source.path).catch(() => undefined)
				const status: SourceStatus = !info ? 'missing' : info.size === source.bytes && info.mtimeMs === source.mtimeMillis ? 'available' : 'changed'
				if (status === source.status) continue
				const list = changed.get(source.projectId)
				const updated = { ...source, status }
				if (list) list.push(updated)
				else changed.set(source.projectId, [updated])
			}
		}

		await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, check))
		const now = Date.now()
		for (const [project, list] of changed) this.store.putSources(project, list, now)
	}

	// Starts looking at directories and files of the server for a project. The scan keeps running after this returns,
	// reports through its job, and leaves candidates to review. Throws when a path is missing or managed by the application.
	async startImport(projectId: string, { paths, recursive = true }: StackingImportRequest) {
		await this.ready()
		this.#project(projectId)

		for (const path of paths) {
			if (isWithin(path, this.managed)) throw new StackingError('This directory holds files of Nebulosa, not frames to stack', 400, 'managedPath')
			if (!(await stat(path).catch(() => undefined))) throw new StackingError(`${basename(path)} cannot be read`, 404, 'notFound')
		}

		const now = Date.now()
		const job = this.#saveJob({ jobId: crypto.randomUUID(), projectId, type: 'import', state: 'scanning', createdAt: now, updatedAt: now, found: 0, bytes: 0, truncated: false, paths, recursive })
		const controller = new AbortController()
		this.#scans.set(job.jobId, controller)
		void this.#scan(job, controller.signal)
		return jobSummary(job)
	}

	// Runs a scan to its end; a failure ends in its job.
	async #scan(job: ImportJob, signal: AbortSignal) {
		let current = job
		let reported = 0
		const candidates: (StackingImportCandidate & { readonly identity: string })[] = []
		const seen = new Set<string>()
		let truncated = false
		let found = 0
		let bytes = 0

		// Adds a file once, whichever path found it first.
		const add = (root: string, path: string, size: number, mtimeMillis: number, identity: string, inspection?: FileInspection, error?: string) => {
			if (seen.has(identity)) return
			seen.add(identity)
			candidates.push(this.#candidate(job.projectId, root, path, size, mtimeMillis, identity, inspection, error))
		}

		try {
			for (const root of job.paths) {
				const info = await stat(root)

				if (info.isDirectory()) {
					const scan = await scanDirectory({
						path: root,
						recursive: job.recursive,
						signal,
						progress: (files, size) => {
							if (found + files - reported < PROGRESS_STEP) return
							reported = found + files
							current = this.#saveJob(current, { found: found + files, bytes: bytes + size })
						},
					})

					truncated ||= scan.truncated
					for (const candidate of scan.candidates) add(root, candidate.path, candidate.bytes, candidate.mtimeMillis, candidate.identity, candidate.inspection, candidate.error)
				} else {
					signal.throwIfAborted()
					const identity = await fileIdentity(root, info)
					const inspection = await inspectFile(root).catch((error: unknown) => (Error.isError(error) ? error.message : String(error)))
					if (typeof inspection === 'string') add(root, root, info.size, info.mtimeMs, identity, undefined, inspection)
					else add(root, root, info.size, info.mtimeMs, identity, inspection, inspection ? undefined : 'The file holds no image')
				}

				found = candidates.length
				bytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0)
			}

			this.#saveJob(current, { state: 'completed', found, bytes, truncated, candidates })
		} catch (error) {
			if (signal.aborted) this.#saveJob(current, { state: 'cancelled' })
			else this.#saveJob(current, { state: 'failed', code: 'processingFailed', error: `The files could not be read (${errorCode(error) ?? 'unexpected error'})` })
		} finally {
			this.#scans.delete(job.jobId)
		}
	}

	// Describes a file found for review: its role in a project, or why it cannot join one.
	#candidate(projectId: string, root: string, path: string, bytes: number, mtimeMillis: number, identity: string, inspection?: FileInspection, error?: string) {
		const name = path === root ? basename(path) : relative(root, path)
		const known = this.store.hasIdentity(projectId, identity)
		const base = { path, name, bytes, mtimeMillis, identity, known, warnings: inspection?.warnings ?? [] }
		if (!inspection) return { ...base, error: error ?? 'The header could not be read' }

		const outcome = lightRoleOf(inspection)
		const managed = isWithin(path, this.managed)
		const rejected = managed ? 'A file of Nebulosa, not a frame to stack' : 'rejected' in outcome ? outcome.rejected : inspection.metadata.bitpix === 64 ? 'Frames with BITPIX 64 are not supported' : undefined
		return {
			...base,
			format: inspection.format,
			...('role' in outcome && { role: outcome.role }),
			...(rejected !== undefined && { rejected }),
			...(inspection.metadata.filter.value !== undefined && { filter: inspection.metadata.filter.value }),
			...(inspection.object !== undefined && { object: inspection.object }),
			...(inspection.observedAt !== undefined && Number.isFinite(inspection.observedAt) && { observedAt: inspection.observedAt }),
			metadata: inspection.metadata,
		}
	}

	// Returns a job.
	async job(jobId: string) {
		await this.ready()
		return jobSummary(this.#job(jobId))
	}

	// Lists what an import found.
	importCandidates(jobId: string, offset: number, limit: number): Page<StackingImportCandidate> {
		const candidates = this.#job(jobId).candidates ?? []
		const items: StackingImportCandidate[] = []

		for (const { identity: _, ...candidate } of candidates.slice(offset, offset + Math.min(limit, MAX_PAGE_SIZE))) items.push(candidate)

		return { items, total: candidates.length }
	}

	// Cancels the scan of an import. Throws when it already ended.
	cancelImport(jobId: string) {
		const job = this.#job(jobId)
		const scan = this.#scans.get(jobId)
		if (!scan) throw new StackingError('This import has ended', 409, 'jobConflict')
		scan.abort(new DOMException('Cancelled', 'AbortError'))
		return jobSummary(job)
	}

	// Adds reviewed files to the project of an import: lights, and unclassified files either declared lights with a
	// reason or kept unclassified for later. Rejected, unreadable, and already known files stay out. Returns how many
	// frames entered.
	async commitImport(jobId: string, { paths, lights = {} }: StackingImportCommit) {
		await this.ready()
		const job = this.#job(jobId)
		if (job.state !== 'completed' || job.committed !== undefined) throw new StackingError('This import cannot be committed', 409, 'jobConflict')
		this.#project(job.projectId)

		const chosen = paths && new Set(paths)
		const sources: StackingSource[] = []
		const identities = new Set<string>()

		for (const candidate of job.candidates ?? []) {
			if (chosen && !chosen.has(candidate.path)) continue
			if (candidate.error !== undefined || candidate.rejected !== undefined || candidate.role === undefined || !candidate.metadata || !candidate.format) continue
			if (identities.has(candidate.identity) || this.store.hasIdentity(job.projectId, candidate.identity)) continue
			identities.add(candidate.identity)

			const declared = candidate.role === 'unclassified' ? lights[candidate.path] : undefined
			const warnings = declared ? [...candidate.warnings, `Declared a light by an operator: ${declared.reason}`] : candidate.warnings

			sources.push({
				sourceId: stackingSourceId(job.projectId, candidate.path),
				projectId: job.projectId,
				path: candidate.path,
				format: candidate.format,
				identity: candidate.identity,
				bytes: candidate.bytes,
				mtimeMillis: candidate.mtimeMillis,
				status: 'available',
				role: declared ? 'light' : candidate.role,
				filterKey: filterKeyOf(candidate.metadata.filter.value),
				cohortKey: cohortKeyOf(candidate.metadata),
				...(candidate.object !== undefined && { object: candidate.object }),
				...(candidate.observedAt !== undefined && { observedAt: candidate.observedAt }),
				metadata: candidate.metadata,
				warnings,
			})
		}

		this.store.putSources(job.projectId, sources, Date.now())
		this.#saveJob(job, { candidates: undefined, committed: sources.length })
		this.#changed()
		return { committed: sources.length }
	}
}

// Answers a failure of a route with its status and code.
function failure(error: unknown) {
	if (error instanceof StackingError) return errorResponse(error.message, error.status, error.code)
	return errorResponse(Error.isError(error) ? error.message : String(error), 500, 'processingFailed')
}

// Runs a handler, answering its result as JSON.
async function answer(handler: () => unknown, status = 200) {
	try {
		return Response.json(await handler(), { status })
	} catch (error) {
		return failure(error)
	}
}

// Reads a page of a query string.
function pageOf(request: Request) {
	const { searchParams } = new URL(request.url)
	return { searchParams, offset: Number(searchParams.get('offset')) || 0, limit: Number(searchParams.get('limit')) || DEFAULT_PAGE_SIZE }
}

// Routes of Image Stacking. None of them needs a connection or touches a device.
export function createImageStackingRoutes(stacking: ImageStacking) {
	return {
		'/api/image-stacking': {
			GET: () =>
				answer(async () => {
					await stacking.ready()
					return stacking.snapshot()
				}),
		},
		'/api/image-stacking/refresh': {
			POST: () => answer(() => stacking.refresh()),
		},
		'/api/image-stacking/projects': {
			GET: () => answer(() => stacking.projects()),
			POST: async (request) => {
				const body = (await request.json()) as { readonly name: string }
				return answer(() => stacking.createProject(body), 201)
			},
		},
		'/api/image-stacking/projects/:projectId': {
			GET: ({ params }) => answer(() => stacking.project(params.projectId)),
			PATCH: async (request) => {
				const body = (await request.json()) as { readonly name: string; readonly revision: number }
				return answer(() => stacking.updateProject(request.params.projectId, body))
			},
			DELETE: ({ params }) => answer(() => stacking.deleteProject(params.projectId)),
		},
		'/api/image-stacking/projects/:projectId/refresh': {
			POST: ({ params }) => answer(() => stacking.refresh(params.projectId)),
		},
		'/api/image-stacking/projects/:projectId/imports': {
			POST: async (request) => {
				const body = (await request.json()) as StackingImportRequest
				return answer(() => stacking.startImport(request.params.projectId, body), 202)
			},
		},
		'/api/image-stacking/projects/:projectId/frames': {
			GET: (request) => {
				const { searchParams, offset, limit } = pageOf(request)
				const included = searchParams.get('included')
				const filter = {
					group: searchParams.get('group') ?? undefined,
					role: (searchParams.get('role') as StackingRole | null) ?? undefined,
					status: (searchParams.get('status') as SourceStatus | null) ?? undefined,
					included: included === null ? undefined : included === 'true',
					search: searchParams.get('search') || undefined,
				}
				return answer(() => stacking.frames(request.params.projectId, filter, offset, limit))
			},
		},
		'/api/image-stacking/projects/:projectId/groups': {
			GET: ({ params }) => answer(() => stacking.groups(params.projectId)),
		},
		'/api/image-stacking/projects/:projectId/aliases': {
			POST: async (request) => {
				const body = (await request.json()) as StackingFilterAlias
				return answer(() => stacking.setAlias(request.params.projectId, body))
			},
		},
		'/api/image-stacking/projects/:projectId/aliases/:filterKey': {
			DELETE: ({ params }) => answer(() => stacking.removeAlias(params.projectId, params.filterKey)),
		},
		'/api/image-stacking/frames/:sourceId': {
			GET: ({ params }) => answer(() => stacking.frame(params.sourceId)),
			PATCH: async (request) => {
				const body = (await request.json()) as StackingSourcePatch
				return answer(() => stacking.updateFrame(request.params.sourceId, body))
			},
			DELETE: ({ params }) => answer(() => stacking.removeFrame(params.sourceId)),
		},
		'/api/image-stacking/imports/:jobId': {
			GET: ({ params }) => answer(() => stacking.job(params.jobId)),
		},
		'/api/image-stacking/imports/:jobId/candidates': {
			GET: (request) => {
				const { offset, limit } = pageOf(request)
				return answer(() => stacking.importCandidates(request.params.jobId, offset, limit))
			},
		},
		'/api/image-stacking/imports/:jobId/cancel': {
			POST: ({ params }) => answer(() => stacking.cancelImport(params.jobId)),
		},
		'/api/image-stacking/imports/:jobId/commit': {
			POST: async (request) => {
				const body = (await request.json()) as StackingImportCommit
				return answer(() => stacking.commitImport(request.params.jobId, body))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
