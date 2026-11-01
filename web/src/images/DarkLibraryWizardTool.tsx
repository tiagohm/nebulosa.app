import { useSnapshot } from 'valtio'
import { DarkLibraryWizardSections } from '../camera/DarkLibraryWizardPanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Dark Library Wizard tool of an Images camera tab: the dark acquisition panel of the tab's physical camera, using the
// filter wheel, flat panel, and cover its context associates with it (the setup's FILTER_WHEEL, FLAT_PANEL, and COVER when
// the camera has a role). Its frames reach the tab as the latest frame of the camera, so switching tool, frame, or tab
// never stops a session, which runs on the server.

// Dark Library Wizard contextual panel.
export function DarkLibraryWizardTool({ camera }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to take darks with its camera." />
	return <DarkLibraryWizardSections device={camera.device.device} availability={deviceAvailability('camera', camera.device, operations)} wheel={camera.wheel} flatPanel={camera.flatPanel} cover={camera.cover} settings={camera.settings} snoop={camera.snoop} />
}
