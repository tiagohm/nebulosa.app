import type { FramingCamera, FramingDocument, FramingTelescope } from 'api'
import { useSnapshot } from 'valtio'
import { type CatalogCamera, type CatalogTelescope, catalogState } from '../equipment/catalog'
import { type CameraRole, roleDefinition } from '../equipment/roles'
import { useProfileTelescopes } from '../equipment/telescopes'
import { activeProfile, profileState } from '../profile/profile'
import type { RoleSensor } from '../sky/sensors'
import { useRoleSensors } from '../sky/useSkyDevices'
import { framingsState, type SavedFraming, sortedFramings } from './framings'
import { DEFAULT_TELESCOPE, type EquipmentTelescopes, type Framing, type MissingFraming, type OpticalConfiguration, resolveFraming, type SensorGeometry } from './geometry'
import type { FrameColor } from './palette'

// Resolution of a framing into the optical configuration a field of view is computed from, for the tab that shows it. A
// typed or AstroBin telescope or camera keeps its values; one of the Equipment Catalog takes what the item declares and
// keeps its last copy for what it does not declare or once it is deleted; one of the Equipment Setup follows the active
// profile of the tab: the telescope or guide telescope (resolved through the catalog, with the setup's reducer or Barlow)
// and the sensor of a camera role (what its device reports, completed by the catalog: roleSensors). The two pseudo-framings
// of the Equipment Setup, the Main Camera behind the telescope (EQUIPMENT_FRAMING_ID) and the Guide Camera behind the
// guide telescope (GUIDE_FRAMING_ID), both without rotation, are offered first by every tool, so a profile plans with
// its setup before any framing is created.

// Id of the pseudo-framing of the Main Camera of the Equipment Setup, never saved; what a tool falls back to.
export const EQUIPMENT_FRAMING_ID = 'equipment'

// Id of the pseudo-framing of the Guide Camera of the Equipment Setup, never saved.
export const GUIDE_FRAMING_ID = 'equipment-guide'

// Zero sensor of a camera that reports none, which resolveFraming lists as missing.
const NO_SENSOR: SensorGeometry = { kind: 'pixels', width: 0, height: 0, pixelSize: 0 }

// Document of a framing as resolve reads it: a saved one has the index of its colour, a pseudo-framing of the Equipment
// Setup the colour of its camera.
export interface ResolvableFraming extends Omit<FramingDocument, 'color'> {
	// Colour of the framing.
	readonly color: FrameColor
}

// Document of the pseudo-framing of the Main Camera of the Equipment Setup: the Main Camera behind the telescope, without
// rotation.
export const EQUIPMENT_FRAMING: ResolvableFraming = {
	name: 'Main Camera',
	color: 'main',
	optics: { telescope: { source: 'setup', setupOptics: 'telescope', focalLength: 0, aperture: 0, focalMultiplier: 1 }, camera: { source: 'setup', role: 'MAIN_CAMERA', sensor: NO_SENSOR } },
	rotation: 0,
}

// Document of the pseudo-framing of the Guide Camera of the Equipment Setup: the Guide Camera behind the guide
// telescope, without rotation; with an off-axis guider the guide telescope repeats the telescope.
export const GUIDE_FRAMING: ResolvableFraming = {
	name: 'Guide Camera',
	color: 'guide',
	optics: { telescope: { source: 'setup', setupOptics: 'guideTelescope', focalLength: 0, aperture: 0, focalMultiplier: 1 }, camera: { source: 'setup', role: 'GUIDE_CAMERA', sensor: NO_SENSOR } },
	rotation: 0,
}

// Returns whether a framing id is a pseudo-framing of the Equipment Setup, shown but never edited, turned, or saved.
export function isSetupFraming(id: string) {
	return id === EQUIPMENT_FRAMING_ID || id === GUIDE_FRAMING_ID
}

// What a framing resolves against: the active profile's Equipment Setup and the Equipment Catalog of the tab.
export interface FramingContext {
	// Telescope and guide telescope of the Equipment Setup, resolved through the catalog.
	readonly telescopes: EquipmentTelescopes
	// Sensor of each camera role of the Equipment Setup; absent for a role whose camera has none.
	readonly sensors: Readonly<Partial<Record<CameraRole, RoleSensor>>>
	// Cameras of the Equipment Catalog, archived ones included.
	readonly catalogCameras: readonly Readonly<Pick<CatalogCamera, 'id' | 'name' | 'sensor'>>[]
	// Telescopes of the Equipment Catalog, archived ones included.
	readonly catalogTelescopes: readonly Readonly<Pick<CatalogTelescope, 'id' | 'name' | 'aperture' | 'focalLength'>>[]
}

// Where the resolved values of a telescope or camera come from, for people.
export interface OpticsOrigin {
	// Short name of the source, such as the catalog item, the AstroBin equipment model, or the camera role.
	readonly label: string
	// Whether the catalog item it refers to was deleted, so its last copy is used.
	readonly deleted?: boolean
}

// Camera origin, with what the Equipment Setup lacks.
export interface CameraOrigin extends OpticsOrigin {
	// Camera role of the Equipment Setup whose camera has no sensor; absent otherwise.
	readonly missingCamera?: CameraRole
	// Sensor of the camera role, with where its values come from; present for a role that has one.
	readonly roleSensor?: RoleSensor
}

// A framing resolved for the tab.
export interface ResolvedFraming {
	// Id of the framing, or EQUIPMENT_FRAMING_ID or GUIDE_FRAMING_ID.
	readonly id: string
	// Name of the framing.
	readonly name: string
	// Colour of the framing: an index of the `frame-*` tokens, or the colour of a camera of the Equipment Setup.
	readonly color: FrameColor
	// Optical configuration, with the rotation of the framing.
	readonly optics: OpticalConfiguration
	// Field of view, or what is missing to compute it.
	readonly field: Framing | MissingFraming
	// Where the telescope values come from.
	readonly telescope: OpticsOrigin
	// Where the camera values come from.
	readonly camera: CameraOrigin
}

// Returns the name of the camera whose missing sensor keeps a framing from its field, such as "Main Camera sensor";
// undefined when its camera has one or is not of the Equipment Setup.
export function missingCameraName(camera: Pick<CameraOrigin, 'missingCamera'>) {
	return camera.missingCamera && `${roleDefinition(camera.missingCamera).label} sensor`
}

// Returns the telescope values of a framing, in millimeters, with their origin.
function resolveTelescopeOf(telescope: FramingTelescope, context: FramingContext): { readonly values: Pick<OpticalConfiguration, 'focalLength' | 'aperture' | 'focalMultiplier'>; readonly origin: OpticsOrigin } {
	const { focalLength, aperture, focalMultiplier } = telescope

	switch (telescope.source) {
		case 'setup': {
			const guide = telescope.setupOptics === 'guideTelescope'
			const optics = (guide ? context.telescopes.guideTelescope : context.telescopes.telescope) ?? DEFAULT_TELESCOPE
			return { values: { focalLength: optics.focalLength, aperture: optics.aperture, focalMultiplier: optics.focalMultiplier }, origin: { label: guide ? 'Guide Telescope' : 'Main Telescope' } }
		}
		case 'catalog': {
			const item = context.catalogTelescopes.find((e) => e.id === telescope.telescopeId)
			if (!item) return { values: { focalLength, aperture, focalMultiplier }, origin: { label: 'Deleted telescope', deleted: true } }
			return { values: { focalLength: item.focalLength ?? focalLength, aperture: item.aperture ?? aperture, focalMultiplier }, origin: { label: item.name } }
		}
		case 'model':
			return { values: { focalLength, aperture, focalMultiplier }, origin: { label: telescope.model ?? 'Telescope model' } }
		case 'manual':
			return { values: { focalLength, aperture, focalMultiplier }, origin: { label: 'Entered by hand' } }
	}
}

// Returns the sensor of a framing with its origin.
function resolveCameraOf(camera: FramingCamera, context: FramingContext): { readonly sensor: SensorGeometry; readonly origin: CameraOrigin } {
	switch (camera.source) {
		case 'setup': {
			const role = camera.role ?? 'MAIN_CAMERA'
			const label = roleDefinition(role).label
			const roleSensor = context.sensors[role]
			if (!roleSensor) return { sensor: NO_SENSOR, origin: { label, missingCamera: role } }
			return { sensor: { kind: 'pixels', width: roleSensor.width, height: roleSensor.height, pixelSize: roleSensor.pixelSize }, origin: { label, roleSensor } }
		}
		case 'catalog': {
			const item = context.catalogCameras.find((e) => e.id === camera.cameraId)
			if (!item) return { sensor: camera.sensor, origin: { label: 'Deleted camera', deleted: true } }
			if (!item.sensor) return { sensor: camera.sensor, origin: { label: item.name } }
			const copied = camera.sensor.kind === 'pixels' ? camera.sensor.pixelSize : 0
			return { sensor: { kind: 'pixels', width: item.sensor.width, height: item.sensor.height, pixelSize: item.sensor.pixelSize ?? copied }, origin: { label: item.name } }
		}
		case 'model':
			return { sensor: camera.sensor, origin: { label: camera.model ?? 'Camera model' } }
		case 'manual':
			return { sensor: camera.sensor, origin: { label: 'Entered by hand' } }
	}
}

// Resolves a framing for the tab: its optical configuration, its field of view, and where its values come from.
export function resolveFramingOptics(id: string, framing: ResolvableFraming, context: FramingContext): ResolvedFraming {
	const telescope = resolveTelescopeOf(framing.optics.telescope, context)
	const camera = resolveCameraOf(framing.optics.camera, context)
	const optics: OpticalConfiguration = { ...telescope.values, sensor: camera.sensor, rotation: framing.rotation }
	return { id, name: framing.name, color: framing.color, optics, field: resolveFraming(optics), telescope: telescope.origin, camera: camera.origin }
}

// Resolves the pseudo-framings of the Main Camera and the Guide Camera of the Equipment Setup and every saved framing
// (drafts applied), in the order every select lists them.
export function resolveAllFramings(framings: readonly Pick<SavedFraming, 'id' | 'name' | 'optics' | 'rotation' | 'color'>[], context: FramingContext): ResolvedFraming[] {
	return [resolveFramingOptics(EQUIPMENT_FRAMING_ID, EQUIPMENT_FRAMING, context), resolveFramingOptics(GUIDE_FRAMING_ID, GUIDE_FRAMING, context), ...framings.map((framing) => resolveFramingOptics(framing.id, framing, context))]
}

// Returns what the framings of the tab resolve against, following the active profile's Equipment Setup, its cameras, and
// the Equipment Catalog.
export function useFramingContext(): FramingContext {
	const profile = activeProfile(useSnapshot(profileState))
	const telescopes = useProfileTelescopes(profile.settings)
	const sensors = useRoleSensors()
	const catalog = useSnapshot(catalogState)
	return { telescopes, sensors, catalogCameras: catalog.cameras, catalogTelescopes: catalog.telescopes }
}

// Returns the pseudo-framings of the Equipment Setup and every saved framing, resolved for the tab and followed.
export function useResolvedFramings(): ResolvedFraming[] {
	const context = useFramingContext()
	return resolveAllFramings(sortedFramings(useSnapshot(framingsState)), context)
}

// Returns the framing of an id resolved for the tab, the Main Camera's of the Equipment Setup for EQUIPMENT_FRAMING_ID,
// an absent id, or a framing that no longer exists.
export function useFraming(id: string | undefined): ResolvedFraming {
	const framings = useResolvedFramings()
	return framings.find((framing) => framing.id === id) ?? framings[0]
}
