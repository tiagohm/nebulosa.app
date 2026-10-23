import { describe, expect, test } from 'bun:test'
import type { StarDetectionJob } from 'api'
import { imageQuality } from './quality'
import { DEFAULT_ASTAP_SETTINGS, DEFAULT_STAR_REQUEST } from './stars'

const AUTO_FOCUS = { kind: 'autofocus', sessionId: 's', connectionId: 'c', deviceId: 'cam', frameId: 's:3', capture: 3 } as const

function job(patch: Partial<StarDetectionJob> = {}): StarDetectionJob {
	return { jobId: 'job-1', imageId: 'image-1', origin: { kind: 'manual' }, request: DEFAULT_STAR_REQUEST, state: 'queued', queuedAt: 1000, ...patch }
}

// Star detection state holding one job as the latest of its image.
function holding(latest: StarDetectionJob) {
	return { jobs: { [latest.jobId]: latest }, latest: { [latest.imageId]: latest.jobId } }
}

describe('image quality', () => {
	test('an image without a known detection is not measured, never measured as zero', () => {
		const quality = imageQuality({ jobs: {}, latest: {} }, 'image-1')
		expect(quality).toEqual({ imageId: 'image-1', status: 'not-measured' })
		expect(quality.hfdPx).toBeUndefined()
	})

	test('a waiting or running detection is pending, without values', () => {
		expect(imageQuality(holding(job()), 'image-1')).toMatchObject({ status: 'pending', measurementId: 'job-1', provider: 'builtin' })
		expect(imageQuality(holding(job({ state: 'running' })), 'image-1').hfdPx).toBeUndefined()
	})

	test('the HFD of an Auto Focus measurement belongs to the frame it measured, with its provider and criteria', () => {
		const request = { ...DEFAULT_STAR_REQUEST, detector: { ...DEFAULT_ASTAP_SETTINGS } }
		const measured = job({ jobId: 'af', imageId: 'frame-3', origin: AUTO_FOCUS, request, state: 'completed', summary: { detectedCount: 40, acceptedCount: 31, aggregateHfd: 2.75, measurement: 'ok', elapsed: 120 } })
		const state = holding(measured)

		expect(imageQuality(state, 'frame-3')).toEqual({ imageId: 'frame-3', status: 'measured', measurementId: 'af', origin: 'autofocus', provider: 'astap', request, measurement: 'ok', hfdPx: 2.75, detectedStars: 40, acceptedStars: 31 })
		expect(imageQuality(state, 'frame-4')).toEqual({ imageId: 'frame-4', status: 'not-measured' })
	})

	test('a completed detection with too few stars is measured without an HFD', () => {
		const quality = imageQuality(holding(job({ state: 'completed', summary: { detectedCount: 2, acceptedCount: 2, measurement: 'unavailable', elapsed: 10 } })), 'image-1')
		expect(quality).toMatchObject({ status: 'measured', measurement: 'unavailable', acceptedStars: 2 })
		expect(quality.hfdPx).toBeUndefined()
	})

	test('a failed detection keeps why; a cancelled one is not a measurement', () => {
		expect(imageQuality(holding(job({ state: 'failed', error: 'ASTAP crashed' })), 'image-1')).toMatchObject({ status: 'failed', error: 'ASTAP crashed' })
		expect(imageQuality(holding(job({ state: 'cancelled' })), 'image-1')).toEqual({ imageId: 'image-1', status: 'not-measured' })
	})
})
