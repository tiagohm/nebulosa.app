import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { Distance } from 'nebulosa/src/math/units/distance'
import type { OsculatingElementsInput } from '#/asteroid'
import { DEFAULT_COORDINATE_INFO } from '#/mount'
import type { CoordinateInfo, CoordinateInfoFlags } from '#/mount'

// Which BodyPosition fields to materialize. Omitted flags mean "compute everything", matching
// today's complete-object callers. A flag only asks for an output; frames required as intermediates
// are still computed but unrequested fields stay at their zero defaults and must not be read.
export interface BodyPositionFlags extends CoordinateInfoFlags {
	// Catalog names; filled by the handler from SkyObject metadata, not by the ephemeris series.
	readonly names?: boolean
	// Apparent visual magnitude. Null when the model has no formula.
	readonly magnitude?: boolean
	// Observer-to-body distance, AU.
	readonly distance?: boolean
	// Illuminated fraction 0..1.
	readonly illuminated?: boolean
	// Solar elongation, radians.
	readonly elongation?: boolean
	// True when the body is east of the Sun (Horizons /L).
	readonly leading?: boolean
}

// Everything computed, the behaviour of a caller that passes no flags at all.
const DEFAULT_BODY_POSITION_FLAGS: Required<BodyPositionFlags> = {
	equatorial: true,
	equatorialJ2000: true,
	horizontal: true,
	ecliptic: true,
	galactic: true,
	constellation: true,
	lst: true,
	names: true,
	magnitude: true,
	distance: true,
	illuminated: true,
	elongation: true,
	leading: true,
}

// Turns omitted BodyPositionFlags into "compute everything". At least one `true` flag means only
// those outputs (plus internal dependencies) are contractual; unrequested fields stay at the
// DEFAULT_BODY_POSITION / DEFAULT_COORDINATE_INFO zeros.
//
// - flags: the request's BodyPositionFlags, possibly empty or mixed with unrelated PositionOfBody fields.
export function resolveBodyPositionFlags(flags: BodyPositionFlags): Required<BodyPositionFlags> {
	if (
		flags.equatorial === true ||
		flags.equatorialJ2000 === true ||
		flags.horizontal === true ||
		flags.ecliptic === true ||
		flags.galactic === true ||
		flags.constellation === true ||
		flags.lst === true ||
		flags.names === true ||
		flags.magnitude === true ||
		flags.distance === true ||
		flags.illuminated === true ||
		flags.elongation === true ||
		flags.leading === true
	) {
		return {
			equatorial: flags.equatorial === true,
			equatorialJ2000: flags.equatorialJ2000 === true,
			horizontal: flags.horizontal === true,
			ecliptic: flags.ecliptic === true,
			galactic: flags.galactic === true,
			constellation: flags.constellation === true,
			lst: flags.lst === true,
			names: flags.names === true,
			magnitude: flags.magnitude === true,
			distance: flags.distance === true,
			illuminated: flags.illuminated === true,
			elongation: flags.elongation === true,
			leading: flags.leading === true,
		}
	}

	return DEFAULT_BODY_POSITION_FLAGS
}

export interface LocationAndTime {
	readonly location: GeographicCoordinate
	readonly time: UTCTime
}

export interface PositionOfBody extends LocationAndTime, BodyPositionFlags {
	// Prefer a local model when one exists. Default false keeps the Horizons path for Sun, Moon, planets, and satellites.
	readonly fast?: boolean
	// Osculating elements for a minor body. Ignored for Sun, Moon, stars, sky points, and TLEs.
	readonly elements?: OsculatingElementsInput
}

export interface ChartOfBody extends PositionOfBody {}

export interface BodyPosition extends CoordinateInfo {
	readonly names?: readonly string[]
	readonly magnitude: number | null
	readonly distance: Distance
	readonly illuminated: number
	readonly elongation: Angle
	readonly leading: boolean
}

export const DEFAULT_GEOGRAPHIC_COORDINATE: GeographicCoordinate = {
	latitude: 0,
	longitude: 0,
	elevation: 0,
}

export const DEFAULT_TIME: UTCTime = {
	utc: 0,
	offset: 0,
}

export const DEFAULT_POSITION_OF_BODY: PositionOfBody = {
	location: DEFAULT_GEOGRAPHIC_COORDINATE,
	time: DEFAULT_TIME,
}

export const DEFAULT_BODY_POSITION: BodyPosition = {
	...DEFAULT_COORDINATE_INFO,
	names: [],
	magnitude: 0,
	distance: 0,
	illuminated: 0,
	elongation: 0,
	leading: false,
}
