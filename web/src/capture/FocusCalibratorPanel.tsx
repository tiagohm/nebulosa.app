import { PanelSection, PlannedControls } from '../shell/ContextualPanel'

// Contextual panel of the Focus Calibrator mode: exposures of the main camera at focuser positions,
// measuring focus quality to find the best position. Charts appear only once real data exists.

// Focus Calibrator controls.
export function FocusCalibratorPanel() {
	return (
		<>
			<PanelSection title="Exposure">
				<PlannedControls items={['Exposure time', 'Gain and offset']} />
			</PanelSection>
			<PanelSection title="Focuser">
				<PlannedControls items={['Position', 'Step size and range']} />
			</PanelSection>
			<PanelSection title="Focus Quality">
				<PlannedControls items={['HFD and FWHM', 'Focus curve', 'Best position']} />
			</PanelSection>
		</>
	)
}
