import { PanelSection, PlannedControls } from '../shell/ContextualPanel'

// Contextual panel sections of the Camera Capture mode: exposure settings and capture actions of the main
// camera. The required equipment and the operation state are added by ModePanel.

// Camera Capture controls.
export function CameraPanel() {
	return (
		<>
			<PanelSection title="Exposure">
				<PlannedControls items={['Exposure time', 'Frame type', 'Gain and offset', 'Binning and ROI']} />
			</PanelSection>
			<PanelSection title="Capture">
				<PlannedControls items={['Single capture', 'Loop capture', 'Abort']} />
			</PanelSection>
			<PanelSection title="Statistics">
				<PlannedControls items={['Mean, median, and deviation', 'Minimum and maximum']} />
			</PanelSection>
		</>
	)
}
