import type { CameraSensor } from 'api'
import type { CatalogCamera, CatalogTelescope } from '../../equipment/catalog'
import { CAMERA_ROLES, type CameraRole, isCameraRole, roleDefinition } from '../../equipment/roles'
import { DEFAULT_TELESCOPE, type EquipmentTelescopes, type OpticalConfiguration, type SensorGeometry, type TelescopeOptics } from '../../framing/geometry'
import type { SensorTarget } from '../../sky/sensors'

// Sources a calculator can import an optical configuration from, read only from what the tab already has: the active
// profile's Equipment Setup (its telescope or guide telescope with the sensor the camera of a camera role reports), the
// cameras of the Equipment Catalog (the telescope with the sensor a camera declares), the telescopes of the Equipment
// Catalog (the optics a telescope declares with the sensor the Main Camera reports), and the framings of the Framing
// tool as the tab resolves them. An import copies the configuration once into a calculator draft, which is then edited
// on its own: the profile, the framings, and the devices are never written, and a later change of the source never
// rewrites the draft. The origin of an import stays shown only while
// it still describes the same profile and camera.

// Source of an optical configuration: the Equipment Setup through a camera role, a camera or a telescope of the
// Equipment Catalog by id, or a framing of the Framing tool by id.
export type OpticsSourceId = CameraRole | `catalog:${string}` | `telescope:${string}` | `framing:${string}`

// Framing of the Framing tool a calculator imports from, resolved for the tab.
export interface SourceFraming {
	// Id of the framing.
	readonly id: string
	// Name of the framing.
	readonly name: string
	// Optical configuration it resolves to, with its rotation.
	readonly optics: OpticalConfiguration
}

// Profile data the sources are read from.
export interface SourceSettings {
	// Telescope optics of the Equipment Setup, which the Main Camera looks through; absent until entered.
	readonly telescope?: Readonly<TelescopeOptics>
	// Guide telescope optics, which the Guide Camera looks through; absent until entered.
	readonly guideTelescope?: Readonly<TelescopeOptics>
	// Framings of the Framing tool, by name, without the Equipment Setup's pseudo-framing, which the camera roles give.
	readonly framings: readonly Readonly<SourceFraming>[]
	// Cameras of the Equipment Catalog, in list order; the archived ones are not offered.
	readonly catalogCameras: readonly Readonly<Pick<CatalogCamera, 'id' | 'name' | 'sensor' | 'archived'>>[]
	// Telescopes of the Equipment Catalog, in list order; the archived ones are not offered.
	readonly catalogTelescopes: readonly Readonly<Pick<CatalogTelescope, 'id' | 'name' | 'aperture' | 'focalLength' | 'archived'>>[]
}

// Everything an import reads.
export interface SourceContext {
	// Id of the active profile.
	readonly profileId: string
	// Profile data.
	readonly settings: SourceSettings
	// Sensor each camera role's device reports; absent for a role whose camera reports none.
	readonly live: Readonly<Partial<Record<CameraRole, CameraSensor>>>
	// Camera device each camera role follows on the open connection.
	readonly cameras: Readonly<Partial<Record<CameraRole, SensorTarget>>>
}

// Where an imported configuration came from.
export interface ImportOrigin {
	// Source imported.
	readonly source: OpticsSourceId
	// Display name of the source at the time of the import.
	readonly label: string
	// Profile active at the time of the import.
	readonly profileId: string
	// Camera whose sensor was imported; absent for a framing or the catalog.
	readonly camera?: SensorTarget
}

// Result of an import: a copy of the configuration and its origin, or why the source cannot be imported.
export type OpticsImport = { readonly optics: OpticalConfiguration; readonly origin: ImportOrigin } | { readonly reason: string }

// Draft of a calculator with the origin of its last import; the draft as imported tells whether it was edited since.
export interface DraftEntry<D> {
	// Values of the fields, as typed.
	readonly draft: D
	// Origin of the last import; absent for values entered by hand or reset to the example.
	readonly origin?: ImportOrigin
	// Draft right after the last import; present with origin.
	readonly imported?: D
}

// Prefix of the source id of a framing.
const FRAMING_PREFIX = 'framing:'

// Prefix of the source id of a camera of the Equipment Catalog.
const CATALOG_PREFIX = 'catalog:'

// Prefix of the source id of a telescope of the Equipment Catalog.
const TELESCOPE_PREFIX = 'telescope:'

// Returns the sources in menu order: the camera roles, every camera and then every telescope of the Equipment Catalog that
// is not archived, then every framing.
export function opticsSources(settings: Pick<SourceSettings, 'framings' | 'catalogCameras' | 'catalogTelescopes'>): OpticsSourceId[] {
	const cameras = settings.catalogCameras.filter((e) => !e.archived).map((e): OpticsSourceId => `${CATALOG_PREFIX}${e.id}`)
	const telescopes = settings.catalogTelescopes.filter((e) => !e.archived).map((e): OpticsSourceId => `${TELESCOPE_PREFIX}${e.id}`)
	return [...CAMERA_ROLES, ...cameras, ...telescopes, ...settings.framings.map((e): OpticsSourceId => `${FRAMING_PREFIX}${e.id}`)]
}

// Returns the camera of the Equipment Catalog a source names; undefined for another source or a camera no longer there.
function catalogCameraOf(settings: Pick<SourceSettings, 'catalogCameras'>, source: OpticsSourceId) {
	return source.startsWith(CATALOG_PREFIX) ? settings.catalogCameras.find((e) => `${CATALOG_PREFIX}${e.id}` === source) : undefined
}

// Returns the telescope of the Equipment Catalog a source names; undefined for another source or a telescope no longer
// there.
function catalogTelescopeOf(settings: Pick<SourceSettings, 'catalogTelescopes'>, source: OpticsSourceId) {
	return source.startsWith(TELESCOPE_PREFIX) ? settings.catalogTelescopes.find((e) => `${TELESCOPE_PREFIX}${e.id}` === source) : undefined
}

// Returns the framing a source names; undefined for another source or a framing that no longer exists.
function framingOf(settings: Pick<SourceSettings, 'framings'>, source: OpticsSourceId) {
	return source.startsWith(FRAMING_PREFIX) ? settings.framings.find((e) => `${FRAMING_PREFIX}${e.id}` === source) : undefined
}

// Returns the display name of a source.
export function sourceLabel(settings: Pick<SourceSettings, 'framings' | 'catalogCameras' | 'catalogTelescopes'>, source: OpticsSourceId) {
	if (isCameraRole(source)) return roleDefinition(source).label
	if (source.startsWith(CATALOG_PREFIX)) return catalogCameraOf(settings, source)?.name ?? 'Deleted camera'
	if (source.startsWith(TELESCOPE_PREFIX)) return catalogTelescopeOf(settings, source)?.name ?? 'Deleted telescope'
	return framingOf(settings, source)?.name ?? 'Deleted framing'
}

// Returns the menu group of a source.
export function sourceGroup(source: OpticsSourceId) {
	return source.startsWith(FRAMING_PREFIX) ? 'Framings' : source.startsWith(CATALOG_PREFIX) || source.startsWith(TELESCOPE_PREFIX) ? 'Equipment Catalog' : 'Equipment Setup'
}

// Optical configuration of a camera role of the Equipment Setup, or of a sensor behind the telescope: the optics it looks
// through (the guide telescope for the Guide Camera, the telescope otherwise; zero when not entered) with the sensor
// given or the one the role reports, else an empty sensor and the role that has none (missingCamera).
function setupOptics({ telescope, guideTelescope }: EquipmentTelescopes, role: CameraRole, live: SourceContext['live'], sensor?: SensorGeometry): { readonly optics: OpticalConfiguration; readonly missingCamera?: CameraRole } {
	const { focalLength, focalMultiplier, aperture } = (role === 'GUIDE_CAMERA' ? guideTelescope : telescope) ?? DEFAULT_TELESCOPE
	const base = { focalLength, focalMultiplier, aperture, rotation: 0 }
	if (sensor) return { optics: { ...base, sensor } }
	const reported = live[role]
	if (!reported) return { optics: { ...base, sensor: { kind: 'pixels', width: 0, height: 0, pixelSize: 0 } }, missingCamera: role }
	return { optics: { ...base, sensor: { kind: 'pixels', width: reported.width, height: reported.height, pixelSize: reported.pixelSize } } }
}

// Copies the optical configuration of a source. A camera role takes the optics it looks through and the sensor its
// device reports, never another camera's; a camera of the Equipment Catalog takes the telescope with the sensor it
// declares (a pixel size it does not declare stays missing); a telescope of the Equipment Catalog takes its native optics
// (no reducer or Barlow) with the sensor the Main Camera reports, missing when it reports none; a framing is copied as the
// tab resolves it. Optics the profile has not entered are zero, so the draft shows them as missing.
export function importOptics(context: SourceContext, source: OpticsSourceId): OpticsImport {
	const { settings, profileId } = context
	const label = sourceLabel(settings, source)

	if (isCameraRole(source)) {
		const { optics, missingCamera } = setupOptics(settings, source, context.live)
		if (missingCamera) return { reason: `The ${label} has not reported its sensor: assign and connect it in the Equipment Setup.` }
		const camera = context.cameras[source]
		return { optics, origin: { source, label, profileId, camera: camera && { connectionId: camera.connectionId, id: camera.id } } }
	}

	if (source.startsWith(CATALOG_PREFIX)) {
		const camera = catalogCameraOf(settings, source)
		if (!camera) return { reason: 'The camera is no longer in the Equipment Catalog.' }
		if (!camera.sensor) return { reason: `No sensor is declared for ${camera.name}: declare it in Settings → Equipment Catalog.` }
		const { width, height, pixelSize } = camera.sensor
		const { optics } = setupOptics(settings, 'MAIN_CAMERA', context.live, { kind: 'pixels', width, height, pixelSize: pixelSize ?? 0 })
		return { optics, origin: { source, label, profileId } }
	}

	if (source.startsWith(TELESCOPE_PREFIX)) {
		const telescope = catalogTelescopeOf(settings, source)
		if (!telescope) return { reason: 'The telescope is no longer in the Equipment Catalog.' }
		if (telescope.focalLength === undefined) return { reason: `No focal length is declared for ${telescope.name}: declare it in Settings → Equipment Catalog.` }
		const main = context.live.MAIN_CAMERA
		const sensor: SensorGeometry = { kind: 'pixels', width: main?.width ?? 0, height: main?.height ?? 0, pixelSize: main?.pixelSize ?? 0 }
		return { optics: { focalLength: telescope.focalLength, focalMultiplier: 1, aperture: telescope.aperture ?? 0, sensor, rotation: 0 }, origin: { source, label, profileId } }
	}

	const framing = framingOf(settings, source)
	if (!framing) return { reason: 'The framing no longer exists.' }
	return { optics: { ...framing.optics, sensor: { ...framing.optics.sensor } }, origin: { source, label, profileId } }
}

// Whether an import origin still describes the active profile and, for a camera, the camera its role follows now.
export function isOriginCurrent(origin: ImportOrigin, context: Pick<SourceContext, 'profileId' | 'cameras'>) {
	if (origin.profileId !== context.profileId) return false
	if (!isCameraRole(origin.source)) return true
	const camera = context.cameras[origin.source]
	return camera?.connectionId === origin.camera?.connectionId && camera?.id === origin.camera?.id
}
