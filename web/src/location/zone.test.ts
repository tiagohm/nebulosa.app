import { expect, test } from 'bun:test'
import { describeDisplayZone, type DisplayZoneOverride, resolveDisplayZone, wallTimeToInstant, zonedWallTime } from './zone'

const HOME = { timeZone: 'America/Sao_Paulo' }
const BROWSER = 'Europe/Berlin'

test('the profile default shows the site, UTC, or the browser zone, and the browser zone stands in for no site', () => {
	expect(resolveDisplayZone('site', undefined, HOME, BROWSER)).toEqual({ zone: 'America/Sao_Paulo', source: 'site' })
	expect(resolveDisplayZone('utc', undefined, HOME, BROWSER)).toEqual({ zone: 'UTC', source: 'utc' })
	expect(resolveDisplayZone('browser', undefined, HOME, BROWSER)).toEqual({ zone: BROWSER, source: 'browser' })
	expect(resolveDisplayZone('site', undefined, undefined, BROWSER)).toEqual({ zone: BROWSER, source: 'browserFallback' })
})

test('a tool override wins over the default, and default follows it', () => {
	const overrides: [DisplayZoneOverride, string][] = [
		[{ mode: 'default' }, 'UTC'],
		[{ mode: 'site' }, 'America/Sao_Paulo'],
		[{ mode: 'utc' }, 'UTC'],
		[{ mode: 'browser' }, BROWSER],
		[{ mode: 'zone', zone: 'Asia/Kathmandu' }, 'Asia/Kathmandu'],
	]

	for (const [override, zone] of overrides) expect(resolveDisplayZone('utc', override, HOME, BROWSER).zone).toBe(zone)
})

test('the site mode takes the site of the tool, not the active one', () => {
	const other = { timeZone: 'Pacific/Kiritimati' }
	expect(resolveDisplayZone('site', { mode: 'default' }, other, BROWSER)).toEqual({ zone: 'Pacific/Kiritimati', source: 'site' })
	expect(resolveDisplayZone('utc', { mode: 'site' }, other, BROWSER).zone).toBe('Pacific/Kiritimati')
})

test('a resolved zone is named with why it shows the times', () => {
	expect(describeDisplayZone({ zone: 'UTC', source: 'utc' })).toBe('UTC')
	expect(describeDisplayZone({ zone: 'America/Sao_Paulo', source: 'site' })).toBe('America/Sao_Paulo (site)')
	expect(describeDisplayZone({ zone: BROWSER, source: 'browserFallback' })).toBe('Europe/Berlin (browser, no site)')
})

test('wall times of a time zone, across midnight and unusual offsets', () => {
	const time = Date.UTC(2026, 9, 18, 14, 23, 45)
	expect(zonedWallTime(time, 'America/Sao_Paulo')).toEqual({ year: 2026, month: 10, day: 18, hour: 11, minute: 23, second: 45 })
	expect(zonedWallTime(time, 'UTC')).toEqual({ year: 2026, month: 10, day: 18, hour: 14, minute: 23, second: 45 })
	expect(zonedWallTime(time, 'Asia/Kathmandu')).toEqual({ year: 2026, month: 10, day: 18, hour: 20, minute: 8, second: 45 })
	// UTC+14 is already the next day.
	expect(zonedWallTime(time, 'Pacific/Kiritimati')).toEqual({ year: 2026, month: 10, day: 19, hour: 4, minute: 23, second: 45 })
	expect(wallTimeToInstant({ year: 2026, month: 10, day: 18, hour: 11, minute: 23, second: 45 }, 'America/Sao_Paulo')).toEqual({ kind: 'exact', time })
	expect(wallTimeToInstant({ year: 2026, month: 10, day: 19, hour: 4, minute: 23, second: 45 }, 'Pacific/Kiritimati')).toEqual({ kind: 'exact', time })
})

test('wall times the clocks repeat or skip are named, never moved', () => {
	// Summer and winter offsets of Berlin.
	expect(wallTimeToInstant({ year: 2025, month: 7, day: 1, hour: 12, minute: 0, second: 0 }, 'Europe/Berlin')).toEqual({ kind: 'exact', time: Date.UTC(2025, 6, 1, 10) })
	expect(wallTimeToInstant({ year: 2025, month: 1, day: 1, hour: 12, minute: 0, second: 0 }, 'Europe/Berlin')).toEqual({ kind: 'exact', time: Date.UTC(2025, 0, 1, 11) })
	// 02:30 does not exist on 2025-03-30 in Berlin.
	expect(wallTimeToInstant({ year: 2025, month: 3, day: 30, hour: 2, minute: 30, second: 0 }, 'Europe/Berlin')).toEqual({ kind: 'nonexistent' })
	// 02:30 happens twice on 2025-10-26 in Berlin: first in CEST, then in CET.
	expect(wallTimeToInstant({ year: 2025, month: 10, day: 26, hour: 2, minute: 30, second: 0 }, 'Europe/Berlin')).toEqual({ kind: 'ambiguous', earlier: Date.UTC(2025, 9, 26, 0, 30), later: Date.UTC(2025, 9, 26, 1, 30) })
	// 01:30 happens twice on 2025-11-02 in New York.
	expect(wallTimeToInstant({ year: 2025, month: 11, day: 2, hour: 1, minute: 30, second: 0 }, 'America/New_York')).toEqual({ kind: 'ambiguous', earlier: Date.UTC(2025, 10, 2, 5, 30), later: Date.UTC(2025, 10, 2, 6, 30) })
	// São Paulo had daylight saving time until 2019: midnight of 2018-11-04 was skipped.
	expect(wallTimeToInstant({ year: 2018, month: 11, day: 4, hour: 0, minute: 30, second: 0 }, 'America/Sao_Paulo')).toEqual({ kind: 'nonexistent' })
})
