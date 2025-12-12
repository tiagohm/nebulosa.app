import { expect, test } from 'bun:test'
import { ImageHandler } from 'src/api/image'

const image = new ImageHandler(new Map())

test('annotate', () => {
	const solution = {
		SIMPLE: true,
		BITPIX: 8,
		NAXIS: 0,
		'DATE-OBS': '2023-01-15T01:27:05.460',
		EXPTIME: 30,
		XPIXSZ: 18.5021,
		YPIXSZ: 18.5021,
		XBINNING: 4,
		YBINNING: 4,
		OBJECT: 'NGC3372',
		PIERSIDE: 'WEST',
		JD: 2459959.56006319,
		RA: 161.0177548315,
		DEC: -59.6022705034,
		TIMESYS: 'UTC',
		OBJCTRA: '10 44 04.261',
		OBJCTDEC: '-59 36 08.17',
		CUNIT1: 'deg',
		DATAMIN: 0,
		DATAMAX: 65535,
		CTYPE1: 'RA---TAN',
		CTYPE2: 'DEC--TAN',
		CRPIX1: 519,
		CRPIX2: 353.5,
		CRVAL1: 161.0175796038,
		CRVAL2: -59.60197838672,
		CDELT1: 0.0007603558926785,
		CDELT2: 0.0007598425932409,
		CROTA1: -110.1432632996,
		CROTA2: -110.1311030632,
		CD1_1: -0.0002618427660648,
		CD1_2: 0.0007138483378074,
		CD2_1: -0.0007134219535121,
		CD2_2: -0.000261514593761,
		NAXIS1: 1037,
		NAXIS2: 706,
		orientation: -1.9221503573060528,
		scale: 0.000013261755048945717,
		rightAscension: 2.8102869176783765,
		declination: -1.040250763550762,
		width: 0.01376173022530515,
		height: 0.009362799064555677,
		radius: 0.008322367828889234,
		parity: 'NORMAL',
		widthInPixels: 1037,
		heightInPixels: 706,
	} as const

	const res = image.annotate({ solution })

	expect(res).toHaveLength(8)
})
