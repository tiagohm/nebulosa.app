import { arcsec } from 'nebulosa/src/math/units/angle'
import { useSnapshot } from 'valtio'
import { roleDefinition } from '../../equipment/roles'
import { formatAngularSize, MISSING } from '../../format'
import { FramingSelect } from '../../framing/FramingSelect'
import { type Framing, isFraming } from '../../framing/geometry'
import { useFraming } from '../../framing/resolve'
import { formatPixelScale } from '../../platesolving/coordinates'
import { activeProfile, profileState, setPlannerFraming } from '../../profile/profile'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { assessFraming, FRAMING_LABELS, type FramingAssessment, framingDetail } from './framingfit'

// Framing of the Observing Planner's targets: the framing of the Framing tool the active profile plans with (the
// Equipment Setup's until another is chosen; view state), the line that chooses it and names its field or says what it
// lacks, and the label of how a target fits it.

// Parameters of resolveFraming a camera's sensor gives, replaced by the camera's name when it has none.
const SENSOR_FIELDS: ReadonlySet<string> = new Set(['Width in pixels', 'Height in pixels', 'Pixel size'])

// Field of view the targets are judged against: its name, and its angular size and scale, or what it lacks.
export interface PlannerFrame {
	// Id of the framing.
	readonly id: string
	// Name of the framing.
	readonly name: string
	// Field of view, once every parameter is known.
	readonly frame?: Framing
	// Parameters missing to compute it, by display name.
	readonly missing?: readonly string[]
	// Whether a camera role of the Equipment Setup has no sensor, which connecting it or declaring it gives.
	readonly cameraMissing?: boolean
	// Camera of the Equipment Catalog whose declared sensor values the field uses; absent when the camera reports them all.
	readonly catalogCamera?: string
}

// Returns the field of view of the framing the active profile plans with, following the framings, the profile, the
// cameras, the bindings, and the Equipment Catalog.
export function usePlannerFrame(): PlannerFrame {
	const { settings } = activeProfile(useSnapshot(profileState))
	const { id, name, field, camera } = useFraming(settings.plannerFramingId)
	const catalogCamera = camera.roleSensor?.catalogCamera
	if (isFraming(field)) return { id, name, frame: field, catalogCamera }
	// A camera without a sensor is named once, in place of the sensor fields it leaves empty.
	const missing = camera.missingCamera ? [...field.missing.filter((e) => !SENSOR_FIELDS.has(e)), `${roleDefinition(camera.missingCamera).label} sensor`] : field.missing
	return { id, name, missing, cameraMissing: !!camera.missingCamera, catalogCamera }
}

// Choice of the framing the fits are judged against, and the line naming its field and where its sensor comes from, or
// why they are not judged.
export function FrameLine({ frame }: { readonly frame: PlannerFrame }) {
	const declared = frame.catalogCamera ? ` with the sensor the Equipment Catalog declares for ${frame.catalogCamera}` : ''
	let line: string

	if (frame.frame) {
		const { width, height, scale } = frame.frame
		const at = scale === undefined ? '' : ` at ${formatPixelScale(arcsec(scale))}`
		line = `Framing judged against the ${frame.name} field${declared}: ${formatAngularSize(width)} × ${formatAngularSize(height)}${at}.`
	} else {
		const lacking = (frame.missing ?? []).join(', ').toLowerCase()
		const remedy = frame.cameraMissing ? 'Connect the camera, or declare the sensor of the camera it is bound to in the Equipment Catalog.' : 'Complete it in the Framing tool.'
		line = `Framing not judged: the ${frame.name} field${declared} lacks the ${lacking}. ${remedy}`
	}

	return (
		<div className="flex flex-col gap-2">
			<FramingSelect label="Judged Framing" value={frame.id} onChange={(id) => setPlannerFraming(profileState, id)} />
			<Notice>{line}</Notice>
		</div>
	)
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
