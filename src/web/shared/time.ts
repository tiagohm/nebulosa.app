import { temporalFromDate } from 'nebulosa/src/astronomy/time/temporal'
import { timeConvert, Timescale, timeToDate, type Time } from 'nebulosa/src/astronomy/time/time'

export function astronomicEventTemporal(time: Time, scale: Timescale = time.scale) {
	time = timeConvert(time, scale)
	// temporalFromTime always convert to UTC
	return temporalFromDate(...timeToDate(time))
}
