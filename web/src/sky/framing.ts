import type { CameraSensor } from 'api'
import type { CameraRole } from '../equipment/roles'
import { DEFAULT_OPTICS, DEFAULT_TELESCOPE, type EquipmentTelescopes, type OpticalConfiguration, type SensorGeometry } from '../framing/geometry'

// Optical presets of the Sky Framing panel, kept in the profile, and the Equipment Setup field of view: the sensor a
// camera of the setup reports, or a sensor entered manually to simulate another camera, with the profile's optics that
// camera looks through (the guide telescope for the Guide Camera, the telescope otherwise). The geometry of a field of
// view is web/src/framing/geometry.ts. Presets are planning data: they never change the equipment setup or any device.

// Named optical configuration kept in the profile.
export interface OpticalPreset {
	// Unique id within the profile.
	readonly id: string
	// Display name, trimmed and non-empty.
	readonly name: string
	// Optical configuration.
	readonly optics: OpticalConfiguration
}

// Where the drawn field of view comes from: a custom optical preset, or the Equipment Setup.
export type FramingSource = 'custom' | 'equipment'

// Returns where the field of view comes from in a profile's framing settings: the Equipment Setup, the source of truth
// about the devices in use, unless a custom preset was chosen.
export function framingSource(framing?: { readonly source?: FramingSource }): FramingSource {
	return framing?.source ?? 'equipment'
}

// Where the Equipment Setup field of view takes its sensor from: a camera role of the setup, whose
// device reports it, or a sensor entered manually.
export type SensorSource = CameraRole | 'manual'

// Returns whether a sensor source looks through the guide telescope: only the Guide Camera does; the Main Camera and
// a manual sensor look through the telescope.
export function usesGuideTelescope(sensorSource: SensorSource): boolean {
	return sensorSource === 'GUIDE_CAMERA'
}

// Optical configuration of the Equipment Setup source, with what the sensor source lacks.
export interface EquipmentOptics {
	// Configuration to resolve; a sensor that is unknown has zero dimensions, so resolveFraming lists it.
	readonly optics: OpticalConfiguration
	// Name of the camera role whose device reports no sensor; absent when the sensor is known or manual.
	readonly missingCamera?: CameraRole
}

// Builds the Equipment Setup configuration: the optics sensorSource looks through (usesGuideTelescope; defaults when
// absent), the sensor of
// sensorSource, either the live sensor its camera reports (pixels, micrometers) or the manual sensor,
// and the rotation in degrees. A camera without a reported sensor yields an empty sensor and names the
// role in missingCamera; the manual sensor is never used in its place.
export function equipmentOptics({ telescope, guideTelescope }: EquipmentTelescopes, sensorSource: SensorSource, liveSensors: Readonly<Partial<Record<CameraRole, CameraSensor>>>, manualSensor: SensorGeometry | undefined, rotation: number): EquipmentOptics {
	const { focalLength, focalMultiplier, aperture } = (usesGuideTelescope(sensorSource) ? guideTelescope : telescope) ?? DEFAULT_TELESCOPE
	const base = { focalLength, focalMultiplier, aperture, rotation }

	if (sensorSource === 'manual') return { optics: { ...base, sensor: manualSensor ?? DEFAULT_OPTICS.sensor } }

	const live = liveSensors[sensorSource]
	if (!live) return { optics: { ...base, sensor: { kind: 'pixels', width: 0, height: 0, pixelSize: 0 } }, missingCamera: sensorSource }
	return { optics: { ...base, sensor: { kind: 'pixels', width: live.width, height: live.height, pixelSize: live.pixelSize } } }
}

// Framing preferences the drawn field of view depends on: a profile's Sky framing settings.
export interface FrameSettings {
	// Presets in display order.
	readonly presets: readonly OpticalPreset[]
	// Id of the preset drawn; absent when there is none.
	readonly activePresetId?: string
	// Where the field comes from; absent means the Equipment Setup.
	readonly source?: FramingSource
	// Sensor of the Equipment Setup source; absent means the Main Camera.
	readonly sensorSource?: SensorSource
	// Sensor entered for the Equipment Setup source when sensorSource is manual.
	readonly manualSensor?: SensorGeometry
	// Position angle of the Equipment Setup field's top edge in degrees, from north towards east; absent means 0.
	readonly equipmentRotation?: number
}

// Field of view a profile plans with, named: the Equipment Setup's (equipmentOptics) unless a custom preset was chosen,
// then the active preset's, with the camera role whose device reports no sensor (missingCamera of equipmentOptics).
// Undefined when the custom source has no preset. The Sky draws it, and the Observing Planner judges how targets fit it.
export function activeFrameSource(framing: FrameSettings | undefined, telescopes: EquipmentTelescopes, liveSensors: Readonly<Partial<Record<CameraRole, CameraSensor>>>): (OpticalPreset & Pick<EquipmentOptics, 'missingCamera'>) | undefined {
	if (framingSource(framing) === 'custom') return framing?.presets.find((e) => e.id === framing.activePresetId)
	const { optics, missingCamera } = equipmentOptics(telescopes, framing?.sensorSource ?? 'MAIN_CAMERA', liveSensors, framing?.manualSensor, framing?.equipmentRotation ?? 0)
	return { id: 'equipment', name: 'Equipment Setup', optics, missingCamera }
}
