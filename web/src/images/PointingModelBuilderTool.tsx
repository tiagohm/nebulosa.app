import { useSnapshot } from 'valtio'
import { PointingModelBuilderSections } from '../camera/PointingModelBuilderPanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Pointing Model Builder tool of an Images camera tab: acquires the samples of a mount pointing model with the tab's
// physical camera and the mount its context associates with it (the setup's MOUNT). Its frames reach the tab through the
// latest frame of the camera, so switching tool, frame, or tab never stops a session, which runs on the server.

// Pointing Model Builder contextual panel.
export function PointingModelBuilderTool({ camera }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to build a pointing model with its camera." />
	return <PointingModelBuilderSections device={camera.device.device} availability={deviceAvailability('camera', camera.device, operations)} role={camera.role} mount={camera.mount} settings={camera.settings} />
}
