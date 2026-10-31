import type { DisplaySettings, MountRemoteProtocol, StarDetectionRequest, StreakDetectorSettings } from 'api'
import { nanoid } from 'nanoid'
import { proxy, snapshot, subscribe } from 'valtio'
import { conflictingRole, type DeviceAssignment, type EquipmentRole, type EquipmentSetup, isEquipmentRole } from '../equipment/roles'
import { type AstrometryGridSettings, DEFAULT_IMAGE_ASTROMETRY, type ImageAstrometrySettings } from '../platesolving/preferences'
import type { WorkspaceId } from '../shell/route'
import { MAP_STAR_MAGNITUDE_LIMIT, MIN_MAGNITUDE_LIMIT, type SkyLayerId } from '../sky/display'
import { DEFAULT_OPTICS, type OpticalConfiguration, type OpticalPreset, type SensorGeometry, type SensorSource, type TelescopeOptics } from '../sky/framing'
import { DEFAULT_STAR_PROFILE_SETTINGS, type StarProfileSettings } from '../stars/starprofile.settings'
import { DEFAULT_STAR_REQUEST } from '../stars/stars'
import { parseJson, readText, type Stores, writeText } from '../storage'
import { DEFAULT_STREAK_SETTINGS } from '../streaks/streaks'
import { migrate, normalizeDegrees, normalizeSkyObserver } from './migrate'
import {
	type AutoFocusSettings,
	type CameraAcquisitionSettings,
	type CameraExposureSettings,
	type CameraIdentity,
	type CameraSettings,
	DEFAULT_ACQUISITION_SETTINGS,
	DEFAULT_AUTO_FOCUS_SETTINGS,
	DEFAULT_EXPOSURE_SETTINGS,
	DEFAULT_PROFILE_NAME,
	defaultSettings,
	type Profile,
	type ProfileSettings,
	PROFILES_VERSION,
	type ProfilesStorage,
	type SkyFramingSettings,
	type SkyObserverSettings,
	DEFAULT_TPPA_SETTINGS,
	DEFAULT_POINTING_MODEL_SETTINGS,
	type PointingModelSettings,
	DEFAULT_CAMERA_PLATE_SOLVING,
	type CameraPlateSolvingSettings,
	type TppaSettings,
	DEFAULT_DARV_SETTINGS,
	type DarvSettings,
	DEFAULT_FLAT_WIZARD_SETTINGS,
	type FlatWizardSettings,
	DEFAULT_GUIDING_SETTINGS,
	type GuidingSettings,
	DEFAULT_MOUNT_REMOTE_BINDINGS,
	type MountRemoteBinding,
	MAX_NOTIFICATION_IDS,
	DEFAULT_TARGET_CENTERING_SETTINGS,
	FRAMING_REFERENCES_MAXIMUM,
	type FramingReference,
	type TargetCenteringSettings,
} from './schema'

// Profiles of the browser and the profile active in this tab, and the actions that change them. Profiles are a
// versioned collection (schema.ts) in localStorage, shared by every tab with last-write-wins semantics, read through
// migrate.ts; the active profile id is kept per tab in sessionStorage, and also as the browser's last selection so
// that new tabs open it.

// localStorage key of the persisted ProfilesStorage.
export const PROFILES_KEY = 'nebulosa:profiles'

// sessionStorage key of the profile active in the tab.
export const ACTIVE_PROFILE_KEY = 'nebulosa:activeProfileId'

// localStorage key of the profile selected last in any tab, opened by new tabs.
export const LAST_PROFILE_KEY = 'nebulosa:lastProfileId'

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

// Returns the identity of a camera of a profile's saved connection, or undefined when the profile has no connection
// selected or there is no camera.
export function profileCamera(profile: Pick<Profile, 'connectionId'>, deviceId: string | undefined): CameraIdentity | undefined {
	return profile.connectionId && deviceId ? { connectionId: profile.connectionId, deviceId } : undefined
}

// Returns the forms of a camera, or undefined when it has none.
function cameraSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<CameraSettings> | undefined {
	return camera && settings.cameras[camera.connectionId]?.[camera.deviceId]
}

// Replaces fields of a form of a camera in the active profile with a plain copy (the stored form is a proxy, and a
// default must never be shared with a camera); other cameras and forms keep theirs. Does nothing without a camera.
function setCameraForm<K extends keyof CameraSettings>(state: ProfileState, camera: CameraIdentity | undefined, form: K, current: Readonly<NonNullable<CameraSettings[K]>>, patch: Partial<NonNullable<CameraSettings[K]>>) {
	if (!camera) return
	const profile = activeProfile(state)
	const settings = ((profile.settings.cameras[camera.connectionId] ??= {})[camera.deviceId] ??= {})
	settings[form] = JSON.parse(JSON.stringify({ ...current, ...patch })) as CameraSettings[K]
	touch(profile)
}

// Returns the exposure and camera settings of a camera: the ones edited last, or the defaults.
export function exposureSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<CameraExposureSettings> {
	return cameraSettings(settings, camera)?.exposure ?? DEFAULT_EXPOSURE_SETTINGS
}

// Replaces fields of the exposure and camera settings of a camera in the active profile.
export function setExposureSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<CameraExposureSettings>) {
	setCameraForm(state, camera, 'exposure', exposureSettings(activeProfile(state).settings, camera), patch)
}

// Returns the Camera Acquisition form of a camera: the one edited last, or the defaults.
export function acquisitionSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<CameraAcquisitionSettings> {
	return cameraSettings(settings, camera)?.acquisition ?? DEFAULT_ACQUISITION_SETTINGS
}

// Replaces fields of the Camera Acquisition form of a camera in the active profile. The output is replaced as a whole
// when given.
export function setAcquisitionSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<CameraAcquisitionSettings>) {
	setCameraForm(state, camera, 'acquisition', acquisitionSettings(activeProfile(state).settings, camera), patch)
}

// Returns the plate solving settings of a camera: the ones edited last, or the defaults.
export function cameraPlateSolving(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<CameraPlateSolvingSettings> {
	return cameraSettings(settings, camera)?.plateSolving ?? DEFAULT_CAMERA_PLATE_SOLVING
}

// Replaces the plate solving settings of a camera in the active profile as a whole, so a field left out is dropped.
export function setCameraPlateSolving(state: ProfileState, camera: CameraIdentity | undefined, plateSolving: Readonly<CameraPlateSolvingSettings>) {
	setCameraForm(state, camera, 'plateSolving', plateSolving, {})
}

// Returns the Auto Focus form of a camera: the one edited last, or the defaults.
export function autoFocusSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<AutoFocusSettings> {
	return cameraSettings(settings, camera)?.autoFocus ?? DEFAULT_AUTO_FOCUS_SETTINGS
}

// Replaces fields of the Auto Focus form of a camera in the active profile.
export function setAutoFocusSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<AutoFocusSettings>) {
	setCameraForm(state, camera, 'autoFocus', autoFocusSettings(activeProfile(state).settings, camera), patch)
}

// Returns the TPPA form of a camera: the one edited last, or the defaults.
export function tppaSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<TppaSettings> {
	return cameraSettings(settings, camera)?.tppa ?? DEFAULT_TPPA_SETTINGS
}

// Replaces fields of the TPPA form of a camera in the active profile.
export function setTppaSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<TppaSettings>) {
	setCameraForm(state, camera, 'tppa', tppaSettings(activeProfile(state).settings, camera), patch)
}

// Returns the Pointing Model Builder form of a camera: the one edited last, or the defaults.
export function pointingModelSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<PointingModelSettings> {
	return cameraSettings(settings, camera)?.pointingModel ?? DEFAULT_POINTING_MODEL_SETTINGS
}

// Replaces fields of the Pointing Model Builder form of a camera in the active profile.
export function setPointingModelSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<PointingModelSettings>) {
	setCameraForm(state, camera, 'pointingModel', pointingModelSettings(activeProfile(state).settings, camera), patch)
}

// Returns the Target Centering form of a camera: the one edited last, or the defaults.
export function targetCenteringSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<TargetCenteringSettings> {
	return cameraSettings(settings, camera)?.targetCentering ?? DEFAULT_TARGET_CENTERING_SETTINGS
}

// Replaces fields of the Target Centering form of a camera in the active profile.
export function setTargetCenteringSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<TargetCenteringSettings>) {
	setCameraForm(state, camera, 'targetCentering', targetCenteringSettings(activeProfile(state).settings, camera), patch)
}

// Returns the framings saved in a profile.
export function framingReferences(settings: Pick<ProfileSettings, 'framingReferences'>): readonly Readonly<FramingReference>[] {
	return settings.framingReferences ?? []
}

// Saves a framing in the active profile. Returns it, or undefined for a blank name or a full library.
export function saveFramingReference(state: ProfileState, framing: Pick<FramingReference, 'name' | 'rightAscension' | 'declination' | 'source'>, now = Date.now()): FramingReference | undefined {
	const profile = activeProfile(state)
	const name = framing.name.trim()
	const saved = profile.settings.framingReferences ?? []
	if (!name || saved.length >= FRAMING_REFERENCES_MAXIMUM) return undefined
	const reference: FramingReference = { ...framing, id: nanoid(), name, createdAt: now, updatedAt: now }
	profile.settings.framingReferences = [...saved, reference]
	touch(profile)
	return reference
}

// Renames a framing of the active profile. Returns whether it exists and the name is not blank.
export function renameFramingReference(state: ProfileState, id: string, name: string, now = Date.now()): boolean {
	const profile = activeProfile(state)
	const trimmed = name.trim()
	if (!trimmed || !profile.settings.framingReferences?.some((framing) => framing.id === id)) return false
	profile.settings.framingReferences = profile.settings.framingReferences.map((framing) => (framing.id === id ? { ...framing, name: trimmed, updatedAt: now } : framing))
	touch(profile)
	return true
}

// Deletes a framing of the active profile. A camera that had it selected keeps its form, which then selects nothing.
export function deleteFramingReference(state: ProfileState, id: string) {
	const profile = activeProfile(state)
	if (!profile.settings.framingReferences?.some((framing) => framing.id === id)) return
	profile.settings.framingReferences = profile.settings.framingReferences.filter((framing) => framing.id !== id)
	touch(profile)
}

// Returns the DARV form of a camera: the one edited last, or the defaults.
export function darvSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<DarvSettings> {
	return cameraSettings(settings, camera)?.darv ?? DEFAULT_DARV_SETTINGS
}

// Replaces fields of the DARV form of a camera in the active profile.
export function setDarvSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<DarvSettings>) {
	setCameraForm(state, camera, 'darv', darvSettings(activeProfile(state).settings, camera), patch)
}

// Returns the Flat Wizard form of a camera: the one edited last, or the defaults.
export function flatWizardSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<FlatWizardSettings> {
	return cameraSettings(settings, camera)?.flatWizard ?? DEFAULT_FLAT_WIZARD_SETTINGS
}

// Replaces fields of the Flat Wizard form of a camera in the active profile. The filter groups are replaced as a whole
// when given.
export function setFlatWizardSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<FlatWizardSettings>) {
	setCameraForm(state, camera, 'flatWizard', flatWizardSettings(activeProfile(state).settings, camera), patch)
}

// Returns the guiding form of a camera: the one edited last, or the defaults.
export function guidingSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<GuidingSettings> {
	return cameraSettings(settings, camera)?.guiding ?? DEFAULT_GUIDING_SETTINGS
}

// Replaces fields of the guiding form of a camera in the active profile. The settle is replaced as a whole when given.
export function setGuidingSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<GuidingSettings>) {
	setCameraForm(state, camera, 'guiding', guidingSettings(activeProfile(state).settings, camera), patch)
}

// Returns the display settings applied last in Images to the frames of a camera, or to every other image without a
// camera; undefined before the first one is applied.
export function imageDisplaySettings(settings: Pick<ProfileSettings, 'cameras' | 'imageDisplay'>, camera?: CameraIdentity): Readonly<DisplaySettings> | undefined {
	return camera ? cameraSettings(settings, camera)?.display : settings.imageDisplay
}

// Remembers in the active profile the display settings just applied in Images, as a plain copy: those of the frames of
// a camera, or those of every other image without a camera.
export function setImageDisplaySettings(state: ProfileState, camera: CameraIdentity | undefined, settings: DisplaySettings) {
	if (camera) {
		setCameraForm(state, camera, 'display', settings, {})
		return
	}

	const profile = activeProfile(state)
	profile.settings.imageDisplay = JSON.parse(JSON.stringify(settings)) as DisplaySettings
	touch(profile)
}

// Returns the star detection request of a profile: the one edited last, or the defaults.
export function starDetectionSettings(settings: Pick<ProfileSettings, 'starDetection'>): Readonly<StarDetectionRequest> {
	return settings.starDetection ?? DEFAULT_STAR_REQUEST
}

// Replaces the star detection request of the active profile with a plain copy, which the next detection of any
// document and the next Auto Focus session use; a running session keeps the request it started with.
export function setStarDetectionSettings(state: ProfileState, request: StarDetectionRequest) {
	const profile = activeProfile(state)
	profile.settings.starDetection = JSON.parse(JSON.stringify(request)) as StarDetectionRequest
	touch(profile)
}

// Returns the streak detector settings of a profile: the ones edited last, or the defaults.
export function streakDetectionSettings(settings: Pick<ProfileSettings, 'streakDetection'>): Readonly<StreakDetectorSettings> {
	return settings.streakDetection ?? DEFAULT_STREAK_SETTINGS
}

// Replaces the streak detector settings of the active profile with a plain copy, which the next streak detection of any
// document uses.
export function setStreakDetectionSettings(state: ProfileState, settings: StreakDetectorSettings) {
	const profile = activeProfile(state)
	profile.settings.streakDetection = { ...settings }
	touch(profile)
}

// Returns the appearance of the astrometric aids of solved images of a profile: the one edited last, or the default.
export function imageAstrometrySettings(settings: Pick<ProfileSettings, 'imageAstrometry'>): ImageAstrometrySettings {
	return settings.imageAstrometry ?? DEFAULT_IMAGE_ASTROMETRY
}

// Returns the settings of the Star Profile Inspector of a profile, shared by every document.
export function starProfileSettings(settings: Pick<ProfileSettings, 'starProfile'>): StarProfileSettings {
	return settings.starProfile ?? DEFAULT_STAR_PROFILE_SETTINGS
}

// Changes the settings of the Star Profile Inspector of the active profile; never measures anything.
export function setStarProfileSettings(state: ProfileState, patch: Partial<StarProfileSettings>) {
	const profile = activeProfile(state)
	profile.settings.starProfile = { ...starProfileSettings(profile.settings), ...patch }
	touch(profile)
}

// Changes the appearance of the astrometric aids of solved images of the active profile: the coordinates, grid, and
// other fields given replace their current values, a grid patch merging into the current grid.
export function setImageAstrometrySettings(state: ProfileState, patch: Partial<Omit<ImageAstrometrySettings, 'grid'>> & { readonly grid?: Partial<AstrometryGridSettings> }) {
	const profile = activeProfile(state)
	const current = imageAstrometrySettings(profile.settings)
	profile.settings.imageAstrometry = { ...current, ...patch, coordinates: { ...current.coordinates, ...patch.coordinates }, grid: { ...current.grid, ...patch.grid } }
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

// Shows or hides the Sky time bar in the active profile; hidden is kept as the absent default.
export function setSkyTimeBarVisible(state: ProfileState, visible: boolean) {
	const sky = activeProfile(state).settings.sky
	if ((sky.timeBar === true) === visible) return
	if (visible) sky.timeBar = true
	else delete sky.timeBar
	touch(activeProfile(state))
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

// Copies optics, which may be a store proxy or snapshot, into a plain object.
function copyOptics(optics: OpticalConfiguration): OpticalConfiguration {
	return { ...optics, sensor: { ...optics.sensor } }
}

// Returns the framing preferences of a profile, creating them empty and hidden.
function framingOf(profile: Profile): SkyFramingSettings {
	return (profile.settings.sky.framing ??= { presets: [], visible: false })
}

// Creates an optical preset in the active profile from optics (the defaults when absent), selects it,
// and shows the field of view. Returns the preset, or undefined for a blank name.
export function createOpticalPreset(state: ProfileState, name: string, optics: OpticalConfiguration = DEFAULT_OPTICS): OpticalPreset | undefined {
	const trimmed = name.trim()
	if (!trimmed) return undefined
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	const preset: OpticalPreset = { id: nanoid(), name: trimmed, optics: copyOptics(optics) }
	framing.presets = [...framing.presets, preset]
	framing.activePresetId = preset.id
	framing.visible = true
	touch(profile)
	return preset
}

// Replaces the name or optics of a preset of the active profile; a blank name is ignored. Returns
// whether the preset exists.
export function updateOpticalPreset(state: ProfileState, id: string, changes: { readonly name?: string; readonly optics?: OpticalConfiguration }): boolean {
	const profile = activeProfile(state)
	const framing = profile.settings.sky.framing
	const current = framing?.presets.find((preset) => preset.id === id)
	if (!framing || !current) return false
	const updated: OpticalPreset = { id, name: changes.name?.trim() || current.name, optics: changes.optics ? copyOptics(changes.optics) : current.optics }
	framing.presets = framing.presets.map((preset) => (preset.id === id ? updated : preset))
	touch(profile)
	return true
}

// Copies a preset of the active profile under the name "<name> (copy)" and selects the copy.
export function duplicateOpticalPreset(state: ProfileState, id: string): OpticalPreset | undefined {
	const source = activeProfile(state).settings.sky.framing?.presets.find((preset) => preset.id === id)
	return source && createOpticalPreset(state, `${source.name} (copy)`, source.optics)
}

// Deletes a preset of the active profile; deleting the selected one selects the first left, if any.
export function deleteOpticalPreset(state: ProfileState, id: string) {
	const profile = activeProfile(state)
	const framing = profile.settings.sky.framing
	if (!framing?.presets.some((preset) => preset.id === id)) return
	framing.presets = framing.presets.filter((preset) => preset.id !== id)
	if (framing.activePresetId === id) framing.activePresetId = framing.presets[0]?.id
	touch(profile)
}

// Selects the preset drawn in the active profile.
export function selectOpticalPreset(state: ProfileState, id: string) {
	const profile = activeProfile(state)
	const framing = profile.settings.sky.framing
	if (!framing?.presets.some((preset) => preset.id === id) || framing.activePresetId === id) return
	framing.activePresetId = id
	touch(profile)
}

// Shows or hides the field of view in the active profile.
export function setFramingVisible(state: ProfileState, visible: boolean) {
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	if (framing.visible === visible) return
	framing.visible = visible
	touch(profile)
}

// Chooses where the drawn field of view comes from in the active profile.
export function setFramingSource(state: ProfileState, source: 'custom' | 'equipment') {
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	if ((framing.source ?? 'custom') === source) return
	framing.source = source
	touch(profile)
}

// Chooses the sensor of the Equipment Setup field of view in the active profile.
export function setSensorSource(state: ProfileState, source: SensorSource) {
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	if ((framing.sensorSource ?? 'MAIN_CAMERA') === source) return
	framing.sensorSource = source
	touch(profile)
}

// Replaces the manual sensor of the Equipment Setup field of view in the active profile; it only
// simulates a camera and is never sent to a device.
export function setManualSensor(state: ProfileState, sensor: SensorGeometry) {
	const profile = activeProfile(state)
	framingOf(profile).manualSensor = { ...sensor }
	touch(profile)
}

// Sets the position angle in degrees of the Equipment Setup field of view in the active profile,
// normalized to [0, 360).
export function setEquipmentRotation(state: ProfileState, rotation: number) {
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	const value = normalizeDegrees(rotation)
	if (framing.equipmentRotation === value) return
	framing.equipmentRotation = value
	touch(profile)
}

// Replaces the telescope optics of the active profile's Equipment Setup; planning data only, never sent
// to a device.
export function setTelescopeOptics(state: ProfileState, optics: TelescopeOptics) {
	const profile = activeProfile(state)
	profile.settings.telescope = { focalLength: optics.focalLength, focalMultiplier: optics.focalMultiplier, aperture: optics.aperture }
	touch(profile)
}

// Replaces the guide telescope optics of the active profile's Equipment Setup, which guiding takes its pixel scale and
// calibration step from; never sent to a device.
export function setGuideTelescopeOptics(state: ProfileState, optics: TelescopeOptics) {
	const profile = activeProfile(state)
	profile.settings.guideTelescope = { focalLength: optics.focalLength, focalMultiplier: optics.focalMultiplier, aperture: optics.aperture }
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

// Returns the Mount Remote Control binding of a protocol of a mount: the one entered last, or the default. mount is the
// saved connection id and the mount id (profileCamera builds it for any device); absent gives the default.
export function mountRemoteBinding(settings: Pick<ProfileSettings, 'mountRemoteControl'>, mount: CameraIdentity | undefined, protocol: MountRemoteProtocol): Readonly<MountRemoteBinding> {
	return (mount && settings.mountRemoteControl?.[mount.connectionId]?.[mount.deviceId]?.[protocol]) ?? DEFAULT_MOUNT_REMOTE_BINDINGS[protocol]
}

// Remembers the Mount Remote Control binding of a protocol of a mount in the active profile. It never starts, stops, or
// rebinds a listener. Does nothing without a mount.
export function setMountRemoteBinding(state: ProfileState, mount: CameraIdentity | undefined, protocol: MountRemoteProtocol, binding: MountRemoteBinding) {
	if (!mount) return
	const profile = activeProfile(state)
	const mounts = ((profile.settings.mountRemoteControl ??= {})[mount.connectionId] ??= {})
	;(mounts[mount.deviceId] ??= {})[protocol] = { host: binding.host, port: binding.port }
	touch(profile)
}

// Marks notifications as read in the active profile. Reading never changes the server history.
export function markNotificationsRead(state: ProfileState, ids: readonly string[]) {
	const profile = activeProfile(state)
	const preferences = (profile.settings.notifications ??= { readIds: [], dismissedIds: [] })
	const unread = Array.from(new Set(ids)).filter((id) => !preferences.readIds.includes(id))
	if (unread.length === 0) return
	preferences.readIds = [...preferences.readIds, ...unread].slice(-MAX_NOTIFICATION_IDS)
	touch(profile)
}

// Hides a notification from the lists of the active profile, marking it as read. The server history keeps it.
export function dismissNotification(state: ProfileState, id: string) {
	markNotificationsRead(state, [id])
	const profile = activeProfile(state)
	const preferences = profile.settings.notifications
	if (!preferences || preferences.dismissedIds.includes(id)) return
	preferences.dismissedIds = [...preferences.dismissedIds, id].slice(-MAX_NOTIFICATION_IDS)
	touch(profile)
}

// Drops from every profile the read and dismissed ids of notifications the server history no longer retains.
// retained must be the whole history, never a part of it. Profiles are not marked as changed.
export function pruneNotificationPreferences(state: ProfileState, retained: readonly string[]) {
	const ids = new Set(retained)

	for (const profile of state.profiles) {
		const preferences = profile.settings.notifications
		if (!preferences) continue
		if (preferences.readIds.some((id) => !ids.has(id))) preferences.readIds = preferences.readIds.filter((id) => ids.has(id))
		if (preferences.dismissedIds.some((id) => !ids.has(id))) preferences.dismissedIds = preferences.dismissedIds.filter((id) => ids.has(id))
	}
}
