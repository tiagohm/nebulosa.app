import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { BacklashCompensationMode } from 'nebulosa/src/observation/focus/backlash'
import { errorCode, isRecord, writeAtomically } from './util'

// Backlash compensation settings of every physical focuser, persisted in a versioned JSON file of the server.
// A focuser is identified by its connection id and device id, both stable across restarts of the server and
// reconnects of the same endpoint, so two focusers of the same name on different connections never share
// settings. Profiles only choose focusers; they never hold these settings. The store only persists: the
// focuser commands snapshot the settings when a move starts and apply them through the toolkit's
// BacklashCompensator.

// Compensation strategy of an enabled compensation; the toolkit's NONE is expressed by enabled being false.
export type FocuserBacklashMode = Exclude<BacklashCompensationMode, 'NONE'>

// Backlash compensation of a focuser, as edited by people.
export interface FocuserBacklashConfig {
	// Whether the moves of the focuser are compensated; the other fields are kept while disabled.
	readonly enabled: boolean
	// Compensation strategy.
	readonly mode: FocuserBacklashMode
	// Backlash absorbed when reversing into the IN direction (decreasing position), in steps; integer >= 0.
	readonly backlashIn: number
	// Backlash absorbed when reversing into the OUT direction (increasing position), in steps; integer >= 0.
	readonly backlashOut: number
}

// Saved compensation of a focuser.
export interface StoredFocuserBacklash extends FocuserBacklashConfig {
	// Revision of the settings, increased by every save; 0 when never saved.
	readonly revision: number
}

// Settings read from the settings file.
interface LoadedFocusers {
	// Saved settings by focuser key; focusers absent here use the defaults.
	readonly focusers: ReadonlyMap<string, StoredFocuserBacklash>
	// Why the file cannot be used; absent when it was read or does not exist.
	readonly error?: string
	// Whether the file was written by a newer version, so it must not be overwritten.
	readonly newer?: boolean
}

// Outcome of a save: saved, refused because another revision was saved since, or refused because the file
// was written by a newer version, which is never overwritten.
export type FocuserBacklashSaveOutcome = { readonly status: 'saved'; readonly settings: StoredFocuserBacklash } | { readonly status: 'conflict'; readonly settings: StoredFocuserBacklash } | { readonly status: 'newerVersion' }

// File the focuser settings are persisted in when none is given.
export const DEFAULT_FOCUSERS_FILE = join(homedir(), 'Nebulosa', 'focusers.json')

// Version of the focuser settings file format written by this version.
const FOCUSERS_VERSION = 1

// Settings of a focuser never saved: compensation disabled with neutral amounts.
export const DEFAULT_FOCUSER_BACKLASH: StoredFocuserBacklash = { enabled: false, mode: 'OVERSHOOT', backlashIn: 0, backlashOut: 0, revision: 0 }

// Key of a focuser in the settings file.
export function focuserKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Whether value is a whole number of steps >= 0.
function isSteps(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0
}

// Reads the saved settings of a focuser from the file, whose content is not trusted: an unknown mode becomes
// the default one, amounts and revisions that are not non-negative integers become 0.
function normalizeFocuser(value: unknown): StoredFocuserBacklash {
	const { enabled, mode, backlashIn, backlashOut, revision } = isRecord(value) ? value : {}
	return {
		enabled: enabled === true,
		mode: mode === 'ABSOLUTE' || mode === 'OVERSHOOT' ? mode : DEFAULT_FOCUSER_BACKLASH.mode,
		backlashIn: isSteps(backlashIn) ? backlashIn : 0,
		backlashOut: isSteps(backlashOut) ? backlashOut : 0,
		revision: isSteps(revision) ? revision : 0,
	}
}

// Parses the content of the focuser settings file. Content that is not a focuser settings document is
// reported as an error; a document of a newer version is read as far as it is understood and marked as newer.
export function parseFocusers(text: string): LoadedFocusers {
	let data: unknown

	try {
		data = JSON.parse(text)
	} catch {
		return { focusers: new Map(), error: 'The focuser settings file is not valid JSON' }
	}

	if (!isRecord(data) || !isRecord(data.focusers) || !Number.isInteger(data.version)) return { focusers: new Map(), error: 'The focuser settings file is not a Nebulosa settings document' }

	const focusers = new Map(Object.entries(data.focusers).map(([key, value]) => [key, normalizeFocuser(value)]))
	if ((data.version as number) > FOCUSERS_VERSION) return { focusers, error: 'The focuser settings file was written by a newer version of Nebulosa', newer: true }
	return { focusers }
}

// Returns the content of the focuser settings file.
function serializeFocusers(focusers: ReadonlyMap<string, StoredFocuserBacklash>) {
	return `${JSON.stringify({ version: FOCUSERS_VERSION, focusers: Object.fromEntries(focusers) }, undefined, '\t')}\n`
}

// Backlash settings of the focusers, persisted in a JSON file of the server. The file is read on first use,
// so creating the store has no side effect. Saves are applied one at a time; a save made from an outdated
// revision is refused, so two tabs never overwrite each other silently.
export class FocuserBacklashStore {
	// Settings read from the file, once the first read started.
	#loaded?: Promise<LoadedFocusers>
	// Tail of the saves in progress, which run one at a time.
	#queue: Promise<unknown> = Promise.resolve()

	// Creates the store of the settings file at file.
	constructor(readonly file: string = DEFAULT_FOCUSERS_FILE) {}

	// Returns the settings read from the file, reading it on the first call. A missing file gives the defaults.
	#load(): Promise<LoadedFocusers> {
		return (this.#loaded ??= readFile(this.file, 'utf-8').then(parseFocusers, (error: unknown) => {
			const code = errorCode(error)
			return code === 'ENOTDIR' || code === 'ENOENT' ? { focusers: new Map() } : { focusers: new Map(), error: 'The focuser settings file cannot be read' }
		}))
	}

	// Returns the saved settings of a focuser, the defaults when never saved, and why the file cannot be used,
	// if it cannot. The returned settings are a snapshot: a later save never changes them.
	async get(connectionId: string, deviceId: string): Promise<{ readonly settings: StoredFocuserBacklash; readonly error?: string }> {
		const { focusers, error } = await this.#load()
		const settings = focusers.get(focuserKey(connectionId, deviceId)) ?? DEFAULT_FOCUSER_BACKLASH
		return error ? { settings, error } : { settings }
	}

	// Saves the settings of a focuser edited from revision, replacing an unreadable settings file. Throws when
	// the file cannot be written; the saved settings are then unchanged.
	save(connectionId: string, deviceId: string, config: FocuserBacklashConfig, revision: number): Promise<FocuserBacklashSaveOutcome> {
		const run = this.#queue.then(async (): Promise<FocuserBacklashSaveOutcome> => {
			const loaded = await this.#load()
			if (loaded.newer) return { status: 'newerVersion' }

			const key = focuserKey(connectionId, deviceId)
			const current = loaded.focusers.get(key) ?? DEFAULT_FOCUSER_BACKLASH
			if (revision !== current.revision) return { status: 'conflict', settings: current }

			const { enabled, mode, backlashIn, backlashOut } = config
			const settings: StoredFocuserBacklash = { enabled, mode, backlashIn, backlashOut, revision: current.revision + 1 }
			const focusers = new Map(loaded.focusers).set(key, settings)
			await writeAtomically(this.file, serializeFocusers(focusers))

			this.#loaded = Promise.resolve({ focusers })
			return { status: 'saved', settings }
		})

		this.#queue = run.catch(() => undefined)
		return run
	}
}
