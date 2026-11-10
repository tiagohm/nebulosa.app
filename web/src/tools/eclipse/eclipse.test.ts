import { expect, test } from 'bun:test'
import { MISSING } from '../../format'
import { ACTIVE_TOOL_LOCATION, resolveToolLocation } from '../../location/site'
import { DEFAULT_ZONE_OVERRIDE, resolveDisplayZone } from '../../location/zone'
import { formatEclipseAngle, formatEclipseMagnitude, mapLocation, samePlace, utcDate, utcDateStart } from './eclipse'

test('a click on the map keeps the zone of the coordinates entered before, or UTC after a site', () => {
	expect(mapLocation(ACTIVE_TOOL_LOCATION, { longitude: 10, latitude: 20 })).toEqual({ mode: 'manual', latitude: 20, longitude: 10, elevation: 0, timeZone: 'UTC' })
	expect(mapLocation({ mode: 'saved', siteId: 'a' }, { longitude: 10, latitude: 20 }).timeZone).toBe('UTC')
	expect(mapLocation({ mode: 'manual', latitude: 0, longitude: 0, elevation: 500, timeZone: 'Asia/Tokyo' }, { longitude: 10, latitude: 20 })).toEqual({ mode: 'manual', latitude: 20, longitude: 10, elevation: 0, timeZone: 'Asia/Tokyo' })
})

test('the site zone of the times is the zone of the location clicked, never the active site', () => {
	const sites = [{ id: 'home', name: 'Home', latitude: -23.5, longitude: -46.6, elevation: 760, timeZone: 'America/Sao_Paulo' }]
	expect(resolveDisplayZone('site', DEFAULT_ZONE_OVERRIDE, resolveToolLocation(ACTIVE_TOOL_LOCATION, 'home', sites))).toEqual({ zone: 'America/Sao_Paulo', source: 'site' })

	const clicked = mapLocation({ mode: 'manual', latitude: 0, longitude: 0, elevation: 0, timeZone: 'Asia/Tokyo' }, { longitude: 10, latitude: 20 })
	expect(resolveDisplayZone('site', DEFAULT_ZONE_OVERRIDE, resolveToolLocation(clicked, 'home', sites))).toEqual({ zone: 'Asia/Tokyo', source: 'site' })
	expect(resolveDisplayZone('site', DEFAULT_ZONE_OVERRIDE, resolveToolLocation(ACTIVE_TOOL_LOCATION, undefined, sites), 'Europe/Berlin')).toEqual({ zone: 'Europe/Berlin', source: 'browserFallback' })
})

test('places are the same for the same longitude and latitude', () => {
	expect(samePlace(undefined, undefined)).toBe(true)
	expect(samePlace({ longitude: 1, latitude: 2 }, { longitude: 1, latitude: 2 })).toBe(true)
	expect(samePlace({ longitude: 1, latitude: 2 }, { longitude: 1, latitude: 3 })).toBe(false)
	expect(samePlace({ longitude: 1, latitude: 2 }, undefined)).toBe(false)
})

test('converts between UTC instants and calendar dates', () => {
	expect(utcDateStart('2024-04-08')).toBe(Date.UTC(2024, 3, 8))
	expect(utcDate(Date.UTC(2024, 3, 8, 23, 59, 59))).toBe('2024-04-08')
})

test('writes eclipse angles to a tenth and magnitudes with four decimals', () => {
	expect(formatEclipseAngle(23.45)).toBe('23.4°')
	expect(formatEclipseAngle(-0.04)).toBe('0.0°')
	expect(formatEclipseAngle(undefined)).toBe(MISSING)
	expect(formatEclipseAngle(Number.NaN)).toBe(MISSING)
	expect(formatEclipseMagnitude(1.01234)).toBe('1.0123')
	expect(formatEclipseMagnitude(-0.00001)).toBe('0.0000')
	expect(formatEclipseMagnitude(undefined)).toBe(MISSING)
})
