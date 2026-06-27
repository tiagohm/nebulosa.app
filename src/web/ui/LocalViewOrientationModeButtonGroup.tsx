import type { LocalViewOrientationMode } from 'nebulosa/src/astronomy/events/eclipse/solar/local'
import { ButtonGroup, ButtonGroupItem, type ButtonGroupProps } from './components/ButtonGroup'

export function LocalViewOrientationModeButtonGroup(props: Omit<ButtonGroupProps<LocalViewOrientationMode>, 'children'>) {
	return (
		<ButtonGroup size="sm" {...props}>
			<ButtonGroupItem id="zenith" label="Zenith" />
			<ButtonGroupItem id="north" label="North" />
		</ButtonGroup>
	)
}
