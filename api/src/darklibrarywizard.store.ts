import { mkdir, open, readdir, readFile, stat, truncate } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { type DarkFrameAssessment, type DarkFrameHeader, type DarkPlaneMeasurement, type DarkTemperatureTrace, readDarkFrameHeader } from './darklibrarywizard.analysis'
import { publishFrame } from './flatwizard'
import { errorCode, isRecord, writeAtomically } from './util'

// Durable records of the Dark Library Wizard. Each plan is two files under ~/Nebulosa/dark-library/plans: <planId>.json,
// the immutable specification written once, and <planId>.journal.jsonl, one JSON record per line, appended and synced to
// the disk one at a time, so a plan of thousands of frames never rewrites what it already recorded. A record ends with a
// newline: a last line without one was torn by a crash and is cut off when the journal is read. A frame counts only once
// it was committed, which happens in three steps (publishing, the file is linked, committed), so a crash between them is
// reconciled from the journal and the file itself, never assumed. The directory is read once, on first use, before any
// session of the process runs, so whatever was running then belongs to a process that ended: its plan becomes
// interrupted, and what its staging directories hold is quarantined, never deleted. Nothing here resumes a device.
// The frames themselves live in the output directory of the plan, and a file that cannot be used costs only its plan.
// This is the ledger of what the wizard acquired, not a calibration library. Times are Unix milliseconds, exposures
// seconds, temperatures degrees Celsius. Plans never hold pixels, and server paths never leave through events.

// Directory the plans are persisted in when none is given.
export const DEFAULT_DARK_PLANS_DIRECTORY = join(homedir(), 'Nebulosa', 'dark-library', 'plans')

// Version of the plan and journal formats written by this version.
export const DARK_PLAN_VERSION = 1

// Files verified at the same time.
const VERIFICATION_CONCURRENCY = 8

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
	// Version of the format.
	readonly version: number
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

// Record of the journal of a plan.
export type DarkJournalRecord =
	// The acquisition changed state.
	| { readonly type: 'status'; readonly at: number; readonly status: DarkPlanStatus; readonly sessionId?: string; readonly operationId?: string; readonly reason?: string }
	// A frame is about to be published as path, from its staged file.
	| { readonly type: 'publishing'; readonly frame: DarkFrameRecord }
	// The frame was published and counts.
	| { readonly type: 'committed'; readonly frameId: string; readonly at: number }
	// A frame that does not count was quarantined as path.
	| { readonly type: 'rejected'; readonly frame: DarkFrameRecord }
	// A committed frame no longer verifies and stopped counting.
	| { readonly type: 'lost'; readonly frameId: string; readonly at: number; readonly reason: string }
	// What the latest session could not restore.
	| { readonly type: 'cleanup'; readonly at: number; readonly warnings: readonly string[] }

// Counts of one group, from the journal.
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
	// Frames that stopped verifying.
	readonly lost: number
	// Frames still required.
	readonly missing: number
}

// What a listing shows of a plan, without its frames.
export interface DarkPlanSummary {
	// Id of the plan.
	readonly planId: string
	// When the plan was created.
	readonly createdAt: number
	// When its journal last changed.
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
	// Committed frames that stopped verifying, by frame id, and why.
	readonly lost: Readonly<Record<string, string>>
}

// A plan that cannot be used; its files stay on the disk as they are.
export interface UnavailableDarkPlan {
	// Name of the file, without its extension.
	readonly planId: string
	// Why it cannot be used: not a plan document, or written by a newer version.
	readonly reason: 'corrupt' | 'newerVersion'
}

// A plan as the store holds it.
interface LoadedPlan {
	readonly plan: DarkCapturePlan
	// Status recorded last.
	status: DarkPlanStatus
	// Why the latest session ended.
	reason?: string
	// When the journal last changed.
	updatedAt: number
	// Frames in journal order, committed or quarantined.
	readonly frames: DarkFrameRecord[]
	// Frames being published, by frame id.
	readonly publishing: Map<string, DarkFrameRecord>
	// Committed frames that stopped verifying, by frame id, and why.
	readonly lost: Map<string, string>
	// What the latest session could not restore.
	cleanupWarnings: readonly string[]
}

// Plans read from the directory.
interface LoadedPlans {
	// Usable plans, by id.
	readonly plans: Map<string, LoadedPlan>
	// Files that cannot be used, by id.
	readonly unavailable: Map<string, UnavailableDarkPlan>
}

// Result of parsing a journal.
export interface ParsedDarkJournal {
	// Records in order.
	readonly records: readonly DarkJournalRecord[]
	// Bytes of the journal that hold whole records; what follows was torn by a crash.
	readonly length: number
}

// Parses a journal. A last line without its newline was torn by a crash and is left out. Throws when a whole line is not
// a record, since the journal could then hide frames.
export function parseDarkJournal(text: string): ParsedDarkJournal {
	const records: DarkJournalRecord[] = []
	let length = 0

	for (let start = 0, end = text.indexOf('\n'); end >= 0; start = end + 1, end = text.indexOf('\n', start)) {
		records.push(JSON.parse(text.slice(start, end)) as DarkJournalRecord)
		length = end + 1
	}

	return { records, length: Buffer.byteLength(text.slice(0, length)) }
}

// Applies a journal record to a plan.
function applyRecord(loaded: LoadedPlan, record: DarkJournalRecord) {
	switch (record.type) {
		case 'status':
			loaded.status = record.status
			loaded.reason = record.reason
			loaded.updatedAt = record.at
			if (record.status === 'running') loaded.cleanupWarnings = []
			break
		case 'publishing':
			loaded.publishing.set(record.frame.frameId, record.frame)
			break
		case 'committed': {
			const frame = loaded.publishing.get(record.frameId)
			if (frame) loaded.frames.push(frame)
			loaded.publishing.delete(record.frameId)
			loaded.updatedAt = record.at
			break
		}
		case 'rejected':
			loaded.publishing.delete(record.frame.frameId)
			loaded.frames.push(record.frame)
			break
		case 'lost':
			loaded.lost.set(record.frameId, record.reason)
			loaded.updatedAt = record.at
			break
		case 'cleanup':
			loaded.cleanupWarnings = record.warnings
			loaded.updatedAt = record.at
			break
	}
}

// Returns whether a frame counts toward its group: published, and still verifying.
function counts(loaded: Pick<LoadedPlan, 'lost'>, frame: DarkFrameRecord) {
	return (frame.verdict === 'accepted' || frame.verdict === 'acceptedWithWarnings') && !loaded.lost.has(frame.frameId)
}

// Returns the counts of each group of a plan.
export function darkGroupProgress(plan: Pick<DarkCapturePlan, 'groups'>, frames: readonly DarkFrameRecord[], lost: ReadonlyMap<string, string>): DarkGroupProgress[] {
	return plan.groups.map(({ groupId, count }) => {
		const progress = { groupId, required: count, accepted: 0, acceptedWithWarnings: 0, rejected: 0, incomplete: 0, lost: 0 }

		for (const frame of frames) {
			if (frame.groupId !== groupId) continue
			if (lost.has(frame.frameId)) progress.lost++
			else if (frame.verdict === 'accepted') progress.accepted++
			else if (frame.verdict === 'acceptedWithWarnings') progress.acceptedWithWarnings++
			else if (frame.verdict === 'rejected') progress.rejected++
			else progress.incomplete++
		}

		return { ...progress, missing: Math.max(0, count - progress.accepted - progress.acceptedWithWarnings) }
	})
}

// Returns what a listing shows of a plan.
function summaryOf(loaded: LoadedPlan): DarkPlanSummary {
	const { plan, status, reason, updatedAt, frames, lost, cleanupWarnings } = loaded
	const progress = darkGroupProgress(plan, frames, lost)
	const groups = plan.groups.map(({ exposure, temperature, count }, index) => ({ exposure, ...(temperature !== undefined && { temperature }), count, ...progress[index] }))
	return { planId: plan.planId, createdAt: plan.createdAt, updatedAt, status, ...(reason !== undefined && { reason }), groups, missing: progress.reduce((total, group) => total + group.missing, 0), cleanupWarnings }
}

// Moves a file into the rejected directory beside it, under a name of its own. Returns its new path.
async function quarantine(staged: string, directory: string, name: string) {
	const rejected = join(directory, REJECTED_DIRECTORY)
	await mkdir(rejected, { recursive: true })
	const path = join(rejected, name)
	await publishFrame(staged, path)
	return path
}

// Durable plans of the Dark Library Wizard. The directory is read on first use, so creating the store has no side effect.
export class DarkPlanStore {
	// Plans read from the directory, once the first read started.
	#loaded?: Promise<LoadedPlans>
	// Tail of the writes in progress of each plan, which run one at a time.
	readonly #queues = new Map<string, Promise<unknown>>()

	// Creates the store of the files in directory.
	constructor(readonly directory: string = DEFAULT_DARK_PLANS_DIRECTORY) {}

	// Returns the file of the specification of a plan.
	#planFile(planId: string) {
		return join(this.directory, `${planId}.json`)
	}

	// Returns the journal of a plan.
	#journalFile(planId: string) {
		return join(this.directory, `${planId}.journal.jsonl`)
	}

	// Reads one plan: its specification and journal, cutting off a torn record so the next append starts a line of its own.
	async #readPlan(planId: string): Promise<LoadedPlan | UnavailableDarkPlan['reason']> {
		let data: unknown

		try {
			data = JSON.parse(await readFile(this.#planFile(planId), 'utf-8'))
		} catch {
			return 'corrupt'
		}

		if (!isRecord(data) || !Number.isInteger(data.version) || typeof data.planId !== 'string' || !Array.isArray(data.groups)) return 'corrupt'
		if ((data.version as number) > DARK_PLAN_VERSION) return 'newerVersion'

		const plan = data as unknown as DarkCapturePlan
		const loaded: LoadedPlan = { plan, status: 'interrupted', updatedAt: plan.createdAt, frames: [], publishing: new Map(), lost: new Map(), cleanupWarnings: [] }
		const journal = this.#journalFile(planId)
		let text: string

		try {
			text = await readFile(journal, 'utf-8')
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return loaded
			return 'corrupt'
		}

		try {
			const { records, length } = parseDarkJournal(text)
			for (const record of records) applyRecord(loaded, record)
			if (length < Buffer.byteLength(text)) await truncate(journal, length)
			return loaded
		} catch {
			return 'corrupt'
		}
	}

	// Reconciles a plan its process left behind: a frame being published is confirmed from its file or finished from its
	// staged copy, since it was examined already, and anything else in a staging directory is quarantined. Recording this
	// can fail on a read-only disk, which leaves the plan as read; it is reconciled again on the next start of the server.
	async #reconcile(loaded: LoadedPlan) {
		const { plan } = loaded
		const write = async (record: DarkJournalRecord) => await this.#write(loaded, record)

		try {
			for (const frame of Array.from(loaded.publishing.values())) {
				const published = await stat(frame.path).catch(() => undefined)

				if (published?.size === frame.size) {
					await write({ type: 'committed', frameId: frame.frameId, at: Date.now() })
				} else if (published) {
					await write({ type: 'rejected', frame: { ...frame, verdict: 'incomplete', reason: 'The published file is not the examined one' } })
				} else if (frame.staged && (await stat(frame.staged).catch(() => undefined))) {
					await publishFrame(frame.staged, frame.path)
					await write({ type: 'committed', frameId: frame.frameId, at: Date.now() })
				} else {
					await write({ type: 'rejected', frame: { ...frame, verdict: 'incomplete', size: 0, reason: 'The frame was lost before it was published' } })
				}
			}

			await this.#quarantine(loaded)
			await write({ type: 'status', at: Date.now(), status: 'interrupted', reason: 'The server stopped during the acquisition' })
		} catch (error) {
			console.error('unable to reconcile the dark plan', plan.planId, error)
			loaded.status = 'interrupted'
		}
	}

	// Reads every plan of the directory. A missing directory gives no plans.
	async #read(): Promise<LoadedPlans> {
		const plans = new Map<string, LoadedPlan>()
		const unavailable = new Map<string, UnavailableDarkPlan>()
		let files: string[]

		try {
			files = await readdir(this.directory)
		} catch (error) {
			const code = errorCode(error)
			if (code === 'ENOENT' || code === 'ENOTDIR') return { plans, unavailable }
			throw error
		}

		for (const file of files) {
			if (!file.endsWith('.json')) continue

			const planId = file.slice(0, -5)
			const parsed = await this.#readPlan(planId)

			if (typeof parsed === 'string') unavailable.set(planId, { planId, reason: parsed })
			else plans.set(planId, parsed)
		}

		return { plans, unavailable }
	}

	// Returns the plans, reading and reconciling the directory on the first call.
	#load(): Promise<LoadedPlans> {
		this.#loaded ??= this.#read().then(async (loaded) => {
			for (const plan of loaded.plans.values()) if (plan.status === 'running' || plan.status === 'paused' || plan.publishing.size > 0) await this.#reconcile(plan)
			return loaded
		})

		return this.#loaded
	}

	// Runs a write of a plan after the ones in progress.
	#enqueue<T>(planId: string, write: () => Promise<T>): Promise<T> {
		const run = (this.#queues.get(planId) ?? Promise.resolve()).then(write)
		this.#queues.set(
			planId,
			run.catch(() => undefined),
		)
		return run
	}

	// Appends a record to the journal, synced to the disk, and applies it. Throws when it cannot be written; the plan is
	// then unchanged.
	#write(loaded: LoadedPlan, record: DarkJournalRecord): Promise<void> {
		const { planId } = loaded.plan

		return this.#enqueue(planId, async () => {
			const journal = this.#journalFile(planId)
			const handle = await open(journal, 'a')

			try {
				await handle.appendFile(`${JSON.stringify(record)}\n`)
				await handle.sync()
			} finally {
				await handle.close()
			}

			applyRecord(loaded, record)
		})
	}

	// Returns a plan as held, or undefined when there is none or its file cannot be used.
	async #find(planId: string) {
		return (await this.#load()).plans.get(planId)
	}

	// Returns what a listing shows of the usable plans, newest first, keeping those a filter accepts, at most limit.
	async list(accept: (plan: DarkCapturePlan) => boolean = () => true, limit = Number.POSITIVE_INFINITY): Promise<readonly DarkPlanSummary[]> {
		const { plans } = await this.#load()
		return Array.from(plans.values())
			.filter(({ plan }) => accept(plan))
			.sort((a, b) => b.plan.createdAt - a.plan.createdAt || a.plan.planId.localeCompare(b.plan.planId))
			.slice(0, limit)
			.map(summaryOf)
	}

	// Returns the files that cannot be used.
	async unavailable(): Promise<readonly UnavailableDarkPlan[]> {
		return Array.from((await this.#load()).unavailable.values())
	}

	// Returns the specification of a plan.
	async plan(planId: string): Promise<DarkCapturePlan | undefined> {
		return (await this.#find(planId))?.plan
	}

	// Returns the frames of a plan, in journal order, with those that stopped verifying.
	async frames(planId: string): Promise<{ readonly frames: readonly DarkFrameRecord[]; readonly lost: ReadonlyMap<string, string> } | undefined> {
		const loaded = await this.#find(planId)
		return loaded && { frames: loaded.frames, lost: loaded.lost }
	}

	// Returns the complete record of a plan with its latest frames, at most limit.
	async detail(planId: string, limit: number): Promise<DarkPlanDetail | undefined> {
		const loaded = await this.#find(planId)
		return loaded && { ...summaryOf(loaded), plan: loaded.plan, frames: loaded.frames.slice(-limit), frameCount: loaded.frames.length, lost: Object.fromEntries(loaded.lost) }
	}

	// Creates a plan: writes its specification and the running status of its first session. Throws when a file cannot be
	// written; a specification left without its journal reads as an interrupted plan without frames.
	async create(plan: DarkCapturePlan, sessionId: string): Promise<void> {
		const { plans } = await this.#load()
		await writeAtomically(this.#planFile(plan.planId), `${JSON.stringify(plan)}\n`)
		const loaded: LoadedPlan = { plan, status: 'running', updatedAt: plan.createdAt, frames: [], publishing: new Map(), lost: new Map(), cleanupWarnings: [] }
		await this.#write(loaded, { type: 'status', at: Date.now(), status: 'running', sessionId })
		plans.set(plan.planId, loaded)
	}

	// Appends a record to the journal of a plan. Throws when it cannot be written, or the plan is unknown.
	async append(planId: string, record: DarkJournalRecord): Promise<void> {
		const loaded = await this.#find(planId)
		if (!loaded) throw new Error(`Unknown dark plan ${planId}`)
		await this.#write(loaded, record)
	}

	// Moves whatever the staging directories of a plan hold into their rejected directories, each file with a record that
	// says so: a session that ended, one way or another, examined none of it, so it must neither count nor vanish.
	async quarantineStaging(planId: string): Promise<void> {
		const loaded = await this.#find(planId)
		if (loaded) await this.#quarantine(loaded)
	}

	// Moves what the staging directories of a plan hold into their rejected directories (see quarantineStaging).
	async #quarantine(loaded: LoadedPlan) {
		for (const group of loaded.plan.groups) {
			const staging = join(group.directory, STAGING_DIRECTORY)
			const files = await readdir(staging).catch(() => [] as string[])
			let sequence = Math.max(0, ...loaded.frames.filter((frame) => frame.groupId === group.groupId).map((frame) => frame.sequence))

			for (const file of files) {
				const staged = join(staging, file)
				const { size } = await stat(staged)
				const frameId = crypto.randomUUID()
				const path = await quarantine(staged, group.directory, `incomplete_${frameId}.fit`)
				const frame: DarkFrameRecord = { frameId, groupId: group.groupId, sequence: ++sequence, path, size, time: Date.now(), verdict: 'incomplete', reason: 'The frame was not examined before its session ended', planes: [], rejections: [], suspicions: [], notes: [] }
				await this.#write(loaded, { type: 'rejected', frame })
			}
		}
	}

	// Verifies the frames of a plan that count, a few files at a time: each must exist with the size it was examined at,
	// hold a FITS image, and agree with the header it was examined with. One that does not stops counting, with the
	// reason recorded. Resolves the plan's counts. Throws when the result cannot be recorded.
	async verify(planId: string): Promise<readonly DarkGroupProgress[] | undefined> {
		const loaded = await this.#find(planId)
		if (!loaded) return undefined

		const pending = loaded.frames.filter((frame) => counts(loaded, frame))
		const check = async (frame: DarkFrameRecord) => {
			const reason = await frameFault(frame)
			if (reason) await this.#write(loaded, { type: 'lost', frameId: frame.frameId, at: Date.now(), reason })
		}

		await Promise.all(
			Array.from({ length: VERIFICATION_CONCURRENCY }, async () => {
				for (let frame = pending.shift(); frame; frame = pending.shift()) await check(frame)
			}),
		)

		return darkGroupProgress(loaded.plan, loaded.frames, loaded.lost)
	}
}

// Returns why a saved frame can no longer be counted, or undefined when it still verifies.
async function frameFault({ path, size, header }: DarkFrameRecord): Promise<string | undefined> {
	const file = await stat(path).catch(() => undefined)
	if (!file) return 'The file is missing'
	if (file.size !== size) return `The file has ${file.size} bytes instead of ${size}`

	try {
		const found = await readDarkFrameHeader(path)
		if (header && (found.width !== header.width || found.height !== header.height || found.exposure !== header.exposure || found.gain !== header.gain || found.offset !== header.offset)) return 'The header no longer matches the frame that was examined'
		return undefined
	} catch (error) {
		return `The file cannot be read: ${Error.isError(error) ? error.message : String(error)}`
	}
}
