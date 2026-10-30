import { expect, test } from 'bun:test'
import type { PointingModelSummary } from 'api'
import { cameraTabKey } from '../../images/cameratabs'
import { buildTarget, DEFAULT_FIT_FORM, fitOptions, fitRequest, listedModels } from './library'

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
