import type { AnnotationImageContext, AnnotationJob, AnnotationKind, AnnotationResult } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { annotationsState, latestAnnotationJob, loadAnnotationContext, loadAnnotationResult, loadImageAnnotations, shownAnnotationJob, shownAnnotationResult } from './annotations'

// Hooks of the annotations of an image, shared by the Images workspace and its Annotation tool: the latest job of a kind
// of the image id whatever its state, the job of that kind whose result is shown (the newest completed one, so a run
// that waits, fails, or is cancelled keeps the earlier result), and that result, fetched once the job completed, so
// only the images on screen ever download their objects (an image without a known job has its kept jobs fetched
// once), and the observation date and site its header gives, fetched once per image.

// Annotation of a kind of an image as a view shows it.
export interface AnnotationResultView {
	// Latest job of the image, whatever its state; absent when it has none.
	readonly latest?: AnnotationJob
	// Completed job whose result is shown, which may be older than the latest; absent when none completed.
	readonly job?: AnnotationJob
	// Its result, once fetched.
	readonly result?: AnnotationResult
	// Why its result could not be fetched.
	readonly resultError?: string
}

// Returns the annotation of a kind (the local one by default) of an image, fetching the result shown when needed;
// nothing without an image.
export function useAnnotationResult(imageId: string | undefined, kind: AnnotationKind = 'local'): AnnotationResultView {
	const annotations = useSnapshot(annotationsState)
	const latest = imageId === undefined ? undefined : latestAnnotationJob(annotations, imageId, kind)
	const job = imageId === undefined ? undefined : shownAnnotationJob(annotations, imageId, kind)
	const completed = job?.jobId

	useEffect(() => {
		if (completed) void loadAnnotationResult(annotationsState, completed)
	}, [completed])

	useEffect(() => {
		if (imageId && !latest) void loadImageAnnotations(annotationsState, imageId)
	}, [imageId, !latest])

	if (!imageId || !latest) return {}
	// A result is a valtio ref, so the snapshot hands out the stored object itself, never a deep copy.
	return { latest, job, result: shownAnnotationResult(annotations, imageId, kind), resultError: completed && annotations.resultErrors[completed] }
}

// Returns the observation date and site the header of an image gives, which a solar-system search of it uses, fetching
// them once; nothing without an image or before they arrive.
export function useAnnotationContext(imageId: string | undefined): AnnotationImageContext | undefined {
	const annotations = useSnapshot(annotationsState)

	useEffect(() => {
		if (imageId) void loadAnnotationContext(annotationsState, imageId)
	}, [imageId])

	// A context is a valtio ref, so the snapshot hands out the stored object itself.
	return imageId === undefined ? undefined : annotations.contexts[imageId]
}
