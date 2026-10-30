import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useSnapshot } from 'valtio'
import type { ImageDocument } from '../images/images'
import type { AstrometryTarget } from '../platesolving/measurement'
import { cameraKey } from './capture'
import { type TargetCenteringRuntime, targetCenteringRuntime } from './targetcentering'

// What Target Offset draws for a centering session: the solution the session measured an image with, never the one chosen
// for manual inspection, so the overlay shows what the session saw.

// Target and solution of an image a session measured.
export interface TargetCenteringOverlayRecord {
	// Target of the session.
	readonly target: AstrometryTarget
	// Solution of the image, from the attempt that measured it.
	readonly solution: PlateSolution
}

// Returns what a session of the camera of a document measured on the image it shows now, or undefined.
export function targetCenteringOverlay(runtime: Pick<TargetCenteringRuntime, 'sessions' | 'details'>, document: Pick<ImageDocument, 'source' | 'info'> | undefined): TargetCenteringOverlayRecord | undefined {
	if (document?.source.kind !== 'camera' || !document.info) return undefined

	const session = runtime.sessions[cameraKey(document.source.connectionId, document.source.deviceId)]
	const details = session && runtime.details[session.sessionId]
	const imageId = document.info.id
	const attempt = details?.attempts.find((each) => each.imageId === imageId)
	const solution = attempt && details?.solutions[attempt.attempt]
	if (!solution) return undefined

	const { rightAscension, declination } = details.request.target
	return { target: { source: 'manual', rightAscension, declination }, solution }
}

// Returns what a session of the camera of a document measured on the image it shows now, following the store.
export function useTargetCenteringOverlay(document: Pick<ImageDocument, 'source' | 'info'> | undefined) {
	return targetCenteringOverlay(useSnapshot(targetCenteringRuntime), document)
}
