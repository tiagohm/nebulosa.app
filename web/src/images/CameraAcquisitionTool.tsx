import { useSnapshot } from 'valtio'
import { CameraAcquisitionSections } from '../camera/CameraCapturePanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Camera Acquisition tool of an Images camera tab: the acquisition panel of the tab's physical camera, editing that
// camera's forms and snooping the devices its context associates with it. Its frames reach the tab through the latest
// frame of the camera, so switching tool, frame, or tab never stops a capture, which runs on the server.

// Camera Acquisition contextual panel.
export function CameraAcquisitionTool({ camera }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to take frames with its camera." />
	return <CameraAcquisitionSections device={camera.device.device} availability={deviceAvailability('camera', camera.device, operations)} settings={camera.settings} snoop={camera.snoop} />
}
