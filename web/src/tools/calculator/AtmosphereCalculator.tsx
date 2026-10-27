import { SegmentedControl } from '../../ui/SegmentedControl'
import { AIRMASS_EXAMPLE, type AirmassDraft, airmass, DEW_EXAMPLE, type DewDraft, type DewMode, dew } from './atmosphere'
import { CalculatorLayout, type CalculatorViewProps, Datum, DraftBar, FieldGrid, Formula, FormulaNotes, Note, NumberField, OutcomeView, Primary } from './CalculatorParts'
import { formatFixed } from './values'

// Views of the Atmosphere & Conditions calculators: Airmass & Visibility Effects and Dew Conditions.

// Dew Conditions modes in display order.
const DEW_MODES: readonly DewMode[] = ['dew', 'humidity', 'frost']

// Display name of each Dew Conditions mode.
const DEW_MODE_LABELS: Readonly<Record<DewMode, string>> = {
	dew: 'Dew point',
	humidity: 'Humidity',
	frost: 'Frost point',
}

// Airmass & Visibility Effects calculator.
export function AirmassCalculator({ entry, onChange, context }: CalculatorViewProps<AirmassDraft>) {
	const { draft } = entry
	const result = airmass(draft)

	// Changes one field of the draft.
	function set(next: Partial<AirmassDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={AIRMASS_EXAMPLE} />}
			inputs={
				<>
					<FieldGrid>
						<NumberField label="Altitude" suffix="°" value={draft.altitude} onChange={(altitude) => set({ altitude })} />
						<NumberField label="Extinction coefficient" suffix="mag/X" optional value={draft.extinction} onChange={(extinction) => set({ extinction })} />
					</FieldGrid>
					<Note>The true altitude above the horizon, without refraction. Typical visual extinction is 0.15–0.3 mag per airmass, more in hazy or low sites.</Note>
				</>
			}
			results={
				<OutcomeView outcome={result}>
					{(value) => (
						<>
							<Primary label="Airmass">{formatFixed(value.airmass, 3)}</Primary>
							{value.extinction !== undefined && <Datum label="Extinction">{formatFixed(value.extinction, 2)} mag</Datum>}
							<Datum label="Refraction">{formatFixed(value.refraction, 2)}′</Datum>
						</>
					)}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>
						X = 1 / (sin h + 0.50572 × (h + 6.07995)^−1.6364){'\n'}Δm = k × X{'\n'}R = 1.02 / tan(h + 10.3 / (h + 5.11)) arcmin
					</Formula>
					<p className="m-0">h is the true altitude in degrees (Kasten–Young airmass, Sæmundsson refraction) and k the extinction coefficient in magnitudes per airmass; the extinction is the total loss, including the one at the zenith.</p>
					<p className="m-0">The refraction is for standard pressure and temperature, an estimate that grows uncertain near the horizon; it is not a pointing model.</p>
				</FormulaNotes>
			}
		/>
	)
}

// Dew Conditions calculator.
export function DewCalculator({ entry, onChange, context }: CalculatorViewProps<DewDraft>) {
	const { draft } = entry
	const result = dew(draft)

	// Changes one field of the draft.
	function set(next: Partial<DewDraft>) {
		onChange({ ...entry, draft: { ...draft, ...next } })
	}

	return (
		<CalculatorLayout
			bar={<DraftBar entry={entry} onChange={onChange} context={context} example={DEW_EXAMPLE} />}
			inputs={
				<>
					<SegmentedControl label="Compute" options={DEW_MODES} value={draft.mode} onChange={(mode) => set({ mode })} format={(mode) => DEW_MODE_LABELS[mode]} />
					<FieldGrid>
						<NumberField label="Temperature" suffix="°C" value={draft.temperature} onChange={(temperature) => set({ temperature })} />
						{draft.mode === 'dew' && <NumberField label="Relative humidity" suffix="%" value={draft.humidity} onChange={(humidity) => set({ humidity })} />}
						{draft.mode === 'humidity' && <NumberField label="Dew point" suffix="°C" value={draft.dewPoint} onChange={(dewPoint) => set({ dewPoint })} />}
						{draft.mode === 'frost' && <NumberField label="Humidity over ice" suffix="%" value={draft.iceHumidity} onChange={(iceHumidity) => set({ iceHumidity })} />}
					</FieldGrid>
					{draft.mode === 'frost' ? (
						<Note>The humidity relative to ice, not the humidity a weather station reports, which is relative to water. Above freezing the dew point is the condensation temperature.</Note>
					) : (
						<Note>Ambient air temperature and the humidity relative to water, as weather stations report it.</Note>
					)}
				</>
			}
			results={
				<OutcomeView outcome={result}>
					{(value) =>
						value.mode === 'dew' ? (
							<>
								<Primary label="Dew point">{formatFixed(value.dewPoint, 1)} °C</Primary>
								<Datum label="Margin to the dew point">{formatFixed(value.margin, 1)} °C</Datum>
								<Datum label="Dew risk (heuristic)">{formatFixed(value.risk * 100, 0)} %</Datum>
							</>
						) : value.mode === 'humidity' ? (
							<Primary label="Relative humidity">{formatFixed(value.humidity, 1)} %</Primary>
						) : (
							<Primary label="Frost point">{formatFixed(value.frostPoint, 1)} °C</Primary>
						)
					}
				</OutcomeView>
			}
			notes={
				<FormulaNotes>
					<Formula>
						α = a × T / (b + T) + ln(RH / 100){'\n'}T_dew = b × α / (a − α){'\n'}risk = 1 − margin / 5 °C, clamped to 0…1
					</Formula>
					<p className="m-0">Magnus approximation over water (a = 17.625, b = 243.04 °C), and over ice for the frost point (a = 22.587, b = 273.86 °C); temperatures in degrees Celsius within −100 to 100 °C, fitted best for about −45 to 60 °C.</p>
					<p className="m-0">The dew risk only reads the ambient margin: full at a zero margin, none from 5 °C. Optics radiating to a clear sky cool below the air, so dew can form with a positive margin; it is not a measurement of the telescope.</p>
				</FormulaNotes>
			}
		/>
	)
}
