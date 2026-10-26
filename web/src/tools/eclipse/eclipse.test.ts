import { expect, test } from 'bun:test'
import { displayTimeZone, formatDuration, formatEclipseTime, utcDate, utcDateStart } from './eclipse'

test('shows times in the chosen zone, the observer zone, or UTC for a place on the map', () => {
	expect(displayTimeZone({ place: { source: 'observer', longitude: 0, latitude: 0, timeZone: 'Asia/Tokyo' } })).toBe('Asia/Tokyo')
	expect(displayTimeZone({ place: { source: 'observer', longitude: 0, latitude: 0 } })).toBe('')
	expect(displayTimeZone({ place: { source: 'map', longitude: 0, latitude: 0 } })).toBe('UTC')
	expect(displayTimeZone({ place: undefined })).toBe('UTC')
	expect(displayTimeZone({ place: { source: 'map', longitude: 0, latitude: 0 }, timeZone: 'Europe/Lisbon' })).toBe('Europe/Lisbon')
})

test('formats contact times with their date and zone', () => {
	const time = Date.UTC(1997, 8, 16, 18, 47, 11)
	expect(formatEclipseTime(time, 'UTC', 'en-US')).toBe('Sep 16, 1997, 18:47:11 UTC')
	// The same instant is the next day in Tokyo.
	expect(formatEclipseTime(time, 'Asia/Tokyo', 'en-US')).toBe('Sep 17, 1997, 03:47:11 GMT+9')
	// Daylight saving time in New York in March 2025, standard time in January.
	expect(formatEclipseTime(Date.UTC(2025, 2, 14, 6, 58, 43), 'America/New_York', 'en-US')).toBe('Mar 14, 2025, 02:58:43 EDT')
	expect(formatEclipseTime(Date.UTC(2025, 0, 14, 6, 58, 43), 'America/New_York', 'en-US')).toBe('Jan 14, 2025, 01:58:43 EST')
})

test('formats durations to the second', () => {
	expect(formatDuration(3 * 3600 + 16 * 60 + 5.4)).toBe('3h 16m 05s')
	expect(formatDuration(59.6)).toBe('0h 01m 00s')
})

test('converts between UTC instants and calendar dates', () => {
	expect(utcDateStart('2024-04-08')).toBe(Date.UTC(2024, 3, 8))
	expect(utcDate(Date.UTC(2024, 3, 8, 23, 59, 59))).toBe('2024-04-08')
})
