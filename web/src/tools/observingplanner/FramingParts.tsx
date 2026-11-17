import { useSnapshot } from 'valtio'
import { roleDefinition } from '../../equipment/roles'
import { useProfileTelescopes } from '../../equipment/telescopes'
import { formatAngularSize, MISSING } from '../../format'
import { activeProfile, profileState } from '../../profile/profile'
import { activeFrameSource, type Framing, framingSource, isFraming, resolveFraming } from '../../sky/framing'
import { useRoleSensors } from '../../sky/useSkyDevices'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { assessFraming, FRAMING_LABELS, type FramingAssessment, framingDetail } from './framingfit'

// Framing of the Observing Planner's targets: the field of view the active profile plans with, as the Sky draws it (the
// Equipment Setup's, with the sensor its camera reports completed by what the Equipment Catalog declares for it, or the
// active Framing preset), the line that names it or says what it lacks, and the label of how a target fits it.

// Parameters of resolveFraming a camera's sensor gives, replaced by the camera's name when it has none.
const SENSOR_FIELDS: ReadonlySet<string> = new Set(['Width in pixels', 'Height in pixels', 'Pixel size'])

// Field of view the targets are judged against: its name, and its angular size and scale, or what it lacks.
export interface PlannerFrame {
	// Name of the source: Equipment Setup or a preset's; absent when the custom source has no preset.
	readonly name?: string
	// Field of view, once every parameter is known.
	readonly frame?: Framing
	// Parameters missing to compute it, by display name.
	readonly missing?: readonly string[]
	// Whether a camera of the Equipment Setup has no sensor, which connecting it, declaring it, or a manual sensor gives.
	readonly cameraMissing?: boolean
	// Camera of the Equipment Catalog whose declared sensor values the field uses; absent when the camera reports them all.
	readonly catalogCamera?: string
}

// Returns the field of view the active profile plans with, as the Sky draws it, following the profile, the cameras, the
// bindings, and the Equipment Catalog.
export function usePlannerFrame(): PlannerFrame {
	const { settings } = activeProfile(useSnapshot(profileState))
	const sensors = useRoleSensors()
	const framing = settings.sky.framing
	const source = activeFrameSource(framing, useProfileTelescopes(settings), sensors)
	if (!source) return {}
	const role = framingSource(framing) === 'equipment' ? (framing?.sensorSource ?? 'MAIN_CAMERA') : 'manual'
	const catalogCamera = role === 'manual' ? undefined : sensors[role]?.catalogCamera
	const resolved = resolveFraming(source.optics)
	if (isFraming(resolved)) return { name: source.name, frame: resolved, catalogCamera }
	// A camera without a sensor is named once, in place of the sensor fields it leaves empty.
	const missing = source.missingCamera ? [...resolved.missing.filter((e) => !SENSOR_FIELDS.has(e)), `${roleDefinition(source.missingCamera).label} sensor`] : resolved.missing
	return { name: source.name, missing, cameraMissing: !!source.missingCamera, catalogCamera }
}

// Line naming the field of view the fits are judged against, and where its sensor comes from, or why they are not judged.
export function FrameLine({ frame }: { readonly frame: PlannerFrame }) {
	const declared = frame.catalogCamera ? ` with the sensor the Equipment Catalog declares for ${frame.catalogCamera}` : ''

	if (frame.frame) {
		const { width, height, scale } = frame.frame
		const at = scale === undefined ? '' : ` at ${scale.toFixed(2)}″/px`
		return <Notice>{`Framing judged against the ${frame.name} field${declared}: ${formatAngularSize(width)} × ${formatAngularSize(height)}${at}. Change it in the Framing panel of the Sky.`}</Notice>
	}

	const lacking = (frame.missing ?? []).join(', ').toLowerCase()
	const remedy = frame.cameraMissing ? 'Connect the camera, declare the sensor of the camera it is bound to in the Equipment Catalog, or enter a manual sensor in the Framing panel of the Sky.' : 'Enter it in the Framing panel of the Sky.'
	return <Notice>{frame.name ? `Framing not judged: the ${frame.name} field${declared} lacks the ${lacking}. ${remedy}` : 'Framing not judged: choose a preset in the Framing panel of the Sky.'}</Notice>
}

// Fit of a target as a badge or plain words, with the share of the field and the pixels in its tooltip; a dash when its
// size or the field is unknown.
export function FitLabel({ assessment, frame, badge = true }: { readonly assessment?: FramingAssessment; readonly frame?: Framing; readonly badge?: boolean }) {
	if (!assessment) return <span title={frame ? 'Size unknown' : 'Field of view unknown'}>{badge ? MISSING : `Framing ${MISSING}`}</span>
	const { label, tone } = FRAMING_LABELS[assessment.fit]
	return badge ? <StatusBadge tone={tone} label={label} title={framingDetail(assessment)} /> : <span title={framingDetail(assessment)}>{label}</span>
}

// Assesses how a target of known apparent axes (radians) fits a field of view; undefined without a field or a size.
export function fitOf(target: { readonly majorAxis?: number; readonly minorAxis?: number }, frame: Framing | undefined) {
	return frame && assessFraming(target.majorAxis, target.minorAxis, frame)
}
