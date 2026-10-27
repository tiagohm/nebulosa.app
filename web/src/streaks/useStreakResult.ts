import type { StreakDetectionJob, StreakDetectionResult } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { latestStreakJob, latestStreakResult, loadImageStreakJobs, loadStreakResult, streaksState } from './streaks'

// Hook of the latest streak detection of an image, shared by the Images workspace and its Streak Detection tool: it
// returns the latest job of the image id and its result, and fetches the result once the job completed, so only the
// images on screen ever download their streaks. An image without a known job has its kept jobs fetched once.

// Latest streak detection of an image.
export interface StreakResultView {
	// Latest job of the image, if any.
	readonly job?: StreakDetectionJob
	// Its result, once completed and fetched.
	readonly result?: StreakDetectionResult
	// Why the result of the completed job could not be fetched.
	readonly resultError?: string
}

// Returns the latest streak detection of an image, fetching its result when needed; nothing without an image.
export function useStreakResult(imageId: string | undefined): StreakResultView {
	const streaks = useSnapshot(streaksState)
	const job = imageId === undefined ? undefined : latestStreakJob(streaks, imageId)
	const completed = job?.state === 'completed' ? job.jobId : undefined

	useEffect(() => {
		if (completed) void loadStreakResult(streaksState, completed)
	}, [completed])

	useEffect(() => {
		if (imageId && !job) void loadImageStreakJobs(streaksState, imageId)
	}, [imageId, !job])

	if (!imageId || !job) return {}
	// A result is a valtio ref, so the snapshot hands out the stored object itself, never a deep copy.
	return { job, result: latestStreakResult(streaks, imageId), resultError: completed && streaks.resultErrors[completed] }
}
