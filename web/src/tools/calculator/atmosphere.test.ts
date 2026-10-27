import { describe, expect, test } from 'bun:test'
import { dewPoint, frostPoint } from 'nebulosa/src/astronomy/formulas'
import { AIRMASS_EXAMPLE, airmass, DEW_EXAMPLE, dew } from './atmosphere'

describe('airmass', () => {
	test('is 1 at the zenith and grows towards the horizon', () => {
		const zenith = airmass({ altitude: '90', extinction: '' })
		expect(zenith.status === 'ready' && zenith.value).toMatchObject({ airmass: 1, extinction: undefined })
		const low = airmass(AIRMASS_EXAMPLE)
		expect(low.status === 'ready' && low.value.airmass).toBeCloseTo(1.9943, 4)
		expect(low.status === 'ready' && low.value.extinction).toBeCloseTo(0.2 * 1.9943, 4)
		expect(low.status === 'ready' && low.value.refraction).toBeCloseTo(1.7, 1)
	})

	test('the altitude must be above the horizon, the coefficient may be zero', () => {
		expect(airmass({ altitude: '0', extinction: '' }).status).toBe('invalid')
		expect(airmass({ altitude: '-5', extinction: '' }).status).toBe('invalid')
		expect(airmass({ altitude: '90.5', extinction: '' }).status).toBe('invalid')
		const clear = airmass({ altitude: '45', extinction: '0' })
		expect(clear.status === 'ready' && clear.value.extinction).toBe(0)
	})
})

describe('dew', () => {
	test('dew point, margin, and risk of a reading', () => {
		const result = dew(DEW_EXAMPLE)
		expect(result.status).toBe('ready')
		if (result.status !== 'ready' || result.value.mode !== 'dew') return
		expect(result.value.dewPoint).toBeCloseTo(dewPoint(10, 85), 12)
		expect(result.value.margin).toBeCloseTo(10 - dewPoint(10, 85), 12)
		expect(result.value.risk).toBeCloseTo(1 - (10 - dewPoint(10, 85)) / 5, 12)
	})

	test('saturated air has its dew point at the temperature and full risk', () => {
		const result = dew({ ...DEW_EXAMPLE, humidity: '100' })
		expect(result.status === 'ready' && result.value.mode === 'dew' && result.value.risk).toBeCloseTo(1, 12)
		expect(result.status === 'ready' && result.value.mode === 'dew' && result.value.dewPoint).toBeCloseTo(10, 10)
	})

	test('the humidity must be within (0, 100] and the temperature within the Magnus domain', () => {
		for (const humidity of ['0', '-1', '100.1']) expect(dew({ ...DEW_EXAMPLE, humidity }).status).toBe('invalid')
		expect(dew({ ...DEW_EXAMPLE, humidity: '' })).toEqual({ status: 'incomplete', missing: ['Relative humidity'] })
		expect(dew({ ...DEW_EXAMPLE, temperature: '120' })).toEqual({ status: 'invalid', reason: 'Temperature must be at least -100 and at most 100.' })
	})

	test('the humidity of a dew point, never from a dew point above the temperature', () => {
		const result = dew({ ...DEW_EXAMPLE, mode: 'humidity', dewPoint: String(dewPoint(10, 85)) })
		expect(result.status === 'ready' && result.value.mode === 'humidity' && result.value.humidity).toBeCloseTo(85, 8)
		expect(dew({ ...DEW_EXAMPLE, mode: 'humidity', dewPoint: '10' })).toEqual({ status: 'ready', value: { mode: 'humidity', humidity: 100 } })
		expect(dew({ ...DEW_EXAMPLE, mode: 'humidity', dewPoint: '12' })).toEqual({ status: 'invalid', reason: 'Dew point must not be above the temperature.' })
	})

	test('the frost point reads the humidity over ice, not over water', () => {
		const result = dew({ ...DEW_EXAMPLE, mode: 'frost', temperature: '-10', humidity: '', iceHumidity: '80' })
		expect(result).toEqual({ status: 'ready', value: { mode: 'frost', frostPoint: frostPoint(-10, 80) } })
		expect(dew({ ...DEW_EXAMPLE, mode: 'frost', iceHumidity: '' })).toEqual({ status: 'incomplete', missing: ['Relative humidity over ice'] })
	})
})
