import { expect, test } from 'bun:test'
import { deg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { ofDateMatrix, toDate } from '../../sky/footprint'
import { framingPreviewEntry, type FramingPreviewState, mountCenter, newFramingDocument, newFramingName, setPreviewCenter } from './framing'

test('a new framing gets the first free name and the default optics typed by hand', () => {
	expect(newFramingName([])).toBe('Framing 1')
	expect(newFramingName(['Framing 2', 'wide'])).toBe('Framing 3')
	expect(newFramingName(['framing 2'])).toBe('Framing 3')
	expect(newFramingDocument('Framing 1')).toMatchObject({ name: 'Framing 1', rotation: 0, optics: { telescope: { source: 'manual', focalLength: 600 }, camera: { source: 'manual' } } })
})

test('the mount position of date is centered at J2000', () => {
	const time = Date.UTC(2026, 10, 18)
	const [rightAscension, declination] = toDate(ofDateMatrix(time), [deg(83.8), deg(-5.4)])
	const center = mountCenter({ rightAscension, declination }, time)
	expect(center.rightAscension).toBeCloseTo(deg(83.8), 12)
	expect(center.declination).toBeCloseTo(deg(-5.4), 12)
})

test('the preview keeps its center, background, and survey, never the download', () => {
	const state = proxy<FramingPreviewState>({ source: 'sky', survey: 'CDS/P/DSS2/color', downloading: true })
	const entry = framingPreviewEntry(state)
	setPreviewCenter(state, { rightAscension: 1.5, declination: -0.1 }, 'M 42')
	state.source = 'survey'
	expect(entry.value()).toEqual({ center: { rightAscension: 1.5, declination: -0.1 }, centerName: 'M 42', source: 'survey', survey: 'CDS/P/DSS2/color' })

	const restored = proxy<FramingPreviewState>({ source: 'sky', survey: 'x', downloading: false })
	framingPreviewEntry(restored).restore({ center: { rightAscension: 2, declination: 0.2 }, source: 'survey', survey: 'CDS/P/2MASS/color' })
	expect(restored).toMatchObject({ center: { rightAscension: 2, declination: 0.2 }, source: 'survey', survey: 'CDS/P/2MASS/color', downloading: false })

	setPreviewCenter(state, undefined)
	expect(state.centerName).toBeUndefined()
})
