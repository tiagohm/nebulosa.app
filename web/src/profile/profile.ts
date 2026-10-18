import { nanoid } from 'nanoid'
import { proxy, snapshot, subscribe } from 'valtio'
import { CAMERA_ROLES, type CameraRole, conflictingRole, type DeviceAssignment, type EquipmentRole, type EquipmentSetup, isCameraRole, isEquipmentRole } from '../equipment/roles'
import { type CaptureMode, isCaptureMode, WORKSPACE_IDS, type WorkspaceId } from '../shell/route'
import { MAP_STAR_MAGNITUDE_LIMIT, MIN_MAGNITUDE_LIMIT, SKY_LAYER_IDS, type SkyDisplaySettings, type SkyLayerId } from '../sky/display'
import { isRecord, parseJson, readText, type Stores, writeText } from '../storage'

// Profiles of the browser and the profile active in this tab. Profiles are a versioned collection in
// localStorage, shared by every tab with last-write-wins semantics; the active profile id is kept per
// tab in sessionStorage, and also as the browser's last selection so that new tabs open it. Profiles
// hold selections and preferences only, never operational device state.

// localStorage key of the persisted ProfilesStorage.
export const PROFILES_KEY = 'nebulosa:profiles'

// sessionStorage key of the profile active in the tab.
export const ACTIVE_PROFILE_KEY = 'nebulosa:activeProfileId'

// localStorage key of the profile selected last in any tab, opened by new tabs.
export const LAST_PROFILE_KEY = 'nebulosa:lastProfileId'

// Current version of the persisted format. Version 1 stored each assignment as a bare device id;
// version 2 stores the device id and name.
export const PROFILES_VERSION = 2

// Name of the profile created when none is stored.
export const DEFAULT_PROFILE_NAME = 'Default'

// Application preferences that belong to a profile. Each preference is added here, with its default in
// defaultSettings and its restoration in normalizeSettings.
export interface ProfileSettings {
	// Whether the contextual panel of each workspace is expanded on wide screens; an absent workspace
	// shows it expanded. Narrow screens open the panel as a drawer that is never persisted.
	panels: Partial<Record<WorkspaceId, boolean>>
	// Server directory an image was opened from last, where the file explorer starts; absent before the
	// first image is opened.
	lastImageDirectory?: string
	// Camera view and per-camera presentation preferences of the Capture workspace.
	capture: CaptureSettings
	// Preferences of the Sky workspace.
	sky: SkySettings
}

// Location the Sky workspace observes from. Degrees and meters, entered manually; never assumed.
export interface SkyObserverSettings {
	// Name of the place, such as "Backyard"; absent when not named.
	name?: string
	// Geodetic latitude in degrees, north positive, [-90, 90].
	latitude: number
	// Geodetic longitude in degrees, east positive, [-180, 180].
	longitude: number
	// Height above the ellipsoid in meters, [-500, 9000].
	elevation: number
	// IANA time zone the Sky shows and enters times in, such as "America/Sao_Paulo"; absent uses the
	// browser's. It never changes positions, only how instants are read.
	timeZone?: string
}

// Sky preferences of a profile.
export interface SkySettings {
	// Observer location; absent until the user sets one, and then the sky is shown without a horizon
	// and positions are geocentric.
	observer?: SkyObserverSettings
	// What the star map shows; absent until the user changes a preference, and then every default holds.
	display?: SkyDisplaySettings
}

// Presentation preferences of one Capture camera view. They belong to the camera role, not to the
// device assigned to it, so replacing the device keeps them.
export interface CameraViewSettings {
	// Operational mode selected last in the camera view.
	mode: CaptureMode
	// Whether the viewer's reticle is shown; absent follows the mode's default overlays. Selecting
	// another mode clears it.
	reticle?: boolean
}

// Capture preferences of a profile. Only presentation is kept: never images, devices, or operations.
export interface CaptureSettings {
	// Camera role of the view selected last; absent before Capture is first opened.
	activeCamera?: CameraRole
	// Preferences of each camera view used so far, by camera role.
	views: Partial<Record<CameraRole, CameraViewSettings>>
}

// A complete working environment: the selected connection, the equipment assigned on each connection,
// and preferences.
export interface Profile {
	// Unique id, kept across renames.
	readonly id: string
	// Display name, trimmed and non-empty.
	name: string
	// Id of the saved connection the profile works with; absent when none is selected.
	connectionId?: string
	// Equipment setup of each saved connection the profile has used, keyed by saved connection id. Only
	// the setup of connectionId is active; the others are restored when that connection is selected again.
	equipment: Record<string, EquipmentSetup>
	// Preferences of the profile.
	settings: ProfileSettings
	// Creation time, ISO 8601.
	readonly createdAt: string
	// Time of the last change, ISO 8601.
	updatedAt: string
}

// Persisted form of the profile collection.
export interface ProfilesStorage {
	// Format version, PROFILES_VERSION when written by this code.
	readonly version: number
	// Profiles in display order.
	readonly profiles: readonly Profile[]
}

// Profile store of the tab.
export interface ProfileState {
	// Profiles in display order; never empty once loaded.
	profiles: Profile[]
	// Id of the profile active in this tab.
	activeId: string
	// Whether the profile management modal is shown.
	open: boolean
	// Message of the last failed write to storage, cleared by the next successful one.
	error?: string
}

// Profile store of the tab, empty until loadProfiles runs.
export const profileState = proxy<ProfileState>({ profiles: [], activeId: '', open: false })

// Returns the default preferences of a new profile.
export function defaultSettings(): ProfileSettings {
	return { panels: {}, capture: { views: {} }, sky: {} }
}

// Restores persisted Capture preferences, dropping unknown camera roles and invalid values. Profiles
// written before camera views existed have none and get the defaults.
function normalizeCapture(value: unknown, capture: CaptureSettings) {
	if (!isRecord(value)) return
	if (isCameraRole(value.activeCamera)) capture.activeCamera = value.activeCamera
	if (!isRecord(value.views)) return

	for (const role of CAMERA_ROLES) {
		const view = value.views[role]
		if (!isRecord(view)) continue
		const settings: CameraViewSettings = { mode: isCaptureMode(view.mode) ? view.mode : 'camera' }
		if (typeof view.reticle === 'boolean') settings.reticle = view.reticle
		capture.views[role] = settings
	}
}

// Lowest elevation accepted for an observer in meters (below the Dead Sea shore, -430 m).
const MIN_OBSERVER_ELEVATION = -500

// Highest elevation accepted for an observer in meters (above Everest, 8849 m).
const MAX_OBSERVER_ELEVATION = 9000

// Returns a valid observer, or undefined for anything out of range or incomplete.
export function normalizeSkyObserver(value: unknown): SkyObserverSettings | undefined {
	if (!isRecord(value)) return undefined

	const { latitude, longitude, elevation, name, timeZone } = value
	if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return undefined
	if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return undefined
	if (typeof elevation !== 'number' || !Number.isFinite(elevation) || elevation < MIN_OBSERVER_ELEVATION || elevation > MAX_OBSERVER_ELEVATION) return undefined

	const observer: SkyObserverSettings = { latitude, longitude, elevation }
	if (typeof name === 'string' && name.trim()) observer.name = name.trim()
	if (typeof timeZone === 'string' && isKnownTimeZone(timeZone)) observer.timeZone = timeZone
	return observer
}

// Whether a name is an IANA time zone the browser knows; an unknown one is dropped, using the browser's.
function isKnownTimeZone(timeZone: string) {
	try {
		return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone !== ''
	} catch {
		return false
	}
}

// Restores persisted display preferences, keeping only known layers and a magnitude limit in range.
function normalizeSkyDisplay(value: unknown): SkyDisplaySettings | undefined {
	if (!isRecord(value)) return undefined

	const display: SkyDisplaySettings = { layers: {} }

	if (isRecord(value.layers)) {
		for (const [id, visible] of Object.entries(value.layers)) {
			if (SKY_LAYER_IDS.has(id) && typeof visible === 'boolean') display.layers[id as SkyLayerId] = visible
		}
	}

	const limit = value.magnitudeLimit
	if (typeof limit === 'number' && limit >= MIN_MAGNITUDE_LIMIT && limit <= MAP_STAR_MAGNITUDE_LIMIT) display.magnitudeLimit = limit
	return display
}

// Restores persisted Sky preferences, dropping an invalid observer and invalid display preferences.
function normalizeSky(value: unknown, sky: SkySettings) {
	if (!isRecord(value)) return
	const observer = normalizeSkyObserver(value.observer)
	if (observer) sky.observer = observer
	const display = normalizeSkyDisplay(value.display)
	if (display) sky.display = display
}

// Restores persisted preferences, falling back to the default of every missing or invalid preference.
function normalizeSettings(value: unknown): ProfileSettings {
	const settings = defaultSettings()
	if (!isRecord(value)) return settings

	if (isRecord(value.panels)) {
		for (const workspace of WORKSPACE_IDS) {
			const open = value.panels[workspace]
			if (typeof open === 'boolean') settings.panels[workspace] = open
		}
	}

	if (typeof value.lastImageDirectory === 'string' && value.lastImageDirectory) settings.lastImageDirectory = value.lastImageDirectory

	normalizeCapture(value.capture, settings.capture)
	normalizeSky(value.sky, settings.sky)

	return settings
}

// Restores a persisted assignment: a bare device id (version 1), whose name is unknown, or an id and
// name (version 2). Returns undefined for anything else.
function normalizeAssignment(value: unknown): DeviceAssignment | undefined {
	if (typeof value === 'string') return value ? { id: value, name: '' } : undefined
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return undefined
	return { id: value.id, name: typeof value.name === 'string' ? value.name : '' }
}

// Restores the persisted equipment setups, keeping only valid role assignments.
function normalizeEquipment(value: unknown): Record<string, EquipmentSetup> {
	const equipment: Record<string, EquipmentSetup> = {}
	if (!isRecord(value)) return equipment

	for (const [connectionId, setup] of Object.entries(value)) {
		if (!isRecord(setup)) continue
		const roles: EquipmentSetup = {}

		for (const [role, assignment] of Object.entries(setup)) {
			const device = normalizeAssignment(assignment)
			if (isEquipmentRole(role) && device) roles[role] = device
		}

		equipment[connectionId] = roles
	}

	return equipment
}

// Restores a persisted profile, filling missing fields with defaults. Returns undefined when it has no id.
function normalizeProfile(value: unknown, now: string): Profile | undefined {
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return undefined

	const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Unnamed'
	const createdAt = typeof value.createdAt === 'string' ? value.createdAt : now
	const profile: Profile = {
		id: value.id,
		name,
		equipment: normalizeEquipment(value.equipment),
		settings: normalizeSettings(value.settings),
		createdAt,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : createdAt,
	}

	if (typeof value.connectionId === 'string' && value.connectionId) profile.connectionId = value.connectionId

	return profile
}

// Reads the profiles of a persisted document of any known version. Returns undefined for a document
// that is not a known ProfilesStorage, including one written by a newer version.
function migrate(data: unknown, now: string): Profile[] | undefined {
	if (!isRecord(data) || !Array.isArray(data.profiles)) return undefined

	switch (data.version) {
		case 1:
		case 2: {
			const profiles: Profile[] = []

			for (const value of data.profiles) {
				const profile = normalizeProfile(value, now)
				if (profile && !profiles.some((p) => p.id === profile.id)) profiles.push(profile)
			}

			return profiles
		}
		default:
			return undefined
	}
}

// Returns a new profile with default preferences, no connection, and an empty setup.
export function newProfile(name: string, now = new Date().toISOString()): Profile {
	return { id: nanoid(), name, equipment: {}, settings: defaultSettings(), createdAt: now, updatedAt: now }
}

// Writes the profile collection. Records a failure in state.error and returns false.
function writeProfiles(state: ProfileState, stores: Stores, profiles: readonly Profile[]): boolean {
	const data: ProfilesStorage = { version: PROFILES_VERSION, profiles }
	const ok = writeText(stores.local, PROFILES_KEY, JSON.stringify(data))
	state.error = ok ? undefined : 'Unable to save profiles: browser storage is unavailable or full.'
	return ok
}

// Loads the profiles into state and restores the tab's active profile: this tab's last profile, then
// the browser's last selection, then the first profile. Creates and stores a Default profile when
// nothing is stored. A stored document that cannot be read is left untouched until the next change,
// and a Default profile is used meanwhile.
export function loadProfiles(state: ProfileState, stores: Stores) {
	const now = new Date().toISOString()
	const text = readText(stores.local, PROFILES_KEY)
	let profiles = text === undefined ? undefined : migrate(parseJson(text), now)

	if (!profiles?.length) {
		profiles = [newProfile(DEFAULT_PROFILE_NAME, now)]
		if (text === undefined) writeProfiles(state, stores, profiles)
	}

	const exists = (id: string | undefined) => id !== undefined && profiles.some((p) => p.id === id)
	const session = readText(stores.session, ACTIVE_PROFILE_KEY)
	const last = readText(stores.local, LAST_PROFILE_KEY)

	state.profiles = profiles
	state.activeId = exists(session) ? session! : exists(last) ? last! : profiles[0].id
	writeText(stores.session, ACTIVE_PROFILE_KEY, state.activeId)
}

// Persists every later change of state: the profile collection to localStorage, and the active profile
// to this tab's sessionStorage and as the browser's last selection. Returns a function that stops it.
export function persistProfiles(state: ProfileState, stores: Stores): () => void {
	let { profiles, activeId } = snapshot(state)

	return subscribe(state, () => {
		const current = snapshot(state)

		if (current.profiles !== profiles) {
			profiles = current.profiles
			writeProfiles(state, stores, current.profiles)
		}

		if (current.activeId !== activeId) {
			activeId = current.activeId
			writeText(stores.session, ACTIVE_PROFILE_KEY, activeId)
			writeText(stores.local, LAST_PROFILE_KEY, activeId)
		}
	})
}

// Returns the profile active in the tab, of the state or of a snapshot of it. The state must be loaded.
export function activeProfile<P extends Pick<Profile, 'id'>>(state: { readonly profiles: readonly P[]; readonly activeId: string }): P {
	return state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0]
}

// Returns the equipment setup of the profile's selected connection, of a profile or a snapshot of it;
// empty when none is selected.
export function activeSetup(profile: { readonly connectionId?: string; readonly equipment: { readonly [connectionId: string]: Readonly<EquipmentSetup> } }): Readonly<EquipmentSetup> {
	return (profile.connectionId && profile.equipment[profile.connectionId]) || {}
}

// Marks a profile as changed now.
function touch(profile: Profile) {
	profile.updatedAt = new Date().toISOString()
}

// Makes a profile active in the tab. Ignored for an unknown id.
export function selectProfile(state: ProfileState, id: string) {
	if (state.profiles.some((p) => p.id === id)) state.activeId = id
}

// Adds a profile with default preferences and returns it. Returns undefined for a blank name.
export function createProfile(state: ProfileState, name: string): Profile | undefined {
	const trimmed = name.trim()
	if (!trimmed) return undefined
	const profile = newProfile(trimmed)
	state.profiles.push(profile)
	return profile
}

// Renames a profile, keeping its id. Returns false for a blank name or an unknown id.
export function renameProfile(state: ProfileState, id: string, name: string): boolean {
	const trimmed = name.trim()
	const profile = state.profiles.find((p) => p.id === id)
	if (!trimmed || !profile) return false
	profile.name = trimmed
	touch(profile)
	return true
}

// Adds a copy of a profile, with a new id, right after it: same connection, equipment, and preferences.
// Returns the copy, or undefined for an unknown id.
export function duplicateProfile(state: ProfileState, id: string): Profile | undefined {
	const index = state.profiles.findIndex((p) => p.id === id)
	if (index < 0) return undefined

	const source = structuredClone(snapshot(state).profiles[index]) as Profile
	const now = new Date().toISOString()
	const copy: Profile = { ...source, id: nanoid(), name: `${source.name} (copy)`, createdAt: now, updatedAt: now }
	state.profiles.splice(index + 1, 0, copy)
	return copy
}

// Deletes a profile, never the last one. When it is active, the first remaining profile becomes active.
// Connections and devices are not touched. Returns false when nothing was deleted.
export function deleteProfile(state: ProfileState, id: string): boolean {
	if (state.profiles.length <= 1 || !state.profiles.some((p) => p.id === id)) return false
	state.profiles = state.profiles.filter((p) => p.id !== id)
	if (state.activeId === id) state.activeId = state.profiles[0].id
	return true
}

// Selects the saved connection the active profile works with; undefined clears it. The setup the
// profile used on that connection becomes active again.
export function selectConnection(state: ProfileState, connectionId: string | undefined) {
	const profile = activeProfile(state)
	if (profile.connectionId === connectionId) return
	if (connectionId) profile.connectionId = connectionId
	else delete profile.connectionId
	touch(profile)
}

// Result of an assignment: ok, no connection selected, or the role that already holds the device and
// cannot share it.
export type AssignResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'no-connection' } | { readonly ok: false; readonly reason: 'conflict'; readonly role: EquipmentRole }

// Assigns a device to a role of the active profile's setup on its selected connection; undefined clears
// the role. Selecting a device does not connect it.
export function assignDevice(state: ProfileState, role: EquipmentRole, device: DeviceAssignment | undefined): AssignResult {
	const profile = activeProfile(state)
	const connectionId = profile.connectionId
	if (!connectionId) return { ok: false, reason: 'no-connection' }

	const setup = (profile.equipment[connectionId] ??= {})

	if (device) {
		const conflict = conflictingRole(setup, role, device.id)
		if (conflict) return { ok: false, reason: 'conflict', role: conflict }
		setup[role] = { id: device.id, name: device.name }
	} else {
		delete setup[role]
	}

	touch(profile)
	return { ok: true }
}

// Fills in the missing names of the active profile's assignments (stored before names were kept) from
// the devices of its connection. Changes nothing when every assigned name is known.
export function rememberDeviceNames(state: ProfileState, devices: readonly DeviceAssignment[]) {
	const profile = activeProfile(state)
	const setup = profile.connectionId ? profile.equipment[profile.connectionId] : undefined
	if (!setup) return
	let changed = false

	for (const [role, assignment] of Object.entries(setup)) {
		if (!isEquipmentRole(role) || !assignment || assignment.name) continue
		const device = devices.find((d) => d.id === assignment.id)
		if (!device) continue
		setup[role] = { id: device.id, name: device.name }
		changed = true
	}

	if (changed) touch(profile)
}

// Whether the contextual panel of a workspace is expanded in a profile's settings or a snapshot of them.
export function panelOpen(settings: { readonly panels: Readonly<ProfileSettings['panels']> }, workspace: WorkspaceId): boolean {
	return settings.panels[workspace] ?? true
}

// Expands or collapses the contextual panel of a workspace in the active profile. Only the layout
// preference changes; whatever the panel controls keeps running.
export function setPanelOpen(state: ProfileState, workspace: WorkspaceId, open: boolean) {
	const profile = activeProfile(state)
	if (panelOpen(profile.settings, workspace) === open) return
	profile.settings.panels[workspace] = open
	touch(profile)
}

// Remembers in the active profile the server directory an image was opened from.
export function setLastImageDirectory(state: ProfileState, directory: string) {
	const profile = activeProfile(state)
	if (profile.settings.lastImageDirectory === directory) return
	profile.settings.lastImageDirectory = directory
	touch(profile)
}

// Remembers in the active profile the Capture camera view shown and its mode. Selecting another mode
// clears the view's reticle choice, so the new mode's default overlays apply. The equipment setup is
// never changed, and nothing is started or stopped.
export function selectCameraView(state: ProfileState, role: CameraRole, mode: CaptureMode) {
	const capture = activeProfile(state).settings.capture
	const view = capture.views[role]
	if (capture.activeCamera === role && view?.mode === mode) return
	capture.activeCamera = role
	if (view?.mode !== mode) capture.views[role] = { mode }
	touch(activeProfile(state))
}

// Shows or hides the viewer's reticle of a Capture camera view in the active profile; other camera views
// keep theirs.
export function setCameraReticle(state: ProfileState, role: CameraRole, reticle: boolean) {
	const profile = activeProfile(state)
	const view = (profile.settings.capture.views[role] ??= { mode: 'camera' })
	if (view.reticle === reticle) return
	view.reticle = reticle
	touch(profile)
}

// Sets the Sky observer of the active profile, or clears it with undefined. Returns false, changing
// nothing, for an observer out of range.
export function setSkyObserver(state: ProfileState, observer: SkyObserverSettings | undefined): boolean {
	const profile = activeProfile(state)

	if (observer === undefined) {
		if (!profile.settings.sky.observer) return true
		delete profile.settings.sky.observer
		touch(profile)
		return true
	}

	const normalized = normalizeSkyObserver(observer)
	if (!normalized) return false
	const current = profile.settings.sky.observer
	if (current && current.latitude === normalized.latitude && current.longitude === normalized.longitude && current.elevation === normalized.elevation && current.name === normalized.name && current.timeZone === normalized.timeZone) return true
	profile.settings.sky.observer = normalized
	touch(profile)
	return true
}

// Shows or hides a star map layer in the active profile.
export function setSkyLayerVisible(state: ProfileState, layer: SkyLayerId, visible: boolean) {
	const profile = activeProfile(state)
	const display = (profile.settings.sky.display ??= { layers: {} })
	if (display.layers[layer] === visible) return
	display.layers[layer] = visible
	touch(profile)
}

// Sets the faintest star magnitude the star map draws in the active profile, kept within
// [MIN_MAGNITUDE_LIMIT, MAP_STAR_MAGNITUDE_LIMIT].
export function setSkyMagnitudeLimit(state: ProfileState, limit: number) {
	const profile = activeProfile(state)
	const display = (profile.settings.sky.display ??= { layers: {} })
	const value = Math.min(MAP_STAR_MAGNITUDE_LIMIT, Math.max(MIN_MAGNITUDE_LIMIT, limit))
	if (display.magnitudeLimit === value) return
	display.magnitudeLimit = value
	touch(profile)
}

// Forgets a removed saved connection in every profile: profiles that selected it lose their selection,
// and its equipment setup is dropped, because the removed entry can never be selected again.
export function forgetConnection(state: ProfileState, connectionId: string) {
	for (const profile of state.profiles) {
		const selected = profile.connectionId === connectionId
		const used = connectionId in profile.equipment
		if (!selected && !used) continue
		if (selected) delete profile.connectionId
		delete profile.equipment[connectionId]
		touch(profile)
	}
}
