import { expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { newProfile, type ProfileState } from '../profile/profile'
import { activeSite, forgetSite, normalizeObservingSite, parseGeographicAngle, removeSite, saveSite, selectSite, type SiteState } from './site'
import { formatUtcOffset, isKnownTimeZone } from './zone'

const HOME = { name: ' Home ', latitude: -23.5475, longitude: -46.63611, elevation: 760, timeZone: 'America/Sao_Paulo' }

function stores() {
	const profiles = proxy<ProfileState>({ profiles: [newProfile('A', 'a'), newProfile('B', 'b')], activeId: 'a', open: false })
	const sites = proxy<SiteState>({ sites: [] })
	return { profiles, sites }
}

test('a site needs a name, coordinates and an elevation in range, and a known time zone', () => {
	expect(normalizeObservingSite(HOME)).toEqual({ ...HOME, name: 'Home' })
	expect(normalizeObservingSite({ ...HOME, timeZone: 'UTC' })).toMatchObject({ timeZone: 'UTC' })
	expect(normalizeObservingSite({ ...HOME, name: '  ' })).toBeUndefined()
	expect(normalizeObservingSite({ ...HOME, latitude: 90.1 })).toBeUndefined()
	expect(normalizeObservingSite({ ...HOME, longitude: -180.5 })).toBeUndefined()
	expect(normalizeObservingSite({ ...HOME, elevation: 9001 })).toBeUndefined()
	expect(normalizeObservingSite({ ...HOME, elevation: Number.NaN })).toBeUndefined()
	expect(normalizeObservingSite({ ...HOME, timeZone: 'Mars/Olympus' })).toBeUndefined()
	expect(normalizeObservingSite({ ...HOME, timeZone: '' })).toBeUndefined()
})

test('coordinates are read as decimal or sexagesimal degrees, with a sign or a hemisphere', () => {
	expect(parseGeographicAngle('-23.5475', 'latitude')).toBeCloseTo(-23.5475, 10)
	expect(parseGeographicAngle('23.5475 S', 'latitude')).toBeCloseTo(-23.5475, 10)
	expect(parseGeographicAngle('n 23 30', 'latitude')).toBeCloseTo(23.5, 10)
	expect(parseGeographicAngle('46° 38′ 10″ W', 'longitude')).toBeCloseTo(-(46 + 38 / 60 + 10 / 3600), 8)
	expect(parseGeographicAngle('-57.01863', 'longitude')).toBe(-57.01863)
	expect(parseGeographicAngle('45 30', 'longitude')).toBe(45.5)
	expect(parseGeographicAngle('-0 30', 'longitude')).toBeCloseTo(-0.5, 10)
	expect(parseGeographicAngle('10 E', 'longitude')).toBe(10)
	expect(parseGeographicAngle('10 E', 'latitude')).toBeUndefined()
	expect(parseGeographicAngle('-10 S', 'latitude')).toBeUndefined()
	expect(parseGeographicAngle('north', 'latitude')).toBeUndefined()
})

test('sites are added and edited in place, and invalid ones change nothing', () => {
	const { sites } = stores()
	const site = saveSite(sites, HOME)!
	expect(sites.sites).toEqual([{ id: site.id, ...HOME, name: 'Home' }])

	saveSite(sites, { ...HOME, name: 'Backyard' }, site.id)
	expect(sites.sites).toEqual([{ id: site.id, ...HOME, name: 'Backyard' }])

	expect(saveSite(sites, { ...HOME, latitude: 100 }, site.id)).toBeUndefined()
	expect(sites.sites[0].latitude).toBe(HOME.latitude)
})

test('a profile observes from a saved site only, and from none once it is deleted', () => {
	const { profiles, sites } = stores()
	selectSite(profiles, sites, 'missing')
	expect(profiles.profiles[0].activeSiteId).toBeUndefined()

	const site = saveSite(sites, HOME)!
	selectSite(profiles, sites, site.id)
	profiles.profiles[1].activeSiteId = site.id
	expect(activeSite(profiles.profiles[0], sites.sites)?.id).toBe(site.id)

	removeSite(sites, site.id)
	forgetSite(profiles, site.id)
	expect(profiles.profiles.map((profile) => profile.activeSiteId)).toEqual([undefined, undefined])
	expect(activeSite(profiles.profiles[0], sites.sites)).toBeUndefined()

	selectSite(profiles, sites, undefined)
	expect('activeSiteId' in profiles.profiles[0]).toBeFalse()
})

test('time zones are named by IANA and their offset holds at an instant', () => {
	expect(isKnownTimeZone('UTC')).toBeTrue()
	expect(isKnownTimeZone('Asia/Kathmandu')).toBeTrue()
	expect(isKnownTimeZone('Nowhere/Land')).toBeFalse()
	expect(formatUtcOffset('UTC', 0)).toBe('UTC+00:00')
	expect(formatUtcOffset('Asia/Kathmandu', Date.UTC(2026, 0, 1))).toBe('UTC+05:45')
	expect(formatUtcOffset('America/New_York', Date.UTC(2026, 0, 1))).toBe('UTC−05:00')
	expect(formatUtcOffset('America/New_York', Date.UTC(2026, 6, 1))).toBe('UTC−04:00')
})
