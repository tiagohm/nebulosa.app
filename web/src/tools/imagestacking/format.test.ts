import { describe, expect, test } from 'bun:test'
import type { StackingFinding, StackingImportCandidate } from 'api'
import { ALL_CANDIDATES, blocksAnalysis, candidateChecked, candidateText, candidateUsable, cohortText, NO_CANDIDATES, withCandidate, memoryText, runGroupText, committedCounts, integrationText, masterText, metricText, registrationText, selectionFields, selectionOf } from './format'

function candidate(path: string, patch: Partial<StackingImportCandidate> = {}): StackingImportCandidate {
	return { path, name: path, bytes: 1, mtimeMillis: 1, format: 'fits', role: 'light', warnings: [], known: false, ...patch }
}

describe('integration', () => {
	test('run outcomes and sizes read in words', () => {
		expect([runGroupText({ groupKey: 'l', name: 'L', frames: 3, productId: 'p', reused: true }), runGroupText({ groupKey: 'l', name: 'L', frames: 3, productId: 'p' }), runGroupText({ groupKey: 'l', name: 'L', frames: 3, error: 'A frame changed' }), runGroupText({ groupKey: 'l', name: 'L', frames: 3 })]).toEqual([
			'L: reused',
			'L: published',
			'L: A frame changed',
			'L: not integrated',
		])
		expect([memoryText(1), memoryText(300 * 1024 ** 2), memoryText(3 * 1024 ** 3)]).toEqual(['1 MiB', '300 MiB', '3.0 GiB'])
	})
})

describe('planning', () => {
	test('thresholds read from blank or unreadable fields set nothing, and come back as written', () => {
		const selection = selectionOf({ minStars: ' 20 ', minMedianSNR: '', maxMedianHFD: 'wide', maxBackground: '0.05' })
		expect(selection).toEqual({ minStars: 20, maxBackground: 0.05 })
		expect(selectionFields(selection)).toEqual({ minStars: '20', maxBackground: '0.05' })
	})

	test('measurements, registrations, masters, and cohorts read in words', () => {
		expect([metricText(2.345), metricText(null), metricText(undefined), metricText(Infinity), metricText(0.12345, 4)]).toEqual(['2.35', '—', '—', '—', '0.1235'])
		const summary = { model: 'similarity' as const, translationX: 5.04, translationY: -3, scaleX: 1, scaleY: 1, rotation: Math.PI / 180, shear: 0, mirrored: false, inlierCount: 30, rmsError: 0.123 }
		const transform = { a: 1, b: 0, tx: 5, ty: -3, mirrored: false }
		expect(registrationText({ success: true, transform: { transform, inverseTransform: transform, summary } })).toBe('5.0, -3.0 px · 1.00° · 0.12 px rms')
		expect(registrationText({ success: false, reason: 'match-failed' })).toBe('Failed: match-failed')
		expect(registrationText(undefined)).toBe('—')
		expect(masterText({ masterId: 12, createdAt: 0, frames: 30, status: 'warning' })).toMatch(/^#12 · .+ · 30 frames · warnings$/)
		expect(masterText({ masterId: 3, createdAt: 0, frames: 1, status: 'ready' })).toMatch(/^#3 · .+ · 1 frame$/)
		expect(cohortText({ groupKey: 'Ha', target: { width: 1, height: 1, channels: 1, exposure: 300 }, frames: 1 })).toBe('Ha · 300 s · 1 frame')
		expect(cohortText({ groupKey: 'Ha', target: { width: 1, height: 1, channels: 1 }, frames: 2 })).toBe('Ha · unknown exposure · 2 frames')
	})
})

describe('format', () => {
	test('integration times read in minutes below an hour and in hours above', () => {
		expect(integrationText(0)).toBe('0 min 0 s')
		expect(integrationText(905)).toBe('15 min 5 s')
		expect(integrationText(3600 * 2 + 15 * 60 + 20)).toBe('2 h 15 min')
	})

	test('candidates explain why they stay out, and the commit counts what enters', () => {
		const items = [candidate('a'), candidate('b', { role: 'unclassified' }), candidate('c', { role: 'unclassified' }), candidate('d', { rejected: 'A dark frame, not a light frame', role: undefined }), candidate('e', { known: true }), candidate('f', { error: 'Broken', role: undefined })]
		expect(items.map(candidateText)).toEqual(['Light', 'Unclassified', 'Unclassified', 'A dark frame, not a light frame', 'Already in this project', 'Broken'])
		expect(items.map(candidateUsable)).toEqual([true, true, true, false, false, false])
		expect(committedCounts({ lights: 1, unclassified: 2 }, ALL_CANDIDATES, 1)).toEqual({ lights: 2, unclassified: 1 })
		expect(committedCounts({}, ALL_CANDIDATES, 0)).toEqual({ lights: 0, unclassified: 0 })
	})

	test('a selection checks every candidate but its exceptions, or only them, across pages', () => {
		const skipping = withCandidate(withCandidate(ALL_CANDIDATES, 'a', 'light', false), 'b', 'unclassified', false)
		expect([candidateChecked(skipping, 'a'), candidateChecked(skipping, 'b'), candidateChecked(skipping, 'z')]).toEqual([false, false, true])
		expect(committedCounts({ lights: 5, unclassified: 2 }, skipping, 0)).toEqual({ lights: 4, unclassified: 1 })
		expect(withCandidate(skipping, 'a', 'light', true).except.has('a')).toBeFalse()

		const naming = withCandidate(withCandidate(NO_CANDIDATES, 'a', 'light', true), 'b', 'unclassified', true)
		expect([candidateChecked(naming, 'a'), candidateChecked(naming, 'z')]).toEqual([true, false])
		expect(committedCounts({ lights: 5, unclassified: 2 }, naming, 1)).toEqual({ lights: 2, unclassified: 0 })
	})
})

test('only a project without lights or a gone master blocks an analysis', () => {
	const finding = (severity: StackingFinding['severity'], code: StackingFinding['code'], groupKey?: string): StackingFinding => ({ severity, code, groupKey, message: '' })

	expect(blocksAnalysis(finding('blocker', 'noLights'))).toBe(true)
	expect(blocksAnalysis(finding('blocker', 'masterUnavailable', 'Ha'))).toBe(true)
	expect(blocksAnalysis(finding('blocker', 'noLights', 'Ha'))).toBe(false)
	expect(blocksAnalysis(finding('blocker', 'analysisStale', 'Ha'))).toBe(false)
	expect(blocksAnalysis(finding('blocker', 'masterIncompatible', 'Ha'))).toBe(false)
	expect(blocksAnalysis(finding('blocker', 'registrationFailed', 'Ha'))).toBe(false)
	expect(blocksAnalysis(finding('warning', 'partialCalibration', 'Ha'))).toBe(false)
})
