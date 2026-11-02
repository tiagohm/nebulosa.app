import { mkdir, readdir, stat } from 'fs/promises'
import { join } from 'path'
import type { DarkFrameAssessment, DarkFrameHeader, DarkPlaneMeasurement, DarkTemperatureTrace } from './darklibrarywizard.analysis'
import type { AppDatabase } from './database'
import { publishFrame } from './flatwizard'

// Durable records of the Dark Library Wizard, in the operational database: the immutable specification of each plan
// (dark_plans and dark_groups), the state of its latest session, and every frame it published or quarantined
// (dark_frames), each change one synchronous transaction, so a plan of thousands of frames never rewrites what it already
// recorded. A frame counts only once it was committed, which happens in three steps (publishing, the file is linked,
// committed), so a crash between them is reconciled from the row and the file itself, never assumed. The server
// reconciles before it serves (reconcile), so whatever was running then belongs to a process that ended: its plan
// becomes interrupted, and what its staging directories hold is quarantined, never deleted. Nothing here resumes a
// device. The frames themselves live in the output directory of the plan. This is the ledger of what the wizard
// acquired; the Calibration Library reads it and never writes it. Times are Unix milliseconds, exposures seconds,
// temperatures degrees Celsius. Plans never hold pixels, and server paths never leave through events.

// Directory of the frames of a group that do not count.
export const REJECTED_DIRECTORY = 'rejected'

// Directory of the frames of a group being acquired.
export const STAGING_DIRECTORY = '.staging'

// Camera settings shared by every frame of a plan; each group adds its exposure and temperature.
export interface DarkPlanCapture {
	// Gain, in driver units.
	readonly gain: number
	// Offset, in driver units.
	readonly offset: number
	// Binning factors.
	readonly binX: number
	readonly binY: number
	// Whether x, y, width, and height select a subframe instead of the full sensor.
	readonly subframe: boolean
	// Subframe, in unbinned sensor pixels.
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
	// Readout mode of the driver; empty leaves it unchanged.
	readonly frameFormat: string
}

// One row of a capture plan.
export interface DarkGroup {
	// Exposure, in seconds; positive.
	readonly exposure: number
	// Target sensor temperature, in degrees Celsius; absent when the temperature is not controlled.
	readonly temperature?: number
	// Accepted frames required; at least 1.
	readonly count: number
}

// Group of a plan.
export interface DarkPlanGroup extends DarkGroup {
	// Id of the group, unique in the plan.
	readonly groupId: string
	// Exact identity of the settings of its frames (darkGroupKey).
	readonly key: string
	// Absolute directory of its frames.
	readonly directory: string
}

// Light protection of a plan: any combination of the mechanisms, each one verified or asserted.
export interface DarkProtection {
	// Dark or opaque slot of the wheel, 0-based; absent leaves the wheel alone.
	readonly darkFilter?: { readonly slot: number }
	// Whether the assigned dust cover is closed.
	readonly closeCover: boolean
	// Whether the assigned flat panel is switched off.
	readonly panelOff: boolean
	// Whether the operator asserts a manual opaque cap.
	readonly manualCap: boolean
	// Whether a suspicion of light on the first frame of each group stops for the operator's decision.
	readonly verifyFirstFrame: boolean
}

// Thermal protocol of the groups with a target temperature.
export interface DarkThermalPolicy {
	// Largest distance from the target, in degrees Celsius; positive.
	readonly tolerance: number
	// Time the sensor must stay inside the tolerance, in seconds.
	readonly hold: number
	// Longest wait for a stable temperature, in seconds.
	readonly timeout: number
}

// Physical device of a plan.
export interface DarkPlanDevice {
	// Id of the hardware.
	readonly hardwareId: string
	// Name of the device.
	readonly name: string
}

// Immutable specification of a capture plan. A change makes another plan.
export interface DarkCapturePlan {
	// Id of the plan.
	readonly planId: string
	// When the plan was created.
	readonly createdAt: number
	// Physical camera.
	readonly camera: DarkPlanDevice & {
		// Executable and version of its driver.
		readonly driver: { readonly executable: string; readonly version: string }
		// Full sensor, in unbinned pixels; absent while unknown.
		readonly sensor?: { readonly width: number; readonly height: number }
	}
	// Devices the protection uses.
	readonly wheel?: DarkPlanDevice & {
		// Name of the dark slot as the wheel reported it, a convenience that proves nothing about its opacity.
		readonly slotName: string
	}
	readonly panel?: DarkPlanDevice
	readonly cover?: DarkPlanDevice
	// Absolute directory the frames are saved under.
	readonly directory: string
	// Camera settings of every frame.
	readonly capture: DarkPlanCapture
	// Groups in acquisition order.
	readonly groups: readonly DarkPlanGroup[]
	// Light protection.
	readonly protection: DarkProtection
	// Thermal protocol.
	readonly thermal: DarkThermalPolicy
	// Rejected frames allowed per group before the session fails.
	readonly maximumRejections: number
	// What the frames are for; absent is an ordinary dark. A dark-flat is the same light-blocked capture at the exposure
	// of a flat, and a driver may write it as a plain DARK.
	readonly purpose?: 'darkFlat'
	// Whether the Calibration Library should build the masters of the complete groups once the acquisition ends.
	readonly generateMasters?: boolean
}

// Outcome of an examined frame:
// - accepted: counts, nothing to report.
// - acceptedWithWarnings: counts, its warnings and whether the operator acknowledged them are recorded.
// - rejected: a proven failure, kept in the rejected directory; never counts.
// - incomplete: never examined, kept in the rejected directory; never counts.
export type DarkFrameVerdict = 'accepted' | 'acceptedWithWarnings' | 'rejected' | 'incomplete'

// Durable record of one frame.
export interface DarkFrameRecord extends DarkFrameAssessment {
	// Id of the frame, unique in the plan.
	readonly frameId: string
	// Group of the frame.
	readonly groupId: string
	// Number of the frame among the files of its group, from 1, never reused.
	readonly sequence: number
	// Absolute path of its file.
	readonly path: string
	// Absolute path it was staged at, while it could still be there.
	readonly staged?: string
	// Size of its file, in bytes.
	readonly size: number
	// Instant the exposure started.
	readonly time: number
	// Outcome.
	readonly verdict: DarkFrameVerdict
	// Whether the operator confirmed its suspicion of light.
	readonly acknowledged?: boolean
	// Why it never was examined.
	readonly reason?: string
	// Levels of its planes.
	readonly planes: readonly DarkPlaneMeasurement[]
	// Keywords of its header.
	readonly header?: DarkFrameHeader
	// Temperature during the exposure, as the driver reported it.
	readonly temperature?: Omit<DarkTemperatureTrace, 'at'>
}

// State of the acquisition of a plan:
// - running, paused: a session of this process works on it.
// - interrupted: such a session did not end, because the process did.
// - completed, stopped, failed: the latest session ended.
export type DarkPlanStatus = 'running' | 'paused' | 'interrupted' | 'completed' | 'stopped' | 'failed'

// Change recorded for a plan.
export type DarkJournalRecord =
	// The acquisition changed state.
	| { readonly type: 'status'; readonly at: number; readonly status: DarkPlanStatus; readonly sessionId?: string; readonly operationId?: string; readonly reason?: string }
	// A frame is about to be published as path, from its staged file.
	| { readonly type: 'publishing'; readonly frame: DarkFrameRecord }
	// The frame was published and counts.
	| { readonly type: 'committed'; readonly frameId: string; readonly at: number }
	// A frame that does not count was quarantined as path.
	| { readonly type: 'rejected'; readonly frame: DarkFrameRecord }
	// What the latest session could not restore.
	| { readonly type: 'cleanup'; readonly at: number; readonly warnings: readonly string[] }

// Counts of one group, from its frames.
export interface DarkGroupProgress {
	// Id of the group.
	readonly groupId: string
	// Accepted frames required.
	readonly required: number
	// Frames that count without warnings.
	readonly accepted: number
	// Frames that count with warnings.
	readonly acceptedWithWarnings: number
	// Frames quarantined with a proven failure.
	readonly rejected: number
	// Frames quarantined without being examined.
	readonly incomplete: number
	// Frames still required.
	readonly missing: number
}

// What a listing shows of a plan, without its frames.
export interface DarkPlanSummary {
	// Id of the plan.
	readonly planId: string
	// When the plan was created.
	readonly createdAt: number
	// When its state, the frames that count, or its cleanup warnings last changed.
	readonly updatedAt: number
	// State of its acquisition.
	readonly status: DarkPlanStatus
	// Why the latest session ended, when it failed.
	readonly reason?: string
	// Groups in acquisition order.
	readonly groups: readonly (DarkGroup & DarkGroupProgress)[]
	// Frames still required by the whole plan.
	readonly missing: number
	// What the latest session could not restore.
	readonly cleanupWarnings: readonly string[]
}

// Complete record of a plan.
export interface DarkPlanDetail extends DarkPlanSummary {
	// Specification of the plan.
	readonly plan: DarkCapturePlan
	// Latest frames, oldest first.
	readonly frames: readonly DarkFrameRecord[]
	// Frames of the plan, of which frames holds the latest ones.
	readonly frameCount: number
}

// Returns the counts of each group of a plan from its committed and quarantined frames.
export function darkGroupProgress(plan: Pick<DarkCapturePlan, 'groups'>, frames: readonly Pick<DarkFrameRecord, 'groupId' | 'verdict'>[]): DarkGroupProgress[] {
	return plan.groups.map(({ groupId, count }) => {
		const progress = { groupId, required: count, accepted: 0, acceptedWithWarnings: 0, rejected: 0, incomplete: 0 }

		for (const frame of frames) {
			if (frame.groupId !== groupId) continue
			if (frame.verdict === 'accepted') progress.accepted++
			else if (frame.verdict === 'acceptedWithWarnings') progress.acceptedWithWarnings++
			else if (frame.verdict === 'rejected') progress.rejected++
			else progress.incomplete++
		}

		return { ...progress, missing: Math.max(0, count - progress.accepted - progress.acceptedWithWarnings) }
	})
}

// Moves a file into the rejected directory beside it, under a name of its own. Returns its new path.
async function quarantine(staged: string, directory: string, name: string) {
	const rejected = join(directory, REJECTED_DIRECTORY)
	await mkdir(rejected, { recursive: true })
	const path = join(rejected, name)
	await publishFrame(staged, path)
	return path
}

// What dark_plans keeps of a specification as JSON.
type DarkPlanSpec = Pick<DarkCapturePlan, 'camera' | 'wheel' | 'panel' | 'cover' | 'capture' | 'protection' | 'thermal' | 'maximumRejections'>

// Row of dark_plans.
interface DarkPlanRow {
	readonly plan_id: string
	readonly created_at: number
	readonly directory: string
	readonly purpose: DarkCapturePlan['purpose'] | null
	readonly generate_masters: number
	readonly spec: string
	readonly status: DarkPlanStatus
	readonly status_reason: string | null
	readonly cleanup_warnings: string
	readonly updated_at: number
}

// Row of dark_groups.
interface DarkGroupRow {
	readonly group_id: string
	readonly key: string
	readonly exposure: number
	readonly temperature: number | null
	readonly count: number
	readonly directory: string
}

// Row of dark_frames.
interface DarkFrameRow {
	readonly frame_id: string
	readonly group_id: string
	readonly sequence: number
	readonly verdict: DarkFrameVerdict
	readonly path: string
	readonly staged_path: string | null
	readonly size: number
	readonly time: number
	readonly assessment: string
}

// What dark_frames keeps of a frame as JSON: everything but its columns.
type DarkFrameAssessmentRecord = Omit<DarkFrameRecord, 'frameId' | 'groupId' | 'sequence' | 'verdict' | 'path' | 'staged' | 'size' | 'time'>

// Columns of dark_frames read into a DarkFrameRecord.
const FRAME_COLUMNS = 'frame_id, group_id, sequence, verdict, path, staged_path, size, time, assessment'

// Columns of dark_plans read into a summary.
const PLAN_COLUMNS = 'plan_id, created_at, directory, purpose, generate_masters, spec, status, status_reason, cleanup_warnings, updated_at'

// Returns the frame of a row.
function rowFrame({ frame_id, group_id, sequence, verdict, path, staged_path, size, time, assessment }: DarkFrameRow): DarkFrameRecord {
	return { ...(JSON.parse(assessment) as DarkFrameAssessmentRecord), frameId: frame_id, groupId: group_id, sequence, path, ...(staged_path !== null && { staged: staged_path }), size, time, verdict }
}

// Returns the values of the row of a frame, in the order of FRAME_COLUMNS.
function frameValues({ frameId, groupId, sequence, verdict, path, staged, size, time, ...assessment }: DarkFrameRecord) {
	return [frameId, groupId, sequence, verdict, path, staged ?? null, size, time, JSON.stringify(assessment)] as const
}

// Durable plans of the Dark Library Wizard in the operational database. Methods answer promises, and a change rejects
// when it cannot be written, leaving the plan as it was.
export class DarkPlanStore {
	// Creates the store of the plans in database.
	constructor(readonly database: AppDatabase) {}

	// Returns the specification of a plan row.
	#plan(row: DarkPlanRow): DarkCapturePlan {
		const groups = this.database.db.query<DarkGroupRow, [string]>('SELECT group_id, key, exposure, temperature, count, directory FROM dark_groups WHERE plan_id = ? ORDER BY position').all(row.plan_id)

		return {
			planId: row.plan_id,
			createdAt: row.created_at,
			...(JSON.parse(row.spec) as DarkPlanSpec),
			directory: row.directory,
			groups: groups.map(({ group_id, key, exposure, temperature, count, directory }) => ({ groupId: group_id, key, exposure, temperature: temperature ?? undefined, count, directory })),
			...(row.purpose !== null && { purpose: row.purpose }),
			...(row.generate_masters === 1 && { generateMasters: true }),
		}
	}

	// Returns the row of a plan, or undefined when there is none.
	#row(planId: string) {
		return this.database.db.query<DarkPlanRow, [string]>(`SELECT ${PLAN_COLUMNS} FROM dark_plans WHERE plan_id = ?`).get(planId) ?? undefined
	}

	// Returns what a listing shows of a plan.
	#summary(row: DarkPlanRow, plan: DarkCapturePlan): DarkPlanSummary {
		const counted = this.database.db.query<Pick<DarkFrameRecord, 'groupId' | 'verdict'>, [string]>("SELECT group_id AS groupId, verdict FROM dark_frames WHERE plan_id = ? AND state <> 'publishing'").all(row.plan_id)
		const progress = darkGroupProgress(plan, counted)
		const groups = plan.groups.map(({ exposure, temperature, count }, index) => ({ exposure, ...(temperature !== undefined && { temperature }), count, ...progress[index] }))
		const reason = row.status_reason ?? undefined
		return { planId: row.plan_id, createdAt: row.created_at, updatedAt: row.updated_at, status: row.status, ...(reason !== undefined && { reason }), groups, missing: progress.reduce((total, group) => total + group.missing, 0), cleanupWarnings: JSON.parse(row.cleanup_warnings) as string[] }
	}

	// Records a change of a plan. Throws when the plan is unknown.
	#apply(planId: string, record: DarkJournalRecord) {
		const { db } = this.database
		if (!db.query('SELECT 1 FROM dark_plans WHERE plan_id = ?').get(planId)) throw new Error(`Unknown dark plan ${planId}`)
		const position = '(SELECT coalesce(max(position), 0) + 1 FROM dark_frames WHERE plan_id = ?)'

		switch (record.type) {
			case 'status':
				db.query('UPDATE dark_plans SET status = ?, status_reason = ?, session_id = coalesce(?, session_id), operation_id = coalesce(?, operation_id), cleanup_warnings = coalesce(?, cleanup_warnings), updated_at = ? WHERE plan_id = ?').run(
					record.status,
					record.reason ?? null,
					record.sessionId ?? null,
					record.operationId ?? null,
					record.status === 'running' ? '[]' : null,
					record.at,
					planId,
				)
				break
			case 'publishing':
				db.query(`INSERT INTO dark_frames (plan_id, state, ${FRAME_COLUMNS}) VALUES (?, 'publishing', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(planId, ...frameValues(record.frame))
				break
			case 'committed':
				db.query(`UPDATE dark_frames SET state = 'committed', position = ${position} WHERE plan_id = ? AND frame_id = ? AND state = 'publishing'`).run(planId, planId, record.frameId)
				db.query('UPDATE dark_plans SET updated_at = ? WHERE plan_id = ?').run(record.at, planId)
				break
			case 'rejected': {
				// A frame that was being published becomes rejected in place; any other one is added.
				const [frameId, groupId, sequence, verdict, path, staged, size, time, assessment] = frameValues(record.frame)
				const updated = db
					.query(`UPDATE dark_frames SET state = 'rejected', position = ${position}, group_id = ?, sequence = ?, verdict = ?, path = ?, staged_path = ?, size = ?, time = ?, assessment = ? WHERE plan_id = ? AND frame_id = ?`)
					.run(planId, groupId, sequence, verdict, path, staged, size, time, assessment, planId, frameId)
				if (updated.changes === 0) db.query(`INSERT INTO dark_frames (plan_id, state, position, ${FRAME_COLUMNS}) VALUES (?, 'rejected', ${position}, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(planId, planId, frameId, groupId, sequence, verdict, path, staged, size, time, assessment)
				break
			}
			case 'cleanup':
				db.query('UPDATE dark_plans SET cleanup_warnings = ?, updated_at = ? WHERE plan_id = ?').run(JSON.stringify(record.warnings), record.at, planId)
				break
		}
	}

	// Reconciles the plans a previous run of the server left behind: running or paused, or with a frame being published.
	// Called once, before anything is served, so no session of this process works on them. Never rejects: a plan that
	// cannot be reconciled is reported on the console and reconciled again on the next start.
	async reconcile() {
		const rows = this.database.db.query<{ plan_id: string }, []>("SELECT plan_id FROM dark_plans WHERE status IN ('running', 'paused') OR EXISTS (SELECT 1 FROM dark_frames WHERE dark_frames.plan_id = dark_plans.plan_id AND state = 'publishing')").all()
		for (const { plan_id } of rows) await this.#reconcile(plan_id)
	}

	// Reconciles a plan its process left behind: a frame being published is confirmed from its file or finished from its
	// staged copy, since it was examined already, and anything else in a staging directory is quarantined.
	async #reconcile(planId: string) {
		const write = (record: DarkJournalRecord) => this.database.write(() => this.#apply(planId, record))

		try {
			const publishing = this.database.db.query<DarkFrameRow, [string]>(`SELECT ${FRAME_COLUMNS} FROM dark_frames WHERE plan_id = ? AND state = 'publishing' ORDER BY sequence`).all(planId).map(rowFrame)

			for (const frame of publishing) {
				const published = await stat(frame.path).catch(() => undefined)

				if (published?.size === frame.size) {
					write({ type: 'committed', frameId: frame.frameId, at: Date.now() })
				} else if (published) {
					write({ type: 'rejected', frame: { ...frame, verdict: 'incomplete', reason: 'The published file is not the examined one' } })
				} else if (frame.staged && (await stat(frame.staged).catch(() => undefined))) {
					await publishFrame(frame.staged, frame.path)
					write({ type: 'committed', frameId: frame.frameId, at: Date.now() })
				} else {
					write({ type: 'rejected', frame: { ...frame, verdict: 'incomplete', size: 0, reason: 'The frame was lost before it was published' } })
				}
			}

			await this.#quarantine(planId)
			write({ type: 'status', at: Date.now(), status: 'interrupted', reason: 'The server stopped during the acquisition' })
		} catch (error) {
			console.error('unable to reconcile the dark plan', planId, error)
		}
	}

	// Returns what a listing shows of the plans, newest first, keeping those a filter accepts, at most limit.
	list(accept: (plan: DarkCapturePlan) => boolean = () => true, limit = Number.POSITIVE_INFINITY): Promise<readonly DarkPlanSummary[]> {
		return Promise.try(() => {
			const summaries: DarkPlanSummary[] = []

			for (const row of this.database.db.query<DarkPlanRow, []>(`SELECT ${PLAN_COLUMNS} FROM dark_plans ORDER BY created_at DESC, plan_id`).all()) {
				if (summaries.length >= limit) break
				const plan = this.#plan(row)
				if (accept(plan)) summaries.push(this.#summary(row, plan))
			}

			return summaries
		})
	}

	// Returns the specification of a plan.
	plan(planId: string): Promise<DarkCapturePlan | undefined> {
		return Promise.try(() => {
			const row = this.#row(planId)
			return row && this.#plan(row)
		})
	}

	// Returns the committed and quarantined frames of a plan, in the order they were recorded.
	frames(planId: string): Promise<{ readonly frames: readonly DarkFrameRecord[] } | undefined> {
		return Promise.try(() => {
			if (!this.#row(planId)) return undefined
			const rows = this.database.db.query<DarkFrameRow, [string]>(`SELECT ${FRAME_COLUMNS} FROM dark_frames WHERE plan_id = ? AND state <> 'publishing' ORDER BY position`).all(planId)
			return { frames: rows.map(rowFrame) }
		})
	}

	// Returns the complete record of a plan with its latest frames, at most limit.
	detail(planId: string, limit: number): Promise<DarkPlanDetail | undefined> {
		return Promise.try(() => {
			const row = this.#row(planId)
			if (!row) return undefined

			const { db } = this.database
			const plan = this.#plan(row)
			const latest = db.query<DarkFrameRow, [string, number]>(`SELECT ${FRAME_COLUMNS} FROM dark_frames WHERE plan_id = ? AND state <> 'publishing' ORDER BY position DESC LIMIT ?`).all(planId, limit)
			const { count } = db.query<{ count: number }, [string]>("SELECT count(*) AS count FROM dark_frames WHERE plan_id = ? AND state <> 'publishing'").get(planId)!
			return { ...this.#summary(row, plan), plan, frames: latest.toReversed().map(rowFrame), frameCount: count }
		})
	}

	// Creates a plan, with the running status of its first session. Rejects when it cannot be written; nothing of it is
	// then kept.
	create(plan: DarkCapturePlan, sessionId: string): Promise<void> {
		return Promise.try(() =>
			this.database.write(() => {
				const { db } = this.database
				const { planId, createdAt, directory, groups, purpose, generateMasters, camera, wheel, panel, cover, capture, protection, thermal, maximumRejections } = plan
				const spec: DarkPlanSpec = { camera, ...(wheel && { wheel }), ...(panel && { panel }), ...(cover && { cover }), capture, protection, thermal, maximumRejections }
				db.query("INSERT INTO dark_plans (plan_id, created_at, directory, purpose, generate_masters, spec, status, session_id, cleanup_warnings, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '[]', ?)").run(
					planId,
					createdAt,
					directory,
					purpose ?? null,
					generateMasters ? 1 : 0,
					JSON.stringify(spec),
					sessionId,
					Date.now(),
				)
				const group = db.query('INSERT INTO dark_groups (plan_id, group_id, position, key, exposure, temperature, count, directory) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
				for (const [position, { groupId, key, exposure, temperature, count, directory: groupDirectory }] of groups.entries()) group.run(planId, groupId, position, key, exposure, temperature ?? null, count, groupDirectory)
			}),
		)
	}

	// Records a change of a plan. Rejects when it cannot be written, or the plan is unknown.
	append(planId: string, record: DarkJournalRecord): Promise<void> {
		return Promise.try(() => this.database.write(() => this.#apply(planId, record)))
	}

	// Moves whatever the staging directories of a plan hold into their rejected directories, each file with a record that
	// says so: a session that ended, one way or another, examined none of it, so it must neither count nor vanish.
	async quarantineStaging(planId: string): Promise<void> {
		if (this.#row(planId)) await this.#quarantine(planId)
	}

	// Moves what the staging directories of a plan hold into their rejected directories (see quarantineStaging).
	async #quarantine(planId: string) {
		const { db } = this.database
		const row = this.#row(planId)
		if (!row) return

		for (const group of this.#plan(row).groups) {
			const staging = join(group.directory, STAGING_DIRECTORY)
			const files = await readdir(staging).catch(() => [] as string[])
			let sequence = db.query<{ sequence: number }, [string, string]>('SELECT coalesce(max(sequence), 0) AS sequence FROM dark_frames WHERE plan_id = ? AND group_id = ?').get(planId, group.groupId)!.sequence

			for (const file of files) {
				const staged = join(staging, file)
				const { size } = await stat(staged)
				const frameId = crypto.randomUUID()
				const path = await quarantine(staged, group.directory, `incomplete_${frameId}.fit`)
				const frame: DarkFrameRecord = { frameId, groupId: group.groupId, sequence: ++sequence, path, size, time: Date.now(), verdict: 'incomplete', reason: 'The frame was not examined before its session ended', planes: [], rejections: [], suspicions: [], notes: [] }
				this.database.write(() => this.#apply(planId, { type: 'rejected', frame }))
			}
		}
	}
}
