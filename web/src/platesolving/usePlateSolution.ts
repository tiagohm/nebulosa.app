import type { PlateSolveJob, PlateSolveResult } from 'api'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { latestJob, loadPlateSolveResult, loadSolutions, plateSolvingState, selectedJob, selectedSolution } from './platesolving'

// Hook of the plate solution of an image a view shows, shared by the Images workspace and Camera Capture: it returns the
// selected job of the image id (or the job of its latest solution), its result and solution once fetched, the latest
// job of the image whatever its state, and the solution of the header. It fetches the solutions of the image once and
// the result of a completed job when shown, so only the images on screen ever download a WCS.

// Plate solution of an image as a view shows it.
export interface PlateSolutionView {
	// Job shown: the selected one, or the job of the latest solution of the image; absent for the header solution.
	readonly job?: PlateSolveJob
	// Latest job of the image, which may be running or have ended without a solution.
	readonly latest?: PlateSolveJob
	// Its result, once completed and fetched.
	readonly result?: PlateSolveResult
	// Solution drawn: the job's when it solved, or the header's when selected.
	readonly solution?: PlateSolution
	// Solution of the header of the image, once fetched; absent when it has none.
	readonly header?: PlateSolution
	// Why the result of the completed job could not be fetched.
	readonly resultError?: string
}

// Returns the plate solution of an image a view shows, for a selection (a job id, 'header', or its latest solution when
// undefined), fetching what is needed; nothing without an image.
export function usePlateSolution(imageId: string | undefined, selected?: string): PlateSolutionView {
	const state = useSnapshot(plateSolvingState)
	const job = imageId === undefined ? undefined : selectedJob(state, imageId, selected)
	const completed = job?.state === 'completed' ? job.jobId : undefined

	useEffect(() => {
		if (imageId) void loadSolutions(plateSolvingState, imageId)
	}, [imageId])

	useEffect(() => {
		if (completed) void loadPlateSolveResult(plateSolvingState, completed)
	}, [completed])

	if (!imageId) return {}
	// Results and headers are valtio refs, so the snapshot hands out the stored objects themselves.
	const header = state.headers[imageId] ?? undefined
	const result = completed ? state.results[completed] : undefined
	return { job, latest: latestJob(state, imageId), result, solution: selectedSolution(state, imageId, selected), header, resultError: completed && state.resultErrors[completed] }
}
