import { describe, expect, test } from 'bun:test'
import type { SatelliteSearchPage, SkyCatalogObject } from 'api'
import { proxy } from 'valtio'
import { activeProfile, newProfile, type ProfileState } from '../profile/profile'
import { filterFavorites, isSkyFavorite, searchFavoriteSatellites, selectionResult, setSkyObjectFavorite } from './favorites'

function load() {
	const profile = newProfile('Default')
	return proxy<ProfileState>({ profiles: [profile], activeId: profile.id, open: false })
}

const m42 = { ref: { kind: 'catalog', id: 1 }, name: 'M 42', designations: ['NGC 1976', 'Orion Nebula'], category: 'deepSky', typeName: 'Emission Nebula', magnitude: 4, constellation: 'Ori' } as const
const mars = { ref: { kind: 'body', code: '499' }, name: 'Mars', designations: [], category: 'solarSystem', typeName: 'Planet', magnitude: -1.2 } as const
const iss = { ref: { kind: 'satellite', noradId: '25544' }, name: 'ISS (ZARYA)', designations: ['NORAD 25544'], category: 'satellite', typeName: 'Payload' } as const

describe('marking', () => {
	test('a satellite goes to the satellite favorites and any other object to the sky favorites', () => {
		const state = load()
		const settings = () => activeProfile(state).settings

		setSkyObjectFavorite(state, iss, true)
		setSkyObjectFavorite(state, m42, true)
		setSkyObjectFavorite(state, mars, true)

		expect(settings().satelliteFavorites).toEqual(['25544'])
		expect(settings().skyFavorites).toEqual([m42, { ref: mars.ref, name: 'Mars', designations: [], category: 'solarSystem', typeName: 'Planet' }])
		expect(isSkyFavorite(settings(), iss.ref)).toBe(true)
		expect(isSkyFavorite(settings(), { kind: 'catalog', id: 1 })).toBe(true)
		expect(isSkyFavorite(settings(), { kind: 'catalog', id: 2 })).toBe(false)
		expect(isSkyFavorite(settings(), { kind: 'mount', connectionId: 'c', id: 'm' })).toBe(false)
		expect(isSkyFavorite(settings(), { kind: 'coordinates', rightAscension: 1, declination: 0 })).toBe(false)

		setSkyObjectFavorite(state, iss, false)
		setSkyObjectFavorite(state, m42, false)
		expect(settings().satelliteFavorites).toEqual([])
		expect(isSkyFavorite(settings(), m42.ref)).toBe(false)
	})
})

describe('selection entry', () => {
	test('is the one the search lists, and waits for the catalog data of a catalog object', () => {
		expect(selectionResult({ ref: { kind: 'mount', connectionId: 'c', id: 'm' }, name: 'Mount' })).toBeUndefined()
		expect(selectionResult({ ref: { kind: 'coordinates', rightAscension: 1, declination: 0 }, name: 'Sky Point' })).toBeUndefined()
		expect(selectionResult({ ref: { kind: 'catalog', id: 1 }, name: 'M 42' })).toBeUndefined()

		const catalog: SkyCatalogObject = { id: 1, category: 'deepSky', type: 0, typeName: 'Emission Nebula', name: 'M 42', designations: ['NGC 1976'], rightAscension: 0, declination: 0, magnitude: 4, pmRA: 0, pmDEC: 0, rv: 0, constellation: 'Ori', constellationName: 'Orion' }
		expect(selectionResult({ ref: { kind: 'catalog', id: 1 }, name: 'M 42', catalog })).toEqual({ ref: { kind: 'catalog', id: 1 }, name: 'M 42', designations: ['NGC 1976'], category: 'deepSky', typeName: 'Emission Nebula', magnitude: 4, constellation: 'Ori' })

		expect(selectionResult({ ref: { kind: 'body', code: '999' }, name: 'Pluto' })?.typeName).toBe('Dwarf Planet')
		expect(selectionResult({ ref: { kind: 'minorBody', spkId: '1', designation: '1' }, name: 'Ceres' })).toMatchObject({ category: 'minorBody', typeName: 'Minor Body' })
		expect(selectionResult({ ref: { kind: 'constellation', code: 'ORI' }, name: 'Orion', constellation: { code: 'ORI', abbreviation: 'Ori', name: 'Orion', genitive: 'Orionis', rightAscension: 0, declination: 0 } })?.designations).toEqual(['Ori', 'Orionis'])
		expect(selectionResult({ ref: { kind: 'meteorShower', id: 'iau:4' }, name: 'Geminids' })?.category).toBe('meteorShower')
		expect(selectionResult({ ref: iss.ref, name: 'ISS' })?.category).toBe('satellite')
	})
})

describe('filtering', () => {
	test('matches name, designations, and type, ignoring case, accents, and spaces', () => {
		const favorites = [m42, mars, { ...mars, ref: { kind: 'body', code: '599' }, name: 'Júpiter' }] as const
		expect(filterFavorites(favorites, '')).toHaveLength(3)
		expect(filterFavorites(favorites, ' m42 ').map((e) => e.name)).toEqual(['M 42'])
		expect(filterFavorites(favorites, 'ngc1976').map((e) => e.name)).toEqual(['M 42'])
		expect(filterFavorites(favorites, 'jupiter').map((e) => e.name)).toEqual(['Júpiter'])
		expect(filterFavorites(favorites, 'planet').map((e) => e.name)).toEqual(['Mars', 'Júpiter'])
		expect(filterFavorites(favorites, 'galaxy')).toEqual([])
	})
})

describe('favorite satellites', () => {
	test('are asked by id and text and listed as the search lists satellites', async () => {
		const urls: string[] = []
		const page: SatelliteSearchPage = { items: [{ noradId: '25544', name: 'ISS (ZARYA)', cosparId: '1998-067A', objectType: 'payload', groups: [] }], total: 1 }
		const io = {
			fetch: (input: string) => {
				urls.push(input)
				return Promise.resolve(Response.json(page))
			},
		}

		const listed = await searchFavoriteSatellites(['25544', '1'], ' zarya ', new AbortController().signal, io)
		expect(urls).toEqual(['/api/satellites?ids=25544%2C1&limit=100&q=zarya'])
		expect(listed).toEqual({ results: [{ ref: { kind: 'satellite', noradId: '25544' }, name: 'ISS (ZARYA)', designations: ['NORAD 25544', '1998-067A'], category: 'satellite', typeName: 'Payload' }], total: 1 })

		expect(await searchFavoriteSatellites([], '', new AbortController().signal, io)).toEqual({ results: [], total: 0 })
		expect(urls).toHaveLength(1)
	})
})
