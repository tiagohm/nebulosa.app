import type { GuidingCalibrationProgress } from 'api'
import { cn } from 'cn'
import { Notice } from '../equipment-control/parts'

// Progress of a running guiding calibration in the Session section of the Guiding panel: one bar per leg (the RA move,
// the RA return to the start, the DEC move past the backlash, and the DEC return to the start once solved) with its
// steps against their limit and its travel against what the leg needs, the DEC backlash measured so far, and the unusable frames that would fail it. Distances
// are guide-camera pixels, backlash milliseconds.

// Phases in the order a calibration runs through them; a leg is done once a later phase is reached.
const PHASE_ORDER: readonly GuidingCalibrationProgress['phase'][] = [
	'idle',
	'precheck',
	'acquireLock',
	'raForwardPulse',
	'raForwardMeasure',
	'raForwardComplete',
	'raClearPulse',
	'raClearMeasure',
	'decBacklashClearing',
	'decForwardPulse',
	'decForwardMeasure',
	'decForwardComplete',
	'solving',
	'validating',
	'decReturnPulse',
	'decReturnMeasure',
	'completed',
]

// State of a leg: not started, running, or finished.
type LegState = 'pending' | 'active' | 'done'

// Returns the state of the leg whose phases run from first to last, at a phase of the calibration.
function legState(phase: GuidingCalibrationProgress['phase'], first: GuidingCalibrationProgress['phase'], last: GuidingCalibrationProgress['phase']): LegState {
	const index = PHASE_ORDER.indexOf(phase)
	if (index > PHASE_ORDER.indexOf(last)) return 'done'
	return index >= PHASE_ORDER.indexOf(first) ? 'active' : 'pending'
}

// Returns a fraction clamped to [0, 1], 0 when it is not a number.
function clampFraction(value: number) {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

// Bars of the legs of a running calibration.
export function CalibrationProgress({ progress }: { readonly progress: GuidingCalibrationProgress }) {
	const { phase, raSteps, maxRaSteps, raDistance, raTarget, clearingSteps, maxClearingSteps, clearingDistance, clearingTarget, decSteps, maxDecSteps, decDistance, decTarget, decReturn, decReturnSteps, decMoving, backlash, badFrames, maxBadFrames } = progress
	const ra = legState(phase, 'raForwardPulse', 'raForwardComplete')
	const clearing = legState(phase, 'raClearPulse', 'raClearMeasure')
	const dec = legState(phase, 'decBacklashClearing', 'decForwardComplete')
	const decReturning = legState(phase, 'decReturnPulse', 'decReturnMeasure')
	// The return starts from where the RA leg ended and ends within clearingTarget of the start.
	const returned = clampFraction((raDistance - clearingDistance) / (raDistance - clearingTarget))
	// The DEC return starts about the DEC travel away from the start, and its nudges stop near it.
	const decReturned = clampFraction((decDistance - clearingDistance) / (decDistance - clearingTarget))

	return (
		<div className="flex flex-col gap-2">
			<Leg label="RA" state={ra} fraction={ra === 'done' ? 1 : clampFraction(raDistance / raTarget)} detail={`${raSteps}/${maxRaSteps} steps · ${raDistance.toFixed(1)} of ${raTarget} px`} />
			<Leg label="RA return" state={clearing} fraction={clearing === 'done' ? 1 : clearingSteps > 0 ? returned : 0} detail={`${clearingSteps}/${maxClearingSteps} steps · ${clearing === 'pending' ? '—' : `${clearingDistance.toFixed(1)} px from the start`}`} />
			<Leg label="DEC" state={dec} fraction={dec === 'done' ? 1 : clampFraction(decDistance / decTarget)} detail={`${decSteps}/${maxDecSteps} steps · ${dec !== 'pending' && !decMoving ? 'clearing the backlash' : `${decDistance.toFixed(1)} of ${decTarget} px`}`} />
			{decReturn && <Leg label="DEC return" state={decReturning} fraction={decReturning === 'done' ? 1 : decReturnSteps > 0 ? decReturned : 0} detail={`${decReturnSteps} steps · ${decReturning === 'pending' ? '—' : `${clearingDistance.toFixed(1)} px from the start`}`} />}
			{backlash > 0 && <p className="m-0 text-xs leading-4 text-ink-300">{`DEC backlash so far: ${Math.round(backlash)} ms`}</p>}
			{badFrames > 0 && <Notice error>{`${badFrames} of ${maxBadFrames} unusable frames in a row; one more than the limit fails the calibration.`}</Notice>}
		</div>
	)
}

interface LegProps {
	// Name of the leg.
	readonly label: string
	// Whether it has not started, runs, or finished.
	readonly state: LegState
	// Completion in [0, 1].
	readonly fraction: number
	// Steps and travel of the leg.
	readonly detail: string
}

// Bar and numbers of one leg.
function Leg({ label, state, fraction, detail }: LegProps) {
	return (
		<div className="flex flex-col gap-1">
			<p className="m-0 flex justify-between gap-3 text-xs leading-4 tabular-nums">
				<span className={cn('text-ink-300', state === 'active' && 'text-accent', state === 'done' && 'text-success')}>{label}</span>
				<span className="text-right text-ink-200">{detail}</span>
			</p>
			<div className="h-1 overflow-hidden rounded-full bg-base-300">
				<div className={cn('h-full transition-[width] duration-200', state === 'done' ? 'bg-success' : 'bg-accent')} style={{ width: `${fraction * 100}%` }} />
			</div>
		</div>
	)
}
