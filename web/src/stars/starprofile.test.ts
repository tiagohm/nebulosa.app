import { describe, expect, test } from 'bun:test'
import type { StarProfileMeasured, StarProfileNoStar, StarProfileResult } from 'api'
import { proxy } from 'valtio'
import { clearStarProfile, type ImagesState, newView } from '../images/images'
import { inspectStar, measuredStar, previewPixels, profileEllipse, reinspectStar, starProfileOf } from './starprofile'
import { DEFAULT_STAR_PROFILE_SETTINGS, sameMeasurement } from './starprofile.settings'

const KEY = 'document'
const IMAGE = 'image'
const POINT = { x: 10.5, y: 20.5 }

const MEASURED = {
	status: 'measured',
	imageId: IMAGE,
	seed: POINT,
	requestedModel: 'moffat',
	profile: { x: 11, y: 20, valid: true, quality: 1, model: 'moffat', flags: [], hfd: 3 },
	horizontal: { offsets: [0], values: [1] },
	vertical: { offsets: [0], values: [1] },
	preview: { left: 0, top: 0, width: 1, height: 1, samples: [0.5] },
	conversion: { unit: 'adu', scale: 65535, offset: 0, rescaled: false },
	saturationKnown: true,
} as const satisfies StarProfileMeasured

const NO_STAR: StarProfileNoStar = { status: 'noStar', imageId: IMAGE, seed: POINT, reason: 'noPeak' }

// Images state of one document.
function state() {
	return proxy<ImagesState>({ documents: [], views: { [KEY]: newView() }, tools: {} })
}

// Fake fetch whose requests are answered by the test, and the requests it received.
function deferredFetch() {
	const calls: { readonly url: string; readonly body: Record<string, unknown>; readonly signal: AbortSignal; readonly answer: (result: StarProfileResult, status?: number) => void; readonly fail: (error: unknown) => void }[] = []

	// As the browser's fetch, which refuses to be called as a method of anything else.
	const request = function (this: unknown, url: string, init: RequestInit) {
		if (this !== undefined) throw new TypeError('Illegal invocation')
		const { promise, resolve, reject } = Promise.withResolvers<Response>()
		calls.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown>, signal: init.signal!, answer: (result, status = 200) => resolve(Response.json(result, { status })), fail: reject })
		return promise
	} as unknown as typeof fetch

	return { calls, request }
}

describe('inspectStar', () => {
	test('asks for the star near the point and keeps the answer', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		const done = inspectStar(images, KEY, IMAGE, POINT, undefined, DEFAULT_STAR_PROFILE_SETTINGS, request)

		expect(images.views[KEY].starProfile).toMatchObject({ imageId: IMAGE, status: 'measuring' })
		expect(calls[0].url).toBe('/api/images/image/star-profile')
		expect(calls[0].body).toEqual({ x: 10.5, y: 20.5, model: 'moffat', searchRadius: 8, maximumRadius: 32, minSNR: 5 })

		calls[0].answer(MEASURED)
		await done

		expect(images.views[KEY].starProfile).toMatchObject({ status: 'measured', controller: undefined })
		expect(measuredStar(images.views[KEY].starProfile)).toEqual(MEASURED)
	})

	test('says when a detection already found the star', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		const done = inspectStar(images, KEY, IMAGE, POINT, 3.2, DEFAULT_STAR_PROFILE_SETTINGS, request)

		expect(calls[0].body.detectedHfd).toBe(3.2)
		calls[0].answer(MEASURED)
		await done
	})

	test('keeps why no star was found, with no measured star', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		const done = inspectStar(images, KEY, IMAGE, POINT, undefined, DEFAULT_STAR_PROFILE_SETTINGS, request)
		calls[0].answer(NO_STAR)
		await done

		expect(images.views[KEY].starProfile?.status).toBe('noStar')
		expect(measuredStar(images.views[KEY].starProfile)).toBeUndefined()
	})

	test('a newer measurement aborts the one before it, and a late answer of that one is dropped', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		const first = inspectStar(images, KEY, IMAGE, POINT, undefined, DEFAULT_STAR_PROFILE_SETTINGS, request)
		const second = inspectStar(images, KEY, IMAGE, { x: 50, y: 60 }, undefined, DEFAULT_STAR_PROFILE_SETTINGS, request)

		expect(calls[0].signal.aborted).toBeTrue()
		expect(calls[1].signal.aborted).toBeFalse()

		calls[1].answer(NO_STAR)
		await second
		calls[0].answer(MEASURED)
		await first

		expect(images.views[KEY].starProfile?.status).toBe('noStar')
	})

	test('an answer arriving after the state was cleared never comes back', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		const done = inspectStar(images, KEY, IMAGE, POINT, undefined, DEFAULT_STAR_PROFILE_SETTINGS, request)

		clearStarProfile(images.views[KEY])
		expect(calls[0].signal.aborted).toBeTrue()

		calls[0].answer(MEASURED)
		await done
		expect(images.views[KEY].starProfile).toBeUndefined()
	})

	test('an answer for a document closed meanwhile is dropped', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		const done = inspectStar(images, KEY, IMAGE, POINT, undefined, DEFAULT_STAR_PROFILE_SETTINGS, request)

		delete images.views[KEY]
		calls[0].answer(MEASURED)
		await done
		expect(images.views[KEY]).toBeUndefined()
	})

	test('a failure is kept with its message', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		const done = inspectStar(images, KEY, IMAGE, POINT, undefined, DEFAULT_STAR_PROFILE_SETTINGS, request)
		calls[0].fail(new Error('unreachable'))
		await done

		expect(images.views[KEY].starProfile).toMatchObject({ status: 'failed', error: 'unreachable' })
	})

	test('a failed response keeps the message of the API', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		const done = inspectStar(images, KEY, IMAGE, POINT, undefined, DEFAULT_STAR_PROFILE_SETTINGS, request)
		calls[0].answer({ error: 'Image not found', code: 'notFound' } as unknown as StarProfileResult, 404)
		await done

		expect(images.views[KEY].starProfile).toMatchObject({ status: 'failed', error: 'Image not found' })
	})
})

describe('reinspectStar', () => {
	test('measures the same point with new settings, keeping how the star was found', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		const first = inspectStar(images, KEY, IMAGE, POINT, 3.2, DEFAULT_STAR_PROFILE_SETTINGS, request)
		calls[0].answer(MEASURED)
		await first

		const again = reinspectStar(images, KEY, { ...DEFAULT_STAR_PROFILE_SETTINGS, model: 'moments', minSNR: 3 }, request)
		expect(calls[1].body).toEqual({ x: 10.5, y: 20.5, detectedHfd: 3.2, model: 'moments', searchRadius: 8, maximumRadius: 32, minSNR: 3 })
		calls[1].answer(MEASURED)
		await again
	})

	test('does nothing without a star', async () => {
		const images = state()
		const { calls, request } = deferredFetch()
		await reinspectStar(images, KEY, DEFAULT_STAR_PROFILE_SETTINGS, request)
		expect(calls).toHaveLength(0)
	})
})

test('a measurement is shown only for the image it measured', () => {
	const view = { starProfile: { imageId: IMAGE } }

	expect(starProfileOf(view, IMAGE)).toBe(view.starProfile)
	expect(starProfileOf(view, 'next frame')).toBeUndefined()
	expect(starProfileOf({}, undefined)).toBeUndefined()
	expect(starProfileOf(undefined, IMAGE)).toBeUndefined()
})

test('two settings ask for the same measurement unless a measured value differs', () => {
	expect(sameMeasurement(DEFAULT_STAR_PROFILE_SETTINGS, { ...DEFAULT_STAR_PROFILE_SETTINGS })).toBeTrue()
	expect(sameMeasurement(DEFAULT_STAR_PROFILE_SETTINGS, { ...DEFAULT_STAR_PROFILE_SETTINGS, minSNR: 3 })).toBeFalse()
	expect(sameMeasurement(DEFAULT_STAR_PROFILE_SETTINGS, { ...DEFAULT_STAR_PROFILE_SETTINGS, model: 'moments' })).toBeFalse()
})

test('the ellipse holds half of each FWHM axis, rotated in degrees', () => {
	expect(profileEllipse({ major: 6, minor: 4, theta: Math.PI / 2 })).toEqual({ rx: 3, ry: 2, rotation: 90 })
	expect(profileEllipse({ major: 4, minor: 4 })).toEqual({ rx: 2, ry: 2, rotation: 0 })
	expect(profileEllipse({ major: undefined, minor: 4 })).toBeUndefined()
})

test('the preview is gray from low to high, clipped outside, and transparent where a sample is not finite', () => {
	expect(Array.from(previewPixels({ samples: [0, 0.4, 1, 2, null] }, 0, 1))).toEqual([0, 0, 0, 255, 102, 102, 102, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0])
	expect(Array.from(previewPixels({ samples: [0.2] }, 0.2, 0.2)).at(-1)).toBe(255)
})
