import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { Distance } from 'nebulosa/src/math/units/distance'
import { DEFAULT_COORDINATE_INFO } from '#/mount'
import type { CoordinateInfo } from '#/mount'

export interface LocationAndTime {
	readonly location: GeographicCoordinate
	readonly time: UTCTime
}

export interface PositionOfBody extends LocationAndTime {
	// Prefer a local model when one exists. Default false keeps the Horizons path for Sun, Moon, planets, and satellites.
	readonly fast?: boolean
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
