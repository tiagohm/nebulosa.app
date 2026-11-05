import { LiveStackingSections } from '../camera/LiveStackingPanel'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Live Stacking tool of an Images camera tab: the live stacking session of the tab's physical camera, which integrates
// the frames Camera Acquisition takes with it. The tab shows its stacks or their color composition in place of the
// latest frame when selected, and switching tool, frame, or tab never stops the session, which runs on the server.

// Live Stacking contextual panel.
export function LiveStackingTool({ camera, document }: ImageToolPanelProps) {
	if (!camera || !document) return <EmptyState title="No camera tab" description="Select a camera tab to stack the frames of its camera." />
	return <LiveStackingSections document={document} camera={camera} />
}
