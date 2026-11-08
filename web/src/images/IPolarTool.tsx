import { useSnapshot } from 'valtio'
import { IPolarSections } from '../camera/IPolarPanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// iPolar tool of an Images camera tab: the camera-based polar alignment panel of the tab's physical camera, with the
// mount its context associates with it (the setup's MOUNT), needed only to turn the RA axis automatically. Its frames
// reach the tab through the latest frame of the camera with the axis and pole markers over them, so switching tool,
// frame, or tab never stops a session, which runs on the server.

// iPolar contextual panel.
export function IPolarTool({ camera }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to align the mount with its camera." />
	return <IPolarSections device={camera.device.device} availability={deviceAvailability('camera', camera.device, operations)} mount={camera.mount} settings={camera.settings} />
}
