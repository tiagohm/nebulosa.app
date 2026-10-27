import type { CameraSensor } from 'api'
import { CAMERA_ROLES, type CameraRole, isCameraRole, roleDefinition } from '../../equipment/roles'
import { equipmentOptics, type OpticalConfiguration, type OpticalPreset, type SensorGeometry, type TelescopeOptics } from '../../sky/framing'
import type { SensorTarget } from '../../sky/sensors'

// Sources a calculator can import an optical configuration from, read only from what the tab already has: the active
// profile's Equipment Setup (its telescope or guide telescope with the sensor the camera of a camera role reports, or
// with the manual sensor of Sky Framing) and the profile's optical presets. An import copies the configuration once
// into a calculator draft, which is then edited on its own: the profile, the presets, and the devices are never
// written, and a later change of the source never rewrites the draft. The origin of an import stays shown only while
// it still describes the same profile and camera.

// Source of an optical configuration: the Equipment Setup through a camera role, through the manual sensor, or a
// preset by id.
export type OpticsSourceId = CameraRole | 'manual' | `preset:${string}`

// Profile data the sources are read from.
export interface SourceSettings {
	// Telescope optics of the Equipment Setup, which the Main Camera and the manual sensor look through; absent until
	// entered.
	readonly telescope?: Readonly<TelescopeOptics>
	// Guide telescope optics, which the Guide Camera looks through; absent until entered.
	readonly guideTelescope?: Readonly<TelescopeOptics>
	// Optical presets of Sky Framing, in display order.
	readonly presets: readonly Readonly<OpticalPreset>[]
	// Manual sensor of the Sky Framing Equipment Setup source; absent until entered.
	readonly manualSensor?: Readonly<SensorGeometry>
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
	// Camera whose sensor was imported; absent for a preset or the manual sensor.
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

// Prefix of the source id of a preset.
const PRESET_PREFIX = 'preset:'

// Returns the sources in menu order: the camera roles, the manual sensor, then every preset.
export function opticsSources(settings: Pick<SourceSettings, 'presets'>): OpticsSourceId[] {
	return [...CAMERA_ROLES, 'manual', ...settings.presets.map((e): OpticsSourceId => `${PRESET_PREFIX}${e.id}`)]
}

// Returns the preset a source names; undefined for another source or a preset that no longer exists.
function presetOf(settings: Pick<SourceSettings, 'presets'>, source: OpticsSourceId) {
	return source.startsWith(PRESET_PREFIX) ? settings.presets.find((e) => `${PRESET_PREFIX}${e.id}` === source) : undefined
}

// Returns the display name of a source.
export function sourceLabel(settings: Pick<SourceSettings, 'presets'>, source: OpticsSourceId) {
	if (isCameraRole(source)) return roleDefinition(source).label
	if (source === 'manual') return 'Manual sensor'
	return presetOf(settings, source)?.name ?? 'Deleted preset'
}

// Returns the menu group of a source.
export function sourceGroup(source: OpticsSourceId) {
	return source.startsWith(PRESET_PREFIX) ? 'Optical presets' : 'Equipment Setup'
}

// Copies the optical configuration of a source. A camera role takes the optics it looks through and the sensor its
// device reports, never another camera's or the manual sensor; the manual sensor takes the telescope; a preset is
// copied as saved. Optics the profile has not entered are zero, so the draft shows them as missing.
export function importOptics(context: SourceContext, source: OpticsSourceId): OpticsImport {
	const { settings, profileId } = context
	const label = sourceLabel(settings, source)

	if (isCameraRole(source)) {
		const { optics, missingCamera } = equipmentOptics(settings, source, context.live, undefined, 0)
		if (missingCamera) return { reason: `The ${label} has not reported its sensor: assign and connect it in the Equipment Setup.` }
		const camera = context.cameras[source]
		return { optics, origin: { source, label, profileId, camera: camera && { connectionId: camera.connectionId, id: camera.id } } }
	}

	if (source === 'manual') {
		// equipmentOptics substitutes an example sensor for a manual sensor never entered; refuse instead.
		if (!settings.manualSensor) return { reason: 'No manual sensor is entered in Sky → Framing.' }
		const { optics } = equipmentOptics(settings, 'manual', context.live, { ...settings.manualSensor }, 0)
		return { optics, origin: { source, label, profileId } }
	}

	const preset = presetOf(settings, source)
	if (!preset) return { reason: 'The preset no longer exists.' }
	return { optics: { ...preset.optics, sensor: { ...preset.optics.sensor } }, origin: { source, label, profileId } }
}

// Whether an import origin still describes the active profile and, for a camera, the camera its role follows now.
export function isOriginCurrent(origin: ImportOrigin, context: Pick<SourceContext, 'profileId' | 'cameras'>) {
	if (origin.profileId !== context.profileId) return false
	if (!isCameraRole(origin.source)) return true
	const camera = context.cameras[origin.source]
	return camera?.connectionId === origin.camera?.connectionId && camera?.id === origin.camera?.id
}
