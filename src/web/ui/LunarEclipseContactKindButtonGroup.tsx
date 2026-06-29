import type { LunarEclipseContactKind } from 'nebulosa/src/astronomy/events/eclipse/lunar/map'
import { ButtonGroup, ButtonGroupItem, type ButtonGroupProps } from './components/ButtonGroup'

export function LunarEclipseContactKindButtonGroup(props: Omit<ButtonGroupProps<LunarEclipseContactKind>, 'children'>) {
	return (
		<ButtonGroup size="sm" {...props}>
			<ButtonGroupItem id="P1" label="P1" />
			<ButtonGroupItem id="U1" label="U1" />
			<ButtonGroupItem id="U2" label="U2" />
			<ButtonGroupItem id="MAX" label="Max" />
			<ButtonGroupItem id="U3" label="U3" />
			<ButtonGroupItem id="U4" label="U4" />
			<ButtonGroupItem id="P4" label="P4" />
		</ButtonGroup>
	)
}
