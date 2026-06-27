import type { LocalEclipseContactKind } from 'nebulosa/src/astronomy/events/eclipse/solar/local'
import { ButtonGroup, ButtonGroupItem, type ButtonGroupProps } from './components/ButtonGroup'

export function LocalEclipseContactKindButtonGroup(props: Omit<ButtonGroupProps<LocalEclipseContactKind>, 'children'>) {
	return (
		<ButtonGroup size="sm" {...props}>
			<ButtonGroupItem id="C1" label="C1" />
			<ButtonGroupItem id="C2" label="C2" />
			<ButtonGroupItem id="MAX" label="Max" />
			<ButtonGroupItem id="C3" label="C3" />
			<ButtonGroupItem id="C4" label="C4" />
		</ButtonGroup>
	)
}
