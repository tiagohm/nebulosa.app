import type { ObservingTargetRef } from 'api'
import { formatDeclination, formatRightAscension } from '../../sky/format'

// Text of the Observing Planner's own values: scores and targets. Angles are radians. Lengths and time spans use
// formatHours and formatSpan of web/src/format.ts.

// Returns a score on 0..100 as a whole number.
export function formatScore(score: number) {
	return score.toFixed(0)
}

// Returns what a target is, for a subtitle: a catalog object, a body, a minor body with its SPK-ID, a meteor shower
// observation with its shower id, or its coordinates.
export function formatTargetKind(target: ObservingTargetRef) {
	if (target.kind === 'catalog') return 'Sky catalog object'
	if (target.kind === 'body') return 'Solar system body'
	if (target.kind === 'minorBody') return `Asteroid or comet · SPK-ID ${target.spkId}`
	if (target.kind === 'meteorShower') return `Meteor shower observation · ${target.id}`
	return `RA ${formatRightAscension(target.rightAscension)} · Dec ${formatDeclination(target.declination)} (J2000)`
}
