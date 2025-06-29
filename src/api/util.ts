import type { ExposureTimeUnit } from './types'

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

export function exposureTimeInMinutes(time: number, unit: ExposureTimeUnit) {
	return unit === 'MINUTE' ? time : time / exposureTimeUnitFactor(unit)
}

export function exposureTimeInSeconds(time: number, unit: ExposureTimeUnit) {
	return unit === 'SECOND' ? time : time * (60 / exposureTimeUnitFactor(unit))
}

export function exposureTimeInMilliseconds(time: number, unit: ExposureTimeUnit) {
	return unit === 'MILLISECOND' ? time : time * (60000 / exposureTimeUnitFactor(unit))
}

export function exposureTimeInMicroseconds(time: number, unit: ExposureTimeUnit) {
	return unit === 'MICROSECOND' ? time : time * (60000000 / exposureTimeUnitFactor(unit))
}

export function exposureTimeIn(time: number, from: ExposureTimeUnit, to: ExposureTimeUnit) {
	return from === to ? time : time * (exposureTimeUnitFactor(to) / exposureTimeUnitFactor(from))
}

export function exposureTimeUnitCode(unit: ExposureTimeUnit) {
	switch (unit) {
		case 'MINUTE':
			return 'm'
		case 'SECOND':
			return 's'
		case 'MILLISECOND':
			return 'ms'
		case 'MICROSECOND':
			return 'µs'
	}
}
