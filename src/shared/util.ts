import type { ExposureTimeUnit } from './types'

// Unsubscribes all provided unsubscribers
export function unsubscribe(unsubscribers?: readonly (VoidFunction | undefined)[]) {
	unsubscribers?.forEach((e) => e?.())
}

// Returns a factor to convert exposure time to minutes
export function exposureTimeUnitFactor(unit: ExposureTimeUnit) {
	switch (unit) {
		case 'MINUTE':
			return 1
		case 'SECOND':
			return 60
		case 'MILLISECOND':
			return 60000
		case 'MICROSECOND':
			return 60000000
	}
}

// Converts exposure time in given unit to minutes
export function exposureTimeInMinutes(time: number, unit: ExposureTimeUnit) {
	return unit === 'MINUTE' ? time : time / exposureTimeUnitFactor(unit)
}

// Converts exposure time in given unit to seconds
export function exposureTimeInSeconds(time: number, unit: ExposureTimeUnit) {
	return unit === 'SECOND' ? time : time * (60 / exposureTimeUnitFactor(unit))
}

// Converts exposure time in given unit to milliseconds
export function exposureTimeInMilliseconds(time: number, unit: ExposureTimeUnit) {
	return unit === 'MILLISECOND' ? time : time * (60000 / exposureTimeUnitFactor(unit))
}

// Converts exposure time in given unit to microseconds
export function exposureTimeInMicroseconds(time: number, unit: ExposureTimeUnit) {
	return unit === 'MICROSECOND' ? time : time * (60000000 / exposureTimeUnitFactor(unit))
}

// Converts exposure time from one unit to another
export function exposureTimeIn(time: number, from: ExposureTimeUnit, to: ExposureTimeUnit) {
	return from === to ? time : time * (exposureTimeUnitFactor(to) / exposureTimeUnitFactor(from))
}
