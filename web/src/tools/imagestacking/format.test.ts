import { describe, expect, test } from 'bun:test'
import type { StackingImportCandidate } from 'api'
import { candidateText, candidateUsable, committedCounts, groupLabel, integrationText } from './format'

function candidate(path: string, patch: Partial<StackingImportCandidate> = {}): StackingImportCandidate {
	return { path, name: path, bytes: 1, mtimeMillis: 1, format: 'fits', role: 'light', warnings: [], known: false, ...patch }
}

describe('format', () => {
	test('integration times read in minutes below an hour and in hours above', () => {
		expect(integrationText(0)).toBe('0 min 0 s')
		expect(integrationText(905)).toBe('15 min 5 s')
		expect(integrationText(3600 * 2 + 15 * 60 + 20)).toBe('2 h 15 min')
		expect(groupLabel('', 'whatever')).toBe('Unassigned')
		expect(groupLabel('ha', 'Ha')).toBe('Ha')
	})

	test('candidates explain why they stay out, and the commit counts what enters', () => {
		const items = [candidate('a'), candidate('b', { role: 'unclassified' }), candidate('c', { role: 'unclassified' }), candidate('d', { rejected: 'A dark frame, not a light frame', role: undefined }), candidate('e', { known: true }), candidate('f', { error: 'Broken', role: undefined })]
		expect(items.map(candidateText)).toEqual(['Light', 'Unclassified', 'Unclassified', 'A dark frame, not a light frame', 'Already in this project', 'Broken'])
		expect(items.map(candidateUsable)).toEqual([true, true, true, false, false, false])
		expect(committedCounts(items, new Set(['b', 'd']))).toEqual({ lights: 2, unclassified: 1 })
	})
})
