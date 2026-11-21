import { expect, test } from 'bun:test'
import { deg } from 'nebulosa/src/math/units/angle'
import { domeStateWord, guideOutputStateWord, mountStateWord } from './lexicon'
import { mountSiteDiffers } from './mountSite'
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
	expect(domeStateWord({ ...dome, shutterState: 'OPENING', slewing: true })).toBe('Shutter opening')
	expect(domeStateWord({ ...dome, slewing: true })).toBe('Slewing')
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
