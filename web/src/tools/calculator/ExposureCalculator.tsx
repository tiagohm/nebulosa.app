import { SegmentedControl } from '../../ui/SegmentedControl'
import { CalculatorLayout, type CalculatorViewProps, Datum, DraftBar, FieldGrid, Formula, FormulaNotes, Note, NumberField, OptionalDatum, OutcomeView, Primary } from './CalculatorParts'
import { EXPOSURE_PLAN_EXAMPLE, type ExposurePlanDraft, exposurePlan, type PlanMode, STAR_TRAIL_EXAMPLE, type StarTrailDraft, starTrail, starTrailFromOptics } from './exposure'
import { formatDuration, formatFixed } from './values'

// Views of the Exposure & Integration calculators: Exposure Planner and Star Trailing.

// Exposure Planner modes in display order.
const PLAN_MODES: readonly PlanMode[] = ['count', 'time']

// Exposure Planner calculator.
export function ExposurePlannerCalculator({ entry, onChange, context }: CalculatorViewProps<ExposurePlanDraft>) {
	const { draft } = entry
	const result = exposurePlan(draft)

	// Changes one field of the draft.
	function set(next: Partial<ExposurePlanDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={EXPOSURE_PLAN_EXAMPLE} />}
			inputs={
				<>
					<SegmentedControl label="Compute from" options={PLAN_MODES} value={draft.mode} onChange={(mode) => set({ mode })} format={(mode) => (mode === 'count' ? 'Frame count' : 'Target integration')} />
					<FieldGrid>
						<NumberField label="Subexposure" suffix="s" value={draft.subExposure} onChange={(subExposure) => set({ subExposure })} />
						{draft.mode === 'count' ? <NumberField label="Frames" value={draft.frameCount} onChange={(frameCount) => set({ frameCount })} /> : <NumberField label="Target integration" suffix="h" value={draft.targetHours} onChange={(targetHours) => set({ targetHours })} />}
					</FieldGrid>
				</>
			}
			results={
				<OutcomeView outcome={result}>
					{({ frames, total, snrGain, magnitudeGain }) => (
						<>
							{draft.mode === 'count' ? <Primary label="Total integration">{formatDuration(total)}</Primary> : <Primary label="Frames needed">{frames}</Primary>}
							{draft.mode === 'time' && <Datum label="Total integration">{formatDuration(total)}</Datum>}
							<Datum label="Stacking SNR gain">×{formatFixed(snrGain, 2)}</Datum>
							<Datum label="Stacking depth gain">{formatFixed(magnitudeGain, 2)} mag</Datum>
						</>
					)}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>
						T = N × t{'\n'}N = ceil(T_target / t){'\n'}SNR gain = √N{'\n'}Δm = 1.25 × log₁₀ N
					</Formula>
					<p className="m-0">A target integration is covered by whole subframes, so the total may exceed it.</p>
					<p className="m-0">The gains are idealized: they compare the stack with one subframe and assume independent frames limited by random noise. Sky background, read noise, rejected frames, and calibration change what is actually reached.</p>
				</FormulaNotes>
			}
		/>
	)
}

// Star Trailing calculator.
export function StarTrailingCalculator({ entry, onChange, context }: CalculatorViewProps<StarTrailDraft>) {
	const { draft } = entry
	const result = starTrail(draft)

	// Changes one field of the draft.
	function set(next: Partial<StarTrailDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={STAR_TRAIL_EXAMPLE} fromOptics={starTrailFromOptics} />}
			inputs={
				<>
					<FieldGrid>
						<NumberField label="Declination" suffix="°" value={draft.declination} onChange={(declination) => set({ declination })} />
						<NumberField label="Image scale" suffix="″/px" value={draft.scale} onChange={(scale) => set({ scale })} />
						<NumberField label="Exposure" suffix="s" optional value={draft.exposure} onChange={(exposure) => set({ exposure })} />
						<NumberField label="Trail budget" suffix="px" optional value={draft.trailLimit} onChange={(trailLimit) => set({ trailLimit })} />
					</FieldGrid>
					<Note>For an untracked camera or a mount that is not tracking. The exposure gives the trail; the trail budget gives the longest exposure.</Note>
				</>
			}
			results={
				<OutcomeView outcome={result}>
					{({ trail, maxExposure }) => (
						<>
							{trail !== undefined && <Primary label="Star trail">{formatFixed(trail, 1)} px</Primary>}
							<OptionalDatum label="Longest exposure in budget" outcome={maxExposure}>
								{formatDuration}
							</OptionalDatum>
						</>
					)}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>trail = 15.041 × cos δ × t / scale{'\n'}t_max = budget × scale / (15.041 × cos δ)</Formula>
					<p className="m-0">15.041″/s is the sidereal rate, δ the declination, t the exposure in seconds, and the scale in arcseconds per pixel.</p>
					<p className="m-0">A simplified sidereal drift at the center of the frame: it ignores field rotation, the projection of wide fields, and the size of the star, and it is not the 500 or NPF rule. At a celestial pole the drift vanishes, so no limit is given.</p>
				</FormulaNotes>
			}
		/>
	)
}
