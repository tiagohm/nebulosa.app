import { describe, expect, test } from 'bun:test'
import { ImageHandler, ImageProcessor } from 'src/api/image'
import type { AnnotateImage } from 'src/shared/types'

const EMPTY_ANNOTATE_IMAGE: Omit<AnnotateImage, 'solution'> = {
	stars: false,
	dsos: false,
	useSimbad: false,
	minorPlanets: false,
	minorPlanetsMagnitudeLimit: 0,
	includeMinorPlanetsWithoutMagnitude: false,
}

const processor = new ImageProcessor()
const image = new ImageHandler(processor)

describe('annotate', () => {
	const solution = {
		'DATE-OBS': '2024-07-11T04:00:00.000',
		SIMPLE: true,
		BITPIX: 16,
		NAXIS: 2,
		NAXIS1: 1280,
		NAXIS2: 1024,
		WCSAXES: 2,
		CRPIX1: 640,
		CRPIX2: 512,
		CDELT1: -0.002282778583712,
		CDELT2: 0.002282778583712,
		CUNIT1: 'deg',
		CUNIT2: 'deg',
		CTYPE1: 'RA---TAN',
		CTYPE2: 'DEC--TAN',
		CRVAL1: 284.84583333333,
		CRVAL2: -29.661666666667,
		LONPOLE: 180,
		LATPOLE: -29.661666666667,
		RADESYS: 'ICRS',
		orientation: -Math.PI,
		scale: 0.000039842002379787396,
		rightAscension: 4.971497652253623,
		declination: -0.5176937449623905,
		width: 0.05099776304612787,
		height: 0.040798210436902294,
		radius: 0.03265450126155186,
		parity: 'FLIPPED',
		widthInPixels: 1280,
		heightInPixels: 1024,
	} as const

	test('stars & dsos', async () => {
		const res = await image.annotate({ solution, ...EMPTY_ANNOTATE_IMAGE, stars: true, dsos: true })

		expect(res).toHaveLength(8)
	})

	test('stars', async () => {
		const res = await image.annotate({ solution, ...EMPTY_ANNOTATE_IMAGE, stars: true })

		expect(res).toHaveLength(1)
	})

	test('dsos', async () => {
		const res = await image.annotate({ solution, ...EMPTY_ANNOTATE_IMAGE, dsos: true })

		expect(res).toHaveLength(7)
	})

	test.skip('minor planets', async () => {
		const res = await image.annotate({ solution, ...EMPTY_ANNOTATE_IMAGE, minorPlanets: true, minorPlanetsMagnitudeLimit: 10 })

		expect(res).toHaveLength(1)
		expect(res.filter((e) => e.name.includes('1 Ceres'))).toHaveLength(1)
	}, 120000)
})
