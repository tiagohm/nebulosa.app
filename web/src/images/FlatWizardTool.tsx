import { useSnapshot } from 'valtio'
import { FlatWizardSections } from '../camera/FlatWizardPanel'
import { deviceAvailability } from '../equipment/availability'
import { operationsState } from '../operations'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Flat Wizard tool of an Images camera tab: the flat acquisition panel of the tab's physical camera, moving the filter
// wheel and lighting the flat panel its context associates with it (the setup's FILTER_WHEEL and FLAT_PANEL when the
// camera has a role). Its frames reach the tab as the latest frame of the camera, so switching tool, frame, or tab
// never stops a session, which runs on the server.

// Flat Wizard contextual panel.
export function FlatWizardTool({ camera }: ImageToolPanelProps) {
	const operations = useSnapshot(operationsState)
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to take flats with its camera." />
	return <FlatWizardSections device={camera.device.device} availability={deviceAvailability('camera', camera.device, operations)} wheel={camera.wheel} flatPanel={camera.flatPanel} settings={camera.settings} snoop={camera.snoop} />
}
