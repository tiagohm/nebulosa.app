import type { StreakDetectionJob, StreakDetectionResult } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { latestStreakJob, loadImageStreakJobs, loadStreakResult, shownStreakJob, shownStreakResult, streaksState } from './streaks'

// Hook of the streak detection of an image, shared by the Images workspace and its Streak Detection tool: it returns the
// latest job of the image id whatever its state, the job whose result is shown (the newest completed one, so a
// detection that runs, fails, or is cancelled keeps the earlier result), and that result, fetched once the job
// completed, so only the images on screen ever download their streaks. An image without a known job has its kept jobs
// fetched once.

// Streak detection of an image as a view shows it.
export interface StreakResultView {
	// Latest job of the image, whatever its state; absent when it has none.
	readonly latest?: StreakDetectionJob
	// Completed job whose result is shown, which may be older than the latest; absent when none completed.
	readonly job?: StreakDetectionJob
	// Its result, once fetched.
	readonly result?: StreakDetectionResult
	// Why its result could not be fetched.
	readonly resultError?: string
}

// Returns the streak detection of an image, fetching the result shown when needed; nothing without an image.
export function useStreakResult(imageId: string | undefined): StreakResultView {
	const streaks = useSnapshot(streaksState)
	const latest = imageId === undefined ? undefined : latestStreakJob(streaks, imageId)
	const job = imageId === undefined ? undefined : shownStreakJob(streaks, imageId)
	const completed = job?.jobId

	useEffect(() => {
		if (completed) void loadStreakResult(streaksState, completed)
	}, [completed])

	useEffect(() => {
		if (imageId && !latest) void loadImageStreakJobs(streaksState, imageId)
	}, [imageId, !latest])

	if (!imageId || !latest) return {}
	// A result is a valtio ref, so the snapshot hands out the stored object itself, never a deep copy.
	return { latest, job, result: shownStreakResult(streaks, imageId), resultError: completed && streaks.resultErrors[completed] }
}
