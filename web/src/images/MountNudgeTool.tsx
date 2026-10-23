import { MountNudgeSections } from '../capture/MountNudgePanel'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Mount Nudge tool of an Images camera tab: the nudge panel of the mount the tab's context associates with its
// camera (the MOUNT of the active equipment setup), with the state of the tab's camera. The panel is mounted per tab,
// so switching tool or camera tab unmounts it and releases any press it holds; the viewer keeps showing the tab's
// frames, and nudging never needs a new exposure.

// Mount Nudge contextual panel.
export function MountNudgeTool({ camera }: ImageToolPanelProps) {
	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to move the mount associated with its camera." />
	return <MountNudgeSections mount={camera.mount} camera={camera.device.device} />
}
