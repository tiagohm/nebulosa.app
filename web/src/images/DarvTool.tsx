import { useSnapshot } from 'valtio'
import { DarvSections } from '../camera/DarvPanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// DARV tool of an Images camera tab: the drift alignment panel of the tab's physical camera, moving the mount its
// context associates with it (the setup's MOUNT). Its frames reach the tab through the latest frame of the camera with
// the trails drawn over them, so switching tool, frame, or tab never stops a measurement, which runs on the server.

// DARV contextual panel.
export function DarvTool({ camera }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to align the mount with its camera." />
	return <DarvSections device={camera.device.device} availability={deviceAvailability('camera', camera.device, operations)} mount={camera.mount} settings={camera.settings} />
}
