import { expect, test } from 'bun:test'
import { deg } from 'nebulosa/src/math/units/angle'
import { domeMoving, domeStateWord, guideOutputStateWord, mountStateWord } from './lexicon'
import { mountSiteDiffers, mountSiteDistance } from './mountSite'
import { firstReason } from './useControl'

const mount = { parking: false, homing: false, moving: false, slewing: false, parked: false, tracking: false }

test('names an idle mount Idle, as the status bar does', () => {
	expect(mountStateWord(mount)).toBe('Idle')
	expect(mountStateWord({ ...mount, parked: true })).toBe('Parked')
	expect(mountStateWord({ ...mount, parking: true, slewing: true })).toBe('Parking')
})

test('names the motion of a dome before its rest state', () => {
	const dome = { homing: false, parking: false, moving: false, slewing: false, shutterState: 'CLOSED', parked: true, atHome: false } as const
	expect(domeStateWord(dome)).toBe('Parked')
	expect(domeStateWord({ ...dome, shutterState: 'OPENING' })).toBe('Shutter opening')
	// Slewing aggregates the other flags and arrives as an event of its own, so it never names a motion alone.
	const slewing = { ...dome, slewing: true }
	expect(domeStateWord({ ...slewing, shutterState: 'OPENING' })).toBe('Shutter opening')
	expect(domeStateWord({ ...slewing, shutterState: 'OPEN' })).toBe('Parked')
	expect(domeMoving({ ...slewing, shutterState: 'OPEN' })).toBe(false)
	expect(domeMoving({ ...dome, shutterState: 'CLOSING' })).toBe(true)
	expect(domeStateWord({ ...dome, moving: true, direction: 'COUNTER_CLOCKWISE' })).toBe('Rotating counterclockwise')
})

test('names the axes a guide output pulses', () => {
	expect(guideOutputStateWord({ pulsing: true, pulsingNS: true, pulsingWE: false })).toBe('Pulsing N/S')
	expect(guideOutputStateWord({ pulsing: false, pulsingNS: false, pulsingWE: false })).toBe('Idle')
})

test('tells a mount site apart from the observing site', () => {
	const observer = { latitude: -22.5, longitude: -45.5 }
	expect(mountSiteDiffers({ latitude: deg(-22.5), longitude: deg(-45.5) }, observer)).toBeFalse()
	expect(mountSiteDiffers({ latitude: deg(-22.505), longitude: deg(-45.495) }, observer)).toBeFalse()
	expect(mountSiteDiffers({ latitude: 0, longitude: 0 }, observer)).toBeTrue()
	expect(mountSiteDiffers({ latitude: 0, longitude: deg(-179.999) }, { latitude: 0, longitude: 179.999 })).toBeFalse()
})

test('gives the first reason a command is unavailable', () => {
	expect(firstReason(undefined, false, 'Unpark the mount first', 'Enter both coordinates')).toBe('Unpark the mount first')
	expect(firstReason(undefined, false)).toBeUndefined()
})

test('measures the ground distance from a mount site to the observing site', () => {
	expect(mountSiteDistance({ latitude: deg(-22.5), longitude: deg(-45.5) }, { latitude: -22.5, longitude: -45.5 })).toBe(0)
	expect(mountSiteDistance({ latitude: deg(-23.5), longitude: deg(-45.5) }, { latitude: -22.5, longitude: -45.5 })).toBeCloseTo(111.32, 1)
	expect(mountSiteDistance({ latitude: 0, longitude: deg(-179.5) }, { latitude: 0, longitude: 179.5 })).toBeCloseTo(111.32, 1)
})
