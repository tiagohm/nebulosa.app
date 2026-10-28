import type { AnnotationImageContext, AnnotationJob, AnnotationKind, AnnotationResult } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { annotationsState, latestAnnotationJob, latestAnnotationResult, loadAnnotationContext, loadAnnotationResult, loadImageAnnotations } from './annotations'

// Hooks of the annotations of an image, shared by the Images workspace and its Annotation tool: the latest job of a kind
// of the image id and its result, fetched once the job completed, so only the images on screen ever download their
// objects (an image without a known job has its kept jobs fetched once), and the observation date and site its header
// gives, fetched once per image.

// Latest annotation of an image.
export interface AnnotationResultView {
	// Latest job of the image, if any.
	readonly job?: AnnotationJob
	// Its result, once completed and fetched.
	readonly result?: AnnotationResult
	// Why the result of the completed job could not be fetched.
	readonly resultError?: string
}

// Returns the latest annotation of a kind (the local one by default) of an image, fetching its result when needed;
// nothing without an image.
export function useAnnotationResult(imageId: string | undefined, kind: AnnotationKind = 'local'): AnnotationResultView {
	const annotations = useSnapshot(annotationsState)
	const job = imageId === undefined ? undefined : latestAnnotationJob(annotations, imageId, kind)
	const completed = job?.state === 'completed' ? job.jobId : undefined

	useEffect(() => {
		if (completed) void loadAnnotationResult(annotationsState, completed)
	}, [completed])

	useEffect(() => {
		if (imageId && !job) void loadImageAnnotations(annotationsState, imageId)
	}, [imageId, !job])

	if (!imageId || !job) return {}
	// A result is a valtio ref, so the snapshot hands out the stored object itself, never a deep copy.
	return { job, result: latestAnnotationResult(annotations, imageId, kind), resultError: completed && annotations.resultErrors[completed] }
}

// Returns the observation date and site the header of an image gives, which a minor-body search of it uses, fetching
// them once; nothing without an image or before they arrive.
export function useAnnotationContext(imageId: string | undefined): AnnotationImageContext | undefined {
	const annotations = useSnapshot(annotationsState)

	useEffect(() => {
		if (imageId) void loadAnnotationContext(annotationsState, imageId)
	}, [imageId])

	// A context is a valtio ref, so the snapshot hands out the stored object itself.
	return imageId === undefined ? undefined : annotations.contexts[imageId]
}
