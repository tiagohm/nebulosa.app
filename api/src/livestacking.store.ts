import { readdir, rm } from 'fs/promises'
import { join } from 'path'
import { type AppDatabase, DEFAULT_DATA_DIRECTORY } from './database'
import type { LiveStackingComposition, LiveStackingRecipe } from './livestacking.engine'
import type { LiveFilterCalibration } from './livestacking.groups'

// Durable part of Live Stacking: the stacks an operator saved, as rows of live_stack_products in the operational
// database and files under live-stacking/products/<productId>/. Sessions, stacks, queued frames, and the frame history
// live only in memory and are gone after a restart; a saved stack keeps everything that explains it, without any of the
// frames it integrated. A product is written into live-stacking/staging/<id>/, on the filesystem of the products, recorded
// as publishing, renamed into products/, and only then marked published.

// Directory of the files of Live Stacking.
export const DEFAULT_LIVE_STACKING_DIRECTORY = join(DEFAULT_DATA_DIRECTORY, 'live-stacking')

// Publication state of a product: being renamed into place, available, or being deleted.
export type LiveStackingPublication = 'publishing' | 'published' | 'deleting'

// A stack of the product: what it integrated and how it was calibrated.
export interface LiveProductCohort {
	// Id of the cohort in its session.
	readonly cohortId: string
	// Filter, exactly as the headers named it, or None.
	readonly filter: string
	// Accepted frames it integrated and their total exposure, in seconds.
	readonly frames: number
	readonly exposure: number
	// Masters it was calibrated with; absent when uncalibrated.
	readonly calibration?: LiveFilterCalibration
}

// A saved stack: a mono or color stack of one cohort, or a color composition of cohorts of one field.
export interface LiveStackingProduct {
	readonly productId: string
	readonly sessionId: string
	readonly connectionId: string
	readonly deviceId: string
	readonly cameraName: string
	readonly kind: 'stack' | 'composite'
	// Filter of a stack, or preset of a composition.
	readonly name: string
	// When it was saved, Unix milliseconds (UTC).
	readonly createdAt: number
	// SHA-256 and size, in bytes, of its stack, and of its coverage for a stack.
	readonly contentDigest: string
	readonly bytes: number
	readonly coverageDigest?: string
	readonly coverageBytes?: number
	// Grid, in pixels, and channels.
	readonly width: number
	readonly height: number
	readonly channels: number
	// Accepted frames and their total exposure, in seconds, over its cohorts.
	readonly frames: number
	readonly exposure: number
	readonly recipe: LiveStackingRecipe
	readonly cohorts: readonly LiveProductCohort[]
	// How a composite mixes its cohorts.
	readonly composition?: LiveStackingComposition
}

// Rows of Live Stacking products and the directories of their files.
export class LiveStackingStore {
	// Creates the store of the rows of database and the files under directory.
	constructor(
		readonly database: AppDatabase,
		readonly directory: string = DEFAULT_LIVE_STACKING_DIRECTORY,
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

	// Directory an export is written into before it is published, on the filesystem of the products.
	stagingDirectory(id: string) {
		return join(this.directory, 'staging', id)
	}

	// Removes every staged export, which only a running export owns.
	async clearStaging() {
		await rm(join(this.directory, 'staging'), { recursive: true, force: true })
	}

	// Lists the names of the directories of products/.
	async productDirectories() {
		const entries = await readdir(this.productsDirectory, { withFileTypes: true }).catch(() => [])
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
	}

	// Lists the published products, newest first.
	products() {
		return this.database.db
			.query<{ product: string }, []>("SELECT product FROM live_stack_products WHERE publication = 'published' ORDER BY created_at DESC, product_id")
			.all()
			.map((row) => JSON.parse(row.product) as LiveStackingProduct)
	}

	// Returns a published product.
	product(productId: string) {
		const row = this.database.db.query<{ product: string }, [string]>("SELECT product FROM live_stack_products WHERE product_id = ? AND publication = 'published'").get(productId)
		return row ? (JSON.parse(row.product) as LiveStackingProduct) : undefined
	}

	// Lists the products a crash left being published or deleted.
	pendingProducts() {
		return this.database.db
			.query<{ product: string; publication: LiveStackingPublication }, []>("SELECT product, publication FROM live_stack_products WHERE publication != 'published'")
			.all()
			.map((row) => ({ product: JSON.parse(row.product) as LiveStackingProduct, publication: row.publication }))
	}

	// Returns whether a product row exists, in any publication state.
	hasProduct(productId: string) {
		return this.database.db.query<{ found: number }, [string]>('SELECT 1 AS found FROM live_stack_products WHERE product_id = ?').get(productId) !== null
	}

	// Records a product as publishing.
	beginProduct(product: LiveStackingProduct) {
		this.database.write(() =>
			this.database.db
				.query("INSERT INTO live_stack_products (product_id, publication, session_id, connection_id, device_id, created_at, content_digest, bytes, product) VALUES (?, 'publishing', ?, ?, ?, ?, ?, ?, ?)")
				.run(product.productId, product.sessionId, product.connectionId, product.deviceId, product.createdAt, product.contentDigest, product.bytes, JSON.stringify(product)),
		)
	}

	// Changes the publication state of a product.
	setPublication(productId: string, publication: LiveStackingPublication) {
		this.database.write(() => this.database.db.query('UPDATE live_stack_products SET publication = ? WHERE product_id = ?').run(publication, productId))
	}

	// Forgets a product.
	discardProduct(productId: string) {
		this.database.write(() => this.database.db.query('DELETE FROM live_stack_products WHERE product_id = ?').run(productId))
	}
}
