import type { PlateSolveJob, PlateSolveResult } from 'api'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { loadPlateSolveResult, loadSolutions, plateSolvingState, selectedJob, selectedSolution } from './platesolving'

// Hook of the plate solution of an image a view shows, shared by the Images workspace and Camera Capture: it returns the
// selected (or latest) job of the image id, its result and solution once fetched, and the solution of the header. It
// fetches the solutions of the image once and the result of a completed job when shown, so only the images on screen
// ever download a WCS.

// Plate solution of an image as a view shows it.
export interface PlateSolutionView {
	// Job shown: the selected one, or the latest of the image; absent for the header solution.
	readonly job?: PlateSolveJob
	// Its result, once completed and fetched.
	readonly result?: PlateSolveResult
	// Solution drawn: the job's when it solved, or the header's when selected.
	readonly solution?: PlateSolution
	// Solution of the header of the image, once fetched; absent when it has none.
	readonly header?: PlateSolution
	// Why the result of the completed job could not be fetched.
	readonly resultError?: string
}

// Returns the plate solution of an image a view shows, for a selection (a job id, 'header', or the latest job when
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
	return { job, result, solution: selectedSolution(state, imageId, selected), header, resultError: completed && state.resultErrors[completed] }
}
