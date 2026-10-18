import { expect, test } from 'bun:test'
import { constellationDetails, constellationOfLabel, searchConstellations } from './constellations'

const source = {
	lines: [],
	boundaries: [],
	labels: [
		{ name: 'Orion', rightAscension: 1.45, declination: 0.05 },
		{ name: 'Serpens Caput', rightAscension: 4.1, declination: 0.2 },
		{ name: 'Serpens Cauda', rightAscension: 4.8, declination: -0.1 },
	],
}

test('constellations of labels', () => {
	expect(constellationOfLabel('Orion')).toBe('ORI')
	expect(constellationOfLabel('canis major')).toBe('CMA')
	expect(constellationOfLabel('Corona Austrina')).toBe('CRA')
	expect(constellationOfLabel('Serpens Cauda')).toBe('SER')
	expect(constellationOfLabel('Nowhere')).toBeUndefined()
})

test('details of a constellation', () => {
	expect(constellationDetails(source, 'ORI')).toEqual({ code: 'ORI', abbreviation: 'Ori', name: 'Orion', genitive: 'Orionis', rightAscension: 1.45, declination: 0.05 })
	expect(constellationDetails(source, 'SER')?.rightAscension).toBe(4.1)
	expect(constellationDetails(source, 'CMA')).toBeUndefined()
	expect(constellationDetails(source, 'XYZ')).toBeUndefined()
})

test('search constellations', () => {
	expect(searchConstellations('ori').map((e) => e.name)).toEqual(['Orion'])
	expect(searchConstellations('Canis').map((e) => e.name)).toEqual(['Canis Major', 'Canis Minor'])
	expect(searchConstellations('orionis')[0]).toEqual({ ref: { kind: 'constellation', code: 'ORI' }, name: 'Orion', designations: ['Ori', 'Orionis'], category: 'constellation', typeName: 'Constellation' })
	expect(searchConstellations('or')).toEqual([])
})
