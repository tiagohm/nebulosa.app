import type { AnnotationJob, AnnotationResult } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { annotationsState, latestAnnotationJob, latestAnnotationResult, loadAnnotationResult, loadImageAnnotations } from './annotations'

// Hook of the latest annotation of an image, shared by the Images workspace and its Annotation tool: it returns the
// latest job of the image id and its result, and fetches the result once the job completed, so only the images on
// screen ever download their objects. An image without a known job has its kept jobs fetched once.

// Latest annotation of an image.
export interface AnnotationResultView {
	// Latest job of the image, if any.
	readonly job?: AnnotationJob
	// Its result, once completed and fetched.
	readonly result?: AnnotationResult
	// Why the result of the completed job could not be fetched.
	readonly resultError?: string
}

// Returns the latest annotation of an image, fetching its result when needed; nothing without an image.
export function useAnnotationResult(imageId: string | undefined): AnnotationResultView {
	const annotations = useSnapshot(annotationsState)
	const job = imageId === undefined ? undefined : latestAnnotationJob(annotations, imageId)
	const completed = job?.state === 'completed' ? job.jobId : undefined

	useEffect(() => {
		if (completed) void loadAnnotationResult(annotationsState, completed)
	}, [completed])

	useEffect(() => {
		if (imageId && !job) void loadImageAnnotations(annotationsState, imageId)
	}, [imageId, !job])

	if (!imageId || !job) return {}
	// A result is a valtio ref, so the snapshot hands out the stored object itself, never a deep copy.
	return { job, result: latestAnnotationResult(annotations, imageId), resultError: completed && annotations.resultErrors[completed] }
}
