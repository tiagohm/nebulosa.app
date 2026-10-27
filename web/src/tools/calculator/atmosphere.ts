import { airmassKastenYoung, atmosphericExtinction, atmosphericRefraction, dewMargin, dewPoint, dewRisk, frostPoint, MAGNUS_MAX_CELSIUS, MAGNUS_MIN_CELSIUS, relativeHumidity } from 'nebulosa/src/astronomy/formulas'
import { deg } from 'nebulosa/src/math/units/angle'
import { between, newCheck, NON_NEGATIVE, optional, type Outcome, outcome, ready, required } from './values'

// Atmosphere & Conditions calculators. Airmass & Visibility Effects gives the Kasten–Young airmass of an altitude, the
// extinction it causes for an extinction coefficient, and the refraction that lifts it. Dew Conditions gives, with the
// Magnus approximation, the dew point and a heuristic dew risk of a reading, the relative humidity a dew point implies,
// or the frost point of a humidity relative to ice. Altitudes are degrees in the fields and radians for the formulas,
// temperatures degrees Celsius, humidities percent.

// Fields of Airmass & Visibility Effects, as typed.
export interface AirmassDraft {
	// True altitude in degrees, (0, 90].
	readonly altitude: string
	// Extinction coefficient in magnitudes per airmass; optional.
	readonly extinction: string
}

// Results of Airmass & Visibility Effects.
export interface AirmassResult {
	// Airmass, at least 1.
	readonly airmass: number
	// Refraction in arcminutes added to the true altitude.
	readonly refraction: number
	// Extinction in magnitudes; absent without a coefficient.
	readonly extinction: number | undefined
}

// Direction of the Dew Conditions calculation: the dew point of a reading, the humidity a dew point implies, or the
// frost point of a humidity relative to ice.
export type DewMode = 'dew' | 'humidity' | 'frost'

// Fields of Dew Conditions, as typed.
export interface DewDraft {
	// Direction of the calculation.
	readonly mode: DewMode
	// Ambient temperature in degrees Celsius.
	readonly temperature: string
	// Relative humidity with respect to water in percent, (0, 100]; read for the dew point.
	readonly humidity: string
	// Dew point in degrees Celsius; read for the humidity.
	readonly dewPoint: string
	// Relative humidity with respect to ice in percent, (0, 100]; read for the frost point.
	readonly iceHumidity: string
}

// Results of Dew Conditions, by mode.
export type DewResult =
	// Dew point of a reading.
	| {
			readonly mode: 'dew'
			// Dew point in degrees Celsius.
			readonly dewPoint: number
			// Ambient temperature minus dew point in degrees Celsius.
			readonly margin: number
			// Heuristic dew risk, 0 to 1.
			readonly risk: number
	  }
	// Humidity implied by a dew point.
	| {
			readonly mode: 'humidity'
			// Relative humidity with respect to water in percent.
			readonly humidity: number
	  }
	// Frost point of a humidity relative to ice.
	| {
			readonly mode: 'frost'
			// Frost point in degrees Celsius.
			readonly frostPoint: number
	  }

// Temperatures the Magnus approximation accepts, in degrees Celsius.
const MAGNUS_DOMAIN = between(MAGNUS_MIN_CELSIUS, MAGNUS_MAX_CELSIUS)

// Relative humidities the Magnus approximation accepts, in percent.
const HUMIDITY_DOMAIN = between(0, 100, true)

// Example of Airmass & Visibility Effects: 30° of altitude with a typical visual extinction of 0.2 mag per airmass.
export const AIRMASS_EXAMPLE: AirmassDraft = { altitude: '30', extinction: '0.2' }

// Computes Airmass & Visibility Effects.
export function airmass(draft: AirmassDraft): Outcome<AirmassResult> {
	const check = newCheck()
	const altitude = required(check, 'Altitude', draft.altitude, between(0, 90, true))
	const extinction = optional(check, 'Extinction coefficient', draft.extinction, NON_NEGATIVE)

	return outcome(check, () => {
		const h = deg(altitude)
		const x = airmassKastenYoung(h)
		return ready({ airmass: x, refraction: atmosphericRefraction(h), extinction: extinction === undefined ? undefined : atmosphericExtinction(extinction, x) })
	})
}

// Example of Dew Conditions: 10 °C at 85 % humidity.
export const DEW_EXAMPLE: DewDraft = { mode: 'dew', temperature: '10', humidity: '85', dewPoint: '5', iceHumidity: '90' }

// Computes Dew Conditions in its mode. A dew point above the temperature is supersaturated air, not a reading.
export function dew(draft: DewDraft): Outcome<DewResult> {
	const check = newCheck()
	const temperature = required(check, 'Temperature', draft.temperature, MAGNUS_DOMAIN)

	if (draft.mode === 'dew') {
		const humidity = required(check, 'Relative humidity', draft.humidity, HUMIDITY_DOMAIN)
		return outcome(check, () => ready({ mode: 'dew', dewPoint: dewPoint(temperature, humidity), margin: dewMargin(temperature, humidity), risk: dewRisk(temperature, humidity) }))
	}

	if (draft.mode === 'humidity') {
		const point = required(check, 'Dew point', draft.dewPoint, MAGNUS_DOMAIN)
		if (point > temperature) check.invalid.push('Dew point must not be above the temperature.')
		return outcome(check, () => ready({ mode: 'humidity', humidity: Math.min(100, relativeHumidity(temperature, point)) }))
	}

	const iceHumidity = required(check, 'Relative humidity over ice', draft.iceHumidity, HUMIDITY_DOMAIN)
	return outcome(check, () => ready({ mode: 'frost', frostPoint: frostPoint(temperature, iceHumidity) }))
}
