import { expect, test } from 'bun:test'
import type { PointingModelSummary, PointingRevision, PointingSampleRecord } from 'api'
import { cameraTabKey } from '../../images/cameratabs'
import { buildTarget, DEFAULT_FIT_FORM, draftFrom, fitOptions, fitRequest, listedModels, openingRevision, revisionNumber, sampleRows } from './library'

function model(modelId: string, hardwareId: string, createdAt: number) {
	return { modelId, createdAt, mount: { hardwareId } } as PointingModelSummary
}

const MODELS = { a: model('a', 'mine', 1), b: model('b', 'other', 2), c: model('c', 'mine', 3) }

test('a mount lists its own models, newest first, unless every model is asked for', () => {
	expect(listedModels(MODELS, 'mine', false).map((each) => each.modelId)).toEqual(['c', 'a'])
	expect(listedModels(MODELS, 'mine', true).map((each) => each.modelId)).toEqual(['c', 'b', 'a'])
	expect(listedModels(MODELS, undefined, false).map((each) => each.modelId)).toEqual(['c', 'b', 'a'])
})

test('a form at its defaults sends no options', () => {
	expect(fitOptions(DEFAULT_FIT_FORM)).toBeUndefined()
	expect(fitRequest(4, DEFAULT_FIT_FORM, new Set())).toEqual({ expectedRevision: 4, strategy: 'auto' })
})

test('a form sends what it changes, and the samples left out', () => {
	const request = fitRequest(4, { ...DEFAULT_FIT_FORM, strategy: 'hybrid', robust: 'none', altitudeTerms: false }, new Set(['s1']))
	expect(request).toEqual({ expectedRevision: 4, strategy: 'hybrid', options: { robust: { method: 'none' }, featureConfiguration: { includeAltitudeTerms: false } }, excludedSampleIds: ['s1'] })
})

test('building goes to the tab of the Main Camera exactly, never to another camera', () => {
	const camera = { id: 'cam', connectionId: 'c' }
	const key = cameraTabKey('c', 'cam')

	expect(buildTarget([{ key: 'other' }, { key }], camera)).toEqual({ key })
	expect(buildTarget([{ key: cameraTabKey('c', 'guide') }], camera)).toEqual({ reason: 'The Main Camera has no tab in Images; connect it first.' })
	expect(buildTarget([{ key }], undefined)).toEqual({ reason: 'No Main Camera is assigned in Equipment Setup.' })
})

function sample(id: string, waypoint: number, status: PointingSampleRecord['status'] = 'accepted') {
	return { id, waypoint, attempt: 1, status } as PointingSampleRecord
}

function revision(revisionId: string, patch: Partial<PointingRevision> = {}) {
	return { revisionId, request: 'auto', sampleIds: [], heldOutIds: [], residuals: [], ...patch } as unknown as PointingRevision
}

test('a refit starts from the revision shown: its strategy, its options, and the samples it left out', () => {
	const samples = [sample('a', 0), sample('b', 1), sample('c', 2), sample('r', 3, 'rejected')]
	const shown = revision('r2', { request: 'hybrid', options: { robust: { method: 'tukey' }, featureConfiguration: { includeAltitudeTerms: false } }, sampleIds: ['a'], heldOutIds: ['c'] })
	const draft = draftFrom(shown, samples)
	expect(draft.revisionId).toBe('r2')
	expect(draft.form).toEqual({ strategy: 'hybrid', robust: 'tukey', altitudeTerms: false, hourAngleTerms: true, declinationTerms: true })
	expect([...draft.excluded]).toEqual(['b'])
	expect(fitRequest(7, draft.form, draft.excluded)).toEqual({ expectedRevision: 7, strategy: 'hybrid', options: { robust: { method: 'tukey' }, featureConfiguration: { includeAltitudeTerms: false } }, excludedSampleIds: ['b'] })
})

test('a model never fitted drafts the defaults with every sample in', () => {
	const draft = draftFrom(undefined, [sample('a', 0)])
	expect(draft).toEqual({ form: DEFAULT_FIT_FORM, excluded: new Set() })
})

test('a model opens on its revision in force, else on its latest', () => {
	const model = { modelId: 'm', revisions: [revision('r1'), revision('r2'), revision('r3')] }
	expect(openingRevision(model, { modelId: 'm', revisionId: 'r1' })).toBe('r1')
	expect(openingRevision(model, { modelId: 'other', revisionId: 'r1' })).toBe('r3')
	expect(openingRevision(model, { modelId: 'm', revisionId: 'gone' })).toBe('r3')
	expect(openingRevision(model, undefined)).toBe('r3')
	expect(openingRevision({ modelId: 'm', revisions: [] }, undefined)).toBeUndefined()
	expect(revisionNumber(model, 'r2')).toBe(2)
	expect(revisionNumber(model, 'gone')).toBeUndefined()
})

test('samples are rows of accepted samples, by point or by the error left, largest first and unknown last', () => {
	const samples = [sample('c', 2), sample('a', 0), sample('x', 4, 'rejected'), sample('b', 1)]
	const shown = revision('r', {
		residuals: [
			{ id: 'a', heldOut: false, rawDx: 0, rawDy: 0, dx: 3, dy: 4 },
			{ id: 'c', heldOut: true, rawDx: 0, rawDy: 0, dx: 6, dy: 8 },
		],
	})
	expect(sampleRows(samples, shown, 'point').map((row) => [row.sample.id, row.error])).toEqual([
		['a', 5],
		['b', undefined],
		['c', 10],
	])
	expect(sampleRows(samples, shown, 'error').map((row) => row.sample.id)).toEqual(['c', 'a', 'b'])
	expect(sampleRows(samples, undefined, 'error').map((row) => row.sample.id)).toEqual(['a', 'b', 'c'])
})
