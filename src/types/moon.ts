import type { LunarEclipse, LunarPhase } from 'nebulosa/src/astronomy/bodies/moon'
import type { LocalLunarEclipseCircumstancesOptions, LocalLunarEclipseCircumstances, LocalLunarEclipseViewOptions } from 'nebulosa/src/astronomy/events/eclipse/lunar/local'
import type { LunarEclipseMapGeometry, LunarEclipseMapSvgPaths } from 'nebulosa/src/astronomy/events/eclipse/lunar/map'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { Time } from 'nebulosa/src/astronomy/time/time'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { Distance } from 'nebulosa/src/math/units/distance'
import type { LocationAndTime } from '#/atlas'

export type ApogeeAndPerigee = readonly [LunarApsis, LunarApsis]

export type LunarPhaseTime = readonly [LunarPhase, number]

export interface LunarApsis {
	readonly time: Time
	readonly distance: Distance
	readonly diameter: Angle
}

export interface FindLunarEclipse extends LocationAndTime {
	count: number
	next: boolean
}

export interface LunarEclipseMap extends Pick<LunarEclipseMapGeometry, 'events'> {
	readonly paths: LunarEclipseMapSvgPaths
}

export interface ComputeLunarEclipseLocalCircumstances {
	readonly eclipse: LunarEclipse
	readonly location: GeographicCoordinate
	readonly options?: LocalLunarEclipseCircumstancesOptions
}

export interface ComputeLunarEclipseLocalView {
	readonly eclipse: LunarEclipse
	readonly events: LocalLunarEclipseCircumstances['events']
	readonly options: LocalLunarEclipseViewOptions
}
