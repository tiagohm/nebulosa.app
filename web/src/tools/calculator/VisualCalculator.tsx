import { CalculatorLayout, type CalculatorViewProps, Datum, DraftBar, FieldGrid, Formula, FormulaNotes, Note, NumberField, OutcomeView, Primary } from './CalculatorParts'
import { formatFixed } from './values'
import { APERTURE_COMPARISON_EXAMPLE, type ApertureComparisonDraft, type ApertureSide, apertureComparison, EYEPIECE_EXAMPLE, type EyepieceDraft, eyepiece, eyepieceFromOptics, type LightGrasp } from './visual'

// Views of the Visual Observation calculators: Eyepiece & Telescope and Aperture Comparison.

// Sides of Aperture Comparison in display order.
const APERTURE_SIDES: readonly ApertureSide[] = ['A', 'B']

// Formats a light grasp ratio with the side that collects more.
function formatLightGrasp({ ratio, larger }: LightGrasp) {
	return larger ? `${larger} ×${formatFixed(ratio, 2)}` : 'Equal'
}

// Eyepiece & Telescope calculator.
export function EyepieceCalculator({ entry, onChange, context }: CalculatorViewProps<EyepieceDraft>) {
	const { draft } = entry
	const result = eyepiece(draft)

	// Changes one field of the draft.
	function set(next: Partial<EyepieceDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={EYEPIECE_EXAMPLE} fromOptics={eyepieceFromOptics} />}
			inputs={
				<>
					<FieldGrid>
						<NumberField label="Telescope focal length" suffix="mm" value={draft.focalLength} onChange={(focalLength) => set({ focalLength })} />
						<NumberField label="Aperture" suffix="mm" value={draft.aperture} onChange={(aperture) => set({ aperture })} />
						<NumberField label="Eyepiece focal length" suffix="mm" value={draft.eyepiece} onChange={(value) => set({ eyepiece: value })} />
						<NumberField label="Apparent field" suffix="°" optional value={draft.apparentField} onChange={(apparentField) => set({ apparentField })} />
						<NumberField label="Field stop" suffix="mm" optional value={draft.fieldStop} onChange={(fieldStop) => set({ fieldStop })} />
					</FieldGrid>
					<Note>The telescope focal length includes any Barlow or reducer; importing applies its factor.</Note>
				</>
			}
			results={
				<OutcomeView outcome={result}>
					{(view) => (
						<>
							<Primary label="Magnification">×{formatFixed(view.magnification, 0)}</Primary>
							<Datum label="Exit pupil">{formatFixed(view.exitPupil, 2)} mm</Datum>
							{view.trueField !== undefined && <Datum label="True field (apparent field)">{formatFixed(view.trueField, 2)}°</Datum>}
							{view.fieldStopTrueField !== undefined && <Datum label="True field (field stop)">{formatFixed(view.fieldStopTrueField, 2)}°</Datum>}
							<Datum label="Dawes limit">{formatFixed(view.dawes, 2)}″</Datum>
							<Datum label="Rayleigh limit">{formatFixed(view.rayleigh, 2)}″</Datum>
							<Datum label="Limiting magnitude">{formatFixed(view.limitingMagnitude, 1)}</Datum>
						</>
					)}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>
						M = F / f{'\n'}exit pupil = D / M{'\n'}true field = apparent field / M ≈ 57.3 × field stop / F{'\n'}Dawes = 116 / D, Rayleigh = 138 / D{'\n'}m_lim = 2.7 + 5 × log₁₀ D
					</Formula>
					<p className="m-0">F and f are the telescope and eyepiece focal lengths and D the aperture, all in millimeters; limits are in arcseconds.</p>
					<p className="m-0">The true field from the apparent field is an estimate, since eyepieces are often specified loosely; the field stop gives a better one. The resolving limits and limiting magnitude are empirical first-order estimates for good conditions and a dark-adapted eye, not guarantees.</p>
				</FormulaNotes>
			}
		/>
	)
}

// Aperture Comparison calculator.
export function ApertureComparisonCalculator({ entry, onChange, context }: CalculatorViewProps<ApertureComparisonDraft>) {
	const { draft } = entry
	const result = apertureComparison(draft)

	// Changes one field of the draft.
	function set(next: Partial<ApertureComparisonDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={APERTURE_COMPARISON_EXAMPLE} />}
			inputs={
				<FieldGrid>
					<NumberField label="Aperture A" suffix="mm" value={draft.apertureA} onChange={(apertureA) => set({ apertureA })} />
					<NumberField label="Obstruction A" suffix="mm" optional value={draft.obstructionA} onChange={(obstructionA) => set({ obstructionA })} />
					<NumberField label="Aperture B" suffix="mm" value={draft.apertureB} onChange={(apertureB) => set({ apertureB })} />
					<NumberField label="Obstruction B" suffix="mm" optional value={draft.obstructionB} onChange={(obstructionB) => set({ obstructionB })} />
				</FieldGrid>
			}
			results={
				<OutcomeView outcome={result}>
					{({ clear, collecting, sides }) => (
						<>
							<Primary label="Light grasp of the apertures">{formatLightGrasp(clear)}</Primary>
							{collecting && <Datum label="With obstructions">{formatLightGrasp(collecting)}</Datum>}
							{APERTURE_SIDES.map((side) => {
								const { obstruction, effectiveAperture } = sides[side]

								return (
									obstruction !== undefined && (
										<Datum key={side} label={`${side}: obstruction, equivalent clear aperture`}>
											{formatFixed(obstruction, 0)} %, {formatFixed(effectiveAperture, 1)} mm
										</Datum>
									)
								)
							})}
						</>
					)}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>
						light grasp = (D_larger / D_smaller)²{'\n'}obstruction = 100 × d / D{'\n'}D_eff = √(D² − d²)
					</Formula>
					<p className="m-0">D is an aperture and d its central obstruction, in millimeters.</p>
					<p className="m-0">The equivalent clear aperture only has the same collecting area: an obstructed aperture keeps the resolution of its full diameter but loses contrast, which this comparison does not model. Spider vanes, coatings, and transmission are ignored.</p>
				</FormulaNotes>
			}
		/>
	)
}
