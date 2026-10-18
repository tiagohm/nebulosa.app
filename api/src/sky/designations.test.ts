import { expect, test } from 'bun:test'
import { CONSTELLATION_LIST } from 'nebulosa/src/astronomy/coordinates/constellation'
import { abbreviateGreekLetter, CATALOG, displayPriority, formatDesignation, parseDesignationQuery } from './designations'

test('format designations', () => {
	const cma = CONSTELLATION_LIST.indexOf('CMA')
	expect(formatDesignation(CATALOG.M, '31', 0)).toBe('M 31')
	expect(formatDesignation(CATALOG.NGC, '224', 0)).toBe('NGC 224')
	expect(formatDesignation(CATALOG.SH2, '281', 0)).toBe('Sh 2-281')
	expect(formatDesignation(CATALOG.BAYER, 'Alp', cma)).toBe('Alp CMa')
	expect(formatDesignation(CATALOG.FLAMSTEED, '9', cma)).toBe('9 CMa')
	expect(formatDesignation(CATALOG.NAME, 'Sirius', cma)).toBe('Sirius')
})

test('parse catalog designations', () => {
	expect(parseDesignationQuery('M31')).toEqual([{ type: CATALOG.M, name: '31' }])
	expect(parseDesignationQuery(' m  31 ')).toEqual([{ type: CATALOG.M, name: '31' }])
	expect(parseDesignationQuery('Messier 31')).toEqual([{ type: CATALOG.M, name: '31' }])
	expect(parseDesignationQuery('NGC224')).toEqual([{ type: CATALOG.NGC, name: '224' }])
	expect(parseDesignationQuery('HIP 32349')).toEqual([{ type: CATALOG.HIP, name: '32349' }])
	expect(parseDesignationQuery('Sh2-281')).toEqual([{ type: CATALOG.SH2, name: '281' }])
	expect(parseDesignationQuery('Sh 2-281')).toEqual([{ type: CATALOG.SH2, name: '281' }])
	expect(parseDesignationQuery('Mel 22')).toEqual([{ type: CATALOG.MEL, name: '22' }])
	expect(parseDesignationQuery('Cr 399')).toEqual([{ type: CATALOG.CR, name: '399' }])
	expect(parseDesignationQuery('Ced 55d')).toEqual([{ type: CATALOG.CED, name: '55d' }])
	expect(parseDesignationQuery('Arp 2').map((e) => e.type)).toEqual([CATALOG.ARP, CATALOG.CL_ARP])
})

test('parse stellar designations', () => {
	expect(parseDesignationQuery('Alp CMa')).toEqual([{ type: CATALOG.BAYER, name: 'Alp', constellation: 'CMA', components: true }])
	expect(parseDesignationQuery('α CMa')).toEqual([{ type: CATALOG.BAYER, name: 'Alp', constellation: 'CMA', components: true }])
	expect(parseDesignationQuery('alpha cma')).toEqual([{ type: CATALOG.BAYER, name: 'Alp', constellation: 'CMA', components: true }])
	expect(parseDesignationQuery('Pi1 Ori')).toEqual([{ type: CATALOG.BAYER, name: 'Pi-1', constellation: 'ORI' }])
	expect(parseDesignationQuery('Pi-1 Ori')).toEqual([{ type: CATALOG.BAYER, name: 'Pi-1', constellation: 'ORI' }])
	expect(parseDesignationQuery('58 Ori')).toEqual([{ type: CATALOG.FLAMSTEED, name: '58', constellation: 'ORI' }])
})

test('names are not designations', () => {
	expect(parseDesignationQuery('Sirius')).toEqual([])
	expect(parseDesignationQuery('Orion Nebula')).toEqual([])
	expect(parseDesignationQuery('Big Dog')).toEqual([])
	expect(parseDesignationQuery('')).toEqual([])
})

test('display priority', () => {
	expect(displayPriority(CATALOG.NAME)).toBeLessThan(displayPriority(CATALOG.M))
	expect(displayPriority(CATALOG.M)).toBeLessThan(displayPriority(CATALOG.NGC))
	expect(displayPriority(CATALOG.BAYER)).toBeLessThan(displayPriority(CATALOG.HIP))
	expect(displayPriority(CATALOG.HIP)).toBeLessThan(displayPriority(CATALOG.PGC))
})

test('abbreviate greek letters', () => {
	expect(abbreviateGreekLetter('α Cen')).toBe('Alp Cen')
	expect(abbreviateGreekLetter('Omega Centauri')).toBe('Omega Centauri')
})
