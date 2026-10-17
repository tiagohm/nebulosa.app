import { PanelSection, PlannedControls } from '../shell/ContextualPanel'

// Contextual panel of the Polar Alignment mode: captures and plate solves at mount positions to measure
// the polar axis error and guide its correction. The steps are owned by the future alignment service.

// Polar Alignment controls.
export function PolarAlignmentPanel() {
	return (
		<>
			<PanelSection title="Steps">
				<PlannedControls items={['Capture and solve', 'Rotate the mount', 'Measure the error', 'Adjust and refine']} />
			</PanelSection>
			<PanelSection title="Plate Solving">
				<PlannedControls items={['Solver', 'Solution']} />
			</PanelSection>
			<PanelSection title="Result">
				<PlannedControls items={['Azimuth error', 'Altitude error']} />
			</PanelSection>
		</>
	)
}
