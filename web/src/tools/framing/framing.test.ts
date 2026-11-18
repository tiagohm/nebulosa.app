import { expect, test } from 'bun:test'
import { deg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { ofDateMatrix, toDate } from '../../sky/footprint'
import { framingPreviewEntry, type FramingPreviewState, mountCenter, newFramingDocument, newFramingName, setPreviewCenter } from './framing'

test('a new framing gets the first free name, its colour, and the Equipment Setup or the default optics', () => {
	expect(newFramingName([])).toBe('Framing 1')
	expect(newFramingName(['Framing 2', 'wide'])).toBe('Framing 3')
	expect(newFramingName(['framing 2'])).toBe('Framing 3')
	expect(newFramingDocument('Framing 1', 2)).toMatchObject({ name: 'Framing 1', color: 2, rotation: 0, optics: { telescope: { source: 'manual', focalLength: 600 }, camera: { source: 'manual' } } })

	const sensor = { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 } as const
	expect(newFramingDocument('Framing 2', 0, { focalLength: 800, focalMultiplier: 0.8, aperture: 200, sensor, rotation: 0 })).toEqual({
		name: 'Framing 2',
		color: 0,
		optics: { telescope: { source: 'setup', setupOptics: 'telescope', focalLength: 800, aperture: 200, focalMultiplier: 0.8 }, camera: { source: 'setup', role: 'MAIN_CAMERA', sensor } },
		rotation: 0,
	})
})

test('the mount position of date is centered at J2000', () => {
	const time = Date.UTC(2026, 10, 18)
	const [rightAscension, declination] = toDate(ofDateMatrix(time), [deg(83.8), deg(-5.4)])
	const center = mountCenter({ rightAscension, declination }, time)
	expect(center.rightAscension).toBeCloseTo(deg(83.8), 12)
	expect(center.declination).toBeCloseTo(deg(-5.4), 12)
})

test('the preview keeps its center, background, survey, and fit', () => {
	const state = proxy<FramingPreviewState>({ source: 'sky', survey: 'CDS/P/DSS2/color', fit: 'all' })
	const entry = framingPreviewEntry(state)
	setPreviewCenter(state, { rightAscension: 1.5, declination: -0.1 }, 'M 42')
	state.source = 'survey'
	state.fit = 'selected'
	expect(entry.value()).toEqual({ center: { rightAscension: 1.5, declination: -0.1 }, centerName: 'M 42', source: 'survey', survey: 'CDS/P/DSS2/color', fit: 'selected' })

	const restored = proxy<FramingPreviewState>({ source: 'sky', survey: 'x', fit: 'all' })
	framingPreviewEntry(restored).restore({ center: { rightAscension: 2, declination: 0.2 }, source: 'survey', survey: 'CDS/P/2MASS/color', fit: 'selected' })
	expect(restored).toMatchObject({ center: { rightAscension: 2, declination: 0.2 }, source: 'survey', survey: 'CDS/P/2MASS/color', fit: 'selected' })
	framingPreviewEntry(restored).restore({ fit: 'sideways' })
	expect(restored.fit).toBe('selected')

	setPreviewCenter(state, undefined)
	expect(state.centerName).toBeUndefined()
})
