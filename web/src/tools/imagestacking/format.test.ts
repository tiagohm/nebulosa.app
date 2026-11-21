import { describe, expect, test } from 'bun:test'
import type { StackingFinding, StackingImportCandidate, StackingJobSummary } from 'api'
import {
	ALL_CANDIDATES,
	blocksAnalysis,
	byFilter,
	candidateChecked,
	candidateText,
	candidateUsable,
	cohortCalibration,
	cohortText,
	committedCounts,
	compositeText,
	isStackingSection,
	jobProgress,
	masterText,
	memoryText,
	metricText,
	NO_CANDIDATES,
	recipeText,
	registrationText,
	samplesText,
	selectionFields,
	selectionOf,
	stepStates,
	withCandidate,
} from './format'

function candidate(path: string, patch: Partial<StackingImportCandidate> = {}): StackingImportCandidate {
	return { path, name: path, bytes: 1, mtimeMillis: 1, format: 'fits', role: 'light', warnings: [], known: false, ...patch }
}

describe('integration', () => {
	test('sizes read in words', () => {
		expect([memoryText(1), memoryText(300 * 1024 ** 2), memoryText(3 * 1024 ** 3)]).toEqual(['1 MiB', '300 MiB', '3.0 GiB'])
	})
})

describe('planning', () => {
	test('thresholds at zero set nothing, and come back as zero', () => {
		const selection = selectionOf({ minStars: 20, minMedianSNR: 0, maxMedianHFD: 0, maxMedianEccentricity: 0, maxBackground: 0.05 })
		expect(selection).toEqual({ minStars: 20, maxBackground: 0.05 })
		expect(selectionFields(selection)).toEqual({ minStars: 20, minMedianSNR: 0, maxMedianHFD: 0, maxMedianEccentricity: 0, maxBackground: 0.05 })
	})

	test('measurements, registrations, masters, and cohorts read in words', () => {
		expect([metricText(2.345), metricText(null), metricText(undefined), metricText(Infinity), metricText(0.12345, 4)]).toEqual(['2.35', '—', '—', '—', '0.1235'])
		const summary = { model: 'similarity' as const, translationX: 5.04, translationY: -3, scaleX: 1, scaleY: 1, rotation: Math.PI / 180, shear: 0, mirrored: false, inlierCount: 30, rmsError: 0.123 }
		const transform = { a: 1, b: 0, tx: 5, ty: -3, mirrored: false }
		expect(registrationText({ success: true, transform: { transform, inverseTransform: transform, summary } })).toBe('5.0, -3.0 px · 1.00° · 0.12 px rms')
		expect(registrationText({ success: false, reason: 'match-failed' })).toBe('Failed: match-failed')
		expect(registrationText(undefined)).toBe('—')
		expect(masterText({ masterId: 12, createdAt: 0, frames: 30, status: 'warning' }, 'UTC')).toMatch(/^#12 · .+ · 30 frames · warnings$/)
		expect(masterText({ masterId: 3, createdAt: 0, frames: 1, status: 'ready' }, 'UTC')).toMatch(/^#3 · .+ · 1 frame$/)
		expect(cohortText({ groupKey: 'Ha', target: { width: 1, height: 1, channels: 1, exposure: 300 }, frames: 1 })).toBe('Ha · 300 s · 1 frame')
		expect(cohortText({ groupKey: 'Ha', target: { width: 1, height: 1, channels: 1 }, frames: 2 })).toBe('Ha · unknown exposure · 2 frames')
	})
})

describe('format', () => {
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

describe('steps', () => {
	const job = (patch: Partial<StackingJobSummary>): StackingJobSummary => ({ jobId: 'j', projectId: 'p', type: 'analysis', state: 'analyzing', createdAt: 0, updatedAt: 0, found: 10, bytes: 0, truncated: false, ...patch })
	const project = { lights: 13, unclassified: 0, unavailable: 0 }
	const groups = [
		{ key: 'L', usable: 4 },
		{ key: 'R', usable: 1 },
	]

	test('only a step the server knows is a step', () => {
		expect([isStackingSection('quality'), isStackingSection('results'), isStackingSection(undefined)]).toEqual([true, false, false])
	})

	test('each step says where it stands, unknown until fetched', () => {
		expect(stepStates({ project, running: {}, analyzed: false })).toEqual({ frames: { tone: 'success', label: '13 Lights' }, calibration: undefined, quality: { tone: 'muted', label: 'Not Measured' }, integration: undefined, composition: undefined })
		expect(stepStates({ project: { ...project, unclassified: 1 }, running: {}, analyzed: false }).frames?.label).toBe('Needs Review')
		expect(stepStates({ project: { ...project, lights: 0 }, running: {}, analyzed: false }).frames?.label).toBe('No Lights')

		const partial = stepStates({ project, groups, cohorts: [{ calibration: { dark: { masterId: 1, digest: 'd' }, flat: { masterId: 2, digest: 'f' } } }, {}], validation: { findings: [] }, products: [{ groupKey: 'L', status: 'ready' }], composites: [], running: {}, analyzed: true })
		expect([partial.calibration?.label, partial.quality?.label, partial.integration?.label, partial.composition?.label]).toEqual(['Partial', 'Measured', 'Partial', 'Not Composed'])

		const stale = stepStates({
			project,
			groups,
			cohorts: [{ calibration: { flat: { masterId: 2, digest: 'f' } } }],
			validation: { findings: [{ severity: 'blocker', code: 'analysisStale', message: '' }] },
			products: [{ groupKey: 'L', status: 'stale' }],
			composites: [{ status: 'stale' }],
			running: {},
			analyzed: true,
		})
		expect([stale.calibration?.label, stale.quality?.label, stale.integration?.label, stale.composition?.label]).toEqual(['Blocked', 'Stale', 'Stale', 'Stale'])

		const running = stepStates({ project, groups, products: [], composites: [], running: { analysis: true, integration: true, composition: true }, analyzed: false })
		expect([running.quality, running.integration, running.composition]).toEqual([
			{ tone: 'active', label: 'Running' },
			{ tone: 'active', label: 'Running' },
			{ tone: 'active', label: 'Running' },
		])
	})

	test('a cohort is calibrated only with a pedestal and a flat', () => {
		const dark = { masterId: 1, digest: 'd' }
		const flat = { masterId: 2, digest: 'f' }
		expect([cohortCalibration({ dark, flat }), cohortCalibration({ flat }), cohortCalibration({ bias: dark }), cohortCalibration({})].map((state) => state.label)).toEqual(['Calibrated', 'Needs a Dark or Bias', 'Partially Calibrated', 'Not Calibrated'])
	})

	test('a running job reads its stage, counts, and share', () => {
		expect(jobProgress(job({ measured: 4, failures: 1 }))).toEqual({ label: 'Measuring frames · 4 of 10 · 1 not measured', fraction: 0.4 })
		expect(jobProgress(job({ registered: 3, registrationTotal: 12 }))).toEqual({ label: 'Registering frames · 3 of 12', fraction: 0.25 })
		expect(jobProgress(job({ type: 'integration', state: 'integrating', group: 'L', measured: 2, published: 0 }))).toEqual({ label: 'Integrating L · 2 of 10 frames read · 0 published', fraction: undefined })
		expect(jobProgress(job({ type: 'integration', state: 'integrating', group: 'L', measured: 10, rowsCombined: 50, rowsTotal: 200, published: 1 })).fraction).toBe(0.25)
		expect(jobProgress(job({ type: 'composition', state: 'composing', rowsCombined: 10, rowsTotal: 20 }))).toEqual({ label: 'Composing · 10 of 20 rows', fraction: 0.5 })
	})
})

describe('results', () => {
	test('recipes, plans, masters, and composites read in words', () => {
		expect(recipeText({ method: 'sigma-clip', weighting: 'snr', sigmaLower: 2.5, sigmaUpper: 3 })).toBe('Sigma Clip 2.5/3 σ · SNR weights')
		expect(recipeText({ method: 'median', weighting: 'none', sigmaLower: 3, sigmaUpper: 3 })).toBe('Median · Equal weights')
		expect([samplesText({ mode: 'online', stripRows: 100 }), samplesText({ mode: 'spill', stripRows: 1 }), samplesText({ mode: 'spill', stripRows: 64 })]).toEqual(['In memory', 'On disk, 1 row at a time', 'On disk, 64 rows at a time'])
		expect(
			byFilter([
				{ name: 'R', createdAt: 1 },
				{ name: 'L', createdAt: 1 },
				{ name: 'L', createdAt: 2 },
			]),
		).toEqual([
			{ name: 'L', createdAt: 2 },
			{ name: 'L', createdAt: 1 },
			{ name: 'R', createdAt: 1 },
		])
		const masters = [
			{ productId: 'r', name: 'R' },
			{ productId: 'g', name: 'G' },
		]
		const sources = [
			{ productId: 'r', plane: 0, gain: 1, offset: 0 },
			{ productId: 'x', plane: 0, gain: 1, offset: 0 },
		]
		expect(compositeText({ composition: { preset: 'RGB', sources, mix: { red: [], green: [], blue: [] } } }, masters)).toBe('RGB · R + Deleted')
		expect(compositeText({ composition: { preset: 'Custom', sources: [], mix: { red: [], green: [], blue: [] } } }, masters)).toBe('Custom')
		expect(metricText(2.345, 2, 'px')).toBe('2.35 px')
		expect(metricText(undefined, 2, 'px')).toBe('—')
	})
})
