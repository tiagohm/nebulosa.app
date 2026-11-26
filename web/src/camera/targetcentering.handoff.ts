import type { OperationDevice } from 'api'
import { deg } from 'nebulosa/src/math/units/angle'
import { cameraTabKey } from '../images/cameratabs'
import type { ImageDocument } from '../images/images'
import { openCameraTool } from '../images/opencameratool'
import { cameraKey } from './capture'
import { type TargetCenteringDraft, type TargetCenteringRuntime, targetCenteringRunning, targetCenteringRuntime } from './targetcentering'

// Hand-off of a target, an orientation, or both, from another tool (the Sky's framings, a solved image of Images) into
// the Target Centering form of the Main Camera, which it then shows in its camera tab. It only fills the form: nothing is
// commanded, and Center still asks before moving anything. The form of a camera whose session runs is never replaced.

// Replaces the target being edited for a camera (by camera key), clearing a refusal that spoke for the previous one.
export function setTargetCenteringDraft(runtime: TargetCenteringRuntime, key: string, draft: TargetCenteringDraft) {
	runtime.drafts[key] = draft
	delete runtime.errors[key]
}

// Merges patch into the form of a camera, keeping the fields it does not give, and shows the camera's Target Centering
// through open (openCameraTool).
export function sendToTargetCentering(camera: OperationDevice, patch: Partial<TargetCenteringDraft>, runtime: TargetCenteringRuntime = targetCenteringRuntime, open: typeof openCameraTool = openCameraTool) {
	const key = cameraKey(camera.connectionId, camera.deviceId)
	setTargetCenteringDraft(runtime, key, { ...runtime.drafts[key], ...patch })
	open(camera.connectionId, camera.deviceId, 'target-centering')
}

// Returns why the Main Camera (camera; absent when the Equipment Setup assigns none on the watched connection) cannot take a
// hand-off now, or undefined when it can: it needs a tab in Images (documents), and a session of it that ended.
export function targetCenteringHandoffBlocker(documents: readonly Pick<ImageDocument, 'key'>[], runtime: Pick<TargetCenteringRuntime, 'sessions'>, camera: OperationDevice | undefined): string | undefined {
	if (!camera) return 'Assign a connected Main Camera in the Equipment Setup.'
	if (!documents.some(({ key }) => key === cameraTabKey(camera.connectionId, camera.deviceId))) return 'The Main Camera has no tab in Images; connect it first.'
	if (targetCenteringRunning(runtime.sessions[cameraKey(camera.connectionId, camera.deviceId)])) return 'The Main Camera is centering; wait for its session to end.'
	return undefined
}

// Returns the position angle of the image top a framing plans, in radians within [0, 2π), from its rotation in degrees.
export function framingAngle(rotation: number) {
	return deg(((rotation % 360) + 360) % 360)
}
