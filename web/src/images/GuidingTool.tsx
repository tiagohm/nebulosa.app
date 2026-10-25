import { useSnapshot } from 'valtio'
import { GuidingSections } from '../camera/GuidingPanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Guiding tool of an Images camera tab: the native guiding panel of the tab's physical camera, pulsing the guide output
// its context associates with it (the setup's GUIDE_OUTPUT, for the Guide Camera only). Its frames reach the tab as
// the latest frame of the camera with the guider's overlay drawn over them, so switching tool, frame, or tab never
// stops a session, which runs on the server.

// Guiding contextual panel.
export function GuidingTool({ camera }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to guide with its camera." />
	return <GuidingSections device={camera.device.device} availability={deviceAvailability('camera', camera.device, operations)} guideOutput={camera.guideOutput} mount={camera.mount} settings={camera.settings} snoop={camera.snoop} />
}
