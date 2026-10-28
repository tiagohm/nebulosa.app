import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mas } from 'nebulosa/src/math/units/angle'
import { catalogObject, catalogStars, fieldConstellations, fieldObjects, renderConstellations, renderDeepSky, renderStars, searchCatalog } from './catalog'
import { fixtureCatalog } from './fixture'
import { assertSkyCatalogSchema } from './schema'

const db = fixtureCatalog()

// 2026-01-01T00:00:00Z, about 26 years after J2000.
const TIME = Date.UTC(2026, 0, 1)

test('catalog stars within a cone', () => {
	// Around Pi-3 Orionis (Tabit), with Pi-2 Orionis about 2° away and Betelgeuse about 16° away.
	const stars = catalogStars(db, 1.2669, 0.1221, 0.05)
	expect(stars.map((e) => e.declination)).toEqual([0.1221, 0.1563])
	expect(stars[0].flux).toBeGreaterThan(stars[1].flux)
	expect(stars[1].flux).toBeCloseTo(0.4 * 10 ** (-0.4 * 0.35), 9)
	expect(catalogStars(db, 1.2669, 0.1221, 0.01)).toHaveLength(1)
	expect(catalogStars(db, 1.2669, 0.1221, 0.05)[0]).not.toBe(stars[0])
})

test('search by designation', () => {
	expect(searchCatalog(db, 'M31').map((e) => e.name)).toEqual(['Andromeda Galaxy'])
	expect(searchCatalog(db, 'ngc 1976').map((e) => e.name)).toEqual(['Great Orion Nebula'])
	expect(searchCatalog(db, 'HIP 32349').map((e) => e.name)).toEqual(['Sirius'])
	expect(searchCatalog(db, 'Alp CMa').map((e) => e.name)).toEqual(['Sirius'])
	expect(searchCatalog(db, 'α Ori').map((e) => e.name)).toEqual(['Betelgeuse'])
	expect(searchCatalog(db, '58 Ori').map((e) => e.name)).toEqual(['Betelgeuse'])
})

test('search bayer components', () => {
	expect(searchCatalog(db, 'Pi Ori').map((e) => e.name)).toEqual(['Tabit', 'Pi-2 Ori'])
	expect(searchCatalog(db, 'Pi2 Ori').map((e) => e.name)).toEqual(['Pi-2 Ori'])
})

test('search by name and alias', () => {
	expect(searchCatalog(db, 'sirius').map((e) => e.name)).toEqual(['Sirius'])
	expect(searchCatalog(db, 'Andromeda Nebula').map((e) => e.name)).toEqual(['Andromeda Galaxy'])
	// Prefix matches come before substring matches, brightest first within each group.
	expect(searchCatalog(db, 'orion').map((e) => e.name)).toEqual(['Great Orion Nebula'])
	expect(searchCatalog(db, 'neb').map((e) => e.name)).toEqual(['Andromeda Galaxy', 'Great Orion Nebula'])
})

test('search result contents', () => {
	const [m31] = searchCatalog(db, 'M 31')
	expect(m31.ref).toEqual({ kind: 'catalog', id: 1000255 })
	expect(m31.category).toBe('deepSky')
	expect(m31.typeName).toBe('Galaxy')
	expect(m31.magnitude).toBe(3.4)
	expect(m31.constellation).toBe('And')
	// The catalog designation is listed before the other proper names.
	expect(m31.designations).toEqual(['M 31', 'Andromeda Nebula', 'NGC 224'])

	const [sirius] = searchCatalog(db, 'Sirius')
	expect(sirius.category).toBe('star')
	expect(sirius.designations[0]).toBe('Alp CMa')
})

test('search without results', () => {
	expect(searchCatalog(db, 'Vega')).toEqual([])
	expect(searchCatalog(db, '   ')).toEqual([])
	expect(searchCatalog(db, '100%')).toEqual([])
})

test('search limit', () => {
	expect(searchCatalog(db, 'Ori', 1)).toHaveLength(1)
})

test('catalog object', () => {
	const m42 = catalogObject(db, 1001879)!
	expect(m42.name).toBe('Great Orion Nebula')
	expect(m42.designations).toEqual(['Orion Nebula', 'M 42', 'NGC 1976'])
	expect(m42.typeName).toBe('HII Region')
	expect(m42.constellation).toBe('Ori')
	expect(m42.constellationName).toBe('Orion')
	expect(m42.majorAxis).toBeCloseTo(0.0261799, 6)
	expect(m42.distance).toBeUndefined()

	const pgc = catalogObject(db, 1090000)!
	expect(pgc.name).toBe('PGC 90000')
	expect(pgc.magnitude).toBeUndefined()

	expect(catalogObject(db, 1)).toBeUndefined()
})

test('render stars at the equator of date', () => {
	const stars = renderStars(db, TIME)
	expect(stars.time).toBe(TIME)
	expect(stars.ids).toEqual([32263, 27919, 22449, 22509])
	expect(stars.names).toEqual(['Sirius', 'Betelgeuse', 'Tabit', ''])
	expect(stars.designations).toEqual(['Alp CMa', 'Alp Ori', 'Pi-3 Ori', 'Pi-2 Ori'])
	expect(stars.mag[0]).toBe(-1.44)
	expect(stars.bv[0]).toBe(0.65)
	// Precession over 26 years moves Sirius about 0.3° east in right ascension.
	const shift = stars.ra[0] - 1.7677953696021995
	expect(shift).toBeGreaterThan(0.0045)
	expect(shift).toBeLessThan(0.006)
})

test('render deep-sky objects', () => {
	const dsos = renderDeepSky(db, TIME)
	// The PGC galaxy has no magnitude and no classic designation, so it is not rendered.
	expect(dsos.ids).toEqual([1000255, 1001879])
	expect(dsos.names).toEqual(['Andromeda Galaxy', 'Great Orion Nebula'])
	expect(dsos.types).toEqual([1, 18])
	expect(dsos.size[0]).toBeCloseTo(189.1, 1)
	expect(dsos.typeNames[18]).toBe('HII Region')
	expect(renderDeepSky(db, TIME, 3.5).ids).toEqual([1000255])
})

test('render constellations', () => {
	const data = renderConstellations({ lines: [[[1.7677953696021995, -0.291751258517685]]], boundaries: [], labels: [{ name: 'Canis Major', rightAscension: 1.8, declination: -0.4 }] }, TIME)
	expect(data.lines[0][0][0]).toBeCloseTo(renderStars(db, TIME).ra[0], 3)
	expect(data.labels[0].name).toBe('Canis Major')
})

test('schema version', () => {
	expect(() => assertSkyCatalogSchema(db)).not.toThrow()
	expect(() => assertSkyCatalogSchema(new Database(':memory:'))).toThrow('Run "bun make:catalog --force"')
})

test('render stars up to a magnitude', () => {
	expect(renderStars(db, TIME, 1).ids).toEqual([32263, 27919])
	expect(renderStars(db, TIME, -2).ids).toEqual([])
})

test('constellation labels carry their code', () => {
	const data = renderConstellations({ lines: [], boundaries: [], labels: [{ name: 'Serpens Cauda', rightAscension: 4.8, declination: -0.1 }] }, TIME)
	expect(data.labels[0].code).toBe('SER')
})

describe('field objects', () => {
	const field = { radius: 0.05, magnitudeLimit: Number.POSITIVE_INFINITY, maxStars: 100, maxDeepSky: 100 }

	test('stars within a cone with their names', () => {
		const objects = fieldObjects(db, { ...field, rightAscension: 1.2669, declination: 0.1221 })
		expect(objects.stars.map((e) => e.name)).toEqual(['Tabit', 'Pi-2 Ori'])
		expect(objects.stars[0]).toMatchObject({ id: 22449, category: 'star', typeName: 'Star', rightAscension: 1.2669, declination: 0.1221, magnitude: 3.19 })
		expect(objects.stars[0].designations).toContain('Pi-3 Ori')
		expect(objects.deepSky).toBeEmpty()
		expect(objects.truncated).toBeFalse()
	})

	test('magnitude limit and truncation', () => {
		expect(fieldObjects(db, { ...field, rightAscension: 1.2669, declination: 0.1221, magnitudeLimit: 4 }).stars.map((e) => e.id)).toEqual([22449])
		const truncated = fieldObjects(db, { ...field, rightAscension: 1.2669, declination: 0.1221, maxStars: 1 })
		expect(truncated.stars.map((e) => e.id)).toEqual([22449])
		expect(truncated.truncated).toBeTrue()
	})

	test('deep-sky objects reaching the cone by their extent', () => {
		// M 42 has a major axis of 0.0262 rad, so it reaches 0.0131 rad around its center.
		const near = fieldObjects(db, { ...field, rightAscension: 1.462971568107605, declination: -0.09409244358539581 + 0.02, radius: 0.01 })
		expect(near.deepSky.map((e) => e.name)).toEqual(['Great Orion Nebula'])
		expect(near.deepSky[0]).toMatchObject({ category: 'deepSky', typeName: 'HII Region', majorAxis: 0.026179938779914945, magnitude: 4 })
		expect(near.deepSky[0].designations).toContain('M 42')
		expect(fieldObjects(db, { ...field, rightAscension: 1.462971568107605, declination: -0.09409244358539581 + 0.03, radius: 0.01 }).deepSky).toBeEmpty()
	})

	test('objects without a magnitude outside a classic catalog are left out', () => {
		expect(fieldObjects(db, { ...field, rightAscension: 3.1, declination: 0.2 }).deepSky).toBeEmpty()
	})

	test('cone across 0h', () => {
		expect(fieldObjects(db, { ...field, rightAscension: 6.2, declination: 0.72, radius: 0.25 }).deepSky.map((e) => e.name)).toEqual(['Andromeda Galaxy'])
	})

	test('stars moved by proper motion on the J2000 equator', () => {
		const moving = fixtureCatalog()
		// Sirius: -546 mas/yr in right ascension (dα/dt) and -1223 mas/yr in declination.
		moving.run('UPDATE objects SET pmRA = ?, pmDEC = ? WHERE id = 32263', [mas(-546), mas(-1223)])
		const years = (TIME - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86400000)
		const [sirius] = fieldObjects(moving, { ...field, rightAscension: 1.7677953696021995, declination: -0.291751258517685, time: TIME }).stars
		expect(sirius.rightAscension).toBeCloseTo(1.7677953696021995 - mas(546) * years, 9)
		expect(sirius.declination).toBeCloseTo(-0.291751258517685 - mas(1223) * years, 9)
		expect(fieldObjects(moving, { ...field, rightAscension: 1.7677953696021995, declination: -0.291751258517685 }).stars[0].declination).toBe(-0.291751258517685)
	})
})

test('field constellations', () => {
	const source = {
		lines: [
			[
				[-0.1, 0],
				[0.1, 0],
			],
			[
				[2, 0.5],
				[2.1, 0.5],
			],
		],
		boundaries: [],
		labels: [
			{ name: 'Orion', rightAscension: -0.005, declination: 0.01 },
			{ name: 'Leo', rightAscension: 2, declination: 0.5 },
		],
	}

	// The first figure passes 0.01 rad from the center although both of its vertices are 0.1 rad away.
	const field = fieldConstellations(source, 0, 0.01, 0.02)
	expect(field.lines).toHaveLength(1)
	expect(field.lines[0][0][0]).toBeCloseTo(2 * Math.PI - 0.1, 12)
	expect(field.labels).toEqual([{ name: 'Orion', code: 'ORI', rightAscension: 2 * Math.PI - 0.005, declination: 0.01 }])
	expect(fieldConstellations(source, 0, 0.05, 0.02).lines).toBeEmpty()
})
