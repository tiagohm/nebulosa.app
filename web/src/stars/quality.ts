import type { StarDetectionJob, StarDetectionOrigin, StarDetectionRequest, StarDetectorProvider, StarMeasurement } from 'api'
import { latestJob, type StarsState } from './stars'

// Quality of an image as the measurements already made on it describe it: the latest star detection of its image id,
// whoever asked for it (a manual run in Images or an Auto Focus measurement), so a value shown always belongs to the
// image measured and is never measured again only to be shown. Nothing is measured automatically. An HFD is in pixels
// and is only comparable between measurements of the same provider and acceptance criteria, which the summary keeps;
// absence of a measurement is never reported as zero. The model is the foundation of later per-frame quality history.

// State of the quality of an image:
// - not-measured: no detection of the image is known, or the latest one was cancelled or skipped.
// - pending: a detection is waiting or running.
// - measured: a detection completed; its HFD is present only when enough stars were accepted.
// - failed: the latest detection failed.
export type ImageQualityStatus = 'not-measured' | 'pending' | 'measured' | 'failed'

// Quality of one image.
export interface ImageQualitySummary {
	// Id of the image document measured.
	readonly imageId: string
	// State of the quality.
	readonly status: ImageQualityStatus
	// Id of the star detection job the values come from; absent when not measured.
	readonly measurementId?: string
	// Who asked for the measurement: manual, capture, or autofocus.
	readonly origin?: StarDetectionOrigin['kind']
	// Detector that measured it.
	readonly provider?: StarDetectorProvider
	// Detector settings and acceptance criteria of the measurement, which an HFD is only comparable under.
	readonly request?: StarDetectionRequest
	// Outcome of the aggregate HFD of a completed measurement.
	readonly measurement?: StarMeasurement
	// Median HFD of the accepted stars, in pixels; absent unless the measurement is ok.
	readonly hfdPx?: number
	// Stars the detector returned.
	readonly detectedStars?: number
	// Stars meeting the acceptance criteria.
	readonly acceptedStars?: number
	// Why the measurement failed, for people.
	readonly error?: string
}

// Returns the status of a job.
function statusOf(job: Pick<StarDetectionJob, 'state'>): ImageQualityStatus {
	switch (job.state) {
		case 'queued':
		case 'running':
			return 'pending'
		case 'completed':
			return 'measured'
		case 'failed':
			return 'failed'
		default:
			return 'not-measured'
	}
}

// Returns the quality of an image from the latest star detection known for its image id.
export function imageQuality(state: Pick<StarsState, 'jobs' | 'latest'>, imageId: string): ImageQualitySummary {
	const job = latestJob(state, imageId)
	if (!job) return { imageId, status: 'not-measured' }

	const status = statusOf(job)
	if (status === 'not-measured') return { imageId, status }

	const measured = { imageId, status, measurementId: job.jobId, origin: job.origin.kind, provider: job.request.detector.provider, request: job.request }
	if (status === 'failed') return { ...measured, ...(job.error !== undefined && { error: job.error }) }
	if (status === 'pending' || !job.summary) return measured

	const { measurement, aggregateHfd, detectedCount, acceptedCount } = job.summary
	return { ...measured, measurement, ...(measurement === 'ok' && aggregateHfd !== undefined && { hfdPx: aggregateHfd }), detectedStars: detectedCount, acceptedStars: acceptedCount }
}
