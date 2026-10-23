import { useSnapshot } from 'valtio'
import { AutoFocusSections } from '../capture/AutoFocusPanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Auto Focus tool of an Images camera tab: the Auto Focus panel of the tab's physical camera, moving the focuser its
// context associates with it (none unless it is the Main Camera of the equipment setup). Its frames reach the tab
// through the latest frame of the camera and its curve is drawn below the viewer, so switching tool, frame, or tab
// never stops a session, which runs on the server.

// Auto Focus contextual panel.
export function AutoFocusTool({ camera }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to focus with its camera." />
	return <AutoFocusSections device={camera.device.device} availability={deviceAvailability('camera', camera.device, operations)} focuser={camera.focuser} settings={camera.settings} snoop={camera.snoop} />
}
