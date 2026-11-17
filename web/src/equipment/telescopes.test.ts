import { expect, test } from 'bun:test'
import { referencedTelescope, referToTelescope, resolveTelescope, resolveTelescopes } from './telescopes'

const ESPRIT = { id: 't1', name: 'Esprit 100', aperture: 100, focalLength: 550, archived: true }
const GUIDE = { id: 't2', name: 'Guide 50', aperture: 50, archived: false }
const CATALOG = [ESPRIT, GUIDE]

test('a referenced telescope replaces the values it declares and keeps the reducer of the profile', () => {
	expect(resolveTelescope({ focalLength: 400, focalMultiplier: 0.8, aperture: 80, telescopeId: 't1' }, CATALOG)).toEqual({ focalLength: 550, focalMultiplier: 0.8, aperture: 100, telescopeId: 't1' })
	expect(resolveTelescope({ focalLength: 180, focalMultiplier: 1, aperture: 0, telescopeId: 't2' }, CATALOG)).toEqual({ focalLength: 180, focalMultiplier: 1, aperture: 50, telescopeId: 't2' })
})

test('optics entered by hand, absent, or of a deleted telescope resolve as they are', () => {
	expect(resolveTelescope({ focalLength: 400, focalMultiplier: 1, aperture: 80 }, CATALOG)).toEqual({ focalLength: 400, focalMultiplier: 1, aperture: 80 })
	expect(resolveTelescope({ focalLength: 400, focalMultiplier: 1, aperture: 80, telescopeId: 'gone' }, CATALOG)).toEqual({ focalLength: 400, focalMultiplier: 1, aperture: 80, telescopeId: 'gone' })
	expect(resolveTelescope(undefined, CATALOG)).toBeUndefined()
	expect(referencedTelescope({ telescopeId: 'gone' }, CATALOG)).toBeUndefined()
	expect(referencedTelescope({ telescopeId: 't1' }, CATALOG)).toBe(ESPRIT)
})

test('both telescopes of a profile resolve', () => {
	expect(resolveTelescopes({ telescope: { focalLength: 0, focalMultiplier: 1, aperture: 0, telescopeId: 't1' } }, CATALOG)).toEqual({ telescope: { focalLength: 550, focalMultiplier: 1, aperture: 100, telescopeId: 't1' }, guideTelescope: undefined })
})

test('referring to a telescope copies what it declares, and referring to none keeps the last copy', () => {
	const referred = referToTelescope({ focalLength: 400, focalMultiplier: 0.8, aperture: 80 }, GUIDE)
	expect(referred).toEqual({ focalLength: 400, focalMultiplier: 0.8, aperture: 50, telescopeId: 't2' })
	expect(referToTelescope(referred, undefined)).toEqual({ focalLength: 400, focalMultiplier: 0.8, aperture: 50 })
})
