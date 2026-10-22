import type { StarDetectionJob, StarDetectionResult } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { latestJob, latestResult, loadResult, starsState } from './stars'

// Hook of the latest star detection of an image, shared by the views that show one (the Images workspace
// and Camera Capture): it returns the latest job of the image id and its result, and fetches the result
// once the job completed, so only the images on screen ever download their stars.

// Latest star detection of an image.
export interface StarResultView {
	// Latest job of the image, if any.
	readonly job?: StarDetectionJob
	// Its result, once completed and fetched.
	readonly result?: StarDetectionResult
	// Why the result of the completed job could not be fetched.
	readonly resultError?: string
}

// Returns the latest star detection of an image, fetching its result when needed; nothing without an image.
export function useStarResult(imageId: string | undefined): StarResultView {
	const stars = useSnapshot(starsState)
	const job = imageId === undefined ? undefined : latestJob(stars, imageId)
	const completed = job?.state === 'completed' ? job.jobId : undefined

	useEffect(() => {
		if (completed) void loadResult(starsState, completed)
	}, [completed])

	if (!imageId || !job) return {}
	// A result is a valtio ref, so the snapshot hands out the stored object itself, never a deep copy.
	return { job, result: latestResult(stars, imageId), resultError: completed && stars.resultErrors[completed] }
}
