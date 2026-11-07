import type { MountRemoteProtocol, ObservingSite as SavedObservingSite, ProfileCameraForm, ProfilePreferenceKey, ProfileRecord, SavedConnection, ServerEvent, WorkspaceSnapshot, WorkspaceValue } from 'api'
import { proxy, snapshot, subscribe } from 'valtio'
import type { Connection, ConnectionState } from '../connection/connection'
import { jsonInit } from '../http'
import { type ObservingSite, siteState, type SiteState } from '../location/site'
import { nestedObject, newProfile, type ProfileState } from './profile'
import { type CameraSettings, type FramingReference, type MountRemoteBinding, type Profile, PROFILE_SETTINGS_VERSION, type ProfileSettings, type SkyFramingSettings, type SkySettings } from './schema'

// Synchronization of the workspace (the saved connections, the observing sites, and the profiles) with the server, which
// keeps it for every tab and browser. The tab changes its stores at once, as before; this module compares what the tab
// holds with what the server last confirmed, unit by unit (a saved connection, an observing site, the name, connection,
// and active site of a profile, an equipment setup, a preference, a camera form, a Mount Remote Control binding, a saved
// framing, the notifications it read or dismissed), and writes each unit that changed, a moment after the latest change
// and one request at a time. A unit with a revision is written from the revision it was
// edited from; when another tab saved it first the server refuses it, and the tab shows what the server kept and says
// so. The others are written as they are, the last write winning. What the server publishes applies to every unit the
// tab is not writing. View state fields of ProfileSettings (view.ts) are never compared nor written.

// Delay after the latest change before the changes are written, in milliseconds, so an edit typed key by key is written once.
export const WRITE_DELAY = 400

// Delay before writing again after the server could not be reached, in milliseconds.
const RETRY_DELAY = 3000

// Most times a snapshot is read again because a write completed while it was read.
const MAXIMUM_REFRESHES = 3

// What the tab shows of the synchronization.
export interface WorkspaceSyncState {
	// Whether the workspace was read from the server at least once; the shell is shown only then.
	loaded: boolean
	// Latest conflict or refused write, meant for people, until closed.
	message?: string
}

// Synchronization state of the tab.
export const workspaceSyncState = proxy<WorkspaceSyncState>({ loaded: false })

// One thing the server keeps for the workspace, written by one request.
type Unit =
	| { readonly kind: 'connection'; readonly connectionId: string }
	| { readonly kind: 'site'; readonly siteId: string }
	| { readonly kind: 'profile'; readonly profileId: string }
	| { readonly kind: 'equipment'; readonly profileId: string; readonly connectionId: string }
	| { readonly kind: 'preference'; readonly profileId: string; readonly key: ProfilePreferenceKey }
	| { readonly kind: 'camera'; readonly profileId: string; readonly connectionId: string; readonly deviceId: string; readonly form: ProfileCameraForm }
	| { readonly kind: 'binding'; readonly profileId: string; readonly connectionId: string; readonly deviceId: string; readonly protocol: MountRemoteProtocol }
	| { readonly kind: 'framing'; readonly profileId: string; readonly framingId: string }
	| { readonly kind: 'notifications'; readonly profileId: string }

// A unit the tab holds and its value, as written to the server.
interface LocalUnit {
	readonly unit: Unit
	readonly value: unknown
}

// Kinds of unit written from their revision.
const REVISIONED = new Set<Unit['kind']>(['connection', 'site', 'profile', 'preference', 'camera'])

// Kinds of unit deleted on the server when the tab removes them.
const DELETABLE = new Set<Unit['kind']>(['connection', 'site', 'profile', 'framing'])

// Kinds of unit reset to their default (written as null) when the tab removes them.
const RESETTABLE = new Set<Unit['kind']>(['preference', 'camera'])

// How a preference kept by the server is read from and written to the settings of a profile.
interface PreferenceField {
	// Value of the preference in settings; undefined when absent.
	readonly get: (settings: ProfileSettings) => unknown
	// Replaces the value of the preference in settings; undefined makes it absent.
	readonly set: (settings: ProfileSettings, value: unknown) => void
}

// Optional field of ProfileSettings.
type OptionalSetting = { [K in keyof ProfileSettings]-?: undefined extends ProfileSettings[K] ? K : never }[keyof ProfileSettings]

// Preference kept as an optional field of ProfileSettings.
function setting(key: OptionalSetting): PreferenceField {
	return {
		get: (settings) => settings[key],
		set: (settings, value) => Object.assign(settings, { [key]: value }),
	}
}

// Preference kept as an optional field of the Sky settings.
function skySetting(key: keyof Pick<SkySettings, 'display'>): PreferenceField {
	return {
		get: (settings) => settings.sky[key],
		set: (settings, value) => Object.assign(settings.sky, { [key]: value }),
	}
}

// Fields of the framing kept by the server; which preset is drawn, and whether and where from, are view state.
type KeptFraming = Pick<SkyFramingSettings, 'presets' | 'manualSensor' | 'equipmentRotation'>

// Every preference the server keeps, and where it lives in the settings of a profile.
const PREFERENCES: Readonly<Record<ProfilePreferenceKey, PreferenceField>> = {
	telescope: setting('telescope'),
	guideTelescope: setting('guideTelescope'),
	skyDisplay: skySetting('display'),
	skyFraming: {
		get: ({ sky: { framing } }) => framing && ({ presets: framing.presets, manualSensor: framing.manualSensor, equipmentRotation: framing.equipmentRotation } satisfies KeptFraming),
		set: (settings, value) => {
			const framing = settings.sky.framing
			const { presets, manualSensor, equipmentRotation } = (value as KeptFraming | undefined) ?? { presets: [] }
			if (!value && !framing) return
			const activePresetId = presets.some((preset) => preset.id === framing?.activePresetId) ? framing?.activePresetId : presets[0]?.id
			settings.sky.framing = { ...(framing ?? { visible: false }), presets, manualSensor, equipmentRotation, activePresetId }
		},
	},
	starDetection: setting('starDetection'),
	starProfile: setting('starProfile'),
	streakDetection: setting('streakDetection'),
	imageAnnotation: setting('imageAnnotation'),
	imagePlateSolving: setting('imagePlateSolving'),
	imageDisplay: setting('imageDisplay'),
	imageAstrometry: setting('imageAstrometry'),
	statusBar: setting('statusBar'),
	satelliteFavorites: setting('satelliteFavorites'),
	dateTime: setting('dateTime'),
	meridianFlipMonitor: setting('meridianFlipMonitor'),
	meridianFlipExecutor: setting('meridianFlipExecutor'),
	mountDither: setting('mountDither'),
}

// Preferences the server keeps, in a fixed order.
const PREFERENCE_KEYS = Object.keys(PREFERENCES) as ProfilePreferenceKey[]

// Form of the server of each camera form of a profile.
const CAMERA_FORMS: Readonly<Record<keyof CameraSettings, ProfileCameraForm>> = {
	exposure: 'exposure',
	acquisition: 'acquisition',
	plateSolving: 'plateSolving',
	autoFocus: 'autoFocus',
	tppa: 'tppa',
	pointingModel: 'pointingModel',
	targetCentering: 'targetCentering',
	darv: 'darv',
	flatWizard: 'flatWizard',
	darkLibraryWizard: 'darkLibraryWizard',
	liveStacking: 'liveStacking',
	guiding: 'guiding',
	display: 'display',
}

// Key of a unit, unique across the workspace.
function unitKey(unit: Unit) {
	return JSON.stringify(unit)
}

// Saved connection unit of an id.
function connectionUnit(connectionId: string): Unit {
	return { kind: 'connection', connectionId }
}

// Observing site unit of an id.
function siteUnit(siteId: string): Unit {
	return { kind: 'site', siteId }
}

// Name, connection, active site, and position unit of a profile.
function profileUnit(profileId: string): Unit {
	return { kind: 'profile', profileId }
}

// Returns every unit the tab holds, with the value each one would be written with.
function localUnits(connections: readonly Connection[], sites: readonly ObservingSite[], profiles: readonly Profile[]): Map<string, LocalUnit> {
	const units = new Map<string, LocalUnit>()

	const add = (unit: Unit, value: unknown) => {
		if (value !== undefined) units.set(unitKey(unit), { unit, value })
	}

	for (const { id, name, type, host, port } of connections) add(connectionUnit(id), { name, type, host, port })
	for (const { id, name, latitude, longitude, elevation, timeZone } of sites) add(siteUnit(id), { name, latitude, longitude, elevation, timeZone })

	for (const [sortOrder, { id: profileId, name, connectionId, activeSiteId, equipment, settings }] of profiles.entries()) {
		add(profileUnit(profileId), { name, connectionId: connectionId ?? null, activeSiteId: activeSiteId ?? null, sortOrder })
		for (const [connectionId, setup] of Object.entries(equipment)) add({ kind: 'equipment', profileId, connectionId }, setup)
		for (const key of PREFERENCE_KEYS) add({ kind: 'preference', profileId, key }, PREFERENCES[key].get(settings))

		for (const [connectionId, devices] of Object.entries(settings.cameras)) {
			for (const [deviceId, forms] of Object.entries(devices)) {
				for (const [form, value] of Object.entries(forms)) add({ kind: 'camera', profileId, connectionId, deviceId, form: CAMERA_FORMS[form as keyof CameraSettings] }, value)
			}
		}

		for (const [connectionId, mounts] of Object.entries(settings.mountRemoteControl ?? {})) {
			for (const [deviceId, protocols] of Object.entries(mounts)) {
				for (const [protocol, binding] of Object.entries(protocols)) add({ kind: 'binding', profileId, connectionId, deviceId, protocol: protocol as MountRemoteProtocol }, binding)
			}
		}

		for (const { id: framingId, ...framing } of settings.framingReferences ?? []) add({ kind: 'framing', profileId, framingId }, framing)
		add({ kind: 'notifications', profileId }, settings.notifications)
	}

	return units
}

// Path of the route that writes a unit.
function unitPath(unit: Unit): string {
	const e = encodeURIComponent

	switch (unit.kind) {
		case 'connection':
			return `/api/saved-connections/${e(unit.connectionId)}`
		case 'site':
			return `/api/observing-sites/${e(unit.siteId)}`
		case 'profile':
			return `/api/profiles/${e(unit.profileId)}`
		case 'equipment':
			return `/api/profiles/${e(unit.profileId)}/equipment/${e(unit.connectionId)}`
		case 'preference':
			return `/api/profiles/${e(unit.profileId)}/preferences/${unit.key}`
		case 'camera':
			return `/api/profiles/${e(unit.profileId)}/cameras/${e(unit.connectionId)}/${e(unit.deviceId)}/${unit.form}`
		case 'binding':
			return `/api/profiles/${e(unit.profileId)}/mount-bindings/${e(unit.connectionId)}/${e(unit.deviceId)}/${unit.protocol}`
		case 'framing':
			return `/api/profiles/${e(unit.profileId)}/framing-references/${e(unit.framingId)}`
		case 'notifications':
			return `/api/profiles/${e(unit.profileId)}/notifications`
	}
}

// Body of the request that writes a unit with value from revision.
function unitBody(unit: Unit, value: unknown, revision: number): unknown {
	switch (unit.kind) {
		case 'connection':
		case 'site':
		case 'profile':
			return { ...(value as object), revision }
		case 'equipment':
			return { setup: value }
		case 'preference':
		case 'camera':
			return { version: PROFILE_SETTINGS_VERSION, value, revision }
		default:
			return value
	}
}

// Order in which units are written: what others refer to (saved connections and observing sites) is created first and
// deleted last.
function writeOrder(unit: Unit, deleting: boolean) {
	if (deleting) return unit.kind === 'framing' ? 3 : unit.kind === 'profile' ? 4 : 5
	return unit.kind === 'connection' || unit.kind === 'site' ? 0 : unit.kind === 'profile' ? 1 : 2
}

// Profile and saved connection a unit belongs to, whose deletion takes it along; none for a saved connection, an
// observing site, or a profile itself.
function ownersOf(unit: Unit): { readonly profileId?: string; readonly connectionId?: string } {
	if (unit.kind === 'connection' || unit.kind === 'site' || unit.kind === 'profile') return {}
	return { profileId: unit.profileId, connectionId: 'connectionId' in unit ? unit.connectionId : undefined }
}

// Value of a preference or a camera form the tab uses: absent when reset or of another version of its shape.
function usable(stored: WorkspaceValue | undefined) {
	return stored && stored.version === PROFILE_SETTINGS_VERSION && stored.value !== null ? stored.value : undefined
}

// Body of a refused write.
interface RefusedBody {
	readonly error?: string
	readonly code?: string
	readonly connection?: SavedConnection | null
	readonly site?: SavedObservingSite | null
	readonly profile?: ProfileRecord | null
	readonly value?: WorkspaceValue | null
}

// Synchronizes the saved connections of connections, the observing sites of sites, and the profiles of profiles with the
// server, through request.
export class WorkspaceSync {
	// Value of each unit as the server last confirmed it, encoded, by unit key.
	readonly #synced = new Map<string, { readonly unit: Unit; readonly encoded: string }>()
	// Revision of each unit the server keeps one for, by unit key.
	readonly #revisions = new Map<string, number>()
	// Units the tab changed and has not written yet, by unit key.
	readonly #dirty = new Map<string, Unit>()
	// Units being written, by unit key, with the encoded value sent; undefined while one is deleted or reset. The server
	// publishes a write before it answers it, so a scan meanwhile compares the tab with what is in flight, not only with
	// what was confirmed, and never writes the same value twice.
	readonly #writing = new Map<string, string | undefined>()
	// Timer of the next write.
	#timer?: ReturnType<typeof setTimeout>
	// Writes in progress, while they run.
	#flushing?: Promise<void>
	// Number of the latest refresh, so an older one never applies.
	#refreshes = 0
	// Number of completed writes, so a snapshot read across a write is read again.
	#writes = 0

	// connections, profiles, and sites are the stores of the tab, status what it shows, request the fetch of the server,
	// and delay the time after the latest change before writing, in milliseconds.
	constructor(
		readonly connections: ConnectionState,
		readonly profiles: ProfileState,
		readonly sites: SiteState = siteState,
		readonly status: WorkspaceSyncState = workspaceSyncState,
		readonly request: typeof fetch = fetch,
		readonly delay: number = WRITE_DELAY,
	) {}

	// Starts comparing and writing the changes of the tab, writing what is left when the page is hidden. Returns a
	// function that stops it.
	start(): () => void {
		const stops = [subscribe(this.connections, () => this.#scan()), subscribe(this.sites, () => this.#scan()), subscribe(this.profiles, () => this.#scan())]
		const hide = () => void this.flush()
		globalThis.addEventListener?.('pagehide', hide)

		return () => {
			for (const stop of stops) stop()
			globalThis.removeEventListener?.('pagehide', hide)
			clearTimeout(this.#timer)
		}
	}

	// Reads the workspace from the server and applies it to every unit the tab is not writing; the first one makes the
	// workspace loaded. Read again when a write completed meanwhile. Returns false when the server is unreachable or a
	// later refresh started.
	async refresh(): Promise<boolean> {
		const refresh = ++this.#refreshes

		for (let attempt = 0; attempt < MAXIMUM_REFRESHES; attempt++) {
			const writes = this.#writes

			try {
				const { request } = this
				const response = await request('/api/workspace')
				if (!response.ok) return false
				const workspace = (await response.json()) as WorkspaceSnapshot
				if (refresh !== this.#refreshes) return false
				if (this.#writes !== writes && attempt < MAXIMUM_REFRESHES - 1) continue
				this.#reconcile(undefined, () => this.#applySnapshot(workspace))
				this.status.loaded = true
				if (this.#dirty.size > 0) this.#schedule(0)
				return true
			} catch {
				return false
			}
		}

		return false
	}

	// Applies an event of the server: a saved connection, an observing site, or a profile another tab, or this one, changed.
	handle(event: ServerEvent) {
		if (!this.status.loaded) return

		switch (event.type) {
			case 'savedConnection:updated':
				return this.#reconcile(undefined, () => this.#applyConnection(event.connection.id, event.connection))
			case 'savedConnection:removed':
				return this.#reconcile(undefined, () => this.#applyConnection(event.id, undefined))
			case 'observingSite:updated':
				return this.#reconcile(undefined, () => this.#applySite(event.site.id, event.site))
			case 'observingSite:removed':
				return this.#reconcile(undefined, () => this.#applySite(event.id, undefined))
			case 'profile:updated':
				return this.#reconcile(undefined, () => this.#applyProfile(event.profile))
			case 'profile:removed':
				return this.#reconcile(undefined, () => this.#removeProfile(event.id))
		}
	}

	// Writes every change of the tab now, one request at a time, in an order that creates what others refer to first.
	// Resolves once nothing is left to write, or the server could not be reached, which writes again later.
	flush(): Promise<void> {
		clearTimeout(this.#timer)
		this.#flushing ??= this.#drain().finally(() => (this.#flushing = undefined))
		return this.#flushing
	}

	// Whether a unit is being changed by the tab: not written yet, or being written.
	#busy(key: string) {
		return this.#dirty.has(key) || this.#writing.has(key)
	}

	// Units of the tab now.
	#local() {
		return localUnits(snapshot(this.connections).connections, snapshot(this.sites).sites, snapshot(this.profiles).profiles)
	}

	// Marks the units whose value differs from what the server confirmed, or from what is being written to it, as
	// changed, and schedules their write.
	#scan() {
		if (!this.status.loaded) return

		const local = this.#local()
		const profiles = new Set(this.profiles.profiles.map(({ id }) => id))
		const connections = new Set(this.connections.connections.map(({ id }) => id))

		for (const [key, { unit, value }] of local) {
			const encoded = JSON.stringify(value)
			if (this.#synced.get(key)?.encoded === encoded || (this.#writing.has(key) && this.#writing.get(key) === encoded)) this.#dirty.delete(key)
			else this.#dirty.set(key, unit)
		}

		for (const [key, { unit }] of this.#synced) {
			if (local.has(key)) continue

			// Its deletion or reset is already on its way.
			if (this.#writing.has(key) && this.#writing.get(key) === undefined) {
				this.#dirty.delete(key)
				continue
			}

			const { profileId, connectionId } = ownersOf(unit)
			const orphan = (profileId !== undefined && !profiles.has(profileId)) || (connectionId !== undefined && !connections.has(connectionId))

			// What went with its profile or connection goes on the server with it too.
			if (orphan || !(DELETABLE.has(unit.kind) || RESETTABLE.has(unit.kind))) {
				this.#synced.delete(key)
				this.#dirty.delete(key)
			} else {
				this.#dirty.set(key, unit)
			}
		}

		for (const key of this.#dirty.keys()) {
			if (!local.has(key) && !this.#synced.has(key)) this.#dirty.delete(key)
		}

		if (this.#dirty.size > 0 && !this.#flushing) this.#schedule(this.delay)
	}

	// Schedules a write of the changes after delay, in milliseconds.
	#schedule(delay: number) {
		clearTimeout(this.#timer)
		this.#timer = setTimeout(() => void this.flush(), delay)
	}

	// Writes the changed units one at a time until none is left; stops at the first one the server could not receive,
	// which is written again after RETRY_DELAY.
	async #drain() {
		while (this.#dirty.size > 0) {
			const local = this.#local()
			const order = ([key, unit]: [string, Unit]) => writeOrder(unit, !local.has(key) && DELETABLE.has(unit.kind))
			const [key, unit] = [...this.#dirty].sort((a, b) => order(a) - order(b))[0]
			this.#dirty.delete(key)

			if (!(await this.#write(key, unit, local.get(key)?.value))) {
				this.#dirty.set(key, unit)
				this.#schedule(RETRY_DELAY)
				return
			}
		}
	}

	// Writes one unit with value, or deletes or resets it when value is undefined. Returns false when the server could
	// not be reached.
	async #write(key: string, unit: Unit, value: unknown): Promise<boolean> {
		const deleting = value === undefined && DELETABLE.has(unit.kind)
		if (value === undefined && !deleting && !RESETTABLE.has(unit.kind)) return true

		const revision = this.#revisions.get(key) ?? 0
		this.#writing.set(key, value === undefined ? undefined : JSON.stringify(value))

		try {
			const init: RequestInit = deleting ? { method: 'DELETE' } : jsonInit('PUT', unitBody(unit, value ?? null, revision))
			const { request } = this
			const response = await request(unitPath(unit), { ...init, keepalive: true })
			this.#writes++

			if (!response.ok) {
				await this.#refused(key, unit, value, response)
				return true
			}

			if (REVISIONED.has(unit.kind) && !deleting) this.#revisions.set(key, ((await response.json()) as { readonly revision: number }).revision)
			if (deleting) this.#revisions.delete(key)
			if (value === undefined) this.#synced.delete(key)
			else this.#synced.set(key, { unit, encoded: JSON.stringify(value) })
			return true
		} catch {
			return false
		} finally {
			this.#writing.delete(key)
		}
	}

	// Handles a write the server refused: a conflict shows what the server kept; anything else keeps the tab as it is
	// until the workspace is read again, which it is at once.
	async #refused(key: string, unit: Unit, value: unknown, response: Response) {
		const body = (await response.json().catch(() => undefined)) as RefusedBody | undefined
		this.#dirty.delete(key)
		this.#writing.delete(key)

		if (response.status === 409 && body?.code === 'conflict') {
			this.#reconcile(key, () => {
				if (unit.kind === 'connection') this.#applyConnection(unit.connectionId, body.connection ?? undefined, true)
				else if (unit.kind === 'site') this.#applySite(unit.siteId, body.site ?? undefined, true)
				else if (unit.kind === 'profile') body.profile ? this.#applyProfile(body.profile, true) : this.#removeProfile(unit.profileId, true)
				else if (unit.kind === 'preference' || unit.kind === 'camera') this.#applyValue(unit, body.value ?? undefined, true)
			})
			this.status.message = 'Another tab changed this first; this tab now shows what it saved.'
			return
		}

		this.status.message = body?.error ? `Unable to save: ${body.error}.` : `Unable to save: the server answered ${response.status}.`
		if (value === undefined) this.#synced.delete(key)
		else this.#synced.set(key, { unit, encoded: JSON.stringify(value) })
		void this.refresh()
	}

	// Applies what the server holds through change, leaving alone the units the tab is changing, then records every
	// unit the tab is not changing as confirmed. The unit of forced, when given, takes what the server holds even though
	// the tab changed it: the server refused that change.
	#reconcile(forced: string | undefined, change: () => void) {
		this.#scan()
		if (forced !== undefined) this.#dirty.delete(forced)
		change()

		const local = this.#local()

		for (const [key, entry] of local) {
			if (!this.#busy(key)) this.#synced.set(key, { unit: entry.unit, encoded: JSON.stringify(entry.value) })
		}

		for (const key of this.#synced.keys()) {
			if (!local.has(key) && !this.#busy(key)) this.#synced.delete(key)
		}

		const { connections, profiles } = this
		if (!connections.connections.some(({ id }) => id === connections.selected)) connections.selected = connections.connections[0]?.id
		if (!profiles.profiles.some(({ id }) => id === profiles.activeId)) profiles.activeId = profiles.profiles[0]?.id ?? ''
	}

	// Applies a snapshot of the workspace: what it holds, in its order, and what it no longer holds goes, except what the
	// tab is creating.
	#applySnapshot({ connections, sites, profiles }: WorkspaceSnapshot) {
		for (const connection of connections) this.#applyConnection(connection.id, connection)
		const savedConnections = new Set(connections.map(({ id }) => id))
		for (const id of this.connections.connections.map((connection) => connection.id)) if (!savedConnections.has(id)) this.#applyConnection(id, undefined)
		const connectionOrder = new Map(connections.map(({ id }, index) => [id, index]))
		this.connections.connections = [...this.connections.connections].sort((a, b) => (connectionOrder.get(a.id) ?? Infinity) - (connectionOrder.get(b.id) ?? Infinity))

		for (const site of sites) this.#applySite(site.id, site)
		const savedSites = new Set(sites.map(({ id }) => id))
		for (const id of this.sites.sites.map((site) => site.id)) if (!savedSites.has(id)) this.#applySite(id, undefined)
		const siteOrder = new Map(sites.map(({ id }, index) => [id, index]))
		this.sites.sites = [...this.sites.sites].sort((a, b) => (siteOrder.get(a.id) ?? Infinity) - (siteOrder.get(b.id) ?? Infinity))

		for (const profile of profiles) this.#applyProfile(profile)
		const savedProfiles = new Set(profiles.map(({ id }) => id))
		for (const id of this.profiles.profiles.map((profile) => profile.id)) if (!savedProfiles.has(id)) this.#removeProfile(id)
		const profileOrder = new Map(profiles.map(({ id }, index) => [id, index]))
		this.profiles.profiles = [...this.profiles.profiles].sort((a, b) => (profileOrder.get(a.id) ?? Infinity) - (profileOrder.get(b.id) ?? Infinity))
	}

	// Applies a saved connection of the server, or its absence, unless the tab is changing it (or force).
	#applyConnection(id: string, connection: SavedConnection | undefined, force = false) {
		const key = unitKey(connectionUnit(id))
		if (!force && this.#busy(key)) return
		const index = this.connections.connections.findIndex((saved) => saved.id === id)

		if (!connection) {
			this.#revisions.delete(key)
			if (index >= 0) this.connections.connections.splice(index, 1)
			return
		}

		const known = this.#revisions.get(key)
		if (!force && known !== undefined && connection.revision < known) return
		this.#revisions.set(key, connection.revision)
		const { name, type, host, port } = connection
		if (index >= 0) this.connections.connections[index] = { id, name, type, host, port }
		else this.connections.connections.push({ id, name, type, host, port })
	}

	// Applies an observing site of the server, or its absence, unless the tab is changing it (or force). The profiles that
	// observe from a removed site are cleared by the server, which publishes them.
	#applySite(id: string, site: SavedObservingSite | undefined, force = false) {
		const key = unitKey(siteUnit(id))
		if (!force && this.#busy(key)) return
		const index = this.sites.sites.findIndex((saved) => saved.id === id)

		if (!site) {
			this.#revisions.delete(key)
			if (index >= 0) this.sites.sites.splice(index, 1)
			return
		}

		const known = this.#revisions.get(key)
		if (!force && known !== undefined && site.revision < known) return
		this.#revisions.set(key, site.revision)
		const { name, latitude, longitude, elevation, timeZone } = site
		if (index >= 0) this.sites.sites[index] = { id, name, latitude, longitude, elevation, timeZone }
		else this.sites.sites.push({ id, name, latitude, longitude, elevation, timeZone })
	}

	// Removes a profile the server no longer holds, unless the tab is creating or changing it (or force).
	#removeProfile(id: string, force = false) {
		if (!force && this.#busy(unitKey(profileUnit(id)))) return
		this.#revisions.delete(unitKey(profileUnit(id)))
		this.profiles.profiles = this.profiles.profiles.filter((profile) => profile.id !== id)
	}

	// Applies a profile of the server to the tab, creating it when the tab does not know it, unit by unit, leaving alone
	// the units the tab is changing; with force, its name, connection, and active site apply anyway.
	#applyProfile(record: ProfileRecord, force = false) {
		let profile = this.profiles.profiles.find(({ id }) => id === record.id)

		if (!profile) {
			this.profiles.profiles.push(newProfile(record.name, record.id))
			profile = this.profiles.profiles.at(-1)!
		}

		const profileId = record.id
		const headerKey = unitKey(profileUnit(profileId))
		const known = this.#revisions.get(headerKey)

		if (force || (!this.#busy(headerKey) && (known === undefined || record.revision >= known))) {
			this.#revisions.set(headerKey, record.revision)
			profile.name = record.name
			if (record.connectionId) profile.connectionId = record.connectionId
			else delete profile.connectionId
			if (record.activeSiteId) profile.activeSiteId = record.activeSiteId
			else delete profile.activeSiteId
		}

		for (const connectionId of new Set([...Object.keys(profile.equipment), ...Object.keys(record.equipment)])) {
			if (this.#busy(unitKey({ kind: 'equipment', profileId, connectionId }))) continue
			const setup = record.equipment[connectionId]
			if (setup) profile.equipment[connectionId] = structuredClone(setup)
			else delete profile.equipment[connectionId]
		}

		for (const key of PREFERENCE_KEYS) this.#applyValue({ kind: 'preference', profileId, key }, record.preferences[key])

		const { settings } = profile
		const cameras = new Set<string>()
		for (const [connectionId, devices] of Object.entries(settings.cameras)) for (const [deviceId, forms] of Object.entries(devices)) for (const form of Object.keys(forms)) cameras.add(JSON.stringify([connectionId, deviceId, form]))
		for (const [connectionId, devices] of Object.entries(record.cameras)) for (const [deviceId, forms] of Object.entries(devices)) for (const form of Object.keys(forms)) cameras.add(JSON.stringify([connectionId, deviceId, form]))

		for (const camera of cameras) {
			const [connectionId, deviceId, form] = JSON.parse(camera) as [string, string, ProfileCameraForm]
			this.#applyValue({ kind: 'camera', profileId, connectionId, deviceId, form }, record.cameras[connectionId]?.[deviceId]?.[form])
		}

		const bindings = new Set<string>()
		for (const [connectionId, mounts] of Object.entries(settings.mountRemoteControl ?? {})) for (const [deviceId, protocols] of Object.entries(mounts)) for (const protocol of Object.keys(protocols)) bindings.add(JSON.stringify([connectionId, deviceId, protocol]))
		for (const [connectionId, mounts] of Object.entries(record.mountBindings)) for (const [deviceId, protocols] of Object.entries(mounts)) for (const protocol of Object.keys(protocols)) bindings.add(JSON.stringify([connectionId, deviceId, protocol]))

		for (const binding of bindings) {
			const [connectionId, deviceId, protocol] = JSON.parse(binding) as [string, string, MountRemoteProtocol]
			if (this.#busy(unitKey({ kind: 'binding', profileId, connectionId, deviceId, protocol }))) continue
			const stored = record.mountBindings[connectionId]?.[deviceId]?.[protocol]
			settings.mountRemoteControl ??= {}
			const protocols = nestedObject(nestedObject(settings.mountRemoteControl, connectionId), deviceId)
			if (stored) protocols[protocol] = { host: stored.host, port: stored.port } satisfies MountRemoteBinding
			else delete protocols[protocol]
		}

		const local = settings.framingReferences ?? []
		const busy = (framingId: string) => this.#busy(unitKey({ kind: 'framing', profileId, framingId }))
		const kept = record.framings.flatMap((framing): FramingReference[] => {
			if (!busy(framing.id)) return [{ ...framing }]
			const own = local.find(({ id }) => id === framing.id)
			return own ? [own] : []
		})
		const created = local.filter(({ id }) => busy(id) && !record.framings.some((framing) => framing.id === id))
		const framings = [...kept, ...created]
		if (framings.length > 0 || settings.framingReferences) settings.framingReferences = framings

		if (!this.#busy(unitKey({ kind: 'notifications', profileId }))) {
			const { readIds, dismissedIds } = record.notifications
			settings.notifications = readIds.length > 0 || dismissedIds.length > 0 ? { readIds: [...readIds], dismissedIds: [...dismissedIds] } : undefined
		}
	}

	// Applies a preference or a camera form of the server, or its absence, unless the tab is changing it (or force) or
	// the tab knows a newer revision of it.
	#applyValue(unit: Extract<Unit, { kind: 'preference' | 'camera' }>, stored: WorkspaceValue | undefined, force = false) {
		const key = unitKey(unit)
		if (!force && this.#busy(key)) return
		const known = this.#revisions.get(key)
		if (!force && stored && known !== undefined && stored.revision < known) return
		if (stored) this.#revisions.set(key, stored.revision)
		else if (force) this.#revisions.delete(key)

		const profile = this.profiles.profiles.find(({ id }) => id === unit.profileId)
		if (!profile) return
		const value = usable(stored)

		if (unit.kind === 'preference') {
			PREFERENCES[unit.key].set(profile.settings, value === undefined ? undefined : structuredClone(value))
			return
		}

		const { cameras } = profile.settings
		const { form } = unit

		if (value === undefined) {
			const devices = cameras[unit.connectionId]
			if (devices?.[unit.deviceId]) delete devices[unit.deviceId][form]
			return
		}

		Object.assign(nestedObject(nestedObject(cameras, unit.connectionId), unit.deviceId), { [form]: structuredClone(value) })
	}
}
