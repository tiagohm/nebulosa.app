import { expect, test } from 'bun:test'
import type { SkyPosition } from 'api'
import { deg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import type { RouteState } from '../../shell/route'
import { ofDateMatrix, toDate } from '../../sky/footprint'
import { framingPreviewEntry, type FramingPreviewState, mountCenter, newFramingDocument, newFramingName, openFramingAt, setFramingHidden, setPreviewCenter, skySelectionCenter } from './framing'

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

test('the preview keeps its center, background, survey, fit, and hidden framings', () => {
	const state = proxy<FramingPreviewState>({ source: 'sky', survey: 'CDS/P/DSS2/color', fit: 'all', hidden: [] })
	const entry = framingPreviewEntry(state)
	setPreviewCenter(state, { rightAscension: 1.5, declination: -0.1 }, 'M 42')
	state.source = 'survey'
	state.fit = 'selected'
	setFramingHidden(state, 'a', true)
	setFramingHidden(state, 'equipment', true)
	setFramingHidden(state, 'a', true)
	setFramingHidden(state, 'equipment', false)
	expect(entry.value()).toEqual({ center: { rightAscension: 1.5, declination: -0.1 }, centerName: 'M 42', source: 'survey', survey: 'CDS/P/DSS2/color', fit: 'selected', hidden: ['a'] })

	const restored = proxy<FramingPreviewState>({ source: 'sky', survey: 'x', fit: 'all', hidden: [] })
	framingPreviewEntry(restored).restore({ center: { rightAscension: 2, declination: 0.2 }, source: 'survey', survey: 'CDS/P/2MASS/color', fit: 'selected', hidden: ['b', 3] })
	expect(restored).toMatchObject({ center: { rightAscension: 2, declination: 0.2 }, source: 'survey', survey: 'CDS/P/2MASS/color', fit: 'selected' })
	expect([...restored.hidden]).toEqual(['b'])
	framingPreviewEntry(restored).restore({ fit: 'sideways' })
	expect(restored.fit).toBe('selected')

	setPreviewCenter(state, undefined)
	expect(state.centerName).toBeUndefined()
})

test('Open in Framing centers the tool on the J2000 position of the Sky selection', () => {
	const time = Date.UTC(2026, 10, 18)
	const position = { rightAscensionJ2000: 1.2, declinationJ2000: -0.3 } as SkyPosition
	const noMount = { target: undefined, state: undefined }
	expect(skySelectionCenter({ ref: { kind: 'coordinates', rightAscension: 1.2, declination: -0.3 }, name: 'Sky Point' }, noMount, true, time)).toBeUndefined()
	expect(skySelectionCenter({ ref: { kind: 'coordinates', rightAscension: 1.2, declination: -0.3 }, name: 'Sky Point', position }, noMount, true, time)).toEqual({ center: { rightAscension: 1.2, declination: -0.3 }, name: 'Sky Point' })
	expect(skySelectionCenter({ ref: { kind: 'catalog', id: 1 }, name: 'M 42', catalog: { rightAscension: 1.46, declination: -0.09 } as never, position }, noMount, true, time)?.center).toEqual({ rightAscension: 1.46, declination: -0.09 })

	const [rightAscension, declination] = toDate(ofDateMatrix(time), [deg(83.8), deg(-5.4)])
	const mount = { target: { connectionId: 'c', id: 'm', name: 'EQ6' }, state: { connected: true, rightAscension, declination } as never }
	const mountRef = { kind: 'mount', connectionId: 'c', id: 'm' } as const
	expect(skySelectionCenter({ ref: mountRef, name: '' }, mount, true, time)?.center.rightAscension).toBeCloseTo(deg(83.8), 12)
	expect(skySelectionCenter({ ref: mountRef, name: '' }, mount, true, time)?.name).toBe('EQ6')
	expect(skySelectionCenter({ ref: mountRef, name: '' }, mount, false, time)).toBeUndefined()

	const state = proxy<FramingPreviewState>({ source: 'sky', survey: 'x', fit: 'all', hidden: [] })
	const route = proxy<RouteState>({ route: { workspace: 'sky' } })
	openFramingAt({ center: { rightAscension: 1.2, declination: -0.3 }, name: 'Sky Point' }, state, route, { pushState: () => undefined })
	expect(state).toMatchObject({ center: { rightAscension: 1.2, declination: -0.3 }, centerName: 'Sky Point' })
	expect(route.route).toEqual({ workspace: 'tools', tool: 'framing' })
})
