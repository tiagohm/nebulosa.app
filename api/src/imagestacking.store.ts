import { join } from 'path'
import type { CalibrationMetadata } from './calibrationlibrary.compatibility'
import { fileNameOf, MAX_PAGE_SIZE, type Page, type SourceFormat, type SourceStatus } from './calibrationlibrary.store'
import { type AppDatabase, DEFAULT_DATA_DIRECTORY } from './database'
import type { StackingRole } from './imagestacking.sources'

// Persistence of Image Stacking. Projects, the light frames chosen for them with what an operator declared about each,
// and the filter aliases of a project are rows of the operational database; the frames themselves stay where they are.
// Filter groups are not stored: a group is the frames whose canonical filter key, after the aliases of the project, is
// equal. Every read and write is synchronous and short.

// Default directory of the products and staging of Image Stacking, which an import never reads.
export const DEFAULT_IMAGE_STACKING_DIRECTORY = join(DEFAULT_DATA_DIRECTORY, 'image-stacking')

// A project.
export interface StackingProject {
	// Id of the project.
	readonly projectId: string
	// Name an operator gave it.
	readonly name: string
	// Revision of its header, increased by every rename.
	readonly revision: number
	// When it was created and last changed, Unix milliseconds (UTC).
	readonly createdAt: number
	readonly updatedAt: number
}

// Light frame of a project.
export interface StackingSource {
	// Stable id, derived from its project and path.
	readonly sourceId: string
	// Project it belongs to.
	readonly projectId: string
	// Absolute path; never published in an event or a list.
	readonly path: string
	// Format.
	readonly format: SourceFormat
	// Identity of its file, the same for every name of it.
	readonly identity: string
	// Size, in bytes.
	readonly bytes: number
	// Modification time, Unix milliseconds.
	readonly mtimeMillis: number
	// SHA-256 of the file, once a job has read it at this size and time.
	readonly digest?: string
	// State of its file.
	readonly status: SourceStatus
	// Role.
	readonly role: StackingRole
	// Canonical key of its filter before the aliases of the project; empty when unknown.
	readonly filterKey: string
	// Key of its acquisition settings.
	readonly cohortKey: string
	// Target named by its header.
	readonly object?: string
	// Start of its exposure, Unix milliseconds (UTC).
	readonly observedAt?: number
	// Why an operator left it out of stacks; absent when included.
	readonly excluded?: string
	// What is known about it.
	readonly metadata: CalibrationMetadata
	// What should be said about it.
	readonly warnings: readonly string[]
}

// What lists show of a frame: its file name instead of its path.
export type StackingSourceSummary = Omit<StackingSource, 'path' | 'identity'> & { readonly name: string }

// Filters of a list of frames of a project.
export interface StackingSourceFilter {
	// Canonical keys of one filter group, after aliases; the empty key is the frames without a filter.
	readonly filterKeys?: readonly string[]
	// Role.
	readonly role?: StackingRole
	// State of the file.
	readonly status?: SourceStatus
	// Whether only included, or only excluded, frames.
	readonly included?: boolean
	// Text of a file name.
	readonly search?: string
}

// What a filter group is computed from, for one frame.
export interface StackingSourceFacts {
	readonly role: StackingRole
	readonly status: SourceStatus
	readonly filterKey: string
	readonly filterName?: string
	readonly cohortKey: string
	readonly object: string
	// Exposure, in integer microseconds; absent when unknown.
	readonly exposure?: number
	readonly excluded: boolean
}

// A merge of a filter key into the group of another, in a project.
export interface StackingFilterAlias {
	readonly filterKey: string
	readonly targetKey: string
}

// Removes the server path and identity of a frame.
export function stackingSourceSummary({ path, identity: _, ...source }: StackingSource): StackingSourceSummary {
	return { ...source, name: fileNameOf(path) }
}

// Row of stack_projects.
interface ProjectRow {
	readonly project_id: string
	readonly name: string
	readonly revision: number
	readonly created_at: number
	readonly updated_at: number
}

// Row of stack_sources.
interface SourceRow {
	readonly source_id: string
	readonly project_id: string
	readonly path: string
	readonly format: SourceFormat
	readonly identity: string
	readonly bytes: number
	readonly mtime_ms: number
	readonly digest: string | null
	readonly status: SourceStatus
	readonly role: StackingRole
	readonly filter_key: string
	readonly cohort_key: string
	readonly object: string
	readonly observed_at: number | null
	readonly excluded_reason: string | null
	readonly metadata: string
	readonly warnings: string
}

// Columns of stack_sources read into a StackingSource.
const SOURCE_COLUMNS = 'source_id, project_id, path, format, identity, bytes, mtime_ms, digest, status, role, filter_key, cohort_key, object, observed_at, excluded_reason, metadata, warnings'

// Returns the project of a row.
function rowProject(row: ProjectRow): StackingProject {
	return { projectId: row.project_id, name: row.name, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }
}

// Returns the frame of a row.
function rowSource(row: SourceRow): StackingSource {
	return {
		sourceId: row.source_id,
		projectId: row.project_id,
		path: row.path,
		format: row.format,
		identity: row.identity,
		bytes: row.bytes,
		mtimeMillis: row.mtime_ms,
		...(row.digest !== null && { digest: row.digest }),
		status: row.status,
		role: row.role,
		filterKey: row.filter_key,
		cohortKey: row.cohort_key,
		...(row.object !== '' && { object: row.object }),
		...(row.observed_at !== null && { observedAt: row.observed_at }),
		...(row.excluded_reason !== null && { excluded: row.excluded_reason }),
		metadata: JSON.parse(row.metadata) as CalibrationMetadata,
		warnings: JSON.parse(row.warnings) as string[],
	}
}

// Builds the WHERE clause of a list of frames of a project.
function sourceWhere(projectId: string, filter: StackingSourceFilter) {
	const clauses = ['project_id = ?']
	const values: (string | number)[] = [projectId]

	if (filter.filterKeys !== undefined) {
		clauses.push(`role = 'light' AND filter_key IN (${filter.filterKeys.map(() => '?').join(', ') || "''"})`)
		values.push(...filter.filterKeys)
	}

	if (filter.role !== undefined) {
		clauses.push('role = ?')
		values.push(filter.role)
	}

	if (filter.status !== undefined) {
		clauses.push('status = ?')
		values.push(filter.status)
	}

	if (filter.included !== undefined) clauses.push(filter.included ? 'excluded_reason IS NULL' : 'excluded_reason IS NOT NULL')

	if (filter.search !== undefined) {
		clauses.push("name LIKE ? ESCAPE '\\'")
		values.push(`%${filter.search.toLowerCase().replaceAll(/[\\%_]/g, (match) => `\\${match}`)}%`)
	}

	return { where: `WHERE ${clauses.join(' AND ')}`, values }
}

// Projects and their frames in the operational database.
export class ImageStackingStore {
	// Creates the store of the rows of database and the files under directory.
	constructor(
		readonly database: AppDatabase,
		readonly directory: string = DEFAULT_IMAGE_STACKING_DIRECTORY,
	) {}

	// Lists every project, the latest changed first.
	projects() {
		return this.database.db.query<ProjectRow, []>('SELECT project_id, name, revision, created_at, updated_at FROM stack_projects ORDER BY updated_at DESC, project_id').all().map(rowProject)
	}

	// Returns a project.
	project(projectId: string) {
		const row = this.database.db.query<ProjectRow, [string]>('SELECT project_id, name, revision, created_at, updated_at FROM stack_projects WHERE project_id = ?').get(projectId)
		return row ? rowProject(row) : undefined
	}

	// Writes a project.
	putProject(project: StackingProject) {
		this.database.write(() => {
			this.database.db.query('INSERT OR REPLACE INTO stack_projects (project_id, name, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(project.projectId, project.name, project.revision, project.createdAt, project.updatedAt)
		})
	}

	// Deletes a project with its frames and aliases, never their files.
	deleteProject(projectId: string) {
		this.database.write(() => {
			this.database.db.query('DELETE FROM stack_projects WHERE project_id = ?').run(projectId)
		})
	}

	// Writes frames and marks their project changed at `now`, in one transaction.
	putSources(projectId: string, sources: readonly StackingSource[], now: number) {
		this.database.write(() => {
			const statement = this.database.db.query(`INSERT OR REPLACE INTO stack_sources (${SOURCE_COLUMNS}, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

			for (const source of sources) {
				statement.run(
					source.sourceId,
					source.projectId,
					source.path,
					source.format,
					source.identity,
					source.bytes,
					source.mtimeMillis,
					source.digest ?? null,
					source.status,
					source.role,
					source.filterKey,
					source.cohortKey,
					source.object ?? '',
					source.observedAt ?? null,
					source.excluded ?? null,
					JSON.stringify(source.metadata),
					JSON.stringify(source.warnings),
					fileNameOf(source.path).toLowerCase(),
				)
			}

			this.#touch(projectId, now)
		})
	}

	// Forgets a frame of a project, never its file.
	removeSource(projectId: string, sourceId: string, now: number) {
		this.database.write(() => {
			this.database.db.query('DELETE FROM stack_sources WHERE source_id = ?').run(sourceId)
			this.#touch(projectId, now)
		})
	}

	// Returns a frame.
	source(sourceId: string) {
		const row = this.database.db.query<SourceRow, [string]>(`SELECT ${SOURCE_COLUMNS} FROM stack_sources WHERE source_id = ?`).get(sourceId)
		return row ? rowSource(row) : undefined
	}

	// Returns whether a project already holds a file, by its identity.
	hasIdentity(projectId: string, identity: string) {
		return this.database.db.query<{ found: number }, [string, string]>('SELECT 1 AS found FROM stack_sources WHERE project_id = ? AND identity = ?').get(projectId, identity) !== null
	}

	// Lists every frame of a project, or of every project, for refreshes.
	sourcesOf(projectId?: string) {
		const { db } = this.database
		const rows = projectId === undefined ? db.query<SourceRow, []>(`SELECT ${SOURCE_COLUMNS} FROM stack_sources`).all() : db.query<SourceRow, [string]>(`SELECT ${SOURCE_COLUMNS} FROM stack_sources WHERE project_id = ?`).all(projectId)
		return rows.map(rowSource)
	}

	// Lists frames of a project by file name within a filter, by page.
	sources(projectId: string, filter: StackingSourceFilter, offset: number, limit: number): Page<StackingSource> {
		const { where, values } = sourceWhere(projectId, filter)
		const { db } = this.database
		const { total } = db.query<{ total: number }, (string | number)[]>(`SELECT COUNT(*) AS total FROM stack_sources ${where}`).get(...values)!
		const rows = db.query<SourceRow, (string | number)[]>(`SELECT ${SOURCE_COLUMNS} FROM stack_sources ${where} ORDER BY name, source_id LIMIT ? OFFSET ?`).all(...values, Math.min(limit, MAX_PAGE_SIZE), offset)
		return { items: rows.map(rowSource), total }
	}

	// Lists what filter groups and project counts are computed from, for every frame of a project.
	facts(projectId: string): StackingSourceFacts[] {
		const rows = this.database.db
			.query<{ role: StackingRole; status: SourceStatus; filter_key: string; filter_name: string | null; cohort_key: string; object: string; exposure: number | null; excluded: number }, [string]>(
				"SELECT role, status, filter_key, json_extract(metadata, '$.filter.value') AS filter_name, cohort_key, object, json_extract(metadata, '$.exposure.value') AS exposure, excluded_reason IS NOT NULL AS excluded FROM stack_sources WHERE project_id = ?",
			)
			.all(projectId)

		return rows.map((row) => ({ role: row.role, status: row.status, filterKey: row.filter_key, filterName: row.filter_name ?? undefined, cohortKey: row.cohort_key, object: row.object, exposure: row.exposure ?? undefined, excluded: row.excluded === 1 }))
	}

	// Lists the filter aliases of a project.
	aliases(projectId: string): StackingFilterAlias[] {
		return this.database.db
			.query<{ filter_key: string; target_key: string }, [string]>('SELECT filter_key, target_key FROM stack_filter_aliases WHERE project_id = ? ORDER BY filter_key')
			.all(projectId)
			.map((row) => ({ filterKey: row.filter_key, targetKey: row.target_key }))
	}

	// Replaces the aliases of a project in one transaction.
	setAliases(projectId: string, aliases: readonly StackingFilterAlias[], now: number) {
		this.database.write(() => {
			const { db } = this.database
			db.query('DELETE FROM stack_filter_aliases WHERE project_id = ?').run(projectId)
			const statement = db.query('INSERT INTO stack_filter_aliases (project_id, filter_key, target_key) VALUES (?, ?, ?)')
			for (const alias of aliases) statement.run(projectId, alias.filterKey, alias.targetKey)
			this.#touch(projectId, now)
		})
	}

	// Marks a project changed, in the transaction of the caller.
	#touch(projectId: string, now: number) {
		this.database.db.query('UPDATE stack_projects SET updated_at = ? WHERE project_id = ?').run(now, projectId)
	}
}
