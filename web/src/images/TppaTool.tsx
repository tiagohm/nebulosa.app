import { useSnapshot } from 'valtio'
import { TppaSections } from '../camera/TppaPanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// TPPA tool of an Images camera tab: the three-point polar alignment panel of the tab's physical camera, rotating the
// mount its context associates with it (the setup's MOUNT). Its frames reach the tab through the latest frame of the
// camera with the correction guide over them, so switching tool, frame, or tab never stops a session, which runs on
// the server.

// TPPA contextual panel.
export function TppaTool({ camera }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to align the mount with its camera." />
	return <TppaSections device={camera.device.device} availability={deviceAvailability('camera', camera.device, operations)} mount={camera.mount} settings={camera.settings} />
}
