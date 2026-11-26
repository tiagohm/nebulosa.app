import { useSnapshot } from 'valtio'
import { TargetCenteringSections } from '../camera/TargetCenteringPanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Target Centering tool of an Images camera tab: centers or measures a target with the tab's physical camera and the mount
// its context associates with it (the setup's MOUNT), turning the setup's ROTATOR for an orientation when the camera is its
// Main Camera, which the rotator carries. Its frames reach the tab through the latest frame of the camera, so
// switching tool, frame, or tab never stops a session, which runs on the server.

// Target Centering contextual panel.
export function TargetCenteringTool({ camera, document }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to center a target with its camera." />
	return (
		<TargetCenteringSections
			device={camera.device.device}
			availability={deviceAvailability('camera', camera.device, operations)}
			mount={camera.mount}
			guideOutput={camera.mountGuideOutput}
			settings={camera.settings}
			{...(camera.role === 'MAIN_CAMERA' && camera.rotator && { rotator: camera.rotator })}
			guideRotationUnanswered={camera.guideRotationAsked && camera.guideCameraRotates === undefined}
			imageId={document?.info?.id}
		/>
	)
}
