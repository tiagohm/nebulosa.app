import { readdir, rm } from 'fs/promises'
import { join } from 'path'
import type { ChannelMix, CompositionCounters, LuminanceMatch, LuminanceMatchMode } from 'nebulosa/src/imaging/processing/channel.composition'
import type { GlobalNormalizationMode } from 'nebulosa/src/imaging/processing/normalization'
import type { ImageInterpolationMode, ImageRegistrationTransform } from 'nebulosa/src/imaging/processing/registration'
import type { StackingCombinationMethod, StackingWeightingMode } from 'nebulosa/src/imaging/processing/stacker'
import type { SubframeQualityMetrics, SubframeSelectionOptions } from 'nebulosa/src/imaging/processing/subframe.selector'
import type { HeaderMetadata, MasterReference } from './calibrationlibrary.compatibility'
import { fileNameOf, MAX_PAGE_SIZE, type Page, type SourceFormat, type SourceStatus } from './calibrationlibrary.store'
import { type AppDatabase, DEFAULT_DATA_DIRECTORY } from './database'
import type { StackingRole } from './imagestacking.sources'

// Persistence of Image Stacking. Projects with the choices of an operator, the light frames chosen for them with what an
// operator declared and what the latest analysis measured about each, and the calibration decision of each cohort are rows
// of the operational database; the frames themselves stay where they are. Filter groups are not stored: a group is the
// frames whose filter is equal. The
// products the integrations published are rows too, and each product is a directory of products/ under the directory of Image
// Stacking, next to composites/ (the color composites mixed from them), staging/ (the work of a running integration or
// composition), and orphaned/ (directories found without a row). Every read and write of a row is synchronous and short.

// Default directory of the products and staging of Image Stacking, which an import never reads.
export const DEFAULT_IMAGE_STACKING_DIRECTORY = join(DEFAULT_DATA_DIRECTORY, 'image-stacking')

// Choices of an operator about a project.
export interface StackingSettings {
	// Key of the filter group whose reference is the project reference; absent for the automatic choice.
	readonly referenceGroup?: string
	// Reference frame of each filter group, by group key; a group absent here takes the best frame.
	readonly references: Readonly<Record<string, string>>
	// Quality thresholds of the selection; a frame failing one is left out of integration, never deleted.
	readonly selection: Pick<SubframeSelectionOptions, 'minStars' | 'minMedianSNR' | 'maxMedianHFD' | 'maxMedianEccentricity' | 'maxBackground'>
}

// Settings of a new project: automatic references and no threshold.
export const DEFAULT_STACKING_SETTINGS: StackingSettings = { references: {}, selection: {} }

// Outcome of a star registration: the transform from a frame onto its reference, or why there is none.
export type StackingRegistration = { readonly success: true; readonly transform: ImageRegistrationTransform } | { readonly success: false; readonly reason: string }

// A star kept for registration, in pixels of its frame (zero-based centers, x right, y down).
export interface StackingStar {
	readonly x: number
	readonly y: number
	// Flux, in normalized units, and half-flux diameter, in pixels.
	readonly flux: number
	readonly hfd: number
	// Signal-to-noise ratio.
	readonly snr: number
}

// What the latest analysis measured of one frame.
export interface StackingFrameAnalysis {
	// Identity of the inputs measured: the file at its size and time, and the calibration of its cohort.
	readonly fingerprint: string
	// When it was measured, Unix milliseconds (UTC).
	readonly analyzedAt: number
	// SHA-256 of the file as it was read.
	readonly digest?: string
	// Quality of the calibrated frame.
	readonly quality?: SubframeQualityMetrics
	// Brightest stars, at most ANALYSIS_STARS.
	readonly stars?: readonly StackingStar[]
	// Why it could not be measured.
	readonly error?: string
	// Transform onto the reference frame of its group, from the latest registration.
	readonly registration?: StackingRegistration
}

// Outcome of the latest registration of a project.
export interface StackingProjectAnalysis {
	// When it ended, Unix milliseconds (UTC).
	readonly analyzedAt: number
	// Group whose reference is the project reference, and that frame.
	readonly referenceGroup?: string
	readonly referenceSourceId?: string
	// Reference frame of each group, and the transform of that frame onto the project reference, by group key.
	readonly groups: Readonly<Record<string, { readonly referenceSourceId?: string; readonly toProject?: StackingRegistration }>>
}

// Masters chosen to calibrate a cohort, each by id with the SHA-256 of its file; any of them may be absent, and a cohort
// with none is not calibrated.
export interface StackingCalibration {
	// Master dark, which already holds the bias.
	readonly dark?: MasterReference
	// Master flat.
	readonly flat?: MasterReference
	// Master bias, applied only without a dark.
	readonly bias?: MasterReference
}

// What an operator decided about a cohort.
export interface StackingCohortDecision {
	// Id of the cohort.
	readonly cohortId: string
	// Key of its filter group, and of its acquisition settings.
	readonly groupKey: string
	readonly cohortKey: string
	// Camera of the Equipment Catalog an operator declared for its lights, none of which names one; absent while none is.
	readonly cameraId?: string
	// Masters chosen; absent while none is.
	readonly calibration?: StackingCalibration
}

// How the frames of a filter group are integrated.
export interface StackingRecipe {
	// Combination of the samples of a pixel.
	readonly method: StackingCombinationMethod
	// Weight of each frame from its measured quality.
	readonly weighting: StackingWeightingMode
	// Photometric match of each frame to the reference of its group, or none.
	readonly normalization: 'none' | GlobalNormalizationMode
	// Resampling kernel of the warp onto the project grid.
	readonly interpolation: ImageInterpolationMode
	// Fraction of the integrated frames that must cover a pixel for it to hold data, in (0, 1].
	readonly minimumCoverage: number
	// Rejection limits of the sigma-clipping methods, in robust standard deviations.
	readonly sigmaLower: number
	readonly sigmaUpper: number
}

// Recipe of a new integration: weighted sigma clipping of frames weighted by quality and matched by background and
// scale, kept where half of them cover a pixel.
export const DEFAULT_STACKING_RECIPE: StackingRecipe = { method: 'weighted-sigma-clip', weighting: 'quality', normalization: 'background-scale', interpolation: 'bilinear', minimumCoverage: 0.5, sigmaLower: 3, sigmaUpper: 3 }

// Normalization of one integrated frame: `normalized = scale * value + offset` per channel.
export interface StackingFrameNormalization {
	readonly sourceId: string
	readonly scales: readonly number[]
	readonly offsets: readonly number[]
}

// Evidence of an integration.
export interface StackingProductDiagnostics {
	// How the samples were kept: accumulated in memory, or spilled to disk and combined in strips of rows.
	readonly mode: 'online' | 'spill'
	// Frames that must cover a pixel for it to hold data, and the pixels that hold data.
	readonly coverageThreshold: number
	readonly coveredPixels: number
	// Rows of a strip when spilled.
	readonly stripRows?: number
	// Normalization of each frame, in integration order.
	readonly normalization: readonly StackingFrameNormalization[]
}

// A linear master of one filter group: master.fit, in Float32 with NaN where no frame covers a pixel, and coverage.fit,
// the number of frames that covered each pixel. Both are on the project grid, never cropped, so masters of every filter
// of a project align pixel for pixel.
export interface StackingProduct {
	readonly productId: string
	readonly projectId: string
	// Filter group, by key, and its name when integrated.
	readonly groupKey: string
	readonly name: string
	// Identity of its inputs: frames with their digests, weights, and transforms, calibration pins, grid, and recipe.
	readonly fingerprint: string
	// When it was published, Unix milliseconds (UTC).
	readonly createdAt: number
	// SHA-256 and size, in bytes, of master.fit and coverage.fit.
	readonly contentDigest: string
	readonly bytes: number
	readonly coverageDigest: string
	readonly coverageBytes: number
	// Project grid, in pixels, and channels per pixel (3 for a debayered color sensor).
	readonly width: number
	readonly height: number
	readonly channels: number
	// Frame whose pixels the grid is, the reference of the project.
	readonly referenceSourceId: string
	// Frames integrated, and the sum of their exposures, in seconds.
	readonly frames: number
	readonly exposure: number
	readonly recipe: StackingRecipe
	// Calibration of each cohort integrated, by cohort id.
	readonly calibration: Readonly<Record<string, StackingCalibration>>
	readonly diagnostics: StackingProductDiagnostics
}

// A frame a product integrated, with the SHA-256 and weight it had.
export interface StackingProductSource {
	readonly sourceId: string
	readonly digest: string
	readonly weight: number
}

// Publication state of a product row: publishing until its directory is in products/, deleting until it is gone.
export type StackingProductPublication = 'publishing' | 'published' | 'deleting'

// Name of the image file of a product.
export const PRODUCT_MASTER_FILE = 'master.fit'

// Name of the coverage file of a product.
export const PRODUCT_COVERAGE_FILE = 'coverage.fit'

// A plane of a master mixed into a composite, with the linear correction applied to it first.
export interface StackingCompositionSource {
	// Master it reads.
	readonly productId: string
	// Channel of the master, from 0; 0 for a mono master.
	readonly plane: number
	// Multiplier applied to every sample, finite and positive, and value added after it, in the units of the master.
	readonly gain: number
	readonly offset: number
}

// Luminance of a composite: a source blended into the luminance of the mixed color, keeping its channel ratios.
export interface StackingCompositionLuminance {
	// Index of the source in the composition.
	readonly source: number
	// Weight of the source in the target luminance, in [0, 1]; 0 leaves the color untouched.
	readonly alpha: number
	// Whether the source is matched to the mixed luminance by background and scale first.
	readonly match: LuminanceMatchMode
}

// How masters are mixed into a color composite. A mix term names a source by its index, and its weight is unitless and
// non-negative; each output channel is the weighted mean of its terms.
export interface StackingComposition {
	// Name of the preset it came from, such as SHO, or Custom.
	readonly preset: string
	readonly sources: readonly StackingCompositionSource[]
	readonly mix: ChannelMix
	readonly luminance?: StackingCompositionLuminance
}

// Evidence of a composition.
export interface StackingCompositeDiagnostics extends CompositionCounters {
	// Fitted luminance match; absent without a luminance.
	readonly luminanceMatch?: LuminanceMatch
}

// A linear RGB composite: composite.fit, Float32 with NaN where a mixed master has no data, cropped to the box of the
// pixels every mixed master covers.
export interface StackingComposite {
	readonly compositeId: string
	readonly projectId: string
	// Identity of its inputs: the content of each master it reads and its composition.
	readonly fingerprint: string
	// When it was published, Unix milliseconds (UTC).
	readonly createdAt: number
	// SHA-256 and size, in bytes, of composite.fit.
	readonly contentDigest: string
	readonly bytes: number
	// Size, in pixels, and its origin on the project grid, zero-based with x right and y down.
	readonly width: number
	readonly height: number
	readonly left: number
	readonly top: number
	readonly composition: StackingComposition
	readonly diagnostics: StackingCompositeDiagnostics
}

// Name of the image file of a composite.
export const COMPOSITE_FILE = 'composite.fit'

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
	// Choices of an operator.
	readonly settings: StackingSettings
	// Outcome of the latest registration.
	readonly analysis?: StackingProjectAnalysis
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
	// Its filter: the name its header writes, trimmed, or the one an operator declared; None when neither names one.
	readonly filterKey: string
	// Camera of the Equipment Catalog the capture that saved it was bound to, read from the captured frames when it joined;
	// absent for a frame no capture of this server recorded with a camera.
	readonly cameraId?: string
	// Key of its acquisition settings, its camera among them.
	readonly cohortKey: string
	// Target named by its header.
	readonly object?: string
	// Start of its exposure, Unix milliseconds (UTC).
	readonly observedAt?: number
	// Whether an operator left it out of stacks; absent when included.
	readonly excluded?: true
	// What is known about it.
	readonly metadata: HeaderMetadata
	// What should be said about it.
	readonly warnings: readonly string[]
	// What the latest analysis measured.
	readonly analysis?: StackingFrameAnalysis
}

// What lists show of a frame: its file name instead of its path, and its analysis without the stars.
export type StackingSourceSummary = Omit<StackingSource, 'path' | 'identity' | 'analysis'> & { readonly name: string; readonly analysis?: Omit<StackingFrameAnalysis, 'stars'> }

// Filters of a list of frames of a project.
export interface StackingSourceFilter {
	// Filter of one filter group.
	readonly filterKey?: string
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
	readonly cohortKey: string
	readonly object: string
	// Exposure, in integer microseconds; absent when unknown.
	readonly exposure?: number
	readonly excluded: boolean
}

// Removes the server path, identity, and stars of a frame.
export function stackingSourceSummary({ path, identity: _, analysis, ...source }: StackingSource): StackingSourceSummary {
	if (analysis === undefined) return { ...source, name: fileNameOf(path) }
	const { stars: __, ...measured } = analysis
	return { ...source, name: fileNameOf(path), analysis: measured }
}

// Row of stack_projects.
interface ProjectRow {
	readonly project_id: string
	readonly name: string
	readonly revision: number
	readonly created_at: number
	readonly updated_at: number
	readonly settings: string
	readonly analysis: string | null
}

// Columns of stack_projects read into a StackingProject.
const PROJECT_COLUMNS = 'project_id, name, revision, created_at, updated_at, settings, analysis'

// Row of stack_cohorts.
interface CohortRow {
	readonly cohort_id: string
	readonly group_key: string
	readonly cohort_key: string
	readonly camera_id: string | null
	readonly calibration: string | null
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
	readonly camera_id: string | null
	readonly cohort_key: string
	readonly object: string
	readonly observed_at: number | null
	readonly excluded: number
	readonly metadata: string
	readonly warnings: string
	readonly analysis: string | null
}

// Columns of stack_sources read into a StackingSource.
const SOURCE_COLUMNS = 'source_id, project_id, path, format, identity, bytes, mtime_ms, digest, status, role, filter_key, camera_id, cohort_key, object, observed_at, excluded, metadata, warnings, analysis'

// Returns the project of a row.
function rowProject(row: ProjectRow): StackingProject {
	const project: StackingProject = { projectId: row.project_id, name: row.name, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, settings: { ...DEFAULT_STACKING_SETTINGS, ...(JSON.parse(row.settings) as Partial<StackingSettings>) } }
	return row.analysis === null ? project : { ...project, analysis: JSON.parse(row.analysis) as StackingProjectAnalysis }
}

// Returns the decision of a row.
function rowCohort(row: CohortRow): StackingCohortDecision {
	return {
		cohortId: row.cohort_id,
		groupKey: row.group_key,
		cohortKey: row.cohort_key,
		...(row.camera_id !== null && { cameraId: row.camera_id }),
		...(row.calibration !== null && { calibration: JSON.parse(row.calibration) as StackingCalibration }),
	}
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
		...(row.camera_id !== null && { cameraId: row.camera_id }),
		cohortKey: row.cohort_key,
		...(row.object !== '' && { object: row.object }),
		...(row.observed_at !== null && { observedAt: row.observed_at }),
		...(row.excluded === 1 && { excluded: true }),
		metadata: JSON.parse(row.metadata) as HeaderMetadata,
		warnings: JSON.parse(row.warnings) as string[],
		...(row.analysis !== null && { analysis: JSON.parse(row.analysis) as StackingFrameAnalysis }),
	}
}

// Builds the WHERE clause of a list of frames of a project.
function sourceWhere(projectId: string, filter: StackingSourceFilter) {
	const clauses = ['project_id = ?']
	const values: (string | number)[] = [projectId]

	if (filter.filterKey !== undefined) {
		clauses.push("role = 'light' AND filter_key = ?")
		values.push(filter.filterKey)
	}

	if (filter.role !== undefined) {
		clauses.push('role = ?')
		values.push(filter.role)
	}

	if (filter.status !== undefined) {
		clauses.push('status = ?')
		values.push(filter.status)
	}

	if (filter.included !== undefined) clauses.push(filter.included ? 'excluded = 0' : 'excluded = 1')

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

	// Directory of the published products.
	get productsDirectory() {
		return join(this.directory, 'products')
	}

	// Directory of products/ entries found without a row.
	get orphanedDirectory() {
		return join(this.directory, 'orphaned')
	}

	// Directory of a product.
	productDirectory(productId: string) {
		return join(this.productsDirectory, productId)
	}

	// Directory of the published composites.
	get compositesDirectory() {
		return join(this.directory, 'composites')
	}

	// Directory of a composite.
	compositeDirectory(compositeId: string) {
		return join(this.compositesDirectory, compositeId)
	}

	// Directory of the work of a run, on the filesystem of the products so publishing is a rename.
	stagingDirectory(runId: string) {
		return join(this.directory, 'staging', runId)
	}

	// Removes the work of every run, which only a running run owns.
	async clearStaging() {
		await rm(join(this.directory, 'staging'), { recursive: true, force: true })
	}

	// Lists the names of the directories of products/, or of composites/.
	async productDirectories(composites = false) {
		const entries = await readdir(composites ? this.compositesDirectory : this.productsDirectory, { withFileTypes: true }).catch(() => [])
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
	}

	// Lists the published composites of a project, newest first.
	composites(projectId: string) {
		return this.database.db
			.query<{ composite: string }, [string]>("SELECT composite FROM stack_composites WHERE project_id = ? AND publication = 'published' ORDER BY created_at DESC, composite_id")
			.all(projectId)
			.map((row) => JSON.parse(row.composite) as StackingComposite)
	}

	// Returns a published composite.
	composite(compositeId: string) {
		const row = this.database.db.query<{ composite: string }, [string]>("SELECT composite FROM stack_composites WHERE composite_id = ? AND publication = 'published'").get(compositeId)
		return row ? (JSON.parse(row.composite) as StackingComposite) : undefined
	}

	// Returns the published composite of a project with a fingerprint, the newest when there are several.
	compositeByFingerprint(projectId: string, fingerprint: string) {
		const row = this.database.db.query<{ composite: string }, [string, string]>("SELECT composite FROM stack_composites WHERE project_id = ? AND fingerprint = ? AND publication = 'published' ORDER BY created_at DESC LIMIT 1").get(projectId, fingerprint)
		return row ? (JSON.parse(row.composite) as StackingComposite) : undefined
	}

	// Lists the composites whose publication or deletion a crash interrupted.
	pendingComposites() {
		return this.database.db
			.query<{ composite: string; publication: StackingProductPublication }, []>("SELECT composite, publication FROM stack_composites WHERE publication <> 'published'")
			.all()
			.map((row) => ({ composite: JSON.parse(row.composite) as StackingComposite, publication: row.publication }))
	}

	// Returns whether a composite row exists, in any publication state.
	hasComposite(compositeId: string) {
		return this.database.db.query<{ found: number }, [string]>('SELECT 1 AS found FROM stack_composites WHERE composite_id = ?').get(compositeId) !== null
	}

	// Counts the composites that read a master.
	compositesOf(productId: string) {
		return this.database.db.query<{ count: number }, [string]>('SELECT COUNT(*) AS count FROM stack_composite_sources WHERE product_id = ?').get(productId)!.count
	}

	// Records a composite as publishing, with the masters it reads, in one transaction.
	beginComposite(composite: StackingComposite) {
		this.database.write(() => {
			const { db } = this.database
			db.query("INSERT INTO stack_composites (composite_id, project_id, publication, fingerprint, created_at, content_digest, bytes, composite) VALUES (?, ?, 'publishing', ?, ?, ?, ?, ?)").run(
				composite.compositeId,
				composite.projectId,
				composite.fingerprint,
				composite.createdAt,
				composite.contentDigest,
				composite.bytes,
				JSON.stringify(composite),
			)
			const statement = db.query('INSERT OR IGNORE INTO stack_composite_sources (composite_id, product_id) VALUES (?, ?)')
			for (const source of composite.composition.sources) statement.run(composite.compositeId, source.productId)
		})
	}

	// Changes the publication state of a composite.
	setCompositePublication(compositeId: string, publication: StackingProductPublication) {
		this.database.write(() => this.database.db.query('UPDATE stack_composites SET publication = ? WHERE composite_id = ?').run(publication, compositeId))
	}

	// Forgets a composite.
	discardComposite(compositeId: string) {
		this.database.write(() => this.database.db.query('DELETE FROM stack_composites WHERE composite_id = ?').run(compositeId))
	}

	// Lists the published products of a project, newest first.
	products(projectId: string) {
		return this.database.db
			.query<{ product: string }, [string]>("SELECT product FROM stack_products WHERE project_id = ? AND publication = 'published' ORDER BY created_at DESC, product_id")
			.all(projectId)
			.map((row) => JSON.parse(row.product) as StackingProduct)
	}

	// Returns a published product.
	product(productId: string) {
		const row = this.database.db.query<{ product: string }, [string]>("SELECT product FROM stack_products WHERE product_id = ? AND publication = 'published'").get(productId)
		return row ? (JSON.parse(row.product) as StackingProduct) : undefined
	}

	// Returns the published product of a project with a fingerprint, the newest when there are several.
	productByFingerprint(projectId: string, fingerprint: string) {
		const row = this.database.db.query<{ product: string }, [string, string]>("SELECT product FROM stack_products WHERE project_id = ? AND fingerprint = ? AND publication = 'published' ORDER BY created_at DESC LIMIT 1").get(projectId, fingerprint)
		return row ? (JSON.parse(row.product) as StackingProduct) : undefined
	}

	// Lists the frames a product integrated.
	productSources(productId: string): StackingProductSource[] {
		return this.database.db.query<StackingProductSource, [string]>('SELECT source_id AS sourceId, digest, weight FROM stack_product_sources WHERE product_id = ? ORDER BY rowid').all(productId)
	}

	// Lists the products whose publication or deletion a crash interrupted.
	pendingProducts() {
		return this.database.db
			.query<{ product: string; publication: StackingProductPublication }, []>("SELECT product, publication FROM stack_products WHERE publication <> 'published'")
			.all()
			.map((row) => ({ product: JSON.parse(row.product) as StackingProduct, publication: row.publication }))
	}

	// Returns whether a product row exists, in any publication state.
	hasProduct(productId: string) {
		return this.database.db.query<{ found: number }, [string]>('SELECT 1 AS found FROM stack_products WHERE product_id = ?').get(productId) !== null
	}

	// Records a product as publishing, with its frames, in one transaction.
	beginProduct(product: StackingProduct, sources: readonly StackingProductSource[]) {
		this.database.write(() => {
			const { db } = this.database
			db.query("INSERT INTO stack_products (product_id, project_id, publication, group_key, name, fingerprint, created_at, content_digest, bytes, coverage_digest, coverage_bytes, product) VALUES (?, ?, 'publishing', ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
				product.productId,
				product.projectId,
				product.groupKey,
				product.name,
				product.fingerprint,
				product.createdAt,
				product.contentDigest,
				product.bytes,
				product.coverageDigest,
				product.coverageBytes,
				JSON.stringify(product),
			)
			const statement = db.query('INSERT INTO stack_product_sources (product_id, source_id, digest, weight) VALUES (?, ?, ?, ?)')
			for (const source of sources) statement.run(product.productId, source.sourceId, source.digest, source.weight)
		})
	}

	// Changes the publication state of a product.
	setPublication(productId: string, publication: StackingProductPublication) {
		this.database.write(() => this.database.db.query('UPDATE stack_products SET publication = ? WHERE product_id = ?').run(publication, productId))
	}

	// Forgets a product and its frames.
	discardProduct(productId: string) {
		this.database.write(() => this.database.db.query('DELETE FROM stack_products WHERE product_id = ?').run(productId))
	}

	// Lists every project, the latest changed first.
	projects() {
		return this.database.db.query<ProjectRow, []>(`SELECT ${PROJECT_COLUMNS} FROM stack_projects ORDER BY updated_at DESC, project_id`).all().map(rowProject)
	}

	// Returns a project.
	project(projectId: string) {
		const row = this.database.db.query<ProjectRow, [string]>(`SELECT ${PROJECT_COLUMNS} FROM stack_projects WHERE project_id = ?`).get(projectId)
		return row ? rowProject(row) : undefined
	}

	// Writes a project. An existing row is updated in place: replacing it would delete it first, and with it every row
	// that cascades from it.
	putProject(project: StackingProject) {
		this.database.write(() => {
			this.database.db
				.query(`INSERT INTO stack_projects (${PROJECT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET name = excluded.name, revision = excluded.revision, updated_at = excluded.updated_at, settings = excluded.settings, analysis = excluded.analysis`)
				.run(project.projectId, project.name, project.revision, project.createdAt, project.updatedAt, JSON.stringify(project.settings), project.analysis === undefined ? null : JSON.stringify(project.analysis))
		})
	}

	// Deletes a project with its frames, never their files.
	deleteProject(projectId: string) {
		this.database.write(() => {
			this.database.db.query('DELETE FROM stack_projects WHERE project_id = ?').run(projectId)
		})
	}

	// Writes frames and marks their project changed at `now`, in one transaction.
	putSources(projectId: string, sources: readonly StackingSource[], now: number) {
		this.database.write(() => {
			const statement = this.database.db.query(`INSERT OR REPLACE INTO stack_sources (${SOURCE_COLUMNS}, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

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
					source.cameraId ?? null,
					source.cohortKey,
					source.object ?? '',
					source.observedAt ?? null,
					source.excluded ? 1 : 0,
					JSON.stringify(source.metadata),
					JSON.stringify(source.warnings),
					source.analysis === undefined ? null : JSON.stringify(source.analysis),
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
			.query<{ role: StackingRole; status: SourceStatus; filter_key: string; cohort_key: string; object: string; exposure: number | null; excluded: number }, [string]>(
				"SELECT role, status, filter_key, cohort_key, object, json_extract(metadata, '$.exposure.value') AS exposure, excluded FROM stack_sources WHERE project_id = ?",
			)
			.all(projectId)

		return rows.map((row) => ({ role: row.role, status: row.status, filterKey: row.filter_key, cohortKey: row.cohort_key, object: row.object, exposure: row.exposure ?? undefined, excluded: row.excluded === 1 }))
	}

	// Writes what analyses measured of frames, by source id, in one transaction; unknown frames are skipped.
	setAnalyses(analyses: readonly { readonly sourceId: string; readonly analysis: StackingFrameAnalysis }[]) {
		if (analyses.length === 0) return
		this.database.write(() => {
			const statement = this.database.db.query('UPDATE stack_sources SET analysis = ? WHERE source_id = ?')
			for (const { sourceId, analysis } of analyses) statement.run(JSON.stringify(analysis), sourceId)
		})
	}

	// Writes the outcome of a registration of a project.
	setProjectAnalysis(projectId: string, analysis: StackingProjectAnalysis) {
		this.database.write(() => {
			this.database.db.query('UPDATE stack_projects SET analysis = ? WHERE project_id = ?').run(JSON.stringify(analysis), projectId)
		})
	}

	// Lists the calibration decisions of a project.
	cohorts(projectId: string) {
		return this.database.db.query<CohortRow, [string]>('SELECT cohort_id, group_key, cohort_key, camera_id, calibration FROM stack_cohorts WHERE project_id = ?').all(projectId).map(rowCohort)
	}

	// Writes the decision of a cohort and marks its project changed at `now`.
	putCohort(projectId: string, decision: StackingCohortDecision, now: number) {
		this.database.write(() => {
			this.database.db
				.query('INSERT OR REPLACE INTO stack_cohorts (project_id, cohort_id, group_key, cohort_key, camera_id, calibration) VALUES (?, ?, ?, ?, ?, ?)')
				.run(projectId, decision.cohortId, decision.groupKey, decision.cohortKey, decision.cameraId ?? null, decision.calibration === undefined ? null : JSON.stringify(decision.calibration))
			this.#touch(projectId, now)
		})
	}

	// Marks a project changed, in the transaction of the caller.
	#touch(projectId: string, now: number) {
		this.database.db.query('UPDATE stack_projects SET updated_at = ? WHERE project_id = ?').run(now, projectId)
	}
}
