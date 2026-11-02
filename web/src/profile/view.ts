import { subscribe } from 'valtio'
import type { ProfileState } from './profile'
import type { ProfileSettings, SkyFramingSettings } from './schema'
import { type WorkspaceSyncState, workspaceSyncState } from './sync'

// View state of the tab: the fields of a profile the server never keeps (panels, last directories, the time bar, which
// framing is drawn, the Image Processing pipeline, the preferences of Close Approaches and Astro Weather) and which profile
// is active. VIEW_STORAGE says, for each one, the browser storage areas it is kept in: sessionStorage keeps it for this
// tab across its reloads, localStorage for every tab of the browser across its restarts, and a field kept in both is read
// from the first area that holds it and written to all of them. Each area holds one document per profile, written
// whenever a field kept there changes, and removed with its profile. A document of another VIEW_VERSION, or that cannot
// be read, is ignored and replaced; nothing is migrated. A storage that cannot be used (a private window, blocked site
// data, a full quota) leaves the field in memory only. The server, other browsers, and the workspace synchronization never
// see any of it.

// Browser storage area a field is kept in.
export type ViewStorageArea = 'local' | 'session'

// Storage areas of the browser, or none where one cannot be used.
export type ViewStorages = Readonly<Partial<Record<ViewStorageArea, Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>>>>

// Version of the shape of the documents; a document of another version is ignored and replaced.
const VIEW_VERSION = 1

// Prefix of the keys of this application in browser storage.
const PREFIX = 'nebulosa:'

// Key of the id of the active profile.
const ACTIVE_PROFILE_KEY = `${PREFIX}activeProfile`

// Returns the key of the view document of a profile.
function documentKey(profileId: string) {
	return `${PREFIX}view:${profileId}`
}

// How a field of the view is read from and written to the settings of a profile.
interface ViewField {
	// Value of the field in settings; undefined when absent.
	readonly get: (settings: ProfileSettings) => unknown
	// Gives settings a value of the field read back from storage.
	readonly set: (settings: ProfileSettings, value: unknown) => void
}

// Fields of the framing that are view state; the presets and the sensor are kept by the server.
type FramingView = Pick<SkyFramingSettings, 'activePresetId' | 'visible' | 'source' | 'sensorSource'>

// Field of the view kept as an optional field of ProfileSettings.
function setting(key: 'lastImageDirectory' | 'lastSaveDirectory' | 'imageProcessing' | 'closeApproaches' | 'astroWeather'): ViewField {
	return {
		get: (settings) => settings[key],
		set: (settings, value) => Object.assign(settings, { [key]: value }),
	}
}

// Every field of the view of a profile, and where it lives in its settings.
const VIEW_FIELDS = {
	panels: {
		get: (settings) => (Object.keys(settings.panels).length > 0 ? settings.panels : undefined),
		set: (settings, value) => (settings.panels = { ...(value as ProfileSettings['panels']) }),
	},
	lastImageDirectory: setting('lastImageDirectory'),
	lastSaveDirectory: setting('lastSaveDirectory'),
	imageProcessing: setting('imageProcessing'),
	closeApproaches: setting('closeApproaches'),
	astroWeather: setting('astroWeather'),
	skyTimeBar: {
		get: (settings) => settings.sky.timeBar,
		set: (settings, value) => (settings.sky.timeBar = value as boolean),
	},
	skyFraming: {
		get: ({ sky: { framing } }) => framing && ({ activePresetId: framing.activePresetId, visible: framing.visible, source: framing.source, sensorSource: framing.sensorSource } satisfies FramingView),
		// Applies to the framing the server kept, never creating one, and draws only a preset it still has.
		set: (settings, value) => {
			const framing = settings.sky.framing
			if (!framing) return
			const { activePresetId, visible, source, sensorSource } = value as FramingView
			Object.assign(framing, { visible, source, sensorSource, activePresetId: framing.presets.some(({ id }) => id === activePresetId) ? activePresetId : framing.activePresetId })
		},
	},
} as const satisfies Record<string, ViewField>

// Field of the view of a profile.
export type ViewFieldKey = keyof typeof VIEW_FIELDS

// Fields of the view in a fixed order.
const VIEW_FIELD_KEYS = Object.keys(VIEW_FIELDS) as ViewFieldKey[]

// Storage areas of each field of the view and of the active profile, in the order they are read; every one listed is
// written. An empty list keeps the field in the memory of the page only.
export const VIEW_STORAGE: Readonly<Record<ViewFieldKey | 'activeProfile', readonly ViewStorageArea[]>> = {
	// This tab's profile, across its reloads; a new tab opens on the profile used last in the browser.
	activeProfile: ['session', 'local'],
	panels: ['local'],
	lastImageDirectory: ['local'],
	lastSaveDirectory: ['local'],
	imageProcessing: ['local'],
	closeApproaches: ['local'],
	astroWeather: ['local'],
	// Whether the simulation clock is shown belongs to what this tab is doing.
	skyTimeBar: ['session'],
	skyFraming: ['local'],
}

// Document of the view of a profile in one storage area.
interface ViewDocument {
	// VIEW_VERSION it was written with.
	readonly version: number
	// Values of the fields kept in that area; an absent field is absent.
	readonly fields: Partial<Record<ViewFieldKey, unknown>>
}

// Returns the storage areas of the browser, leaving out one that cannot be used.
export function browserStorages(): ViewStorages {
	const area = (name: 'localStorage' | 'sessionStorage') => {
		try {
			return globalThis[name]
		} catch {
			return undefined
		}
	}

	return { local: area('localStorage'), session: area('sessionStorage') }
}

// Keeps the view state of the tab in browser storage, as VIEW_STORAGE says.
export class ViewPersistence {
	// Profiles whose view was read from storage, so a default never overwrites what is stored.
	readonly #restored = new Set<string>()
	// Text last written or read for each key of each area, null when known to be absent, so an unchanged document is not
	// written again.
	readonly #written = new Map<string, string | null>()
	// Whether the active profile was restored, which happens once.
	#activeRestored = false

	// profiles is the store of the tab, status the state of its workspace synchronization, and storages where the view is
	// kept.
	constructor(
		readonly profiles: ProfileState,
		readonly status: WorkspaceSyncState = workspaceSyncState,
		readonly storages: ViewStorages = browserStorages(),
	) {}

	// Restores the view once the workspace is loaded, before anything renders it, and writes every later change. Returns a
	// function that stops it.
	start(): () => void {
		const stops = [subscribe(this.status, () => this.status.loaded && this.#restoreAll(), true), subscribe(this.profiles, () => this.status.loaded && this.#changed())]

		if (this.status.loaded) this.#restoreAll()
		return () => {
			for (const stop of stops) stop()
		}
	}

	// Reads the text of a key of an area; undefined when absent or when the area cannot be used.
	#read(area: ViewStorageArea, key: string) {
		try {
			const storage = this.storages[area]
			if (!storage) return undefined
			const text = storage.getItem(key)
			this.#written.set(`${area}:${key}`, text)
			return text ?? undefined
		} catch {
			return undefined
		}
	}

	// Writes the text of a key of an area, or removes it when text is undefined, unless it already holds it.
	#write(area: ViewStorageArea, key: string, text: string | undefined) {
		const id = `${area}:${key}`
		if (this.#written.get(id) === (text ?? null)) return

		try {
			const storage = this.storages[area]
			if (!storage) return
			if (text === undefined) storage.removeItem(key)
			else storage.setItem(key, text)
			this.#written.set(id, text ?? null)
		} catch {
			// A full quota or blocked storage leaves the field in memory only.
		}
	}

	// Reads the view document of a profile in an area; undefined when absent, unreadable, or of another version.
	#document(area: ViewStorageArea, profileId: string): ViewDocument | undefined {
		const text = this.#read(area, documentKey(profileId))
		if (text === undefined) return undefined

		try {
			const document = JSON.parse(text) as ViewDocument
			return document.version === VIEW_VERSION ? document : undefined
		} catch {
			return undefined
		}
	}

	// Restores the view of every profile not restored yet, and, once, the active profile of the tab.
	#restoreAll() {
		for (const profile of this.profiles.profiles) this.#restore(profile.id)
		if (this.#activeRestored) return
		this.#activeRestored = true

		for (const area of VIEW_STORAGE.activeProfile) {
			const id = this.#read(area, ACTIVE_PROFILE_KEY)

			if (id !== undefined && this.profiles.profiles.some((profile) => profile.id === id)) {
				this.profiles.activeId = id
				break
			}
		}
	}

	// Restores the fields of the view of a profile from the first area of each that holds it.
	#restore(profileId: string) {
		if (this.#restored.has(profileId)) return
		this.#restored.add(profileId)

		const profile = this.profiles.profiles.find(({ id }) => id === profileId)
		if (!profile) return
		const documents = new Map<ViewStorageArea, ViewDocument | undefined>()

		for (const key of VIEW_FIELD_KEYS) {
			for (const area of VIEW_STORAGE[key]) {
				if (!documents.has(area)) documents.set(area, this.#document(area, profileId))
				const fields = documents.get(area)?.fields

				if (fields && key in fields) {
					VIEW_FIELDS[key].set(profile.settings, structuredClone(fields[key]))
					break
				}
			}
		}
	}

	// Restores the profiles that appeared since, writes the view of every profile and the active profile, and removes the
	// documents of the profiles that went.
	#changed() {
		for (const profile of this.profiles.profiles) this.#restore(profile.id)

		const { profiles, activeId } = this.profiles
		const present = new Set(profiles.map(({ id }) => id))

		for (const profile of profiles) {
			for (const area of ['local', 'session'] as const) {
				const fields: Partial<Record<ViewFieldKey, unknown>> = {}
				let kept = false

				for (const key of VIEW_FIELD_KEYS) {
					if (!VIEW_STORAGE[key].includes(area)) continue
					kept = true
					const value = VIEW_FIELDS[key].get(profile.settings)
					if (value !== undefined) fields[key] = value
				}

				if (kept) this.#write(area, documentKey(profile.id), Object.keys(fields).length > 0 ? JSON.stringify({ version: VIEW_VERSION, fields } satisfies ViewDocument) : undefined)
			}
		}

		for (const profileId of this.#restored) {
			if (present.has(profileId)) continue
			this.#restored.delete(profileId)
			for (const area of ['local', 'session'] as const) this.#write(area, documentKey(profileId), undefined)
		}

		if (activeId) for (const area of VIEW_STORAGE.activeProfile) this.#write(area, ACTIVE_PROFILE_KEY, activeId)
	}
}
